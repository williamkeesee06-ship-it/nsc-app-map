import { useState, useEffect, useRef } from "react";
import PageOverlay from "./PageOverlay.js";
import { solveGeoSolution } from "@nsc/types";
import { solutionFromTransform } from "./geoPlacement.js";
import { useMap } from "@vis.gl/react-google-maps";
import type { Job, PrintOverlayPage, PrintOverlaySource, PrintOverlayTransform, PrintOverlayDoc } from "@nsc/types";
import { getBlueprintImage, putBlueprintImage } from "./blueprintImageStore.js";
import { resolvePrintDocument, renderPagesFromDocument, type PrintDocumentMeta } from "./printDocumentStore.js";
import { api } from "../../lib/api.js";

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

  const [localTransforms, setLocalTransforms] = useState<Record<string, PrintOverlayTransform>>(
    doc?.transforms ?? {}
  );
  const [lockedMap, setLockedMap] = useState<Record<string, boolean>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (doc?.transforms) {
      setLocalTransforms((prev) => ({ ...doc.transforms, ...prev }));
    }
  }, [doc?.transforms]);

  const saveTransforms = (newTransforms: Record<string, PrintOverlayTransform>) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      if (!doc) return;
      const updatedDoc: PrintOverlayDoc = {
        ...doc,
        transforms: {
          ...(doc.transforms ?? {}),
          ...newTransforms,
        },
        updatedAt: Date.now(),
      };
      try {
        await api.putPrintOverlay(job.jobId, updatedDoc);
      } catch (err) {
        console.warn("[JobPrintOverlays] Auto-save transform failed:", err);
      }
    }, 300);
  };

  const updateTransform = (pageId: string, patch: Partial<PrintOverlayTransform>) => {
    setLocalTransforms((prev) => {
      const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
      const base: PrintOverlayTransform = prev[pageId] ?? doc?.transforms?.[pageId] ?? {
        center: defaultCenter,
        scale: 1,
        rotationDeg: 0,
        opacity: 0.5,
      };
      const updated = { ...base, ...patch, isPlaced: true };
      const next = { ...prev, [pageId]: updated };
      saveTransforms(next);
      return next;
    });
  };

  const toggleLock = (pageId: string) => {
    setLockedMap((prev) => {
      const currentLocked = prev[pageId] ?? doc?.transforms?.[pageId]?.isLocked ?? false;
      const nextLocked = !currentLocked;
      updateTransform(pageId, { isLocked: nextLocked });
      return { ...prev, [pageId]: nextLocked };
    });
  };

  const handleDeletePage = async (pageId: string) => {
    if (!doc) return;
    const p = pages.find((pg) => pg.id === pageId);
    const label = p?.label || `Page ${p?.pageNumber ?? ""}`;
    if (!window.confirm(`Permanently remove "${label}" from the map overlay?`)) return;

    const updatedPages = (doc.pages ?? []).filter((pg) => pg.id !== pageId);
    const updatedTransforms = { ...(doc.transforms ?? {}) };
    delete updatedTransforms[pageId];
    const updatedAlignments = { ...(doc.alignments ?? {}) };
    delete updatedAlignments[pageId];

    const updatedDoc: PrintOverlayDoc = {
      ...doc,
      pages: updatedPages,
      transforms: updatedTransforms,
      alignments: updatedAlignments,
      updatedAt: Date.now(),
    };
    try {
      await api.putPrintOverlay(job.jobId, updatedDoc);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (err) {
      console.error("[JobPrintOverlays] Failed to delete page", err);
    }
  };

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
        const transform = localTransforms[p.id] ?? doc.transforms?.[p.id] ?? {
          center: defaultCenter,
          scale: 1,
          rotationDeg: 0,
          opacity: 0.5,
        };
        const alignment = doc.alignments?.[p.id] ?? null;
        const isAnchored = !!(alignment && alignment.anchorA && alignment.anchorB);

        const tCenter = transform?.center;
        const isAtDefault =
          !!tCenter &&
          Math.abs(tCenter.lat - defaultCenter.lat) < 1e-9 &&
          Math.abs(tCenter.lng - defaultCenter.lng) < 1e-9 &&
          (transform?.scale ?? 1) === 1 &&
          (transform?.rotationDeg ?? 0) === 0;
        if (!isAnchored && isAtDefault && !transform?.isPlaced) return null;

        const sol = isAnchored
          ? (() => { try { return solveGeoSolution(alignment); } catch { return solutionFromTransform(transform, p.pageWidth, p.pageHeight); } })()
          : solutionFromTransform(transform, p.pageWidth, p.pageHeight);
        if (!sol) return null;

        const isLocked = lockedMap[p.id] ?? transform.isLocked ?? false;

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
            locked={isLocked}
            mode="move"
            anchors={[]}
            scale={transform?.scale ?? 1}
            rotationDeg={transform?.rotationDeg ?? 0}
            onDragCenter={(center) => updateTransform(p.id, { center })}
            onPagePoint={() => {}}
            onScale={(scale) => updateTransform(p.id, { scale })}
            onRotate={(deg) => updateTransform(p.id, { rotationDeg: deg })}
            onToggleLock={() => toggleLock(p.id)}
            onDeletePage={() => void handleDeletePage(p.id)}
            southWestLat={undefined}
            southWestLng={undefined}
            northEastLat={undefined}
            northEastLng={undefined}
            rotationDegrees={undefined}
            blendMode={transform?.blendMode ?? "multiply"}
          />
        );
      })}
    </>
  );
}
