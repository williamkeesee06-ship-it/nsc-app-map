/**
 * Lake Stevens digital twin — loads plant.json built from all 65 SHARED PDF pages.
 * Renders clickable plant CAD (same neon/metal ZiplyPrintOverlay) for that twin only.
 */
import { useEffect, useMemo, useState } from "react";
import type { Job } from "@nsc/types";
import ZiplyPrintOverlay from "../jobs-map/ZiplyPrintOverlay.js";

type PlantFile = {
  source?: { workOrder?: string; hubId?: string; pages?: number };
  jobMatch?: { workOrders?: string[]; hubIds?: string[]; city?: string };
  mapObjects: NonNullable<NonNullable<Job["ziplyPrintLayer"]>["mapObjects"]>;
  stats?: Record<string, number>;
};

const TWIN_JOB_ID = "exp-h3024-lake-stevens";

function buildTwinJob(plant: PlantFile): Job {
  const mo = plant.mapObjects;
  const hub = mo.hub;
  const now = Date.now();
  return {
    jobId: TWIN_JOB_ID,
    workOrder: plant.source?.workOrder || "6007959",
    jobName: "H3024 Lake Stevens DIGITAL TWIN (65-page print)",
    address: "6105 Foster Slough Rd",
    city: "Lake Stevens",
    zipCode: "98290",
    customerProject: "Ziply",
    hubNumber: plant.source?.hubId || "H3024",
    geocode:
      hub?.lat != null && hub?.lng != null
        ? {
            lat: hub.lat as number,
            lng: hub.lng as number,
            formattedAddress: "6105 Foster Slough Rd, Lake Stevens, WA 98290",
            sourceAddress: "6105 Foster Slough Rd",
            cachedAt: now,
            status: "OK",
          }
        : undefined,
    ziplyPrintLayer: {
      hubId: plant.source?.hubId || "H3024",
      hubTypeSize: "432 FDH",
      terminalCount: mo.terminals?.length ?? null,
      fiberCountsPerCable: null,
      drops: {
        lu: mo.dropSites?.length ?? null,
        mdu: 0,
        bu: 0,
        total: mo.dropSites?.length ?? null,
      },
      permittedExcavationMethods: ["bore", "aerial"],
      strandType: null,
      conduitSize: null,
      specialNotes: mo.notes ?? null,
      permits: null,
      mapObjects: mo,
      printGeometryEnhancedAt: now,
    },
    ziplyIngest: {
      status: "complete",
      completedAt: now,
      updatedAt: now,
    },
  } as unknown as Job;
}

interface Props {
  active: boolean;
  /** When true, hide real multi-job plant and show twin only */
  onTwinReady?: (job: Job | null) => void;
}

export default function LakeStevensDigitalTwin({ active, onTwinReady }: Props) {
  const [plant, setPlant] = useState<PlantFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [stats, setStats] = useState<string>("");

  useEffect(() => {
    if (!active) {
      onTwinReady?.(null);
      return;
    }
    let cancelled = false;
    fetch("/experiments/lake-stevens/h3024/plant.json")
      .then((r) => {
        if (!r.ok) throw new Error(`plant.json ${r.status} — run scripts/extract_h3024_plant.py`);
        return r.json() as Promise<PlantFile>;
      })
      .then((p) => {
        if (cancelled) return;
        setPlant(p);
        const s = p.stats;
        setStats(
          s
            ? `${s.terminalsLocated ?? 0}/${s.terminals ?? 0} terminals · ${s.cables ?? 0} cables · ${s.drops ?? 0} drops · ${s.pages ?? 65} pages`
            : "loaded"
        );
        onTwinReady?.(buildTwinJob(p));
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Failed to load digital twin");
          onTwinReady?.(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active, onTwinReady]);

  const twinJob = useMemo(() => (plant ? buildTwinJob(plant) : null), [plant]);

  if (!active) return null;

  return (
    <>
      {twinJob && (
        <ZiplyPrintOverlay
          jobs={[twinJob]}
          focusJobId={TWIN_JOB_ID}
          visible
          show811Clearance={false}
        />
      )}
      <div
        style={{
          position: "absolute",
          left: 12,
          top: 72,
          zIndex: 10,
          maxWidth: 320,
          padding: "10px 12px",
          borderRadius: 10,
          background: "linear-gradient(180deg,#f4f6f8,#d8dde4)",
          border: "1px solid #8e96a0",
          boxShadow: "0 8px 22px rgba(0,0,0,0.2)",
          fontSize: 11,
          color: "#15202c",
        }}
      >
        <div style={{ fontWeight: 800, color: "#1d4ed8", letterSpacing: "0.08em" }}>
          H3024 DIGITAL TWIN
        </div>
        <div style={{ marginTop: 4, color: "#3a4654", lineHeight: 1.35 }}>
          {err ? (
            <span style={{ color: "#b91c1c" }}>{err}</span>
          ) : plant ? (
            <>
              Full print → map from SHARED 65-page design.
              <br />
              <strong>{stats}</strong>
              <br />
              Click cables / MSTs for callouts. Only this plant is live.
            </>
          ) : (
            "Loading digital twin plant…"
          )}
        </div>
      </div>
    </>
  );
}
