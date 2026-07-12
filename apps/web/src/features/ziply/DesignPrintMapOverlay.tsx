/**
 * Digital Field Operations Platform — H3024 Design Print Map
 * Multi-layer GeoJSON on Google Maps (web stack equivalent of the RN Mapbox screen).
 *
 * Layers: feeder, distribution, drop, bore, terminal, service_point, pole, handhole, hub
 * Zoom LOD, status colors, layer toggles, click → feature detail panel.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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

const LAYER_META: Record<
  LayerKey,
  { label: string; color: string; defaultOn: boolean; minZoom: number }
> = {
  hub: { label: "Hub / FDH", color: "#1d4ed8", defaultOn: true, minZoom: 0 },
  feeder: { label: "Feeder cables", color: "#FF6B35", defaultOn: true, minZoom: 12 },
  distribution: { label: "Distribution", color: "#0ea5e9", defaultOn: true, minZoom: 13 },
  drop: { label: "Drops", color: "#45B7D1", defaultOn: true, minZoom: 14 },
  bore: { label: "Bore / trench", color: "#ca8a04", defaultOn: true, minZoom: 13 },
  terminal: { label: "Splice terminals", color: "#7c3aed", defaultOn: true, minZoom: 13 },
  service_point: { label: "Service addresses", color: "#2563eb", defaultOn: true, minZoom: 14 },
  pole: { label: "Poles", color: "#dc2626", defaultOn: true, minZoom: 14 },
  handhole: { label: "Handholes", color: "#0d9488", defaultOn: true, minZoom: 14 },
};

const STATUS_COLOR: Record<string, string> = {
  designed: "#94a3b8",
  permitted: "#3498DB",
  ticket_active: "#F1C40F",
  in_progress: "#F39C12",
  in_progress_alt: "#0ea5e9",
  placed: "#1ABC9C",
  spliced: "#9B59B6",
  tested: "#2ECC71",
  complete: "#27AE60",
  on_hold: "#E74C3C",
  planned: "#94a3b8",
};

type GeoFeature = {
  type: "Feature";
  id?: string | number;
  properties: Record<string, unknown> & { layer?: string; type?: string; status?: string };
  geometry?: {
    type: string;
    coordinates: unknown;
  } | null;
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

function statusColor(status: string | undefined, fallback: string): string {
  if (!status) return fallback;
  return STATUS_COLOR[status] ?? fallback;
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
  const dataRef = useRef<google.maps.Data | null>(null);
  const [fc, setFc] = useState<FeatureCollection | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(15);
  const [selected, setSelected] = useState<PlatformFeature | null>(null);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => {
    const o = {} as Record<LayerKey, boolean>;
    (Object.keys(LAYER_META) as LayerKey[]).forEach((k) => {
      o[k] = LAYER_META[k].defaultOn;
    });
    return o;
  });

  // Load platform GeoJSON
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

  // Zoom tracking for LOD
  useEffect(() => {
    if (!map || !active) return;
    const sync = () => setZoom(map.getZoom() ?? 15);
    sync();
    const l = map.addListener("zoom_changed", sync);
    return () => google.maps.event.removeListener(l);
  }, [map, active]);

  // Fit entire plant footprint (hub + all points/lines)
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
    if (n > 0) {
      map.fitBounds(bounds, 56);
      return;
    }
    const hub = fc.metadata?.hub;
    if (hub) {
      map.panTo({ lat: hub.lat, lng: hub.lng });
      map.setZoom(15);
    }
  }, [map, active, fc]);

  // Google Maps Data layer
  useEffect(() => {
    if (!map || !active || !fc) {
      dataRef.current?.setMap(null);
      dataRef.current = null;
      return;
    }

    const data = new google.maps.Data({ map });
    data.addGeoJson(fc as unknown as object);
    data.setStyle((feature) => {
      const layer = (feature.getProperty("layer") ||
        feature.getProperty("type") ||
        "") as string;
      const status = feature.getProperty("status") as string | undefined;
      const meta = LAYER_META[layer as LayerKey];
      const color = statusColor(status, meta?.color ?? "#64748b");
      const on = layers[layer as LayerKey] !== false;
      const minZ = meta?.minZoom ?? 0;
      const visible = on && zoom >= minZ;

      const geom = feature.getGeometry()?.getType();
      if (geom === "Point") {
        const isHub = layer === "hub";
        return {
          visible,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: isHub ? 11 : layer === "terminal" ? 7 : layer === "pole" ? 5 : 5,
            fillColor: color,
            fillOpacity: 0.95,
            strokeColor: "#ffffff",
            strokeWeight: 2,
          },
          zIndex: isHub ? 30 : 20,
          title: String(feature.getProperty("label") || feature.getProperty("terminalId") || ""),
        };
      }
      // LineString — thick enough to read on satellite/roadmap
      const isFeeder = layer === "feeder";
      const isBore = layer === "bore";
      const isDrop = layer === "drop";
      return {
        visible,
        strokeColor: color,
        strokeOpacity: isDrop ? 0.85 : 0.98,
        strokeWeight: isFeeder ? 6 : isBore ? 4 : isDrop ? 2.5 : 4,
        zIndex: isFeeder ? 12 : isBore ? 8 : isDrop ? 9 : 10,
        icons: isBore
          ? [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: 1,
                  strokeColor: color,
                  scale: 3,
                },
                offset: "0",
                repeat: "12px",
              },
            ]
          : undefined,
      };
    });

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
      setSelected({
        type: "Feature",
        properties: props,
        geometry,
      });
    });

    dataRef.current = data;
    return () => {
      google.maps.event.removeListener(clickL);
      data.setMap(null);
      dataRef.current = null;
    };
  }, [map, active, fc, layers, zoom]);

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

  return (
    <>
      {/* Layer panel */}
      <div style={panelStyle}>
        <div style={{ fontWeight: 800, color: "#1d4ed8", letterSpacing: "0.1em", fontSize: 11 }}>
          H3024 FIELD OPS MAP
        </div>
        <div style={{ fontSize: 10, color: "#3a4654", margin: "4px 0 8px", lineHeight: 1.35 }}>
          Lake Stevens H3024 · print-faithful twin
          {fc ? (
            <>
              <br />
              <strong>{fc.features.length}</strong> features ·{" "}
              {counts.service_point ?? 0} LU · {counts.terminal ?? 0} MST · z
              {zoom.toFixed(0)}
            </>
          ) : err ? (
            <span style={{ color: "#b91c1c" }}> {err}</span>
          ) : (
            " · loading…"
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {(Object.keys(LAYER_META) as LayerKey[]).map((k) => (
            <label
              key={k}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 11,
                fontWeight: 600,
                color: "#15202c",
                cursor: "pointer",
                padding: "4px 6px",
                borderRadius: 6,
                background: layers[k] ? "rgba(30,94,255,0.08)" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={!!layers[k]}
                onChange={() => toggle(k)}
                style={{ accentColor: LAYER_META[k].color }}
              />
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 2,
                  background: LAYER_META[k].color,
                  flexShrink: 0,
                }}
              />
              {LAYER_META[k].label}
              <span style={{ marginLeft: "auto", color: "#64748b", fontSize: 10 }}>
                {counts[k] ?? 0}
                {zoom < LAYER_META[k].minZoom ? " · zoom+" : ""}
              </span>
            </label>
          ))}
        </div>
        <p style={{ fontSize: 9, color: "#64748b", marginTop: 8, lineHeight: 1.35 }}>
          Click any line or point for asset detail. Status colors: gray designed → blue
          permitted → orange live → green complete.
        </p>
      </div>

      {selected && (
        <FeatureDetailSheet
          feature={selected}
          onClose={() => setSelected(null)}
          onStatusChange={(status) => {
            setSelected((prev) =>
              prev
                ? {
                    ...prev,
                    properties: { ...prev.properties, status },
                  }
                : prev
            );
          }}
        />
      )}
    </>
  );
}

const panelStyle: CSSProperties = {
  position: "absolute",
  right: 12,
  top: 72,
  zIndex: 9,
  width: "min(280px, calc(100% - 24px))",
  maxHeight: "min(70vh, 520px)",
  overflow: "auto",
  padding: 12,
  borderRadius: 12,
  background: "linear-gradient(180deg, #f8fafc 0%, #e2e8f0 100%)",
  border: "1px solid #94a3b8",
  boxShadow: "0 10px 28px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.9)",
};


