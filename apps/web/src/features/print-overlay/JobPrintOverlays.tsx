import PageOverlay from "./PageOverlay.js";
import { solveGeoSolution } from "@nsc/types";
import { solutionFromTransform } from "./geoPlacement.js";
import { useMap } from "@vis.gl/react-google-maps";
import type { Job } from "@nsc/types";

interface JobPrintOverlaysProps {
  job: Job;
  visible?: boolean;
}

export default function JobPrintOverlays({ job, visible = true }: JobPrintOverlaysProps) {
  const map = useMap();
  if (!map || !visible || !job.printOverlay) return null;

  const doc = job.printOverlay;
  const pages = doc.pages ?? [];

  // Fallback PDF / permit file download URL from ziplyPrintLayer if previewUrl is missing
  const permitFile = job.ziplyPrintLayer?.permitFiles?.find(
    (f) => f.name?.toLowerCase().endsWith(".pdf") || f.downloadUrl
  ) ?? job.ziplyPrintLayer?.permitFiles?.[0];

  return (
    <>
      {pages.map((p) => {
        if (p.excluded) return null;
        const source = doc.sources?.find((s) => s.documentId === p.documentId);
        const img = p.previewUrl || (p as any).objectUrl || source?.downloadUrl || permitFile?.downloadUrl;
        if (!img) return null;

        const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.95, lng: -121.97 };
        const transform = doc.transforms?.[p.id] ?? {
          center: defaultCenter,
          scale: 1,
          rotationDeg: 0,
          opacity: 0.7,
        };
        const alignment = doc.alignments?.[p.id] ?? null;

        const sol = alignment && alignment.anchorA && alignment.anchorB
          ? (() => { try { return solveGeoSolution(alignment); } catch { return null; } })()
          : solutionFromTransform(transform, p.pageWidth || 1000, p.pageHeight || 1000);
        if (!sol) return null;

        const opacity = typeof transform.opacity === "number" && transform.opacity > 0 ? transform.opacity : 0.7;
        const imgW = p.pageWidth || 1000;
        const imgH = p.pageHeight || 1000;

        return (
          <PageOverlay
            key={p.id}
            map={map}
            imageUrl={img}
            imgW={imgW}
            imgH={imgH}
            crop={p.crop}
            solution={sol}
            opacity={opacity}
            locked={true}
            mode="move"
            anchors={[]}
            scale={transform?.scale ?? 1}
            rotationDeg={transform?.rotationDeg ?? 0}
            onDragCenter={() => {}}
            onPagePoint={() => {}}
            onScale={() => {}}
            onRotate={() => {}}
          />
        );
      })}
    </>
  );
}
