/**
 * StructureDetailCard
 *
 * Lightweight, read-only floating card that appears next to the cursor when a
 * user clicks a structure marker or polyline on the map. Unlike the heavier
 * Studio-app FeatureInspector (which is an editor), this is purely display:
 *
 *   - Title:  <layer icon> <human label>                    [× close]
 *   - Meta:   Job #WO — Job Name  (or raw jobId if unknown)
 *             Hub • City
 *   - Status: colored pill
 *   - Coords: lat/lng (structures) or vertex count (polylines)
 *   - Action: "Open in Left Rail"  → mirrors the same feature into the
 *             LeftRail's FeatureDetailSheet for the full multi-tab view.
 *
 * Positioning is absolute inside the map wrapper; we clamp so the card can
 * never render off-screen. The parent controls visibility by passing / not
 * passing a `feature`. All hard styling lives in structureDetailCard.css so
 * theming (Network View vs Light) can override cleanly.
 */
import { useEffect, useMemo, useRef, memo } from "react";
import type { PlatformFeature } from "../ziply/FeatureDetailSheet.js";
import type { Job } from "@nsc/types";
import "./structureDetailCard.css";

interface Props {
  feature: PlatformFeature | null;
  anchor: { x: number; y: number } | null;
  /** Full job list so we can enrich the card with WO#/name/hub/city on the fly. */
  allJobs: Job[];
  onClose: () => void;
  /** Open the same feature in the LeftRail's FeatureDetailSheet (full editor). */
  onOpenInRail: (feature: PlatformFeature) => void;
  /** Recenter the map on the feature (structures only). */
  onNavigate?: (feature: PlatformFeature) => void;
}

// ─── Layer visuals ──────────────────────────────────────────────────────────
// Emoji icons keep the card zero-dependency; the color pill uses the same
// palette as the drawing tools so users get the same visual language they see
// on the map. If we add real SVG icons later, swap this table only.
const LAYER_ICON: Record<string, string> = {
  pole: "⛊",
  handhole: "◆",
  manhole: "⬢",
  pedestal: "🏛",
  cabinet: "▣",
  anchor: "⚓",
  splice: "✦",
  hub: "◉",
  terminal: "◈",
  feeder: "━",
  distribution: "─",
  drop: "↳",
  bore: "⇢",
  address: "🏠",
  service_point: "🏠",
  flower_pot: "❁",
  cable: "━",
};

const LAYER_LABEL: Record<string, string> = {
  pole: "Pole",
  handhole: "Handhole",
  manhole: "Manhole",
  pedestal: "Pedestal",
  cabinet: "Cabinet",
  anchor: "Anchor",
  splice: "Splice",
  hub: "Hub",
  terminal: "Terminal",
  feeder: "Feeder",
  distribution: "Distribution",
  drop: "Drop",
  bore: "Bore",
  address: "Address",
  service_point: "Service point",
  flower_pot: "Flower pot",
  cable: "Cable",
};

const STATUS_COLOR: Record<string, string> = {
  planned: "#3B82F6",
  designed: "#64748B",
  in_progress: "#F59E0B",
  complete: "#16A34A",
  live: "#39FF14",
  on_hold: "#DC2626",
};

const CARD_W = 280;
const CARD_H_APPROX = 200;
const GUTTER = 12;

function StructureDetailCard({
  feature,
  anchor,
  allJobs,
  onClose,
  onOpenInRail,
  onNavigate,
}: Props) {
  // Escape closes the card — feels native to power users.
  useEffect(() => {
    if (!feature) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [feature, onClose]);

  // Auto-focus the card so keyboard interactions land here, not on the map.
  const cardRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (feature && cardRef.current) cardRef.current.focus();
  }, [feature]);

  // Enrich props from the job list — the overlay only knows jobId, so we do
  // the WO#/name/hub lookup here where allJobs is already in memory.
  const enriched = useMemo(() => {
    if (!feature) return null;
    const jobId = String(feature.properties.jobId ?? "");
    const job = allJobs.find((j) => j.jobId === jobId);
    return {
      jobId,
      wo: (job?.workOrder ?? (feature.properties.jobWorkOrder as string | undefined)) ?? undefined,
      // No `name` field on Job — use address as the human-friendly label so
      // the card still reads well when the WO alone is meaningless.
      name: job?.address ?? undefined,
      hub: (job?.hubNumber ?? (feature.properties.hub as string | undefined)) ?? undefined,
      city: (job?.city ?? (feature.properties.city as string | undefined)) ?? undefined,
    };
  }, [feature, allJobs]);

  if (!feature || !anchor) return null;

  const p = feature.properties;
  const layer = String(p.layer ?? "");
  const label = String(p.label ?? LAYER_LABEL[layer] ?? "Feature");
  const status = String(p.status ?? "");
  const lat = typeof p.lat === "number" ? p.lat : undefined;
  const lng = typeof p.lng === "number" ? p.lng : undefined;
  const geomKind = feature.geometry?.type;

  // Clamp position so the card stays on-screen.
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  const rawX = anchor.x + GUTTER;
  const rawY = anchor.y - CARD_H_APPROX / 2;
  const left = Math.min(Math.max(rawX, GUTTER), vw - CARD_W - GUTTER);
  const top = Math.min(Math.max(rawY, GUTTER), vh - CARD_H_APPROX - GUTTER);

  const accent = String(p.strokeColor ?? p.fillColor ?? "#0EA5E9");
  const statusColor = status ? STATUS_COLOR[status] ?? "#64748B" : null;

  return (
    <div
      ref={cardRef}
      className="structure-detail-card"
      role="dialog"
      aria-label={`${LAYER_LABEL[layer] ?? "Feature"} detail`}
      tabIndex={-1}
      style={{ left, top, width: CARD_W, borderLeftColor: accent }}
      // Prevent click-through to the map behind the card (would trigger
      // dismiss + reselection loops).
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <header className="structure-detail-card__header">
        <span className="structure-detail-card__icon" aria-hidden>
          {LAYER_ICON[layer] ?? "◇"}
        </span>
        <div className="structure-detail-card__title">
          <div className="structure-detail-card__label" title={label}>
            {label}
          </div>
          <div className="structure-detail-card__sublabel">
            {LAYER_LABEL[layer] ?? layer}
          </div>
        </div>
        <button
          type="button"
          className="structure-detail-card__close"
          aria-label="Close detail"
          onClick={onClose}
        >
          ×
        </button>
      </header>

      <dl className="structure-detail-card__meta">
        {/* Job # = Smartsheet Primary column (stored on Job.workOrder).
            Always shown; falls back to raw jobId only if the row was
            somehow ingested without a Primary value. */}
        {enriched?.jobId && (
          <>
            <dt>Job #</dt>
            <dd title={enriched.jobId}>
              {enriched.wo ?? enriched.jobId}
              {enriched.name ? ` — ${enriched.name}` : ""}
            </dd>
          </>
        )}
        {enriched?.hub && (
          <>
            <dt>Hub</dt>
            <dd>{enriched.hub}</dd>
          </>
        )}
        {enriched?.city && !enriched?.hub && (
          <>
            <dt>City</dt>
            <dd>{enriched.city}</dd>
          </>
        )}
        {enriched?.city && enriched?.hub && (
          <>
            <dt>City</dt>
            <dd>{enriched.city}</dd>
          </>
        )}
        {statusColor && (
          <>
            <dt>Status</dt>
            <dd>
              <span
                className="structure-detail-card__pill"
                style={{ background: statusColor }}
              >
                {status.replace(/_/g, " ")}
              </span>
            </dd>
          </>
        )}
        {geomKind === "Point" && lat !== undefined && lng !== undefined && (
          <>
            <dt>Coords</dt>
            <dd>{lat.toFixed(6)}, {lng.toFixed(6)}</dd>
          </>
        )}
        {geomKind === "LineString" && Array.isArray(feature.geometry?.coordinates) && (
          <>
            <dt>Path</dt>
            <dd>{(feature.geometry?.coordinates as unknown[]).length} points</dd>
          </>
        )}
      </dl>

      <footer className="structure-detail-card__footer">
        {geomKind === "Point" && onNavigate && (
          <button
            type="button"
            className="structure-detail-card__btn structure-detail-card__btn--ghost"
            onClick={() => onNavigate(feature)}
          >
            Navigate
          </button>
        )}
        <button
          type="button"
          className="structure-detail-card__btn structure-detail-card__btn--primary"
          onClick={() => onOpenInRail(feature)}
        >
          Open in Left Rail
        </button>
      </footer>
    </div>
  );
}

export default memo(StructureDetailCard);
