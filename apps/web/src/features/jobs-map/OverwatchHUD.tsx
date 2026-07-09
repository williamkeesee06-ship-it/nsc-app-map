import { useEffect, useState } from "react";
import { useAuth } from "../auth/authContext.js";
import { api } from "../../lib/api.js";
import type { Job, DigTicket } from "@nsc/types";
import { ShieldCheck, Crosshair, Map, Activity } from "lucide-react";
import "./overwatchHUD.css";

export default function OverwatchHUD() {
  const { username } = useAuth();
  const [open, setOpen] = useState(false);

  const [metrics, setMetrics] = useState({
    jobsCount: 0,
    ticketsCount: 0,
    markupsCount: 0,
  });

  // ONLY Billy gets the HUD
  if (username !== "Billy") return null;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    
    // Fetch global data by bypassing scoping (isManager logic or explicit wildcard)
    Promise.all([
      api.listJobs().catch(() => ({ jobs: [] as Job[] })),
      api.listDigTickets().catch(() => ({ tickets: [] as DigTicket[] })),
      api.getAllDrawings().catch(() => ({ docs: [] }))
    ]).then(([jobsRes, ticketsRes, drawingsRes]) => {
      if (cancelled) return;
      setMetrics({
        jobsCount: jobsRes.jobs.length,
        ticketsCount: ticketsRes.tickets.length,
        markupsCount: drawingsRes.docs.length,
      });
    });

    return () => { cancelled = true; };
  }, [open]);

  return (
    <>
      {/* Toggle Button */}
      <button 
        className={`overwatch-toggle ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        title="Toggle Overwatch HUD"
      >
        <ShieldCheck size={20} />
        <span>OVERWATCH</span>
      </button>

      {/* Dropdown HUD */}
      <div className={`overwatch-hud-container ${open ? "open" : ""}`}>
        <div className="overwatch-hud-content">
          <div className="hud-header">
            <h3>GLOBAL OVERWATCH</h3>
            <div className="live-badge">
              <span className="pulse-dot" /> LIVE
            </div>
          </div>
          
          <div className="hud-metrics">
            <div className="metric-box">
              <Crosshair size={24} className="metric-icon jobs-icon" />
              <div className="metric-details">
                <span className="metric-value">{metrics.jobsCount}</span>
                <span className="metric-label">TOTAL JOBS</span>
              </div>
            </div>

            <div className="metric-box">
              <Activity size={24} className="metric-icon tickets-icon" />
              <div className="metric-details">
                <span className="metric-value">{metrics.ticketsCount}</span>
                <span className="metric-label">DIG TICKETS</span>
              </div>
            </div>

            <div className="metric-box">
              <Map size={24} className="metric-icon markups-icon" />
              <div className="metric-details">
                <span className="metric-value">{metrics.markupsCount}</span>
                <span className="metric-label">MARKUPS</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
