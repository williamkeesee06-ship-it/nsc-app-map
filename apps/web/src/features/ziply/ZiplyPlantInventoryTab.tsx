import { useState, useMemo } from "react";
import { useDrawing } from "../drawing/drawingContext.js";
import { useMap } from "@vis.gl/react-google-maps";
import type { DrawingObject } from "@nsc/types";

export function ZiplyPlantInventoryTab() {
  const { state: drawState, select } = useDrawing();
  const map = useMap();
  const [filter, setFilter] = useState<"all" | "planned" | "placed">("all");
  const [query, setQuery] = useState("");

  const plantObjects = useMemo(() => {
    return drawState.objects.filter((obj) => {
      const tool = obj.tool;
      return (
        tool.startsWith("ziply_") ||
        tool === "placed_cable" ||
        tool === "removed_cable" ||
        tool === "hh_new" ||
        tool === "pole_new" ||
        tool === "ped_new"
      );
    });
  }, [drawState.objects]);

  const filteredObjects = useMemo(() => {
    return plantObjects.filter((obj) => {
      const status = (obj.style.ziplyStatus ?? "planned").toLowerCase();
      if (filter === "planned" && status !== "planned") return false;
      if (filter === "placed" && status !== "placed" && status !== "complete") return false;

      if (!query.trim()) return true;
      const q = query.toLowerCase();
      const label = (obj.style.userLabel ?? "").toLowerCase();
      const addrs = (obj.style.ziplyAddressesServed ?? "").toLowerCase();
      const tool = obj.tool.toLowerCase();
      const cable = (obj.style.ziplyCableType ?? "").toLowerCase();

      return label.includes(q) || addrs.includes(q) || tool.includes(q) || cable.includes(q);
    });
  }, [plantObjects, filter, query]);

  const handleFocusObject = (obj: DrawingObject) => {
    select([obj.id]);

    let pos: { lat: number; lng: number } | null = null;
    if ("position" in obj) {
      pos = obj.position;
    } else if ("vertices" in obj && obj.vertices.length > 0) {
      const midIdx = Math.floor(obj.vertices.length / 2);
      pos = obj.vertices[midIdx] ?? null;
    }

    if (pos && map) {
      map.panTo(pos);
      map.setZoom(19);
    }
  };

  const totals = useMemo(() => {
    let terminals = 0;
    let cablesFt = 0;
    let placedCount = 0;

    plantObjects.forEach((obj) => {
      const isPlaced = (obj.style.ziplyStatus ?? "planned").toLowerCase() === "placed";
      if (isPlaced) placedCount++;

      if (obj.tool === "ziply_terminal" || obj.tool.includes("terminal")) {
        terminals++;
      } else if ("vertices" in obj && (obj.tool === "placed_cable" || obj.tool.includes("cable") || obj.tool.includes("feeder") || obj.tool.includes("distribution"))) {
        if (obj.style.ziplyFootage) {
          cablesFt += obj.style.ziplyFootage;
        }
      }
    });

    return { total: plantObjects.length, terminals, cablesFt, placedCount };
  }, [plantObjects]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "8px 0" }}>
      {/* Summary KPI Strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          background: "rgba(0, 82, 204, 0.12)",
          border: "1px solid rgba(0, 119, 255, 0.3)",
          borderRadius: 8,
          padding: 8,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>Total</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: "#f8fafc", fontFamily: "var(--font-mono, monospace)" }}>{totals.total}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>MSTs</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: "#60a5fa", fontFamily: "var(--font-mono, monospace)" }}>{totals.terminals}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 8, fontWeight: 800, color: "#94a3b8", letterSpacing: "0.06em", textTransform: "uppercase" }}>Placed</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: "#34d399", fontFamily: "var(--font-mono, monospace)" }}>{totals.placedCount}</span>
        </div>
      </div>

      {/* Search Input */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by T-label, address, cable..."
        style={{
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 6,
          color: "#f8fafc",
          fontSize: 11,
          padding: "6px 10px",
          outline: "none",
          fontFamily: "inherit",
        }}
      />

      {/* Filter Tabs */}
      <div style={{ display: "flex", background: "rgba(0,0,0,0.5)", borderRadius: 6, padding: 2, border: "1px solid rgba(255,255,255,0.08)" }}>
        {(["all", "planned", "placed"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: "4px 0",
              fontSize: 9,
              fontWeight: 800,
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: filter === f ? "#0052cc" : "transparent",
              color: filter === f ? "#fff" : "#64748b",
              textTransform: "uppercase",
              transition: "all 0.2s ease",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Item List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
        {filteredObjects.length === 0 ? (
          <div style={{ padding: "16px 8px", textTransform: "uppercase", textAlign: "center", fontSize: 10, color: "#64748b" }}>
            No plant items placed yet.
          </div>
        ) : (
          filteredObjects.map((obj) => {
            const isPlaced = (obj.style.ziplyStatus ?? "planned").toLowerCase() === "placed";
            const label = obj.style.userLabel || (obj.tool.includes("terminal") ? "MST Terminal" : obj.tool);
            const ports = obj.style.ziplyPortCount ? `${obj.style.ziplyPortCount}P` : "";
            const fibers = obj.style.ziplyFiberCount ? `${obj.style.ziplyFiberCount}F` : obj.style.ziplyCableType ?? "";

            return (
              <div
                key={obj.id}
                onClick={() => handleFocusObject(obj)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: 6,
                  background: "linear-gradient(160deg, rgba(20, 27, 38, 0.9) 0%, rgba(12, 16, 23, 0.9) 100%)",
                  border: isPlaced ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(255,255,255,0.08)",
                  boxShadow: isPlaced ? "0 0 8px rgba(16, 185, 129, 0.15)" : "none",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#f8fafc", fontFamily: "var(--font-mono, monospace)" }}>
                      {label}
                    </span>
                    {(ports || fibers) && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: "#60a5fa", background: "rgba(0,119,255,0.15)", padding: "1px 5px", borderRadius: 3 }}>
                        {ports || fibers}
                      </span>
                    )}
                  </div>
                  {obj.style.ziplyAddressesServed && (
                    <span style={{ fontSize: 9, color: "#94a3b8", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Houses: {obj.style.ziplyAddressesServed}
                    </span>
                  )}
                </div>

                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 900,
                    padding: "2px 6px",
                    borderRadius: 3,
                    background: isPlaced ? "rgba(16, 185, 129, 0.2)" : "rgba(148, 163, 184, 0.15)",
                    color: isPlaced ? "#34d399" : "#94a3b8",
                    border: isPlaced ? "1px solid rgba(16, 185, 129, 0.4)" : "1px solid rgba(148, 163, 184, 0.2)",
                    letterSpacing: "0.06em",
                  }}
                >
                  {isPlaced ? "⚡ PLACED" : "PLANNED"}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
