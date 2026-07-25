import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import type { Job } from "@nsc/types";
import JobCard from "./JobCard.js";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export default function JobCardDesignsPage() {
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.listJobs()
      .then(({ jobs }) => {
        // Find the requested Job 6003516 or fall back to any Ziply job
        const target = jobs.find((j) => j.workOrder === "6003516") || 
                       jobs.find((j) => j.customerProject === "Ziply") || 
                       jobs[0];
        setJob(target ?? null);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Failed to load jobs:", err);
        setLoading(false);
      });
  }, []);

  if (loading) {
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100vh", background: "#f8fafc", color: "#0f172a", fontFamily: "sans-serif" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ border: "4px solid #cbd5e1", borderTopColor: "#06b6d4", borderRadius: "50%", width: 40, height: 40, animation: "spin 1s linear infinite", margin: "0 auto 12px auto" }} />
          <span>LOADING REAL JOB DATA...</span>
          <style>{`
            @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          `}</style>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div style={{ padding: 40, background: "#f8fafc", minHeight: "100vh", color: "#0f172a", fontFamily: "sans-serif" }}>
        <h1>No Job Found</h1>
        <p>Could not load job details from Smartsheet/Firestore database.</p>
        <Link to="/" style={{ color: "#06b6d4" }}>Back to Map</Link>
      </div>
    );
  }

  const layoutNames = [
    "1. Asymmetric Bento Grid",
    "2. Double-Bezel Hardware Tabbed",
    "3. Editorial Split Pane",
    "4. Cyberpunk HUD Console",
    "5. Glassmorphic Card Stack",
    "6. Chrono Workflow Timeline",
    "7. Minimalist Accordion Stack",
    "8. Industrial Rivet Dashboard",
    "9. Circular HUD Sidebar",
    "10. Card-Within-Card Bezel",
    "11. Grid Telemetry Table",
    "12. Swipeable Wizard Carousel"
  ];

  return (
    <div style={{ background: "#f1f5f9", minHeight: "100vh", padding: "24px", fontFamily: "Inter, system-ui, sans-serif" }}>
      {/* Header bar */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff", padding: "16px 24px", borderRadius: "12px", border: "1px solid rgba(0,0,0,0.05)", boxShadow: "0 4px 12px rgba(0,0,0,0.02)", marginBottom: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link to="/" style={{ display: "flex", alignItems: "center", justifyItems: "center", textDecoration: "none", color: "#64748b", fontWeight: 600, fontSize: "13px" }}>
            <ArrowLeft size={16} style={{ marginRight: 6 }} /> Back to Map
          </Link>
          <div style={{ width: 1, height: 20, background: "#e2e8f0" }} />
          <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={18} style={{ color: "#06b6d4" }} /> Job Card Redesign: 12 Layout Mockups
          </h1>
        </div>
        <div style={{ fontSize: "12px", color: "#64748b", fontWeight: "bold" }}>
          THEME: <span style={{ color: "#06b6d4" }}>LIGHT MODE / CYAN ACCENT</span>
        </div>
      </header>

      {/* Grid of 12 Layouts */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "24px" }}>
        {Array.from({ length: 12 }).map((_, i) => {
          const layoutNum = i + 1;
          return (
            <div key={layoutNum} style={{ background: "#ffffff", borderRadius: "12px", border: "1px solid rgba(0,0,0,0.06)", padding: "12px", display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 6px 18px rgba(0,0,0,0.02)" }}>
              {/* Header labeling which layout it is */}
              <div style={{ padding: "6px 12px", background: "rgba(6, 182, 212, 0.08)", border: "1px solid rgba(6, 182, 212, 0.2)", borderRadius: "6px", fontSize: "11px", fontWeight: "bold", color: "#0891b2", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                LAYOUT {layoutNum} · {layoutNames[i]}
              </div>
              
              {/* Actual JobCard rendering that specific layout */}
              <div style={{ flexGrow: 1 }}>
                <JobCard job={job} layoutOverride={layoutNum} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
