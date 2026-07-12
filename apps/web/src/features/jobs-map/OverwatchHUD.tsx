import { useEffect, useState } from "react";
import { useAuth } from "../auth/authContext.js";
import { api } from "../../lib/api.js";
import type { Job, DigTicket } from "@nsc/types";
import { ShieldCheck, Crosshair, Map, Activity } from "lucide-react";
import { useActiveContract } from "../workspace/contractStore.js";
import "./overwatchHUD.css";

/** Overwatch is for Billy only — match full name or first name. */
function isBillyOperator(username: string | null | undefined): boolean {
  if (!username) return false;
  const n = username.trim().toLowerCase();
  return n === "billy keesee" || n === "billy";
}

export default function OverwatchHUD() {
  const { username, authReady, firebaseUser } = useAuth();
  const { contract } = useActiveContract();
  const [open, setOpen] = useState(false);
  const showHud = isBillyOperator(username);

  const [metrics, setMetrics] = useState({
    jobsCount: 0,
    ticketsCount: 0,
    markupsCount: 0,
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !showHud || !authReady || !firebaseUser) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);

    Promise.all([
      api.listJobs(),
      api.listDigTickets("*"),
      api.getAllDrawings().catch(() => ({ docs: [] as unknown[] })),
    ])
      .then(([jobsRes, ticketsRes, drawingsRes]) => {
        if (cancelled) return;
        setMetrics({
          jobsCount: jobsRes.jobs.length,
          ticketsCount: ticketsRes.tickets.length,
          markupsCount: drawingsRes.docs.length,
        });
        setLoadError(null);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setMetrics({ jobsCount: 0, ticketsCount: 0, markupsCount: 0 });
        const msg = err?.message ?? String(err);
        if (/AUTH_ALLOWED_EMAILS is not configured/i.test(msg)) {
          setLoadError(
            "Server AUTH_ALLOWED_EMAILS is empty — set it on Vercel to your login email."
          );
        } else if (/403|Access denied/i.test(msg)) {
          setLoadError(
            "API access denied — add your email to AUTH_ALLOWED_EMAILS on Vercel."
          );
        } else if (/401/i.test(msg)) {
          setLoadError("Not authorized (401). Sign out and sign in again.");
        } else {
          setLoadError(msg.slice(0, 180));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, showHud, authReady, firebaseUser?.uid]);

  // ONLY Billy gets the HUD (hooks above must always run)
  if (!showHud) return null;

  return (
    <>
      <button
        className={`overwatch-toggle ${open ? "active" : ""}`}
        onClick={() => setOpen(!open)}
        title="Toggle Overwatch HUD"
      >
        <ShieldCheck size={20} />
        <span>OVERWATCH</span>
      </button>

      <div className={`overwatch-hud-container ${open ? "open" : ""}`}>
        <div className="overwatch-hud-content">
          <div className="hud-header">
            <h3>GLOBAL OVERWATCH</h3>
            <div className="live-badge">
              <span className="pulse-dot" /> {loading ? "…" : "LIVE"}
            </div>
          </div>

          {loadError && (
            <div
              style={{
                margin: "0 0 10px",
                padding: "8px 10px",
                borderRadius: 6,
                background: "rgba(248,113,113,0.12)",
                border: "1px solid rgba(248,113,113,0.4)",
                color: "#fecaca",
                fontSize: 10,
                lineHeight: 1.4,
              }}
            >
              {loadError}
            </div>
          )}

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

            {contract !== "Ziply" && (
              <div className="metric-box">
                <Map size={24} className="metric-icon markups-icon" />
                <div className="metric-details">
                  <span className="metric-value">{metrics.markupsCount}</span>
                  <span className="metric-label">MARKUPS</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
