/**
 * Digital Field Operations Platform — H3024 Design Print Map
 *
 * Palette: royal blue · white · stainless steel · carbon fiber accents
 * (light modern metal — not dark mode)
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
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import { getZiplyPrintBounds, listZiplyPrintFiles } from "./ziplyUtils.js";
import ZiplyPrintHtmlOverlay from "./ZiplyPrintHtmlOverlay.js";

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
  soft: string;
  defaultOn: boolean;
  minZoom: number;
  lineWeight: number;
};

/** Royal blue / steel / carbon plant palette */
const LAYER_META: Record<LayerKey, LayerMeta> = {
  hub: {
    label: "Hub / FDH",
    color: "#EF4444", // Red
    soft: "#FCA5A5",
    defaultOn: true,
    minZoom: 0,
    lineWeight: 0,
  },
  feeder: {
    label: "Feeder cables",
    color: "#06B6D4", // Cyan
    soft: "#67E8F9",
    defaultOn: true,
    minZoom: 12,
    lineWeight: 6.5,
  },
  distribution: {
    label: "Distribution",
    color: "#6366F1", // Indigo / Royal Blue
    soft: "#A5B4FC",
    defaultOn: true,
    minZoom: 13,
    lineWeight: 4.2,
  },
  drop: {
    label: "Drops",
    color: "#F59E0B", // Amber / Yellow
    soft: "#FDE047",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 2.4,
  },
  bore: {
    label: "Bore / trench",
    color: "#10B981", // Emerald Green
    soft: "#6EE7B7",
    defaultOn: true,
    minZoom: 13,
    lineWeight: 3.5,
  },
  terminal: {
    label: "Splice terminals",
    color: "#A855F7", // Purple
    soft: "#D8B4FE",
    defaultOn: true,
    minZoom: 13,
    lineWeight: 0,
  },
  service_point: {
    label: "Service addresses",
    color: "#3B82F6", // Blue
    soft: "#93C5FD",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 0,
  },
  pole: {
    label: "Poles",
    color: "#B45309", // Amber Brown
    soft: "#F59E0B",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 0,
  },
  handhole: {
    label: "Handholes",
    color: "#64748B", // Slate
    soft: "#94A3B8",
    defaultOn: true,
    minZoom: 14,
    lineWeight: 0,
  },
};

/** Status only overrides non-default work states */
const STATUS_TINT: Record<string, string | null> = {
  designed: null,
  planned: null,
  permitted: "#2563EB",
  conduit_placed: "#0EA5E9",
  fiber_placed: "#F59E0B",
  spliced: "#A855F7",
  live: "#39FF14",
  tested: "#16A34A",
  complete: "#15803D",
  on_hold: "#DC2626",
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
    projectId?: string;
    city?: string;
    stats?: Record<string, number>;
  };
};

function featureColor(layer: string, status?: string): string {
  const meta = LAYER_META[layer as LayerKey];
  const base = meta?.color ?? "#64748B";
  if (!status) return base;
  const tint = STATUS_TINT[status];
  return tint ?? base;
}

function guessLayerByNameAndDesc(name: string, desc: string, fallback: string): string {
  const nameClean = name.trim();
  const descClean = desc.trim();
  const text = (nameClean + " " + descClean).toLowerCase();

  // 1. Hub / Splitter (e.g. S2107, S2108, Splitter, FDH)
  if (/\bS\d{4}\b/.test(nameClean) || text.includes("hub") || text.includes("fdh") || text.includes("splitter")) return "hub";
  // 2. Poles (e.g. P1, P-3, PSE 227113)
  if (/^P\d+$/.test(nameClean) || /^P-\d+$/.test(nameClean) || text.includes("pole") || text.includes("pse")) return "pole";
  // 3. Handholes (e.g. HH1, HH-3, vault, handhole)
  if (/^HH\d*$/i.test(nameClean) || /^HH-\d+$/i.test(nameClean) || text.includes("handhole") || text.includes("hh") || text.includes("vault")) return "handhole";
  // 4. Terminals (e.g. T3, T-4, PRT-9, MST)
  if (/^T\d+$/.test(nameClean) || /^T-\d+$/.test(nameClean) || /^PRT-\d+$/.test(nameClean) || text.includes("terminal") || text.includes("mst") || text.includes("splice") || text.includes("closure")) return "terminal";
  // 5. Service Points
  if (text.includes("service") || text.includes("address") || /^\d+$/.test(nameClean) || nameClean.length > 5) return "service_point";
  return fallback;
}

/** Stainless / carbon marker with soft blue halo (light theme) */
function makeMarkerIcon(
  kind: "hub" | "terminal" | "service" | "pole" | "handhole",
  color: string,
  soft: string,
  size: number
): google.maps.Icon {
  const s = 64;
  let body = "";
  if (kind === "hub") {
    // Legend: HUB/SPLITTER is Option 2: Server Rack Tower badge with glowing outline + neon green active indicator lights
    body = `
      <circle cx="32" cy="32" r="21" fill="url(#steel)" stroke="${color}" stroke-width="2.8" filter="url(#neon-glow)"/>
      <rect x="22" y="20" width="20" height="24" fill="url(#carbon)" stroke="${color}" stroke-width="2" rx="3"/>
      <line x1="26" y1="26" x2="38" y2="26" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="26" y1="32" x2="38" y2="32" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="26" y1="38" x2="38" y2="38" stroke="${color}" stroke-width="2.2" stroke-linecap="round"/>
      <circle cx="35" cy="26" r="1.6" fill="#39FF14" filter="url(#neon-glow)"/>
      <circle cx="35" cy="32" r="1.6" fill="#39FF14" filter="url(#neon-glow)"/>
      <circle cx="35" cy="38" r="1.6" fill="#39FF14" filter="url(#neon-glow)"/>
    `;
  } else if (kind === "terminal") {
    // Legend: SPLICE CHEVRON is a triangle
    body = `
      <polygon points="16,20 48,32 16,44" fill="url(#steel)" stroke="${color}" stroke-width="2.6"/>
      <circle cx="24" cy="32" r="3" fill="${color}"/>
    `;
  } else if (kind === "pole") {
    // Legend: POLE is a circle with a cross (X) inside
    body = `
      <circle cx="32" cy="32" r="14" fill="url(#steel)" stroke="${color}" stroke-width="2.6"/>
      <line x1="24" y1="24" x2="40" y2="40" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>
      <line x1="40" y1="24" x2="24" y2="40" stroke="${color}" stroke-width="2.8" stroke-linecap="round"/>
    `;
  } else if (kind === "handhole") {
    // Legend: HANDHOLE is a square with dashed inner cross
    body = `
      <rect x="16" y="16" width="32" height="32" fill="url(#carbon)" stroke="${color}" stroke-width="2.8" rx="2" ry="2"/>
      <line x1="32" y1="16" x2="32" y2="48" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,3"/>
      <line x1="16" y1="32" x2="48" y2="32" stroke="${color}" stroke-width="1.5" stroke-dasharray="3,3"/>
    `;
  } else {
    // Service Point: House icon matching My Maps screenshot
    body = `
      <polygon points="32,16 14,28 14,48 50,48 50,28" fill="url(#steel)" stroke="${color}" stroke-width="2.8" stroke-linejoin="round"/>
      <rect x="27" y="34" width="10" height="14" fill="${color}"/>
    `;
  }

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <defs>
    <linearGradient id="steel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="45%" stop-color="#E8EEF5"/>
      <stop offset="100%" stop-color="#B8C4D4"/>
    </linearGradient>
    <linearGradient id="carbon" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#3A4454"/>
      <stop offset="50%" stop-color="#1E293B"/>
      <stop offset="100%" stop-color="#0F172A"/>
    </linearGradient>
    <filter id="soft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="2.2" result="b"/>
      <feOffset dy="1" result="o"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.28"/></feComponentTransfer>
      <feMerge>
        <feMergeNode/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <filter id="neon-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="1.8" result="blur"/>
      <feMerge>
        <feMergeNode in="blur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${soft}" stop-opacity="0.55"/>
      <stop offset="70%" stop-color="${soft}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${soft}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="26" fill="url(#halo)"/>
  <g filter="url(#soft)">${body}</g>
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
  jobs?: Job[];
  selectedJob?: Job | null;
}

export default function DesignPrintMapOverlay({
  active,
  geojsonUrl = "/experiments/lake-stevens/h2043/platform.geojson",
  jobs = [],
  selectedJob,
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

  const printJobs = useMemo(() => {
    return jobs.filter((j) => {
      const filesList = listZiplyPrintFiles(j);
      return filesList.length > 0;
    });
  }, [jobs]);
  const [isCustomLoaded, setIsCustomLoaded] = useState(false);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>(() => {
    const o = {} as Record<LayerKey, boolean>;
    (Object.keys(LAYER_META) as LayerKey[]).forEach((k) => {
      o[k] = LAYER_META[k].defaultOn;
    });
    return o;
  });

  const handleKmlFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const r = new FileReader();
    r.onload = (evt) => {
      const text = evt.target?.result as string;
      try {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "text/xml");
        const placemarks = xml.querySelectorAll("Placemark");
        
        const newFeatures: GeoFeature[] = [];
        
        placemarks.forEach((pm, idx) => {
          const name = pm.querySelector("name")?.textContent || `Feature ${idx + 1}`;
          const desc = pm.querySelector("description")?.textContent || "";
          
          const point = pm.querySelector("Point");
          if (point) {
            const coordsStr = point.querySelector("coordinates")?.textContent || "";
            const [lng, lat] = coordsStr.trim().split(",").map(Number);
            if (!isNaN(lat) && !isNaN(lng)) {
              newFeatures.push({
                type: "Feature",
                id: `kml-pt-${idx}`,
                geometry: { type: "Point", coordinates: [lng, lat] },
                properties: {
                  layer: guessLayerByNameAndDesc(name, desc, "terminal"),
                  type: "point",
                  label: name,
                  description: desc,
                  status: "designed",
                }
              });
            }
          }

          const line = pm.querySelector("LineString");
          if (line) {
            const coordsStr = line.querySelector("coordinates")?.textContent || "";
            const coords = coordsStr.trim().split(/\s+/).map(c => {
              const [lng, lat] = c.split(",").map(Number);
              return [lng, lat];
            }).filter(c => !isNaN(c[0]) && !isNaN(c[1]));

            if (coords.length >= 2) {
              newFeatures.push({
                type: "Feature",
                id: `kml-ln-${idx}`,
                geometry: { type: "LineString", coordinates: coords },
                properties: {
                  layer: guessLayerByNameAndDesc(name, desc, "distribution"),
                  type: "line",
                  label: name,
                  description: desc,
                  status: "designed",
                }
              });
            }
          }
        });

        if (newFeatures.length === 0) {
          alert("No point or line features found in the KML file.");
          return;
        }

        const newFc: FeatureCollection = {
          type: "FeatureCollection",
          features: newFeatures as any,
          metadata: {
            projectId: "H2043",
            city: "Imported from My Maps",
            stats: {
              services: newFeatures.filter(f => f.properties.layer === "service_point").length,
              terminals: newFeatures.filter(f => f.properties.layer === "terminal").length,
              cables: newFeatures.filter(f => f.properties.layer === "feeder" || f.properties.layer === "distribution").length,
            } as any
          }
        };

        setFc(newFc as any);
        setIsCustomLoaded(true);
      } catch (err) {
        alert("Error parsing KML: " + (err instanceof Error ? err.message : String(err)));
      }
    };
    r.readAsText(file);
  };

  const handleSaveImported = async () => {
    if (!fc) return;
    try {
      await api.saveGeoJson("H2043", fc);
      alert("Successfully saved Google My Maps KML data directly to the server!");
      setIsCustomLoaded(false);
    } catch (err) {
      alert("Error saving GeoJSON: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setPulse((p) => (p + 1) % 100), 90);
    return () => clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active || !jobs || jobs.length === 0) return;

    const newFeatures: any[] = [];

    for (const j of jobs) {
      const mo = j.ziplyPrintLayer?.mapObjects;
      if (!mo) continue;

      // Hub
      if (mo.hub && (mo.hub.lat != null || mo.hub.lng != null)) {
        newFeatures.push({
          type: "Feature",
          id: `hub-${j.jobId}`,
          geometry: { type: "Point", coordinates: [mo.hub.lng ?? 0, mo.hub.lat ?? 0] },
          properties: {
            layer: "hub",
            type: "point",
            label: j.ziplyPrintLayer?.hubId || "FDH",
            status: mo.hub.status || "planned",
            jobId: j.jobId
          }
        });
      }

      // Terminals
      for (const t of mo.terminals || []) {
        if (t.lat != null && t.lng != null) {
          newFeatures.push({
            type: "Feature",
            id: `term-${j.jobId}-${t.label}`,
            geometry: { type: "Point", coordinates: [t.lng, t.lat] },
            properties: {
              layer: "terminal",
              type: "point",
              label: t.label,
              status: t.status || "planned",
              portCount: t.portCount,
              addressesServed: t.addressesServed,
              jobId: j.jobId
            }
          });
        }
      }

      // Cables
      for (const c of mo.cables || []) {
        if (c.path && c.path.length >= 2) {
          newFeatures.push({
            type: "Feature",
            id: `cable-${j.jobId}-${c.label}`,
            geometry: {
              type: "LineString",
              coordinates: c.path.map((p: any) => [p.lng, p.lat])
            },
            properties: {
              layer: c.role || "distribution",
              type: "line",
              label: c.label,
              status: c.status || "planned",
              fiberCount: c.fiberCount,
              lengthFt: c.lengthFt,
              jobId: j.jobId
            }
          });
        }
      }
    }

    if (newFeatures.length > 0) {
      setFc({
        type: "FeatureCollection",
        features: newFeatures as any
      });
    } else {
      setFc(null);
    }
  }, [active, jobs]);

  // Fit bounds to selected job ONLY when selectedJob changes
  useEffect(() => {
    if (!map || !active || !selectedJob) return;
    const mo = selectedJob.ziplyPrintLayer?.mapObjects;
    if (!mo) return;

    const bounds = new google.maps.LatLngBounds();
    let n = 0;

    if (mo.hub && mo.hub.lat != null && mo.hub.lng != null) {
      bounds.extend({ lat: mo.hub.lat, lng: mo.hub.lng });
      n++;
    }

    for (const t of mo.terminals || []) {
      if (t.lat != null && t.lng != null) {
        bounds.extend({ lat: t.lat, lng: t.lng });
        n++;
      }
    }

    if (n > 0) {
      map.fitBounds(bounds, 80);
    }
  }, [map, active, selectedJob]);

  useEffect(() => {
    if (!map || !active) return;
    const sync = () => setZoom(map.getZoom() ?? 15);
    sync();
    const l = map.addListener("zoom_changed", sync);
    return () => google.maps.event.removeListener(l);
  }, [map, active]);

  // Light stainless basemap + mild 3D tilt (not dark mode)
  useEffect(() => {
    if (!map || !active) return;
    const prevTilt = map.getTilt?.() ?? 0;
    try {
      map.setOptions({
        tilt: 35,
        styles: [],
      });
    } catch {
      /* optional */
    }
    return () => {
      try {
        map.setOptions({ tilt: prevTilt, styles: null });
      } catch {
        /* ignore */
      }
    };
  }, [map, active]);



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
      const soft = meta?.soft ?? color;
      const on = layers[layer as LayerKey] !== false;
      const minZ = meta?.minZoom ?? 0;
      const visible = on && zoom >= minZ;
      const geom = feature.getGeometry()?.getType();

      if (geom === "Point") {
        if (pass === "glow") return { visible: false };
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
          icon: makeMarkerIcon(kind, color, soft, size),
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

      const isFeeder = layer === "feeder";
      const isBore = layer === "bore";
      const isDrop = layer === "drop";
      const baseW = meta?.lineWeight ?? 3;

      if (pass === "glow") {
        return {
          visible,
          strokeColor: soft,
          strokeOpacity: isDrop ? 0.28 : isFeeder ? 0.42 : 0.34,
          strokeWeight: baseW + (isFeeder ? 8 : 6),
          zIndex: isFeeder ? 6 : isBore ? 4 : 5,
          clickable: false,
        };
      }

      const icons: google.maps.IconSequence[] | undefined = isBore
        ? [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 1,
                strokeColor: color,
                scale: 3,
                strokeWeight: 2,
              },
              offset: "0",
              repeat: "14px",
            },
          ]
        : undefined;

      return {
        visible,
        strokeColor: color,
        strokeOpacity: isDrop ? 0.9 : 0.98,
        strokeWeight: baseW,
        zIndex: isFeeder ? 14 : isBore ? 10 : isDrop ? 11 : 12,
        icons,
        cursor: "pointer",
      };
    };

    glow.setStyle((f) => styleFn(f, "glow"));
    data.setStyle((f) => styleFn(f, "core"));

    let offset = 0;
    dashTimer.current = window.setInterval(() => {
      offset = (offset + 2) % 52;
      data.setStyle((f) => {
        const st = styleFn(f, "core") as google.maps.Data.StyleOptions;
        const layer = String(f.getProperty("layer") || "");
        if (layer === "feeder" && st.icons?.[0]) {
          st.icons = [{ ...st.icons[0], offset: `${offset}px` }];
        }
        return st;
      });
    }, 95);

    const hubFeat = fc.features.find((f) => f.properties?.layer === "hub");
    if (hubFeat?.geometry?.type === "Point") {
      const [lng, lat] = hubFeat.geometry.coordinates as [number, number];
      pulseRef.current = new google.maps.Marker({
        map,
        position: { lat, lng },
        clickable: false,
        zIndex: 50,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 18,
          fillColor: "#1D4ED8",
          fillOpacity: 0.1,
          strokeColor: "#3B82F6",
          strokeOpacity: 0.55,
          strokeWeight: 2,
        },
      });
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

  useEffect(() => {
    const m = pulseRef.current;
    if (!m) return;
    const t = pulse / 100;
    const scale = 15 + Math.sin(t * Math.PI * 2) * 5;
    const opacity = 0.3 + Math.sin(t * Math.PI * 2) * 0.2;
    m.setIcon({
      path: google.maps.SymbolPath.CIRCLE,
      scale,
      fillColor: "#1D4ED8",
      fillOpacity: Math.max(0.06, opacity * 0.28),
      strokeColor: "#60A5FA",
      strokeOpacity: Math.max(0.3, opacity),
      strokeWeight: 2.2,
    });
  }, [pulse]);

  if (!active) return null;

  return (
    <>
      {active &&
        printJobs.map((j) => {
          const filesList = listZiplyPrintFiles(j);
          const url = filesList[0]?.downloadUrl;
          const bounds = getZiplyPrintBounds(j);
          if (!url || !bounds) return null;
          return (
            <ZiplyPrintHtmlOverlay
              key={`print-html-overlay-${j.jobId}`}
              url={url}
              bounds={bounds}
              opacity={0.5}
              visible={active}
            />
          );
        })}

      {selected && (
        <FeatureDetailSheet
          feature={selected}
          onClose={() => setSelected(null)}
          onStatusChange={async (status) => {
            const jobId = selected.properties.jobId as string | undefined;
            const label = selected.properties.label as string | undefined;
            const layer = selected.properties.layer as string | undefined;

            let kind: "hub" | "terminal" | "cable" = "cable";
            if (layer === "hub") kind = "hub";
            else if (layer === "terminal") kind = "terminal";

            if (jobId && label) {
              try {
                await api.updateZiplyObjectStatus(jobId, {
                  kind,
                  ref: label,
                  status: status as any
                });
                window.dispatchEvent(new Event("nsc:jobs-reload"));
              } catch (ex) {
                console.error("Failed to update status", ex);
              }
            }

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

const DARK_NEON_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0F172A" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#475569" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0F172A" }] },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#020617" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry",
    stylers: [{ color: "#1E293B" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#334155" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#475569" }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry",
    stylers: [{ visibility: "off" }],
  },
  {
    featureType: "poi",
    elementType: "labels",
    stylers: [{ visibility: "off" }],
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
.h3024-hud {
  padding: 14px 14px 12px;
  border-radius: 14px;
  background:
    linear-gradient(165deg, rgba(30, 41, 59, 0.95) 0%, rgba(15, 23, 42, 0.95) 100%);
  border: 1px solid #334155;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow:
    0 14px 40px rgba(15, 23, 42, 0.18),
    inset 0 1px 0 rgba(255,255,255,0.95),
    inset 0 -1px 0 rgba(148,163,184,0.35);
  color: #F8FAFC;
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
  font-size: 13px;
  color: #FFFFFF;
  background:
    linear-gradient(145deg, #3B82F6 0%, #1D4ED8 55%, #1E3A8A 100%);
  border: 1px solid #1E40AF;
  box-shadow:
    0 4px 12px rgba(29, 78, 216, 0.35),
    inset 0 1px 0 rgba(255,255,255,0.35);
  flex-shrink: 0;
}
.h3024-hud-title {
  font-weight: 800;
  letter-spacing: 0.12em;
  font-size: 12px;
  color: #60A5FA;
}
.h3024-hud-sub {
  font-size: 10px;
  color: #94A3B8;
  margin-top: 2px;
  line-height: 1.4;
  letter-spacing: 0.03em;
}
.h3024-hud-metrics {
  color: #38BDF8;
  font-weight: 700;
}
.h3024-hud-divider {
  height: 1px;
  margin: 12px 0 10px;
  background: linear-gradient(90deg, transparent, #334155, transparent);
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
  background: rgba(30,41,59,0.55);
  color: #F8FAFC;
  border-radius: 10px;
  padding: 7px 8px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.h3024-layer-row.on {
  background: linear-gradient(90deg, rgba(56,189,248,0.15), rgba(30,41,59,0.8));
  border-color: rgba(56,189,248,0.35);
  box-shadow: inset 0 0 0 1px rgba(56,189,248,0.1);
}
.h3024-layer-row.off {
  opacity: 0.48;
  background: rgba(15,23,42,0.6);
}
.h3024-layer-row:hover {
  border-color: rgba(29, 78, 216, 0.45);
}
.h3024-layer-swatch {
  width: 10px;
  height: 10px;
  border-radius: 3px;
  background: var(--lc);
  box-shadow: 0 0 0 1px rgba(255,255,255,0.9), 0 1px 4px rgba(15,23,42,0.2);
}
.h3024-layer-label {
  font-size: 11px;
  font-weight: 650;
  color: #E2E8F0;
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
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid #475569;
  color: #94A3B8;
  background: #1E293B;
}
.h3024-layer-toggle.on {
  color: #FFFFFF;
  background: linear-gradient(180deg, #3B82F6, #1D4ED8);
  border-color: #1E40AF;
  box-shadow: 0 2px 8px rgba(29,78,216,0.3);
}
.h3024-hud-footer {
  margin-top: 12px;
  font-size: 9px;
  line-height: 1.45;
  color: #64748B;
  border-top: 1px solid #CBD5E1;
  padding-top: 10px;
}
`;
