// Left rail for the Jobs Map. Always visible, scrollable.
// Layout (top → bottom):
//
//   ┌─ Tools (top, sticky inside the rail) ──────────┐
//   │  [Undo] [Redo] [Screenshot]                   │  ← global utilities
//   │                                                │
//   │  Map tools                                     │
//   │   [Recenter] [Fit all] [Resync]                │  ← always-active
//   │                                                │
//   │  Drawing tools                  Phase 3       │
//   │   [Cable] [MH] [HH] [Pole] [Photo] [A-tag]    │  ← disabled placeholders
//   │                                                │
//   │  Modifiers                                     │  ← disabled placeholders
//   │   Stroke • Color • Opacity                     │
//   └────────────────────────────────────────────────┘
//   ┌─ Filters (scrolls) ────────────────────────────┐
//   │  View (on-tracker / hide unmapped)            │
//   │  Secondary Job Status (color-coded)            │
//   │  Completed Jobs (separate, silver pin group)   │
//   │  Work Type tags                                │
//   └────────────────────────────────────────────────┘
//
// The drawing tools and modifiers are intentionally rendered as disabled
// placeholders right now — they get fully wired in Phase 3 once we lock the
// per-tool spec. This keeps the rail layout stable so we don't rebuild it.
import type { Job } from "@nsc/types";
import { useState } from "react";
import type { MutableRefObject } from "react";
import FilterRail from "./FilterRail.js";
import type { Filters } from "./FilterRail.js";
import { isJobCompleted } from "./markerStyle.js";

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  onResync: () => Promise<void> | void;
  mapRef: MutableRefObject<google.maps.Map | null>;
}

export default function LeftRail({ jobs, filters, setFilters, onResync, mapRef }: Props) {
  return (
    <aside className="left-rail">
      <div className="left-rail__scroll">
        <ToolsSection onResync={onResync} jobs={jobs} mapRef={mapRef} />
        <FilterRail
          jobs={jobs}
          filters={filters}
          setFilters={setFilters}
        />
      </div>
    </aside>
  );
}

function ToolsSection({
  onResync,
  jobs,
  mapRef,
}: {
  onResync: () => Promise<void> | void;
  jobs: Job[];
  mapRef: MutableRefObject<google.maps.Map | null>;
}) {
  const [resyncing, setResyncing] = useState(false);

  function fitAll() {
    const map = mapRef.current;
    if (!map) return;
    const mapped = jobs.filter(
      (j) => j.geocode?.status === "OK" && j.geocode.lat !== 0
    );
    if (mapped.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    mapped.forEach((j) =>
      bounds.extend({ lat: j.geocode!.lat, lng: j.geocode!.lng })
    );
    map.fitBounds(bounds, 60);
  }

  function recenter() {
    const map = mapRef.current;
    if (!map) return;
    // Western WA default center
    map.panTo({ lat: 47.5, lng: -122.1 });
    map.setZoom(9);
  }

  async function screenshot() {
    // The Google Maps tile canvas is cross-origin, so a true canvas capture
    // would taint. The cleanest cross-browser approach: ask the user to use
    // their OS screenshot for the map area. Long term we'll render the SVG
    // overlays to a separate canvas we own and compose them. Stub for now.
    alert(
      "Map screenshot: due to Google Maps cross-origin tiles, use your OS screenshot tool (⌘⇧4 on Mac, Win+Shift+S on Windows). Full in-app screenshots will arrive with the drawing tools in Phase 3."
    );
  }

  async function doResync() {
    if (resyncing) return;
    setResyncing(true);
    try {
      await onResync();
    } finally {
      setResyncing(false);
    }
  }

  return (
    <section className="rail-section rail-section--tools">
      {/* Top utilities — Undo, Redo, Screenshot */}
      <div className="tool-row tool-row--utilities">
        <button
          type="button"
          className="tool-btn"
          disabled
          title="Undo (available with drawing tools in Phase 3)"
          aria-label="Undo"
        >
          ↶
        </button>
        <button
          type="button"
          className="tool-btn"
          disabled
          title="Redo (available with drawing tools in Phase 3)"
          aria-label="Redo"
        >
          ↷
        </button>
        <button
          type="button"
          className="tool-btn"
          onClick={screenshot}
          title="Screenshot"
          aria-label="Screenshot"
        >
          ⎙
        </button>
      </div>

      <h4 className="rail-h4">Map tools</h4>
      <div className="tool-row">
        <button type="button" className="tool-btn tool-btn--text" onClick={fitAll}>
          Fit all
        </button>
        <button type="button" className="tool-btn tool-btn--text" onClick={recenter}>
          Recenter
        </button>
        <button
          type="button"
          className="tool-btn tool-btn--text"
          onClick={doResync}
          disabled={resyncing}
          title="Pull latest from Smartsheet"
        >
          {resyncing ? "Syncing…" : "Resync"}
        </button>
      </div>

      <h4 className="rail-h4 rail-h4--muted">
        Drawing <span className="rail-phase">Phase 3</span>
      </h4>
      <div className="tool-row tool-row--draw" aria-disabled="true">
        {[
          { k: "cable", label: "Cable" },
          { k: "removed", label: "Removed" },
          { k: "mh", label: "MH" },
          { k: "hh", label: "HH" },
          { k: "pole", label: "Pole" },
          { k: "vault", label: "Vault" },
          { k: "closure", label: "Closure" },
          { k: "atag", label: "A-tag" },
          { k: "photo", label: "Photo" },
        ].map((t) => (
          <button
            key={t.k}
            type="button"
            className="tool-btn tool-btn--draw"
            disabled
            title={`${t.label} (Phase 3)`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <h4 className="rail-h4 rail-h4--muted">
        Modifiers <span className="rail-phase">Phase 3</span>
      </h4>
      <div className="modifier-block" aria-disabled="true">
        <label className="modifier">
          <span>Stroke</span>
          <input type="range" min={1} max={10} defaultValue={3} disabled />
        </label>
        <label className="modifier">
          <span>Opacity</span>
          <input type="range" min={10} max={100} defaultValue={100} disabled />
        </label>
        <label className="modifier">
          <span>Color</span>
          <input type="color" defaultValue="#39ff7a" disabled />
        </label>
      </div>

      <div className="rail-section__divider" />
    </section>
  );
}

// Convenience export: re-exposed so callers can identify the completed bucket.
export { isJobCompleted };
