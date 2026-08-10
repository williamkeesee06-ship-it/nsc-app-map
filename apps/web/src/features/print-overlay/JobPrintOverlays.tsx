import { useState, useEffect } from "react";
import PageOverlay from "./PageOverlay.js";
import { solveGeoSolution } from "@nsc/types";
import { solutionFromTransform } from "./geoPlacement.js";
import { useMap } from "@vis.gl/react-google-maps";
import type { Job, PrintOverlayPage, PrintOverlaySource } from "@nsc/types";
import { getBlueprintImage, putBlueprintImage } from "./blueprintImageStore.js";
import { resolvePrintDocument, renderPagesFromDocument, type PrintDocumentMeta } from "./printDocumentStore.js";

interface JobPrintOverlaysProps {
  job: Job;
  visible?: boolean;
}

export default function JobPrintOverlays({ job, visible = true }: JobPrintOverlaysProps) {
  const map = useMap();
  const [resolvedImages, setResolvedImages] = useState<Record<string, string>>({});
  const [, setRestoringIds] = useState<Set<string>>(new Set());

  const doc = job.printOverlay;
  const pages = doc?.pages ?? [];
  const sources = doc?.sources ?? [];

  useEffect(() => {
    if (!doc || pages.length === 0) return;

    let cancelled = false;

    async function resolvePageImages() {
      const updates: Record<string, string> = {};
      const missingPages: PrintOverlayPage[] = [];

      for (const p of pages) {
        if (p.excluded) continue;

        // Tier 1 & Tier 2: Existing valid preview URL or cached IndexedDB image
        let url = p.previewUrl && !p.previewUrl.startsWith("blob:") ? p.previewUrl : null;
        if (!url) {
          const cached = await getBlueprintImage(p.id);
          if (cached) {
            url = cached;
          }
        }

        if (url) {
          updates[p.id] = url;
        } else {
          missingPages.push(p);
        }
      }

      if (!cancelled && Object.keys(updates).length > 0) {
        setResolvedImages((prev) => ({ ...prev, ...updates }));
      }

      // Tier 3: Re-render missing pages from source PDF (on-demand)
      if (missingPages.length > 0) {
        const missingSet = new Set(missingPages.map((p) => p.id));
        setRestoringIds(missingSet);

        // Group by document ID so each PDF is read once
        const byDoc = new Map<string, PrintOverlayPage[]>();
        for (const p of missingPages) {
          const arr = byDoc.get(p.documentId) ?? [];
          arr.push(p);
          byDoc.set(p.documentId, arr);
        }

        for (const [docId, docPages] of byDoc.entries()) {
          if (cancelled) break;
          const src: PrintOverlaySource | undefined = sources.find((s) => s.documentId === docId);
          const meta: PrintDocumentMeta = {
            id: docId,
            jobId: job.jobId,
            fileName: src?.name ?? `${docId}.pdf`,
            pageCount: src?.pageCount ?? 1,
            byteSize: src?.size ?? 0,
            uploadedAt: new Date().toISOString(),
            cloudUrl: src?.downloadUrl ?? undefined,
          };

          const bytes = await resolvePrintDocument(meta);
          if (!bytes || cancelled) continue;

          const pageNumbers = Array.from(new Set(docPages.map((p) => p.pageNumber)));
          const rendered = await renderPagesFromDocument(bytes.slice(0), pageNumbers, 2.0);

          for (const p of docPages) {
            const dataUrl = rendered.get(p.pageNumber);
            if (dataUrl && !cancelled) {
              await putBlueprintImage(p.id, dataUrl);
              setResolvedImages((prev) => ({ ...prev, [p.id]: dataUrl }));
            }
          }
        }

        if (!cancelled) {
          setRestoringIds(new Set());
        }
      }
    }

    void resolvePageImages();

    return () => {
      cancelled = true;
    };
  }, [doc, pages, sources, job.jobId]);

  if (!map || !visible || !doc) return null;

  return (
    <>
      {pages.map((p) => {
        if (p.excluded) return null;

        const img = resolvedImages[p.id] || (p.previewUrl && !p.previewUrl.startsWith("blob:") ? p.previewUrl : null) || (p as any).objectUrl;
        if (!img) return null;

        const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
        const transform = doc.transforms?.[p.id] ?? {
          center: defaultCenter,
          scale: 1,
          rotationDeg: 0,
          opacity: 0.5,
        };
        const alignment = doc.alignments?.[p.id] ?? null;
        const isAnchored = !!(alignment && alignment.anchorA && alignment.anchorB);

        const sol = isAnchored
          ? (() => { try { return solveGeoSolution(alignment); } catch { return solutionFromTransform(transform, p.pageWidth, p.pageHeight); } })()
          : solutionFromTransform(transform, p.pageWidth, p.pageHeight);
        if (!sol) return null;

        return (
          <PageOverlay
            key={p.id}
            map={map}
            imageUrl={img}
            imgW={p.pageWidth}
            imgH={p.pageHeight}
            crop={p.crop}
            solution={sol}
            opacity={transform?.opacity ?? 0.5}
            locked={true}
            mode="move"
            anchors={[]}
            scale={transform?.scale ?? 1}
            rotationDeg={transform?.rotationDeg ?? 0}
            onDragCenter={() => {}}
            onPagePoint={() => {}}
            onScale={() => {}}
            onRotate={() => {}}
            southWestLat={isAnchored ? undefined : transform?.southWestLat}
            southWestLng={isAnchored ? undefined : transform?.southWestLng}
            northEastLat={isAnchored ? undefined : transform?.northEastLat}
            northEastLng={isAnchored ? undefined : transform?.northEastLng}
            rotationDegrees={isAnchored ? undefined : transform?.rotationDegrees}
            blendMode={transform?.blendMode ?? "multiply"}
          />
        );
      })}
    </>
  );
}
