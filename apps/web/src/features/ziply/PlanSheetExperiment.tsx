/**
 * Lake Stevens plan-sheet experiment panel.
 * - All design pages from SHARED PDF (manifest) as georeferenced map overlays
 * - Used alongside ZiplyPrintOverlay plant CAD for the isolated LS job
 * - Registration (bounds/opacity) stored per page in localStorage
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useMap } from "@vis.gl/react-google-maps";

type LatLng = { lat: number; lng: number };
type Bounds = { sw: LatLng; ne: LatLng };

type PageMeta = {
  page: number;
  file: string;
  width: number;
  height: number;
};

type PackageMeta = {
  id: string;
  label: string;
  workOrder?: string;
  hubId?: string;
  pages: PageMeta[];
};

type Manifest = {
  city: string;
  seedBounds: Bounds;
  focusWorkOrders?: string[];
  packages: PackageMeta[];
};

type PageReg = {
  bounds: Bounds;
  opacity: number;
  visible: boolean;
};

const LS_KEY = "nsc.ziply.planSheetExperiment.v2";

function loadRegs(): Record<string, PageReg> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, PageReg>;
  } catch {
    return {};
  }
}

function saveRegs(regs: Record<string, PageReg>) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(regs));
  } catch {
    /* ignore */
  }
}

function regKey(pkgId: string, page: number) {
  return `${pkgId}:${page}`;
}

function shiftBounds(b: Bounds, dLat: number, dLng: number): Bounds {
  return {
    sw: { lat: b.sw.lat + dLat, lng: b.sw.lng + dLng },
    ne: { lat: b.ne.lat + dLat, lng: b.ne.lng + dLng },
  };
}

function scaleBounds(b: Bounds, factor: number): Bounds {
  const cLat = (b.sw.lat + b.ne.lat) / 2;
  const cLng = (b.sw.lng + b.ne.lng) / 2;
  const hLat = ((b.ne.lat - b.sw.lat) / 2) * factor;
  const hLng = ((b.ne.lng - b.sw.lng) / 2) * factor;
  return {
    sw: { lat: cLat - hLat, lng: cLng - hLng },
    ne: { lat: cLat + hLat, lng: cLng + hLng },
  };
}

function useGroundOverlay(
  map: google.maps.Map | null,
  url: string | null,
  bounds: Bounds | null,
  opacity: number,
  visible: boolean
) {
  const overlayRef = useRef<google.maps.GroundOverlay | null>(null);

  useEffect(() => {
    if (!map || !url || !bounds || !visible) {
      overlayRef.current?.setMap(null);
      overlayRef.current = null;
      return;
    }
    const gBounds = new google.maps.LatLngBounds(
      { lat: bounds.sw.lat, lng: bounds.sw.lng },
      { lat: bounds.ne.lat, lng: bounds.ne.lng }
    );
    overlayRef.current?.setMap(null);
    const ov = new google.maps.GroundOverlay(url, gBounds, {
      opacity,
      clickable: false,
    });
    ov.setMap(map);
    overlayRef.current = ov;
    return () => {
      ov.setMap(null);
      if (overlayRef.current === ov) overlayRef.current = null;
    };
  }, [
    map,
    url,
    bounds?.sw.lat,
    bounds?.sw.lng,
    bounds?.ne.lat,
    bounds?.ne.lng,
    opacity,
    visible,
  ]);
}

interface Props {
  active: boolean;
}

export default function PlanSheetExperiment({ active }: Props) {
  const map = useMap();
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pkgId, setPkgId] = useState("h3024");
  const [pageIdx, setPageIdx] = useState(0);
  const [regs, setRegs] = useState<Record<string, PageReg>>(() => loadRegs());
  const [nudge, setNudge] = useState(0.00035);
  const [sheetUnderCad, setSheetUnderCad] = useState(true);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch("/experiments/lake-stevens/manifest.json")
      .then((r) => {
        if (!r.ok) throw new Error(`manifest ${r.status} — run PDF rasterize from SHARED`);
        return r.json() as Promise<Manifest>;
      })
      .then((m) => {
        if (cancelled) return;
        setManifest(m);
        // Prefer full 65-page H3024 package
        const prefer =
          m.packages.find((p) => p.id === "h3024") ?? m.packages[0];
        if (prefer) setPkgId(prefer.id);
      })
      .catch((e) => {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : "Could not load plan sheets");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [active]);

  const pkg = useMemo(
    () =>
      manifest?.packages.find((p) => p.id === pkgId) ??
      manifest?.packages[0] ??
      null,
    [manifest, pkgId]
  );
  const page = pkg?.pages[pageIdx] ?? null;
  const key = pkg && page ? regKey(pkg.id, page.page) : "";
  const seed = manifest?.seedBounds ?? {
    sw: { lat: 47.998, lng: -122.092 },
    ne: { lat: 48.032, lng: -122.038 },
  };

  const reg: PageReg = key
    ? (regs[key] ?? { bounds: seed, opacity: 0.55, visible: true })
    : { bounds: seed, opacity: 0.55, visible: true };

  const updateReg = useCallback(
    (patch: Partial<PageReg>) => {
      if (!key) return;
      setRegs((prev) => {
        const base = prev[key] ?? {
          bounds: seed,
          opacity: 0.55,
          visible: true,
        };
        const next = { ...prev, [key]: { ...base, ...patch } };
        saveRegs(next);
        return next;
      });
    },
    [key, seed]
  );

  useGroundOverlay(
    active ? map : null,
    active && page && sheetUnderCad ? page.file : null,
    active ? reg.bounds : null,
    reg.opacity,
    active && reg.visible && sheetUnderCad
  );

  useEffect(() => {
    if (!active || !map || !manifest) return;
    const b = new google.maps.LatLngBounds(
      { lat: seed.sw.lat, lng: seed.sw.lng },
      { lat: seed.ne.lat, lng: seed.ne.lng }
    );
    map.fitBounds(b, 48);
  }, [active, map, manifest?.city]);

  if (!active) return null;

  return (
    <div
      style={{
        position: "absolute",
        right: 12,
        top: 72,
        zIndex: 9,
        width: "min(360px, calc(100% - 24px))",
        maxHeight: "min(78vh, 640px)",
        overflow: "auto",
        background: "linear-gradient(180deg, #f4f6f8 0%, #d8dde4 100%)",
        border: "1px solid #8e96a0",
        borderRadius: 12,
        boxShadow:
          "0 10px 28px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.85)",
        color: "#15202c",
        fontSize: 12,
        padding: 12,
      }}
    >
      <div
        style={{
          fontWeight: 800,
          letterSpacing: "0.1em",
          color: "#1d4ed8",
          marginBottom: 4,
        }}
      >
        LAKE STEVENS · FULL PRINT
      </div>
      <div
        style={{
          fontSize: 10,
          color: "#5b6776",
          marginBottom: 10,
          lineHeight: 1.4,
        }}
      >
        Map shows <strong>only</strong> the Lake Stevens design job. Plant CAD
        lines stay clickable. Below: every page of the SHARED design PDF as a
        georeferenced sheet under the plant — flip pages and align to streets.
      </div>

      {err && (
        <div style={{ color: "#b91c1c", marginBottom: 8, fontSize: 11 }}>
          {err}
        </div>
      )}

      {!manifest && !err && (
        <div style={{ color: "#5b6776" }}>
          Loading all plan pages from SHARED PDF…
        </div>
      )}

      {manifest && pkg && (
        <>
          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#1d4ed8",
              marginBottom: 8,
              padding: 8,
              background: "#e8f0ff",
              borderRadius: 8,
              border: "1px solid #93c5fd",
            }}
          >
            {pkg.label}
            <br />
            <span style={{ color: "#3a4654", fontWeight: 600 }}>
              {pkg.pages.length} pages loaded from SHARED · WO{" "}
              {pkg.workOrder ?? "—"} · {pkg.hubId ?? "—"}
            </span>
          </div>

          <label style={lab}>
            Design package
            <select
              value={pkg.id}
              onChange={(e) => {
                setPkgId(e.target.value);
                setPageIdx(0);
              }}
              style={sel}
            >
              {manifest.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label style={lab}>
            Plan page {pageIdx + 1} / {pkg.pages.length}
            <input
              type="range"
              min={0}
              max={Math.max(0, pkg.pages.length - 1)}
              value={pageIdx}
              onChange={(e) => setPageIdx(Number(e.target.value))}
              style={{ width: "100%" }}
            />
          </label>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              style={btn}
              disabled={pageIdx <= 0}
              onClick={() => setPageIdx((i) => Math.max(0, i - 1))}
            >
              ‹ Prev
            </button>
            <button
              type="button"
              style={btn}
              disabled={pageIdx >= pkg.pages.length - 1}
              onClick={() =>
                setPageIdx((i) => Math.min(pkg.pages.length - 1, i + 1))
              }
            >
              Next ›
            </button>
            <button
              type="button"
              style={btn}
              onClick={() => {
                if (!map) return;
                const b = reg.bounds;
                map.fitBounds(
                  new google.maps.LatLngBounds(
                    { lat: b.sw.lat, lng: b.sw.lng },
                    { lat: b.ne.lat, lng: b.ne.lng }
                  ),
                  40
                );
              }}
            >
              Fit
            </button>
          </div>

          {/* Quick jump: skip cover noise — plan sheets often start ~page 5+ */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
            {[1, 5, 10, 15, 20, 25, 30, 40, 50, 60].map((p) => {
              if (p > pkg.pages.length) return null;
              return (
                <button
                  key={p}
                  type="button"
                  style={{
                    ...btn,
                    flex: "0 0 auto",
                    padding: "4px 8px",
                    background:
                      pageIdx + 1 === p
                        ? "linear-gradient(180deg,#3b82f6,#1d4ed8)"
                        : btn.background,
                    color: pageIdx + 1 === p ? "#fff" : btn.color,
                  }}
                  onClick={() => setPageIdx(p - 1)}
                >
                  p{p}
                </button>
              );
            })}
          </div>

          {page && (
            <div
              style={{
                marginBottom: 8,
                borderRadius: 8,
                overflow: "hidden",
                border: "1px solid #a8b0ba",
                background: "#fff",
                maxHeight: 160,
              }}
            >
              <img
                src={page.file}
                alt={`Page ${page.page}`}
                style={{
                  width: "100%",
                  display: "block",
                  objectFit: "contain",
                  maxHeight: 160,
                }}
              />
            </div>
          )}

          <label
            style={{
              ...lab,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <input
              type="checkbox"
              checked={sheetUnderCad}
              onChange={(e) => setSheetUnderCad(e.target.checked)}
            />
            Show this plan page under plant CAD
          </label>

          <label style={lab}>
            Sheet opacity {Math.round(reg.opacity * 100)}%
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.05}
              value={reg.opacity}
              onChange={(e) => updateReg({ opacity: Number(e.target.value) })}
              style={{ width: "100%" }}
            />
          </label>

          <div
            style={{
              fontSize: 10,
              fontWeight: 700,
              color: "#3a4654",
              margin: "8px 0 4px",
            }}
          >
            Align sheet to basemap
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 4,
              marginBottom: 6,
            }}
          >
            <span />
            <button
              type="button"
              style={btn}
              onClick={() =>
                updateReg({ bounds: shiftBounds(reg.bounds, nudge, 0) })
              }
            >
              N
            </button>
            <span />
            <button
              type="button"
              style={btn}
              onClick={() =>
                updateReg({ bounds: shiftBounds(reg.bounds, 0, -nudge) })
              }
            >
              W
            </button>
            <button
              type="button"
              style={btn}
              onClick={() => updateReg({ bounds: seed })}
            >
              ⟲
            </button>
            <button
              type="button"
              style={btn}
              onClick={() =>
                updateReg({ bounds: shiftBounds(reg.bounds, 0, nudge) })
              }
            >
              E
            </button>
            <span />
            <button
              type="button"
              style={btn}
              onClick={() =>
                updateReg({ bounds: shiftBounds(reg.bounds, -nudge, 0) })
              }
            >
              S
            </button>
            <span />
          </div>

          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button
              type="button"
              style={btn}
              onClick={() =>
                updateReg({ bounds: scaleBounds(reg.bounds, 0.92) })
              }
            >
              Scale −
            </button>
            <button
              type="button"
              style={btn}
              onClick={() =>
                updateReg({ bounds: scaleBounds(reg.bounds, 1.08) })
              }
            >
              Scale +
            </button>
            <button
              type="button"
              style={btn}
              onClick={() =>
                setNudge((n) =>
                  n < 0.0002 ? 0.00035 : n < 0.0008 ? 0.0012 : 0.00012
                )
              }
            >
              Step
            </button>
          </div>

          <div
            style={{
              fontSize: 9,
              color: "#5b6776",
              lineHeight: 1.4,
              fontFamily: "monospace",
            }}
          >
            Page {page?.page} · {page?.width}×{page?.height}px
            <br />
            SW {reg.bounds.sw.lat.toFixed(5)}, {reg.bounds.sw.lng.toFixed(5)}
            <br />
            NE {reg.bounds.ne.lat.toFixed(5)}, {reg.bounds.ne.lng.toFixed(5)}
          </div>

          <p
            style={{
              fontSize: 9,
              color: "#64748b",
              marginTop: 10,
              lineHeight: 1.4,
            }}
          >
            Skip cover/index pages (jump to p5+). Plan-view sheets should line
            up with Division St / Machias Rd when registered. Click plant
            cables/MSTs for live callouts. Other Ziply jobs are hidden.
          </p>
        </>
      )}
    </div>
  );
}

const lab: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  marginBottom: 8,
  fontSize: 11,
  fontWeight: 600,
  color: "#3a4654",
};

const sel: CSSProperties = {
  fontSize: 12,
  padding: 6,
  borderRadius: 6,
  border: "1px solid #8e96a0",
  background: "#fff",
};

const btn: CSSProperties = {
  flex: 1,
  fontSize: 11,
  fontWeight: 700,
  padding: "6px 8px",
  borderRadius: 6,
  border: "1px solid #8e96a0",
  background: "linear-gradient(180deg, #ffffff 0%, #e4e9f0 100%)",
  color: "#15202c",
  cursor: "pointer",
};
