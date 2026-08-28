import { useEffect, useMemo, useState } from "react";
import type { DigTicket, Job } from "@nsc/types";
import { api } from "../../lib/api.js";

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

export default function ZiplyDashboardTab({ jobs }: Props) {
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

  const ziplyJobs = useMemo(
    () => jobs.filter((j) => j.customerProject === "Ziply" && j.inTracker !== false),
    [jobs],
  );
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
    <div style={{ padding: 12, color: "#0f172a" }}>
      <h3 style={{ margin: "0 0 4px 0", fontSize: 13, fontWeight: 800, letterSpacing: "0.05em", color: "#1d4ed8" }}>
        ZIPLY COMPANY ROLLUP
      </h3>
      <p style={{ margin: "0 0 12px 0", fontSize: 10, color: "#64748b" }}>
        {selectedHub ? `Hub drill-down · ${selectedHub}` : selectedCity ? `City drill-down · ${selectedCity}` : "All cities / all hubs"}
      </p>

      {(selectedCity || selectedHub) && (
        <button
          style={{ marginBottom: 10, background: "#f1f5f9", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 4, padding: "5px 8px", fontSize: 10, fontWeight: 700, cursor: "pointer" }}
          onClick={() => selectedHub ? setSelectedHub(null) : setSelectedCity(null)}
        >
          ← Back to {selectedHub ? "city" : "company"}
        </button>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <Metric label="Overall Complete" value={`${rollup.pct}%`} sub={`${fmt(rollup.completed)} / ${fmt(rollup.estimated)} ft`} />
        <Metric label="Footage Placed" value={`${fmt(rollup.completed)} ft`} sub="bore + placing + aerial" />
        <Metric label="Active Crews" value={String(rollup.activeCrews.length)} sub={rollup.activeCrews.slice(0, 3).join(", ") || "No section crews assigned"} />
        <Metric label="Outstanding 811s" value={String(rollup.unclearedSections)} sub={`${rollup.sectionCount} tracked sections`} warn={rollup.unclearedSections > 0} />
      </div>

      {!selectedCity && !selectedHub && (
        <DrillList
          title="Cities"
          rows={cityNames.map((city) => ({ name: city, meta: `${ziplyJobs.filter((j) => (j.city || "Unknown City").trim() === city).length} hubs/jobs`, pct: 0 }))}
          onClick={(name) => setSelectedCity(name)}
        />
      )}

      {selectedCity && !selectedHub && (
        <DrillList
          title="Hubs"
          rows={hubs.map((h) => ({ name: h.name, meta: `${h.jobs} job${h.jobs === 1 ? "" : "s"} · ${fmt(h.completed)} / ${fmt(h.estimated)} ft`, pct: h.pct }))}
          onClick={(name) => setSelectedHub(name)}
        />
      )}

      {selectedHub && (
        <div>
          <h4 style={{ margin: "0 0 8px 0", fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em" }}>
            Per-hub dashboard
          </h4>
          <div style={{ background: "#f8fafc", borderRadius: 6, padding: 10, border: "1px solid #e2e8f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
              <span style={{ fontWeight: 800, color: "#0f172a" }}>Hub {selectedHub}</span>
              <span style={{ color: "#1d4ed8", fontWeight: 800 }}>{rollup.pct}%</span>
            </div>
            <div style={{ width: "100%", height: 6, background: "#e2e8f0", borderRadius: 3, overflow: "hidden" }}>
              <div style={{ width: `${rollup.pct}%`, height: "100%", background: "#1d4ed8", borderRadius: 3 }} />
            </div>
            <div style={{ fontSize: 10, color: "#475569", marginTop: 8 }}>
              {rollup.completedJobs} completed job records · {rollup.activeCrews.length} active crews · {rollup.unclearedSections} sections needing active 811 coverage
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div style={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 6, padding: 9, boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
      <div style={{ fontSize: 9, color: "#64748b", fontWeight: 800, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color: warn ? "#d97706" : "#1d4ed8", margin: "4px 0" }}>{value}</div>
      <div style={{ fontSize: 9, color: "#475569", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub}</div>
    </div>
  );
}

function DrillList({ title, rows, onClick }: { title: string; rows: Array<{ name: string; meta: string; pct: number }>; onClick: (name: string) => void }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "0 0 8px 0", fontSize: 10, fontWeight: 800, textTransform: "uppercase", color: "#64748b", letterSpacing: "0.05em" }}>{title}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {rows.map((row) => (
          <button key={row.name} onClick={() => onClick(row.name)} style={{ textAlign: "left", background: "#ffffff", borderRadius: 6, padding: 8, border: "1px solid #e2e8f0", color: "#0f172a", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.03)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 2 }}>
              <span style={{ fontWeight: 800 }}>{row.name}</span>
              {row.pct > 0 && <span style={{ color: "#1d4ed8", fontWeight: 800 }}>{row.pct}%</span>}
            </div>
            <div style={{ fontSize: 9, color: "#64748b" }}>{row.meta}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
