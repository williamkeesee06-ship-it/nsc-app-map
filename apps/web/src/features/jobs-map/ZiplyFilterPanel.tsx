import { useMemo, useState, useEffect } from "react";
import type { Job } from "@nsc/types";
import type { Filters } from "./FilterRail.js";
import { ChevronRight, ChevronDown } from "lucide-react";
import { api } from "../../lib/api.js";
import { useSearchFocus } from "../search/searchContext.js";
import {
  getZiplyPrintDocStatus,
  isNorthMetroJob,
  isZiplyPrintMapReady,
  type ZiplyPrintFilter,
  type ZiplyStatusGroup,
  ziplyPrintStatusColor,
  ziplyPrintStatusLabel,
  ziplyStatusGroupForJob,
} from "../ziply/ziplyUtils.js";

const LAYER_META = {
  hub: { label: "Hub / FDH", color: "#EF4444" },
  feeder: { label: "Feeder cables", color: "#06B6D4" },
  distribution: { label: "Distribution", color: "#6366F1" },
  drop: { label: "Drops", color: "#F59E0B" },
  bore: { label: "Bore / trench", color: "#10B981" },
  terminal: { label: "Splice terminals", color: "#A855F7" },
  service_point: { label: "Service addresses", color: "#3B82F6" },
  pole: { label: "Poles", color: "#B45309" },
  handhole: { label: "Handholes", color: "#64748B" },
};

function guessLayerByNameAndDesc(name: string, desc: string, fallback: string): string {
  const nameClean = name.trim();
  const descClean = desc.trim();
  const text = (nameClean + " " + descClean).toLowerCase();

  if (/\bS\d{4}\b/.test(nameClean) || text.includes("hub") || text.includes("fdh") || text.includes("splitter")) return "hub";
  if (/^P\d+$/.test(nameClean) || /^P-\d+$/.test(nameClean) || text.includes("pole") || text.includes("pse")) return "pole";
  if (/^HH\d*$/i.test(nameClean) || /^HH-\d+$/i.test(nameClean) || text.includes("handhole") || text.includes("hh") || text.includes("vault")) return "handhole";
  if (/^T\d+$/.test(nameClean) || /^T-\d+$/.test(nameClean) || /^PRT-\d+$/.test(nameClean) || text.includes("terminal") || text.includes("mst") || text.includes("splice") || text.includes("closure")) return "terminal";
  if (text.includes("service") || text.includes("address") || /^\d+$/.test(nameClean) || nameClean.length > 5) return "service_point";
  return fallback;
}

interface Props {
  jobs: Job[];
  filters: Filters;
  setFilters: (f: Filters) => void;
  ziplyPrintLayerVisible: boolean;
  setZiplyPrintLayerVisible: (v: boolean) => void;
  ziply811OverlayVisible: boolean;
  setZiply811OverlayVisible: (v: boolean) => void;
}

const STATUS_GROUPS: { id: ZiplyStatusGroup; label: string }[] = [
  { id: "not_started", label: "Not Started" },
  { id: "in_progress", label: "In Progress" },
  { id: "complete", label: "Complete" },
];

const PRINT_FILTERS: { id: ZiplyPrintFilter; label: string }[] = [
  { id: "all", label: "All jobs" },
  { id: "has_print", label: "Print on map" },
  { id: "processing", label: "Ingesting…" },
  { id: "no_print", label: "No print yet" },
  { id: "failed", label: "Ingest failed" },
];

export default function ZiplyFilterPanel({
  jobs,
  filters,
  setFilters,
  ziplyPrintLayerVisible,
  setZiplyPrintLayerVisible,
  ziply811OverlayVisible,
  setZiply811OverlayVisible,
}: Props) {
  const [fc, setFc] = useState<any | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const { selectedJobId } = useSearchFocus();

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/experiments/lake-stevens/h2043/platform.geojson?t=" + Date.now())
        .then((r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((data) => {
          if (!cancelled) setFc(data);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener("nsc:ziply-geojson-reload", load);
    return () => {
      cancelled = true;
      window.removeEventListener("nsc:ziply-geojson-reload", load);
    };
  }, []);

  const counts = useMemo(() => {
    const res: Record<string, number> = {};
    if (!fc) return res;
    for (const f of fc.features) {
      const lay = f.properties?.layer || f.properties?.type || "";
      if (lay) {
        res[lay] = (res[lay] || 0) + 1;
      }
    }
    return res;
  }, [fc]);

  const activeLayers = filters.ziplyActiveLayers ?? new Set(["hub", "feeder", "distribution", "drop", "bore", "terminal", "service_point", "pole", "handhole"]);

  const toggleLayer = (k: string) => {
    const next = new Set(activeLayers);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    setFilters({ ...filters, ziplyActiveLayers: next });
  };

  const handleKmlFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);

    const r = new FileReader();
    r.onload = async (evt) => {
      const text = evt.target?.result as string;
      try {
        const parser = new DOMParser();
        const xml = parser.parseFromString(text, "text/xml");
        const placemarks = xml.querySelectorAll("Placemark");
        
        const newFeatures: any[] = [];
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
          setIsImporting(false);
          return;
        }

        const newFc = {
          type: "FeatureCollection",
          features: newFeatures,
          metadata: {
            projectId: "H2043",
            city: "Imported from My Maps",
            stats: {
              services: newFeatures.filter(f => f.properties.layer === "service_point").length,
              terminals: newFeatures.filter(f => f.properties.layer === "terminal").length,
              cables: newFeatures.filter(f => f.properties.layer === "feeder" || f.properties.layer === "distribution").length,
            }
          }
        };

        await api.saveGeoJson("H2043", newFc);
        alert("Successfully saved Google My Maps KML data directly to the server!");
        
        setFc(newFc);
        window.dispatchEvent(new Event("nsc:ziply-geojson-reload"));
      } catch (err) {
        alert("Error parsing KML: " + (err instanceof Error ? err.message : String(err)));
      } finally {
        setIsImporting(false);
      }
    };
    r.readAsText(file);
  };
  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply"),
    [jobs]
  );

  const northMetroJobs = useMemo(
    () => ziplyJobs.filter(isNorthMetroJob),
    [ziplyJobs]
  );

  const printCounts = useMemo(() => {
    const c = { ready: 0, processing: 0, failed: 0, none: 0, onMap: 0, needRepair: 0 };
    for (const j of ziplyJobs) {
      c[getZiplyPrintDocStatus(j)]++;
      if (isZiplyPrintMapReady(j)) c.onMap++;
      else if (j.ziplyPrintLayer?.mapObjects) c.needRepair++;
    }
    return c;
  }, [ziplyJobs]);

  const [repairBusy, setRepairBusy] = useState(false);
  const [repairMsg, setRepairMsg] = useState<string | null>(null);

  const runBatchRepair = async () => {
    setRepairBusy(true);
    setRepairMsg(null);
    try {
      const r = await api.repairAllZiplyPrints();
      setRepairMsg(
        `Repaired ${r.repaired} · skipped ${r.skipped} · failed ${r.failed}`
      );
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (e) {
      setRepairMsg(e instanceof Error ? e.message : "Repair failed");
    } finally {
      setRepairBusy(false);
    }
  };

  const getStatusCount = (group: ZiplyStatusGroup) =>
    ziplyJobs.filter((j) => ziplyStatusGroupForJob(j) === group).length;

  const groups = filters.ziplyStatusGroups ?? new Set<ZiplyStatusGroup>();

  const handleStatusToggle = (group: ZiplyStatusGroup) => {
    const next = new Set(groups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setFilters({ ...filters, ziplyStatusGroups: next });
  };

  const isStatusChecked = (group: ZiplyStatusGroup) => {
    // Empty set = all groups visible
    if (!groups || groups.size === 0) return true;
    return groups.has(group);
  };

  const jobsBySite = useMemo(() => {
    const map = new Map<string, Job[]>();
    const pool = filters.ziplyNorthMetroOnly ? northMetroJobs : ziplyJobs;
    for (const j of pool) {
      const site = (j.city || "Unknown Site").trim();
      if (!map.has(site)) map.set(site, []);
      map.get(site)!.push(j);
    }
    return map;
  }, [ziplyJobs, northMetroJobs, filters.ziplyNorthMetroOnly]);

  const sites = useMemo(() => Array.from(jobsBySite.keys()).sort(), [jobsBySite]);
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());

  const toggleSite = (site: string) => {
    const next = new Set(expandedSites);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    setExpandedSites(next);
  };

  const handlePanToSite = (site: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const siteJobs = jobsBySite.get(site) || [];
    const validJobs = siteJobs.filter(
      (j) => j.geocode?.status === "OK" && j.geocode.lat && j.geocode.lng
    );
    if (validJobs.length > 0) {
      const bounds = validJobs.map((j) => ({
        lat: j.geocode!.lat,
        lng: j.geocode!.lng,
      }));
      window.dispatchEvent(new CustomEvent("nsc:pan-to", { detail: { bounds } }));
      setZiplyPrintLayerVisible(true);
    }
  };

  const visibleEstimate = useMemo(() => {
    let list = ziplyJobs;
    if (filters.ziplyNorthMetroOnly) list = list.filter(isNorthMetroJob);
    if (filters.ziplyPrintFilter && filters.ziplyPrintFilter !== "all") {
      list = list.filter((j) => {
        const st = getZiplyPrintDocStatus(j);
        const f = filters.ziplyPrintFilter!;
        if (f === "has_print") return st === "ready";
        if (f === "no_print") return st === "none";
        if (f === "processing") return st === "processing";
        if (f === "failed") return st === "failed";
        return true;
      });
    }
    if (groups.size > 0) {
      list = list.filter((j) => groups.has(ziplyStatusGroupForJob(j)));
    }
    return list.length;
  }, [ziplyJobs, filters, groups]);

  return (
    <div
      style={{
        padding: 12,
        color: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: 14,
      }}
    >
      <div>
        <h3
          style={{
            margin: "0 0 4px 0",
            fontSize: 13,
            letterSpacing: "0.05em",
            color: "#1d4ed8",
          }}
        >
          ZIPLY MAP FILTERS
        </h3>
        <p style={{ margin: 0, fontSize: 10, color: "#9ca3af" }}>
          Showing ~{visibleEstimate} of {ziplyJobs.length} Ziply jobs
          {filters.ziplyNorthMetroOnly
            ? ` · North Metro (${northMetroJobs.length})`
            : ""}
        </p>
        <p style={{ margin: "4px 0 0", fontSize: 9, color: "#6b7280" }}>
          Prints: {printCounts.onMap} plottable on map · {printCounts.needRepair}{" "}
          need location repair · {printCounts.processing} ingesting ·{" "}
          {printCounts.none} none
        </p>
      </div>

      {(printCounts.needRepair > 0 || repairMsg) && (
        <div
          style={{
            padding: 8,
            background: "rgba(251,191,36,0.1)",
            border: "1px solid rgba(251,191,36,0.35)",
            borderRadius: 6,
          }}
        >
          <p style={{ margin: "0 0 8px", fontSize: 10, color: "#fbbf24", lineHeight: 1.4 }}>
            {printCounts.needRepair > 0
              ? `${printCounts.needRepair} print(s) have design data but missing lat/lng — they will not show until repaired.`
              : "Print location repair ready."}
          </p>
          <button
            type="button"
            disabled={repairBusy}
            onClick={() => void runBatchRepair()}
            style={{
              width: "100%",
              background: repairBusy ? "rgba(255,255,255,0.1)" : "#ca8a04",
              border: "none",
              color: "#fff",
              fontWeight: 800,
              fontSize: 11,
              padding: "8px 10px",
              borderRadius: 4,
              cursor: repairBusy ? "wait" : "pointer",
            }}
          >
            {repairBusy ? "Repairing locations…" : "Repair print locations (batch)"}
          </button>
          {repairMsg && (
            <p style={{ margin: "6px 0 0", fontSize: 9, color: "#e2e8f0" }}>{repairMsg}</p>
          )}
        </div>
      )}

      {/* North Metro */}
      <div
        style={{
          padding: 8,
          background: "rgba(29, 78, 216, 0.05)",
          border: "1px solid rgba(29, 78, 216, 0.15)",
          borderRadius: 6,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            color: "#0f172a",
          }}
        >
          <input
            type="checkbox"
            checked={!!filters.ziplyNorthMetroOnly}
            onChange={(e) =>
              setFilters({ ...filters, ziplyNorthMetroOnly: e.target.checked })
            }
            style={{ accentColor: "#1d4ed8" }}
          />
          <span style={{ color: "#0f172a" }}>NORTH METRO ONLY</span>
          <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>
            {northMetroJobs.length}
          </span>
        </label>
        <p style={{ margin: "4px 0 0 20px", fontSize: 9, color: "#475569" }}>
          Filters to North Metro cities (Lynnwood, Everett, Edmonds, …) or jobs
          whose construction base says North Metro.
        </p>
      </div>

      {/* Print document filter */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#1d4ed8",
            letterSpacing: "0.05em",
          }}
        >
          Print documents
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {PRINT_FILTERS.map((opt) => {
            const isSelected = (filters.ziplyPrintFilter ?? "all") === opt.id;
            return (
              <label
                key={opt.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "5px 8px",
                  background: isSelected
                    ? "rgba(29, 78, 216, 0.08)"
                    : "rgba(29, 78, 216, 0.02)",
                  border: isSelected
                    ? "1px solid rgba(29, 78, 216, 0.25)"
                    : "1px solid rgba(29, 78, 216, 0.08)",
                  borderRadius: 4,
                  fontSize: 11,
                  cursor: "pointer",
                  color: isSelected ? "#0f172a" : "#475569",
                  fontWeight: isSelected ? 700 : 500,
                }}
              >
                <input
                  type="radio"
                  name="ziply-print-filter"
                  checked={isSelected}
                  onChange={() =>
                    setFilters({ ...filters, ziplyPrintFilter: opt.id })
                  }
                  style={{ accentColor: "#1d4ed8" }}
                />
                <span style={{ color: isSelected ? "#0f172a" : "#475569" }}>{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {/* Map layers */}
      <div
        style={{
          padding: 8,
          background: "rgba(29, 78, 216, 0.05)",
          border: "1px solid rgba(29, 78, 216, 0.15)",
          borderRadius: 6,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
            color: "#0f172a",
          }}
        >
          <input
            type="checkbox"
            checked={ziplyPrintLayerVisible}
            onChange={(e) => setZiplyPrintLayerVisible(e.target.checked)}
            style={{ accentColor: "#1d4ed8" }}
          />
          <span style={{ color: "#0f172a" }}>SHOW PRINT DESIGN LAYER</span>
        </label>
        <p style={{ margin: "4px 0 0 20px", fontSize: 9, color: "#475569" }}>
          Overlay hubs, terminals, and cables for jobs that already ingested a
          print ({printCounts.ready} ready).
        </p>
      </div>

      {ziplyPrintLayerVisible && (
        <div
          style={{
            padding: 10,
            background: "rgba(29, 78, 216, 0.04)",
            border: "1px solid rgba(29, 78, 216, 0.1)",
            borderRadius: 6,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          <span style={{ fontSize: 10, fontWeight: 800, color: "#1d4ed8", letterSpacing: "0.08em" }}>
            FIELD OPS LAYER CONTROLS
          </span>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
            {(Object.keys(LAYER_META) as (keyof typeof LAYER_META)[]).map((k) => {
              const on = activeLayers.has(k);
              const meta = LAYER_META[k];
              const count = counts[k] ?? 0;
              return (
                <button
                  key={k}
                  type="button"
                  onClick={() => toggleLayer(k)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    padding: "4px 6px",
                    background: on ? "rgba(29, 78, 216, 0.08)" : "transparent",
                    border: on ? "1px solid rgba(29, 78, 216, 0.15)" : "1px solid transparent",
                    borderRadius: 4,
                    color: on ? "#0f172a" : "#475569",
                    fontSize: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    width: "100%",
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: meta.color,
                      marginRight: 8,
                      boxShadow: on ? `0 0 8px ${meta.color}` : "none",
                    }}
                  />
                  <span style={{ flex: 1, fontWeight: on ? 700 : 500 }}>{meta.label}</span>
                  <span style={{ fontSize: 9, opacity: 0.6, marginRight: 8 }}>{count}</span>
                  <span style={{
                    fontSize: 8,
                    fontWeight: 800,
                    color: on ? "#059669" : "#dc2626",
                  }}>
                    {on ? "ON" : "OFF"}
                  </span>
                </button>
              );
            })}
          </div>

          <div style={{ marginTop: 8, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 8 }}>
            <label
              style={{
                display: "block",
                background: "linear-gradient(180deg, #1e293b, #0f172a)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "#38bdf8",
                padding: "6px 8px",
                borderRadius: 4,
                textAlign: "center",
                fontSize: "10px",
                fontWeight: 700,
                cursor: isImporting ? "wait" : "pointer",
              }}
            >
              {isImporting ? "Importing KML..." : "Import My Maps KML"}
              <input
                type="file"
                accept=".kml"
                onChange={handleKmlFileChange}
                disabled={isImporting}
                style={{ display: "none" }}
              />
            </label>
          </div>
        </div>
      )}

      <div
        style={{
          padding: 8,
          background: "rgba(250,204,21,0.07)",
          border: "1px solid rgba(250,204,21,0.22)",
          borderRadius: 6,
        }}
      >
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            cursor: "pointer",
            fontSize: 11,
            fontWeight: 700,
          }}
        >
          <input
            type="checkbox"
            checked={ziply811OverlayVisible}
            onChange={(e) => setZiply811OverlayVisible(e.target.checked)}
            style={{ accentColor: "#FACC15" }}
          />
          <span style={{ color: "#FACC15" }}>811 CLEARANCE BY SECTION</span>
        </label>
      </div>

      {/* Job status */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Status{" "}
          <span style={{ fontWeight: 500, textTransform: "none" }}>
            (empty = all)
          </span>
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {STATUS_GROUPS.map(({ id, label }) => (
            <label
              key={id}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 8px",
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: 4,
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={isStatusChecked(id)}
                  onChange={() => handleStatusToggle(id)}
                  style={{ accentColor: "#1d4ed8" }}
                />
                <span>{label}</span>
              </div>
              <span style={{ fontSize: 10, color: "#6b7280" }}>
                {getStatusCount(id)}
              </span>
            </label>
          ))}
        </div>
        {groups.size > 0 && (
          <button
            type="button"
            onClick={() =>
              setFilters({ ...filters, ziplyStatusGroups: new Set() })
            }
            style={{
              marginTop: 6,
              background: "none",
              border: "none",
              color: "#38bdf8",
              fontSize: 10,
              cursor: "pointer",
              padding: 0,
            }}
          >
            Clear status filter (show all)
          </button>
        )}
      </div>

      {/* Sites */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Sites (by city)
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {sites.map((site) => {
            const isExpanded = expandedSites.has(site);
            const siteJobs = jobsBySite.get(site)!;
            const readyCount = siteJobs.filter(
              (j) => getZiplyPrintDocStatus(j) === "ready"
            ).length;
            return (
              <div key={site} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <div
                  onClick={() => toggleSite(site)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 8px",
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {isExpanded ? (
                      <ChevronDown size={14} color="#9ca3af" />
                    ) : (
                      <ChevronRight size={14} color="#9ca3af" />
                    )}
                    <span style={{ fontSize: 11, fontWeight: 600 }}>{site}</span>
                    <span style={{ fontSize: 9, color: "#6b7280" }}>
                      {siteJobs.length} jobs · {readyCount} prints
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => handlePanToSite(site, e)}
                    style={{
                      background: "var(--accent, #1d4ed8)",
                      border: "none",
                      borderRadius: 12,
                      color: "#000",
                      fontSize: 9,
                      fontWeight: 800,
                      padding: "2px 8px",
                      cursor: "pointer",
                    }}
                  >
                    GO TO SITE
                  </button>
                </div>
                {isExpanded && (
                  <div
                    style={{
                      paddingLeft: 16,
                      marginTop: 4,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                    }}
                  >
                    {siteJobs.map((job) => {
                      const pst = getZiplyPrintDocStatus(job);
                      return (
                        <div
                          key={job.jobId}
                          style={{
                            fontSize: 10,
                            color: "#cbd5e1",
                            display: "grid",
                            gridTemplateColumns: "1fr auto auto",
                            gap: 6,
                            borderBottom: "1px solid rgba(255,255,255,0.05)",
                            paddingBottom: 3,
                            alignItems: "center",
                          }}
                        >
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={job.workOrder}
                          >
                            {job.workOrder}
                            {job.hubNumber ? ` · H${job.hubNumber}` : ""}
                          </span>
                          <span
                            style={{
                              color: ziplyPrintStatusColor(pst),
                              fontWeight: 700,
                              fontSize: 9,
                            }}
                            title={ziplyPrintStatusLabel(pst)}
                          >
                            {pst === "ready"
                              ? "PRINT"
                              : pst === "processing"
                                ? "…"
                                : pst === "failed"
                                  ? "FAIL"
                                  : "—"}
                          </span>
                          <span
                            style={{
                              color:
                                job.jobStatus === "Complete" ? "#1d4ed8" : "#4facfe",
                              fontSize: 9,
                            }}
                          >
                            {(job.jobStatus || "NS").slice(0, 12)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Options */}
      <div>
        <span
          style={{
            display: "block",
            fontSize: 10,
            fontWeight: 700,
            marginBottom: 6,
            textTransform: "uppercase",
            color: "#9ca3af",
            letterSpacing: "0.05em",
          }}
        >
          Options
        </span>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            marginBottom: 6,
          }}
        >
          <input
            type="checkbox"
            checked={filters.hideUnmapped}
            onChange={(e) =>
              setFilters({ ...filters, hideUnmapped: e.target.checked })
            }
            style={{ accentColor: "#1d4ed8" }}
          />
          <span>Hide unmapped jobs</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            marginBottom: 6,
          }}
        >
          <input
            type="checkbox"
            checked={filters.inTrackerOnly}
            onChange={(e) =>
              setFilters({ ...filters, inTrackerOnly: e.target.checked })
            }
            style={{ accentColor: "#1d4ed8" }}
          />
          <span>On tracker only</span>
        </label>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 11,
            cursor: "pointer",
            marginTop: 8,
            padding: "6px 8px",
            background: "rgba(250, 204, 21, 0.1)",
            border: "1px solid rgba(250, 204, 21, 0.3)",
            borderRadius: 4,
          }}
        >
          <input
            type="checkbox"
            checked={filters.showDigPolygons ?? true}
            onChange={(e) =>
              setFilters({ ...filters, showDigPolygons: e.target.checked })
            }
            style={{ accentColor: "#FACC15" }}
          />
          <span style={{ color: "#FACC15", fontWeight: 700 }}>
            SHOW 811 DIG TICKETS
          </span>
        </label>
      </div>
    </div>
  );
}
