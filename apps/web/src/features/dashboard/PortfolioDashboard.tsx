import { useMemo, useState, useEffect } from "react";
import type { Job, DigTicket } from "@nsc/types";
import { api } from "../../lib/api.js";
import {
  Search,
  AlertTriangle,
  FileText,
  MapPin,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Layers,
  ArrowUpRight,
  FolderPlus,
} from "lucide-react";

interface Props {
  jobs: Job[];
  onSelectJob: (job: Job) => void;
  onOpenMap: (job?: Job) => void;
  onOpenEarth?: () => void;
}

export default function PortfolioDashboard({
  jobs,
  onSelectJob,
  onOpenMap,
  onOpenEarth,
}: Props) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [tickets, setTickets] = useState<DigTicket[]>([]);
  const [loadingTickets, setLoadingTickets] = useState(false);
  const [activityEvents, setActivityEvents] = useState<
    Array<{ id: string; summary: string; timestamp: number; eventType: string }>
  >([]);

  useEffect(() => {
    let active = true;
    setLoadingTickets(true);
    api.listDigTickets("*")
      .then(({ tickets }) => {
        if (active) setTickets(tickets);
      })
      .catch(() => {
        if (active) setTickets([]);
      })
      .finally(() => {
        if (active) setLoadingTickets(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Filtered jobs list
  const filteredJobs = useMemo(() => {
    const q = query.trim().toLowerCase();
    return jobs.filter((j) => {
      if (statusFilter !== "all") {
        const s = (j.jobStatus || "").toLowerCase();
        if (statusFilter === "in_progress" && !s.includes("progress") && !s.includes("active")) return false;
        if (statusFilter === "complete" && !s.includes("complete")) return false;
        if (statusFilter === "pending" && !s.includes("pending") && !s.includes("survey")) return false;
      }
      if (cityFilter !== "all" && (j.city || "").trim() !== cityFilter) {
        return false;
      }
      if (!q) return true;
      const hay = [
        j.workOrder,
        j.buildReference,
        j.displayName,
        j.city,
        j.address,
        j.constructionSupervisor,
        j.crewName,
        j.customerProject,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [jobs, query, statusFilter, cityFilter]);

  // Distinct cities for filter dropdown
  const cities = useMemo(() => {
    return Array.from(new Set(jobs.map((j) => (j.city || "").trim()).filter(Boolean))).sort();
  }, [jobs]);

  // Overall KPIs
  const kpis = useMemo(() => {
    const total = jobs.length;
    let completed = 0;
    let inProgress = 0;
    let totalBoreFt = 0;
    let totalPlacingFt = 0;

    jobs.forEach((j) => {
      const s = (j.jobStatus || "").toLowerCase();
      if (s.includes("complete")) completed++;
      else inProgress++;

      totalBoreFt += j.completedBoreFt ?? 0;
      totalPlacingFt += j.completedPlacingFt ?? 0;
    });

    return {
      total,
      completed,
      inProgress,
      totalPlacedFt: totalBoreFt + totalPlacingFt,
    };
  }, [jobs]);

  // Attention Queue: expiring tickets (< 7 days) and failed syncs
  const attentionItems = useMemo(() => {
    const now = Date.now();
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const items: Array<{
      id: string;
      jobId: string;
      title: string;
      subtitle: string;
      level: "critical" | "warning" | "info";
    }> = [];

    // Check expiring 811 tickets
    tickets.forEach((t) => {
      if (t.dates.expiresAt && t.dates.expiresAt > now && t.dates.expiresAt - now < weekMs) {
        const daysLeft = Math.ceil((t.dates.expiresAt - now) / (24 * 60 * 60 * 1000));
        items.push({
          id: `ticket_${t.id}`,
          jobId: t.jobId,
          title: `811 Ticket #${t.ticketNumber || t.id} Expiring`,
          subtitle: `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining · Job ${t.jobId}`,
          level: daysLeft <= 2 ? "critical" : "warning",
        });
      }
    });

    // Check failed syncs or unprovisioned folders
    jobs.slice(0, 50).forEach((j) => {
      if (j.earthSync?.status === "failed") {
        items.push({
          id: `sync_${j.jobId}`,
          jobId: j.jobId,
          title: `Earth Sync Failed`,
          subtitle: `${j.displayName || j.workOrder} · ${j.earthSync.errorMessage || "Network error"}`,
          level: "critical",
        });
      }
    });

    return items;
  }, [tickets, jobs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#0a0d14", color: "#f8fafc", overflowY: "auto", padding: 24, gap: 24, fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif" }}>
      {/* Header & Quick Action Bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.15em", color: "#06b6d4", textTransform: "uppercase" }}>
              North Sky Map Studio
            </span>
            <span style={{ background: "rgba(6, 182, 212, 0.15)", border: "1px solid rgba(6, 182, 212, 0.4)", color: "#22d3ee", fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 999 }}>
              NSMS PRODUCTION
            </span>
          </div>
          <h1 style={{ margin: "4px 0 0 0", fontSize: 24, fontWeight: 900, letterSpacing: "-0.02em", color: "#ffffff" }}>
            Portfolio Dashboard & Operations Hub
          </h1>
        </div>

        {/* Quick Actions */}
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => onOpenMap()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "linear-gradient(135deg, #0284c7 0%, #0369a1 100%)",
              border: "1px solid #38bdf8",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 800,
              padding: "8px 14px",
              borderRadius: 8,
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(2, 132, 199, 0.35)",
            }}
          >
            <Layers size={14} /> Open Dark Map
          </button>
          {onOpenEarth && (
            <button
              type="button"
              onClick={onOpenEarth}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "rgba(255, 255, 255, 0.06)",
                border: "1px solid rgba(255, 255, 255, 0.18)",
                color: "#e2e8f0",
                fontSize: 11,
                fontWeight: 800,
                padding: "8px 14px",
                borderRadius: 8,
                cursor: "pointer",
              }}
            >
              <ExternalLink size={14} /> Open ZIPLY in Google Earth
            </button>
          )}
        </div>
      </div>

      {/* KPI Overview Strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Total Managed Jobs</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#ffffff", marginTop: 4, fontFamily: "var(--font-mono, monospace)" }}>{kpis.total}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Smartsheet & NSMS linked</div>
        </div>

        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(6, 182, 212, 0.2)", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#38bdf8", textTransform: "uppercase", letterSpacing: "0.08em" }}>Active Construction</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#38bdf8", marginTop: 4, fontFamily: "var(--font-mono, monospace)" }}>{kpis.inProgress}</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>In progress & field active</div>
        </div>

        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(52, 211, 153, 0.2)", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#34d399", textTransform: "uppercase", letterSpacing: "0.08em" }}>Completed Spans (ft)</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#34d399", marginTop: 4, fontFamily: "var(--font-mono, monospace)" }}>
            {kpis.totalPlacedFt.toLocaleString()}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Bore + placing linear footage</div>
        </div>

        <div style={{ background: "rgba(15, 23, 42, 0.6)", border: "1px solid rgba(251, 191, 36, 0.2)", borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 800, color: "#fbbf24", textTransform: "uppercase", letterSpacing: "0.08em" }}>Attention Items</div>
          <div style={{ fontSize: 28, fontWeight: 900, color: "#fbbf24", marginTop: 4, fontFamily: "var(--font-mono, monospace)" }}>
            {attentionItems.length}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>Expiring tickets & sync flags</div>
        </div>
      </div>

      {/* Main Grid: Job Control + Attention Queue */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 24, minHeight: 480 }}>
        {/* Left: Job Control List */}
        <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
            <h2 style={{ fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", margin: 0, color: "#f1f5f9" }}>
              Job Control & Operations
            </h2>

            {/* Filter Bar */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, padding: "4px 8px", gap: 6 }}>
                <Search size={12} color="#94a3b8" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search jobs, hubs, cities..."
                  style={{ background: "transparent", border: "none", color: "#ffffff", fontSize: 11, outline: "none", width: 140 }}
                />
              </div>

              <select
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", color: "#f8fafc", fontSize: 11, borderRadius: 6, padding: "5px 8px", outline: "none" }}
              >
                <option value="all">All Cities</option>
                {cities.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Job Items Table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid rgba(255,255,255,0.08)", color: "#94a3b8", textAlign: "left" }}>
                  <th style={{ padding: "8px 10px", fontWeight: 800, fontSize: 10, textTransform: "uppercase" }}>Job Standard</th>
                  <th style={{ padding: "8px 10px", fontWeight: 800, fontSize: 10, textTransform: "uppercase" }}>City / ROW</th>
                  <th style={{ padding: "8px 10px", fontWeight: 800, fontSize: 10, textTransform: "uppercase" }}>Status</th>
                  <th style={{ padding: "8px 10px", fontWeight: 800, fontSize: 10, textTransform: "uppercase" }}>Crew</th>
                  <th style={{ padding: "8px 10px", fontWeight: 800, fontSize: 10, textTransform: "uppercase", textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredJobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#64748b" }}>
                      No matching jobs found.
                    </td>
                  </tr>
                ) : (
                  filteredJobs.slice(0, 25).map((job) => {
                    const disp = job.displayName || `${job.workOrder} — ${job.buildReference || "Unassigned"}`;
                    const isDone = (job.jobStatus || "").toLowerCase().includes("complete");

                    return (
                      <tr
                        key={job.jobId}
                        style={{ borderBottom: "1px solid rgba(255,255,255,0.04)", cursor: "pointer", transition: "background 0.15s" }}
                        onClick={() => onSelectJob(job)}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                      >
                        <td style={{ padding: "10px", fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono, monospace)" }}>
                          {disp}
                        </td>
                        <td style={{ padding: "10px", color: "#cbd5e1" }}>
                          {job.city || "—"}
                        </td>
                        <td style={{ padding: "10px" }}>
                          <span style={{
                            fontSize: 9,
                            fontWeight: 800,
                            padding: "3px 8px",
                            borderRadius: 4,
                            background: isDone ? "rgba(16, 185, 129, 0.15)" : "rgba(6, 182, 212, 0.15)",
                            color: isDone ? "#34d399" : "#38bdf8",
                            border: `1px solid ${isDone ? "rgba(16, 185, 129, 0.3)" : "rgba(6, 182, 212, 0.3)"}`,
                            textTransform: "uppercase",
                          }}>
                            {job.jobStatus || "Active"}
                          </span>
                        </td>
                        <td style={{ padding: "10px", color: "#94a3b8", fontSize: 11 }}>
                          {job.crewName || job.constructionCrewForeman || "—"}
                        </td>
                        <td style={{ padding: "10px", textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectJob(job);
                            }}
                            style={{
                              background: "rgba(255,255,255,0.06)",
                              border: "1px solid rgba(255,255,255,0.12)",
                              color: "#ffffff",
                              fontSize: 10,
                              fontWeight: 800,
                              padding: "4px 8px",
                              borderRadius: 4,
                              cursor: "pointer",
                            }}
                          >
                            Open
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Attention Queue */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 12, padding: 16 }}>
            <h3 style={{ fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 12px 0", color: "#fbbf24", display: "flex", alignItems: "center", gap: 6 }}>
              <AlertTriangle size={14} /> Attention Queue ({attentionItems.length})
            </h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 380, overflowY: "auto" }}>
              {attentionItems.length === 0 ? (
                <div style={{ padding: 16, textAlign: "center", color: "#64748b", fontSize: 11 }}>
                  ✓ All syncs healthy · Zero expiring 811 tickets
                </div>
              ) : (
                attentionItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      background: item.level === "critical" ? "rgba(239, 68, 68, 0.1)" : "rgba(245, 158, 11, 0.1)",
                      border: `1px solid ${item.level === "critical" ? "rgba(239, 68, 68, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                      padding: 10,
                      borderRadius: 8,
                      display: "flex",
                      flexDirection: "column",
                      gap: 2,
                    }}
                  >
                    <span style={{ fontSize: 11, fontWeight: 800, color: item.level === "critical" ? "#fca5a5" : "#fcd34d" }}>
                      {item.title}
                    </span>
                    <span style={{ fontSize: 10, color: "#cbd5e1" }}>
                      {item.subtitle}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
