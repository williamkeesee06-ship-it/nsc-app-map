import { useEffect, useMemo, useState } from "react";
import type { DigTicket, Job } from "@nsc/types";
import { api } from "../../../lib/api.js";
import Bezel from "../components/Bezel.js";

interface Props {
  jobs: Job[];
}

const live811Statuses = new Set<DigTicket["status"]>(["Filed", "Active", "Expiring"]);
const doneStatuses = new Set(["billing complete", "all construction complete", "complete", "completed"]);

function footage(job: Job, kind: "estimated" | "completed") {
  if (kind === "estimated") return (job.estBoreFt ?? 0) + (job.estPlacingFt ?? 0) + (job.estAerialFt ?? 0);
  return (job.completedBoreFt ?? 0) + (job.completedPlacingFt ?? 0) + (job.completedAerialFt ?? 0);
}

function hubId(job: Job) {
  return job.hubNumber || job.ziplyPrintLayer?.hubId || job.workOrder || "Unknown Hub";
}

function fmt(n: number) {
  return Math.round(n).toLocaleString();
}

export default function ZiplyRollupCard({ jobs }: Props) {
  const [tickets, setTickets] = useState<DigTicket[]>([]);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedHub, setSelectedHub] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.listDigTickets("*")
      .then(({ tickets }) => {
        if (active) setTickets(tickets);
      })
      .catch(() => {
        if (active) setTickets([]);
      });
    return () => {
      active = false;
    };
  }, []);

  const ziplyJobs = useMemo(() => jobs.filter((j) => j.customerProject === "Ziply"), [jobs]);
  const cityNames = useMemo(() => Array.from(new Set(ziplyJobs.map((j) => (j.city || "Unknown City").trim()))).sort(), [ziplyJobs]);
  const cityJobs = selectedCity ? ziplyJobs.filter((j) => (j.city || "Unknown City").trim() === selectedCity) : ziplyJobs;
  const hubNames = useMemo(() => Array.from(new Set(cityJobs.map(hubId))).sort(), [cityJobs]);
  const hubJobs = selectedHub ? cityJobs.filter((j) => hubId(j) === selectedHub) : cityJobs;

  const liveTicketKeys = useMemo(() => {
    const now = Date.now();
    return new Set(
      tickets
        .filter((t) => ziplyJobs.some((j) => j.jobId === t.jobId))
        .filter((t) => live811Statuses.has(t.status) && (!t.dates.expiresAt || t.dates.expiresAt > now))
        .map((t) => t.scope ? `${t.jobId}:${t.scope.kind}:${t.scope.ref}` : `${t.jobId}:job`)
    );
  }, [tickets, ziplyJobs]);

  const rollup = useMemo(() => {
    const estimated = hubJobs.reduce((s, j) => s + footage(j, "estimated"), 0);
    const completed = hubJobs.reduce((s, j) => s + footage(j, "completed"), 0);
    const pct = estimated > 0 ? Math.round((completed / estimated) * 100) : 0;

    const crews = new Set<string>();
    let sectionCount = 0;
    let unclearedSections = 0;
    hubJobs.forEach((j) => {
      if (j.crewName) crews.add(j.crewName);
      const mo = j.ziplyPrintLayer?.mapObjects;
      mo?.terminals?.forEach((t) => {
        sectionCount += 1;
        if (t.crewName) crews.add(t.crewName);
        const key = `${j.jobId}:terminal:${t.label}`;
        if (!liveTicketKeys.has(key) && !(t.locateExpires && t.locateExpires > Date.now())) unclearedSections += 1;
      });
      mo?.cables?.forEach((c) => {
        sectionCount += 1;
        if (c.crewName) crews.add(c.crewName);
        const key = `${j.jobId}:cable:${c.label}`;
        if (!liveTicketKeys.has(key) && !(c.locateExpires && c.locateExpires > Date.now())) unclearedSections += 1;
      });
    });

    const completedJobs = hubJobs.filter((j) => doneStatuses.has((j.jobStatus || j.secondaryJobStatus || "").toLowerCase())).length;
    const activeCrews = Array.from(crews).filter((c) => c.trim()).sort();

    return { estimated, completed, pct, activeCrews, sectionCount, unclearedSections, completedJobs };
  }, [hubJobs, liveTicketKeys]);

  const hubs = useMemo(() => {
    return hubNames.map((name) => {
      const list = cityJobs.filter((j) => hubId(j) === name);
      const estimated = list.reduce((s, j) => s + footage(j, "estimated"), 0);
      const completed = list.reduce((s, j) => s + footage(j, "completed"), 0);
      return { name, city: list[0]?.city || "Unknown City", estimated, completed, pct: estimated > 0 ? Math.round((completed / estimated) * 100) : 0, jobs: list.length };
    });
  }, [hubNames, cityJobs]);

  return (
    <Bezel className="card ziply-rollup-card" accent="#00843d">
      <div className="card__header" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <h2 className="card__title" style={{ fontSize: 13, textTransform: "uppercase", color: "var(--accent, #00d45a)", letterSpacing: "0.05em" }}>
          Ziply Company Rollup
        </h2>
        <span style={{ fontSize: 9, color: "#9ca3af" }}>
          {selectedHub ? `Hub · ${selectedHub}` : selectedCity ? `City · ${selectedCity}` : "All Cities / Hubs"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <Metric label="Overall Complete" value={`${rollup.pct}%`} sub={`${fmt(rollup.completed)} / ${fmt(rollup.estimated)} ft`} />
        <Metric label="Outstanding 811s" value={String(rollup.unclearedSections)} sub={`${rollup.sectionCount} tracked sections`} warn={rollup.unclearedSections > 0} />
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {(selectedCity || selectedHub) && (
          <button
            style={{
              alignSelf: "flex-start",
              marginBottom: 8,
              background: "rgba(255,255,255,0.06)",
              color: "#fff",
              border: "1px solid #374151",
              borderRadius: 4,
              padding: "4px 8px",
              fontSize: 10,
              cursor: "pointer",
              transition: "background 0.2s"
            }}
            onClick={() => (selectedHub ? setSelectedHub(null) : setSelectedCity(null))}
          >
            ← Back to {selectedHub ? "city" : "company"}
          </button>
        )}

        <div style={{ overflowY: "auto", maxHeight: 150, paddingRight: 4 }}>
          {!selectedCity && !selectedHub && (
            <DrillList
              title="Cities"
              rows={cityNames.map((city) => ({
                name: city,
                meta: `${ziplyJobs.filter((j) => (j.city || "Unknown City").trim() === city).length} hubs/jobs`,
                pct: 0,
              }))}
              onClick={(name) => setSelectedCity(name)}
            />
          )}

          {selectedCity && !selectedHub && (
            <DrillList
              title="Hubs"
              rows={hubs.map((h) => ({
                name: h.name,
                meta: `${h.jobs} job${h.jobs === 1 ? "" : "s"} · ${fmt(h.completed)} / ${fmt(h.estimated)} ft`,
                pct: h.pct,
              }))}
              onClick={(name) => setSelectedHub(name)}
            />
          )}

          {selectedHub && (
            <div style={{ background: "rgba(0,0,0,0.25)", borderRadius: 4, padding: 8, border: "1px solid #1f2937" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>Hub {selectedHub}</span>
                <span style={{ color: "#00d45a" }}>{rollup.pct}%</span>
              </div>
              <div style={{ width: "100%", height: 4, background: "#111827", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${rollup.pct}%`, height: "100%", background: "#00d45a", borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 9, color: "#9ca3af", marginTop: 8, lineHeight: 1.3 }}>
                {rollup.completedJobs} completed jobs · {rollup.activeCrews.length} active crews · {rollup.unclearedSections} sections needing active 811 coverage
              </div>
            </div>
          )}
        </div>
      </div>
    </Bezel>
  );
}

function Metric({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1f2937", borderRadius: 6, padding: 8 }}>
      <div style={{ fontSize: 8, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 800, color: warn ? "#FACC15" : "#00d45a", margin: "4px 0" }}>{value}</div>
      <div style={{ fontSize: 8, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
  );
}

function DrillList({ title, rows, onClick }: { title: string; rows: Array<{ name: string; meta: string; pct: number }>; onClick: (name: string) => void }) {
  return (
    <div>
      <h4 style={{ margin: "0 0 6px 0", fontSize: 9, fontWeight: 700, textTransform: "uppercase", color: "#9ca3af", letterSpacing: "0.05em" }}>
        {title}
      </h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row) => (
          <button
            key={row.name}
            onClick={() => onClick(row.name)}
            style={{
              textAlign: "left",
              background: "rgba(0,0,0,0.15)",
              borderRadius: 4,
              padding: "6px 8px",
              border: "1px solid #1f2937",
              color: "#fff",
              cursor: "pointer",
              transition: "border-color 0.2s"
            }}
            onMouseOver={(e) => (e.currentTarget.style.borderColor = "#374151")}
            onMouseOut={(e) => (e.currentTarget.style.borderColor = "#1f2937")}
          >
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 2 }}>
              <span style={{ fontWeight: 700 }}>{row.name}</span>
              {row.pct > 0 && <span style={{ color: "#00d45a" }}>{row.pct}%</span>}
            </div>
            <div style={{ fontSize: 8, color: "#9ca3af" }}>{row.meta}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
