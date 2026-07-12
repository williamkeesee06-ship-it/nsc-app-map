/**
 * Digital Field Operations Platform — H3024 Design Print Map
 * Multi-layer GeoJSON with neon/metal futuristic styling on Google Maps.
 *
 * Visual system: layer-primary colors (not grey "designed" override),
 * dual-pass glow cables, SVG markers with soft bloom, dark glass HUD.
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
import FeatureDetailSheet, { type PlatformFeature } from "./FeatureDetailSheet.js";

export type LayerKey =
  | "feeder"
  | "distribution"
  | "drop"
  | "bore"
  | "terminal"
  | "service_point"
  | "pole"
  | "handhole"
  | "hub";

type LayerMeta = {
  label: string;
  color: string;
  glow: string;
  defaultOn: boolean;
  minZoom: number;
  lineWeight: number;
};

/** Royal-blue / metal / neon palette — never force grey for "designed" */
const LAYER_META: Record<LayerKey, LayerMeta> = {
  hub: {
    label: "Hub / FDH",
    color: "#3B82F6",
    glow: "#60A5FA",
    defaultOn: true,
    minZoom: 0,
    lineWeight: 0,
  },
  feeder: {
    label: "Feeder cables",
    color: "#FF6B2C",
    glow: "#FFB086",
    defaultOn: true,
    minZoom: 12,
    lineWeight: 7,
  },
  distribution: {
    label: "Distribution",
    color: "#22D3EE",
    glow: "#67E8F9",
    defaultOn: true,
    minZoom: 13,
    lineWeight: 4.5,
  },
  drop: {
    label: "Drops",
    color: "#A78BFA",
    glow: "#C4B5FD",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 2.5,
  },
  bore: {
    label: "Bore / trench",
    color: "#FBBF24",
    glow: "#FDE68A",
    defaultOn: true,
    minZoom: 13,
    lineWeight: 3.5,
  },
  terminal: {
    label: "Splice terminals",
    color: "#C084FC",
    glow: "#E9D5FF",
    defaultOn: true,
    minZoom: 13,
    lineWeight: 0,
  },
  service_point: {
    label: "Service addresses",
    color: "#38BDF8",
    glow: "#7DD3FC",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 0,
  },
  pole: {
    label: "Poles",
    color: "#F87171",
    glow: "#FECACA",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 0,
  },
  handhole: {
    label: "Handholes",
    color: "#2DD4BF",
    glow: "#99F6E4",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 0,
  },
};

/** Status only tints non-default states — designed keeps layer color */
const STATUS_TINT: Record<string, string | null> = {
  designed: null,
  planned: null,
  permitted: "#38BDF8",
  ticket_active: "#FACC15",
  in_progress: "#FB923C",
  in_progress_alt: "#38BDF8",
  placed: "#2DD4BF",
  spliced: "#C084FC",
  tested: "#4ADE80",
  complete: "#22C55E",
  on_hold: "#F87171",
};

type GeoFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown> & { layer?: string; type?: string; status?: string };
  geometry?: { type: string; coordinates: unknown } | null;
};

type FeatureCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
  metadata?: {
    hub?: { lat: number; lng: number };
    workOrder?: string;
    hubId?: string;
  };
};

function featureColor(layer: string, status?: string): string {
  const meta = LAYER_META[layer as LayerKey];
  const base = meta?.color ?? "#94A3B8";
  if (!status) return base;
  const tint = STATUS_TINT[status];
  return tint ?? base;
}

/** SVG marker with soft outer bloom (depth without Mapbox extrusion) */
function makeMarkerIcon(
  kind: "hub" | "terminal" | "service" | "pole" | "handhole",
  color: string,
  glow: string,
  size: number
): google.maps.Icon {
  const s = 64;
  const c = s / 2;
  let body = "";
  if (kind === "hub") {
    // hexagon + core
    body = `
      <polygon points="32,8 52,18 52,38 32,48 12,38 12,18" fill="${color}" stroke="#E0F2FE" stroke-width="2.5"/>
      <circle cx="32" cy="28" r="7" fill="#0B1220" stroke="${glow}" stroke-width="2"/>
      <circle cx="32" cy="28" r="3" fill="${glow}"/>`;
  } else if (kind === "terminal") {
    // diamond
    body = `
      <polygon points="32,10 50,32 32,54 14,32" fill="${color}" stroke="#F5F3FF" stroke-width="2.5"/>
      <polygon points="32,20 42,32 32,44 22,32" fill="#0B1220" opacity="0.55"/>
      <circle cx="32" cy="32" r="3.5" fill="${glow}"/>`;
  } else if (kind === "pole") {
    body = `
      <circle cx="32" cy="32" r="11" fill="${color}" stroke="#fff" stroke-width="2"/>
      <line x1="32" y1="18" x2="32" y2="46" stroke="#0B1220" stroke-width="2.5"/>
      <line x1="18" y1="32" x2="46" y2="32" stroke="#0B1220" stroke-width="2.5"/>`;
  } else if (kind === "handhole") {
    body = `
      <rect x="16" y="16" width="32" height="32" rx="5" fill="${color}" stroke="#ECFDF5" stroke-width="2.5"/>
      <rect x="24" y="24" width="16" height="16" rx="2" fill="#0B1220" opacity="0.4"/>`;
  } else {
    // service — small rounded diamond
    body = `
      <circle cx="32" cy="32" r="12" fill="${color}" stroke="#E0F2FE" stroke-width="2.2"/>
      <circle cx="32" cy="32" r="4.5" fill="#0B1220"/>
      <circle cx="32" cy="32" r="2" fill="${glow}"/>`;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3.2" result="b"/>
      <feMerge>
        <feMergeNode in="b"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <radialGradient id="rg" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${glow}" stop-opacity="0.75"/>
      <stop offset="70%" stop-color="${color}" stop-opacity="0.2"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="${c}" cy="${c}" r="26" fill="url(#rg)"/>
  <g filter="url(#bloom)">${body}</g>
</svg>`;

  const url = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  return {
    url,
    scaledSize: new google.maps.Size(size, size),
    anchor: new google.maps.Point(size / 2, size / 2),
  };
}

interface Props {
  active: boolean;
  geojsonUrl?: string;
}

export default function DesignPrintMapOverlay({
  active,
  geojsonUrl = "/experiments/lake-stevens/h3024/platform.geojson",
}: Props) {
  const map = useMap();
  const glowRef = useRef<google.maps.Data | null>(null);
  const dataRef = useRef<google.maps.Data | null>(null);
  const pulseRef = useRef<google.maps.Marker | null>(null);
  const dashTimer = useRef<number | null>(null);
  const [fc, setFc] = useState<FeatureCollection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(15);
  const [selected, setSelected] = useState<PlatformFeature | null>(null);
  const [pulse, setPulse] = useState(0);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => {
    const o = {} as Record<LayerKey, boolean>;
    (Object.keys(LAYER_META) as LayerKey[]).forEach((k) => {
      o[k] = LAYER_META[k].defaultOn;
    });
    return o;
  });

  // Soft pulse for hub / HUD chrome
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setPulse((p) => (p + 1) % 100), 80);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetch(geojsonUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`GeoJSON ${r.status}`);
        return r.json() as Promise<FeatureCollection>;
      })
      .then((data) => {
        if (!cancelled) setFc(data);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Load failed");
      });
    return () => {
      cancelled = true;
    };
  }, [active, geojsonUrl]);

  useEffect(() => {
    if (!map || !active) return;
    const sync = () => setZoom(map.getZoom() ?? 15);
    sync();
    const l = map.addListener("zoom_changed", sync);
    return () => google.maps.event.removeListener(l);
  }, [map, active]);

  // Darker futuristic basemap + mild tilt for depth when experiment is on
  useEffect(() => {
    if (!map || !active) return;
    const prevTilt = map.getTilt?.() ?? 0;
    try {
      map.setOptions({
        tilt: 45,
        styles: DARK_MAP_STYLES,
        backgroundColor: "#070B14",
      });
    } catch {
      /* styles optional */
    }
    return () => {
      try {
        map.setOptions({ tilt: prevTilt, styles: null });
      } catch {
        /* ignore */
      }
    };
  }, [map, active]);

  // Fit plant
  useEffect(() => {
    if (!map || !active || !fc) return;
    const bounds = new google.maps.LatLngBounds();
    let n = 0;
    for (const f of fc.features) {
      const g = f.geometry;
      if (!g) continue;
      if (g.type === "Point") {
        const [lng, lat] = g.coordinates as [number, number];
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          bounds.extend({ lat, lng });
          n++;
        }
      } else if (g.type === "LineString") {
        for (const c of g.coordinates as [number, number][]) {
          if (Number.isFinite(c[0]) && Number.isFinite(c[1])) {
            bounds.extend({ lat: c[1], lng: c[0] });
            n++;
          }
        }
      }
    }
    if (n > 0) map.fitBounds(bounds, 64);
  }, [map, active, fc]);

  // Dual Data layers: underglow + crisp core
  useEffect(() => {
    if (!map || !active || !fc) {
      glowRef.current?.setMap(null);
      dataRef.current?.setMap(null);
      pulseRef.current?.setMap(null);
      glowRef.current = null;
      dataRef.current = null;
      pulseRef.current = null;
      if (dashTimer.current) {
        window.clearInterval(dashTimer.current);
        dashTimer.current = null;
      }
      return;
    }

    const glow = new google.maps.Data({ map });
    const data = new google.maps.Data({ map });
    glow.addGeoJson(fc as unknown as object);
    data.addGeoJson(fc as unknown as object);

    const styleFn = (feature: google.maps.Data.Feature, pass: "glow" | "core") => {
      const layer = String(
        feature.getProperty("layer") || feature.getProperty("type") || ""
      );
      const status = feature.getProperty("status") as string | undefined;
      const meta = LAYER_META[layer as LayerKey];
      const color = featureColor(layer, status);
      const glowColor = meta?.glow ?? color;
      const on = layers[layer as LayerKey] !== false;
      const minZ = meta?.minZoom ?? 0;
      const visible = on && zoom >= minZ;
      const geom = feature.getGeometry()?.getType();

      if (geom === "Point") {
        if (pass === "glow") {
          // hide points on glow pass — core pass owns markers
          return { visible: false };
        }
        const isHub = layer === "hub";
        const isTerm = layer === "terminal";
        const isPole = layer === "pole";
        const isHh = layer === "handhole";
        const kind = isHub
          ? "hub"
          : isTerm
            ? "terminal"
            : isPole
              ? "pole"
              : isHh
                ? "handhole"
                : "service";
        const size = isHub ? 44 : isTerm ? 30 : isPole || isHh ? 24 : 20;
        return {
          visible,
          icon: makeMarkerIcon(kind, color, glowColor, size),
          zIndex: isHub ? 40 : isTerm ? 28 : 22,
          title: String(
            feature.getProperty("label") ||
              feature.getProperty("terminalId") ||
              feature.getProperty("address") ||
              ""
          ),
          cursor: "pointer",
        };
      }

      // LineString
      const isFeeder = layer === "feeder";
      const isBore = layer === "bore";
      const isDrop = layer === "drop";
      const baseW = meta?.lineWeight ?? 3;

      if (pass === "glow") {
        return {
          visible,
          strokeColor: glowColor,
          strokeOpacity: isDrop ? 0.25 : isFeeder ? 0.45 : 0.35,
          strokeWeight: baseW + (isFeeder ? 10 : 7),
          zIndex: isFeeder ? 6 : isBore ? 4 : 5,
          clickable: false,
        };
      }

      // Core pass — crisp neon line + optional flow chevrons
      const icons: google.maps.IconSequence[] | undefined = isBore
        ? [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 1,
                strokeColor: color,
                scale: 3.2,
                strokeWeight: 2,
              },
              offset: "0",
              repeat: "14px",
            },
          ]
        : isFeeder
          ? [
              {
                icon: {
                  path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
                  scale: 2.4,
                  strokeColor: "#0B1220",
                  strokeWeight: 1,
                  fillColor: glowColor,
                  fillOpacity: 1,
                },
                offset: "0%",
                repeat: "48px",
              },
            ]
          : isDrop
            ? undefined
            : [
                {
                  icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 1.6,
                    fillColor: glowColor,
                    fillOpacity: 0.9,
                    strokeWeight: 0,
                  },
                  offset: "0",
                  repeat: "36px",
                },
              ];

      return {
        visible,
        strokeColor: color,
        strokeOpacity: isDrop ? 0.88 : 0.98,
        strokeWeight: baseW,
        zIndex: isFeeder ? 14 : isBore ? 10 : isDrop ? 11 : 12,
        icons,
        cursor: "pointer",
      };
    };

    glow.setStyle((f) => styleFn(f, "glow"));
    data.setStyle((f) => styleFn(f, "core"));

    // Animate feeder arrows
    let offset = 0;
    dashTimer.current = window.setInterval(() => {
      offset = (offset + 2) % 48;
      data.setStyle((f) => {
        const st = styleFn(f, "core") as google.maps.Data.StyleOptions;
        const layer = String(f.getProperty("layer") || "");
        if (layer === "feeder" && st.icons?.[0]) {
          st.icons = [
            {
              ...st.icons[0],
              offset: `${offset}px`,
            },
          ];
        }
        return st;
      });
    }, 90);

    // Pulsing hub marker ring (extra depth)
    const hubFeat = fc.features.find((f) => f.properties?.layer === "hub");
    if (hubFeat?.geometry?.type === "Point") {
      const [lng, lat] = hubFeat.geometry.coordinates as [number, number];
      const hub = new google.maps.Marker({
        map,
        position: { lat, lng },
        clickable: false,
        zIndex: 50,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 18,
          fillColor: "#3B82F6",
          fillOpacity: 0.12,
          strokeColor: "#60A5FA",
          strokeOpacity: 0.75,
          strokeWeight: 2,
        },
        title: "FDH H3024",
      });
      pulseRef.current = hub;
    }

    const clickL = data.addListener("click", (e: google.maps.Data.MouseEvent) => {
      const f = e.feature;
      if (!f) return;
      const props: Record<string, unknown> = {};
      f.forEachProperty((val, key) => {
        props[key] = val;
      });
      const geom = f.getGeometry();
      let geometry: PlatformFeature["geometry"] = null;
      if (geom?.getType() === "Point") {
        const p = (geom as google.maps.Data.Point).get();
        geometry = { type: "Point", coordinates: [p.lng(), p.lat()] };
      } else if (geom?.getType() === "LineString") {
        const arr: [number, number][] = [];
        (geom as google.maps.Data.LineString).forEachLatLng((ll) => {
          arr.push([ll.lng(), ll.lat()]);
        });
        geometry = { type: "LineString", coordinates: arr };
      }
      setSelected({ type: "Feature", properties: props, geometry });
    });

    // Hover cursor feedback
    const mouseover = data.addListener("mouseover", () => {
      map.setOptions({ draggableCursor: "pointer" });
    });
    const mouseout = data.addListener("mouseout", () => {
      map.setOptions({ draggableCursor: undefined });
    });

    glowRef.current = glow;
    dataRef.current = data;

    return () => {
      google.maps.event.removeListener(clickL);
      google.maps.event.removeListener(mouseover);
      google.maps.event.removeListener(mouseout);
      if (dashTimer.current) {
        window.clearInterval(dashTimer.current);
        dashTimer.current = null;
      }
      glow.setMap(null);
      data.setMap(null);
      pulseRef.current?.setMap(null);
      pulseRef.current = null;
      glowRef.current = null;
      dataRef.current = null;
    };
  }, [map, active, fc, layers, zoom]);

  // Animate hub ring scale with pulse
  useEffect(() => {
    const m = pulseRef.current;
    if (!m) return;
    const t = pulse / 100;
    const scale = 16 + Math.sin(t * Math.PI * 2) * 6;
    const opacity = 0.35 + Math.sin(t * Math.PI * 2) * 0.25;
    m.setIcon({
      path: google.maps.SymbolPath.CIRCLE,
      scale,
      fillColor: "#3B82F6",
      fillOpacity: Math.max(0.08, opacity * 0.35),
      strokeColor: "#93C5FD",
      strokeOpacity: Math.max(0.35, opacity),
      strokeWeight: 2.5,
    });
  }, [pulse]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    if (!fc) return c;
    for (const f of fc.features) {
      const k = String(f.properties?.layer || f.properties?.type || "?");
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  }, [fc]);

  const toggle = useCallback((k: LayerKey) => {
    setLayers((prev) => ({ ...prev, [k]: !prev[k] }));
  }, []);

  if (!active) return null;

  const glowPulse = 0.45 + Math.sin((pulse / 100) * Math.PI * 2) * 0.25;

  return (
    <>
      <style>{HUD_CSS}</style>

      {/* Ambient vignette / scanline overlay */}
      <div className="h3024-vignette" aria-hidden />
      <div className="h3024-scanlines" aria-hidden />

      {/* Layer HUD */}
      <div className="h3024-hud" style={panelStyle}>
        <div className="h3024-hud-header">
          <div className="h3024-hud-badge" style={{ boxShadow: `0 0 18px rgba(59,130,246,${glowPulse})` }}>
            ◆
          </div>
          <div>
            <div className="h3024-hud-title">H3024 FIELD OPS</div>
            <div className="h3024-hud-sub">
              LAKE STEVENS · DIGITAL TWIN
              {fc ? (
                <>
                  <br />
                  <span className="h3024-hud-metrics">
                    {fc.features.length} assets · {counts.service_point ?? 0} LU ·{" "}
                    {counts.terminal ?? 0} MST · z{zoom.toFixed(0)}
                  </span>
                </>
              ) : err ? (
                <span style={{ color: "#F87171" }}> {err}</span>
              ) : (
                " · linking plant…"
              )}
            </div>
          </div>
        </div>

        <div className="h3024-hud-divider" />

        <div className="h3024-layer-list">
          {(Object.keys(LAYER_META) as LayerKey[]).map((k) => {
            const on = !!layers[k];
            const meta = LAYER_META[k];
            const dim = zoom < meta.minZoom;
            return (
              <button
                key={k}
                type="button"
                className={`h3024-layer-row ${on ? "on" : "off"}`}
                onClick={() => toggle(k)}
                style={
                  {
                    ["--lc" as string]: meta.color,
                    ["--lg" as string]: meta.glow,
                  } as CSSProperties
                }
              >
                <span className="h3024-layer-swatch" />
                <span className="h3024-layer-label">{meta.label}</span>
                <span className="h3024-layer-count">
                  {counts[k] ?? 0}
                  {dim ? " · zoom+" : ""}
                </span>
                <span className={`h3024-layer-toggle ${on ? "on" : ""}`}>
                  {on ? "ON" : "OFF"}
                </span>
              </button>
            );
          })}
        </div>

        <div className="h3024-hud-footer">
          Click any neon path or node for live asset detail. Flow arrows mark feeder
          direction · dashed gold = bore.
        </div>
      </div>

      {selected && (
        <FeatureDetailSheet
          feature={selected}
          onClose={() => setSelected(null)}
          onStatusChange={(status) => {
            setSelected((prev) =>
              prev
                ? { ...prev, properties: { ...prev.properties, status } }
                : prev
            );
          }}
        />
      )}
    </>
  );
}

const DARK_MAP_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0B1220" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0B1220" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8B9BB4" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1A2438" }] },
  {
    featureType: "road",
    elementType: "geometry.stroke",
    stylers: [{ color: "#0F172A" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#243044" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0A1628" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#121A2B" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry",
    stylers: [{ color: "#0F1A14" }],
  },
  {
    featureType: "transit",
    elementType: "geometry",
    stylers: [{ color: "#151E30" }],
  },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#2A3A55" }] },
  {
    featureType: "landscape",
    elementType: "geometry",
    stylers: [{ color: "#0E1524" }],
  },
];

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 12,
  top: 72,
  zIndex: 9,
  width: "min(300px, calc(100% - 24px))",
  maxHeight: "min(72vh, 560px)",
  overflow: "auto",
};

const HUD_CSS = `
.h3024-vignette {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 3;
  background:
    radial-gradient(ellipse 80% 70% at 50% 45%, transparent 40%, rgba(3,8,18,0.55) 100%),
    linear-gradient(180deg, rgba(8,14,28,0.35) 0%, transparent 18%, transparent 82%, rgba(8,14,28,0.4) 100%);
}
.h3024-scanlines {
  pointer-events: none;
  position: absolute;
  inset: 0;
  z-index: 3;
  opacity: 0.04;
  background: repeating-linear-gradient(
    0deg,
    transparent,
    transparent 2px,
    rgba(147,197,253,0.35) 3px
  );
}
.h3024-hud {
  padding: 14px 14px 12px;
  border-radius: 16px;
  background:
    linear-gradient(145deg, rgba(15,23,42,0.92) 0%, rgba(8,12,24,0.94) 100%);
  border: 1px solid rgba(96,165,250,0.35);
  box-shadow:
    0 0 0 1px rgba(15,23,42,0.8),
    0 18px 50px rgba(0,0,0,0.55),
    inset 0 1px 0 rgba(147,197,253,0.18),
    0 0 40px rgba(37,99,235,0.18);
  backdrop-filter: blur(14px);
  color: #E2E8F0;
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
}
.h3024-hud-header {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.h3024-hud-badge {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  font-size: 14px;
  color: #BFDBFE;
  background: linear-gradient(145deg, #1E3A8A, #0F172A);
  border: 1px solid rgba(147,197,253,0.55);
  flex-shrink: 0;
}
.h3024-hud-title {
  font-weight: 800;
  letter-spacing: 0.14em;
  font-size: 12px;
  color: #DBEAFE;
  text-shadow: 0 0 12px rgba(96,165,250,0.55);
}
.h3024-hud-sub {
  font-size: 10px;
  color: #94A3B8;
  margin-top: 2px;
  line-height: 1.4;
  letter-spacing: 0.04em;
}
.h3024-hud-metrics {
  color: #7DD3FC;
  font-weight: 600;
  letter-spacing: 0.02em;
}
.h3024-hud-divider {
  height: 1px;
  margin: 12px 0 10px;
  background: linear-gradient(90deg, transparent, rgba(96,165,250,0.45), transparent);
}
.h3024-layer-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.h3024-layer-row {
  display: grid;
  grid-template-columns: 14px 1fr auto auto;
  gap: 8px;
  align-items: center;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: #CBD5E1;
  border-radius: 10px;
  padding: 7px 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.h3024-layer-row.on {
  background: linear-gradient(90deg, color-mix(in srgb, var(--lc) 16%, transparent), transparent);
  border-color: color-mix(in srgb, var(--lc) 40%, transparent);
  box-shadow: inset 0 0 12px color-mix(in srgb, var(--lg) 12%, transparent);
}
.h3024-layer-row.off {
  opacity: 0.45;
}
.h3024-layer-row:hover {
  border-color: color-mix(in srgb, var(--lc) 55%, transparent);
}
.h3024-layer-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--lc);
  box-shadow: 0 0 10px var(--lg);
}
.h3024-layer-label {
  font-size: 11px;
  font-weight: 650;
}
.h3024-layer-count {
  font-size: 10px;
  color: #64748B;
  font-variant-numeric: tabular-nums;
}
.h3024-layer-toggle {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.08em;
  padding: 2px 6px;
  border-radius: 999px;
  border: 1px solid #334155;
  color: #64748B;
  background: #0F172A;
}
.h3024-layer-toggle.on {
  color: #0B1220;
  background: var(--lc);
  border-color: var(--lg);
  box-shadow: 0 0 10px color-mix(in srgb, var(--lg) 50%, transparent);
}
.h3024-hud-footer {
  margin-top: 12px;
  font-size: 9px;
  line-height: 1.45;
  color: #64748B;
  border-top: 1px solid rgba(51,65,85,0.7);
  padding-top: 10px;
}
`;
