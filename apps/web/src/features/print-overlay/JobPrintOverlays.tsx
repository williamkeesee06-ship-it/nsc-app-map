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

  return (
    <>
      {pages.map((p) => {
        if (p.excluded) return null;
        // Use previewUrl (durable Storage reference) first, then objectUrl (temporary URL)
        const img = p.previewUrl || (p as any).objectUrl;
        if (!img) return null;

        const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
        const transform = doc.transforms?.[p.id] ?? {
          center: defaultCenter,
          scale: 1,
          rotationDeg: 0,
          opacity: 0.5,
        };
        const alignment = doc.alignments?.[p.id] ?? null;

        const sol = alignment && alignment.anchorA && alignment.anchorB
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
          />
        );
      })}
    </>
  );
}
