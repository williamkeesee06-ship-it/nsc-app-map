import { useState, useEffect } from "react";

export default function ZiplyDashboardTab() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    fetch("/api/jobs/ziply-metrics")
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((metrics) => {
        if (active) {
          setData(metrics);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err.message || "Failed to load metrics");
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 12, color: "var(--accent)", fontSize: 11, textAlign: "center" }}>
        ⚡ Analyzing production trends & KPIs...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 12, color: "#ff2d4a", fontSize: 11 }}>
        ⚠️ Error: {error}
      </div>
    );
  }

  const { summary, hubs, crews } = data || {};

  return (
    <div style={{ padding: 12, color: "#fff" }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 13, letterSpacing: "0.05em", color: "var(--accent)" }}>
        ZIPLY CONTRACT DASHBOARD
      </h3>

      {/* Summary Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1f2937", borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>Total Bore/Trench</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)", margin: "4px 0" }}>
            {summary?.bore?.completed?.toLocaleString()} ft
          </div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>of {summary?.bore?.estimated?.toLocaleString()} ft est</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1f2937", borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>Total Placing</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)", margin: "4px 0" }}>
            {summary?.placing?.completed?.toLocaleString()} ft
          </div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>of {summary?.placing?.estimated?.toLocaleString()} ft est</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1f2937", borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>Total Aerial</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)", margin: "4px 0" }}>
            {summary?.aerial?.completed?.toLocaleString()} ft
          </div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>of {summary?.aerial?.estimated?.toLocaleString()} ft est</div>
        </div>

        <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid #1f2937", borderRadius: 6, padding: 8 }}>
          <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>Homes Passed</div>
          <div style={{ fontSize: 14, fontWeight: 800, color: "var(--accent)", margin: "4px 0" }}>
            {summary?.drops?.completed?.toLocaleString()} LUs
          </div>
          <div style={{ fontSize: 9, color: "#6b7280" }}>of {summary?.drops?.estimated?.toLocaleString()} LUs target</div>
        </div>
      </div>

      {/* Hub Progress */}
      <div style={{ marginBottom: 16 }}>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#9ca3af", letterSpacing: "0.05em" }}>
          Hub Build Progress
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {hubs?.map((hub: any) => (
            <div key={hub.name} style={{ background: "rgba(0,0,0,0.15)", borderRadius: 4, padding: 6, border: "1px solid #1f2937" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>Hub {hub.name}</span>
                <span style={{ color: "var(--accent)" }}>{hub.pct}%</span>
              </div>
              <div style={{ width: "100%", height: 4, background: "#111827", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${hub.pct}%`, height: "100%", background: "var(--accent, #00E676)", borderRadius: 2 }} />
              </div>
              <div style={{ fontSize: 8, color: "#6b7280", marginTop: 2, textAlign: "right" }}>
                {hub.completed.toLocaleString()} ft / {hub.total.toLocaleString()} ft
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Crew Leaderboard */}
      <div>
        <h4 style={{ margin: "0 0 8px 0", fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#9ca3af", letterSpacing: "0.05em" }}>
          Crew Production
        </h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {Object.entries(crews || {}).map(([crewName, stats]: [string, any]) => (
            <div key={crewName} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "rgba(255,255,255,0.02)", padding: 6, borderRadius: 4, fontSize: 10 }}>
              <span style={{ fontWeight: 700 }}>{crewName}</span>
              <div style={{ textAlign: "right" }}>
                <span style={{ color: "var(--accent)" }}>{(stats.completedBore + stats.completedPlacing + stats.completedAerial).toLocaleString()} ft</span>
                <div style={{ fontSize: 8, color: "#6b7280" }}>
                  B: {stats.completedBore} · P: {stats.completedPlacing} · A: {stats.completedAerial}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
