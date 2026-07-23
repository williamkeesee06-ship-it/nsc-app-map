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
      {/* Summary KPI Strip — Royal Blue & Light Steel */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 6,
          background: "linear-gradient(180deg, #eff6ff 0%, #dbeafe 100%)",
          border: "1.5px solid #2563eb",
          borderRadius: 8,
          padding: 8,
          boxShadow: "0 2px 8px rgba(37, 99, 235, 0.15)",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: "#1e40af", letterSpacing: "0.08em", textTransform: "uppercase" }}>Total</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: "#0f172a", fontFamily: "var(--font-mono, monospace)" }}>{totals.total}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: "#1e40af", letterSpacing: "0.08em", textTransform: "uppercase" }}>MSTs</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: "#1d4ed8", fontFamily: "var(--font-mono, monospace)" }}>{totals.terminals}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 900, color: "#047857", letterSpacing: "0.08em", textTransform: "uppercase" }}>Placed</span>
          <span style={{ fontSize: 14, fontWeight: 900, color: "#059669", fontFamily: "var(--font-mono, monospace)" }}>{totals.placedCount}</span>
        </div>
      </div>

      {/* Search Input — High Contrast Light Input */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Filter by T-label, address, cable..."
        style={{
          background: "#ffffff",
          border: "1.5px solid #cbd5e1",
          borderRadius: 6,
          color: "#0f172a",
          fontSize: 11,
          fontWeight: 600,
          padding: "7px 10px",
          outline: "none",
          fontFamily: "inherit",
          boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
          transition: "border-color 0.15s, box-shadow 0.15s",
        }}
        onFocus={(e) => {
          e.target.style.borderColor = "#2563eb";
          e.target.style.boxShadow = "0 0 0 3px rgba(37, 99, 235, 0.15)";
        }}
        onBlur={(e) => {
          e.target.style.borderColor = "#cbd5e1";
          e.target.style.boxShadow = "inset 0 1px 2px rgba(0,0,0,0.05)";
        }}
      />

      {/* Filter Tabs — Light Segmented Bar */}
      <div style={{ display: "flex", background: "#f1f5f9", borderRadius: 6, padding: 3, border: "1px solid #cbd5e1" }}>
        {(["all", "planned", "placed"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              flex: 1,
              padding: "5px 0",
              fontSize: 9,
              fontWeight: 900,
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: filter === f ? "linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%)" : "transparent",
              color: filter === f ? "#ffffff" : "#475569",
              boxShadow: filter === f ? "0 2px 6px rgba(29, 78, 216, 0.35)" : "none",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              transition: "all 0.15s ease",
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {/* Item List — Crisp Light Cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: "calc(100vh - 280px)", overflowY: "auto" }}>
        {filteredObjects.length === 0 ? (
          <div style={{ padding: "20px 8px", textTransform: "uppercase", textAlign: "center", fontSize: 10, fontWeight: 700, color: "#64748b" }}>
            No plant items found.
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
                  padding: "9px 12px",
                  borderRadius: 8,
                  background: "#ffffff",
                  border: isPlaced ? "1.5px solid #10b981" : "1.5px solid #e2e8f0",
                  boxShadow: isPlaced ? "0 2px 8px rgba(16, 185, 129, 0.15)" : "0 1px 3px rgba(0,0,0,0.05)",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
                onMouseOver={(e) => {
                  if (!isPlaced) e.currentTarget.style.borderColor = "#2563eb";
                  e.currentTarget.style.transform = "translateY(-1px)";
                }}
                onMouseOut={(e) => {
                  if (!isPlaced) e.currentTarget.style.borderColor = "#e2e8f0";
                  e.currentTarget.style.transform = "translateY(0)";
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 800, color: "#0f172a", fontFamily: "var(--font-mono, monospace)" }}>
                      {label}
                    </span>
                    {(ports || fibers) && (
                      <span style={{ fontSize: 9, fontWeight: 800, color: "#1d4ed8", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "1px 6px", borderRadius: 4 }}>
                        {ports || fibers}
                      </span>
                    )}
                  </div>
                  {obj.style.ziplyAddressesServed && (
                    <span style={{ fontSize: 9, fontWeight: 600, color: "#475569", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      Houses: {obj.style.ziplyAddressesServed}
                    </span>
                  )}
                </div>

                <span
                  style={{
                    fontSize: 8,
                    fontWeight: 900,
                    padding: "3px 7px",
                    borderRadius: 4,
                    background: isPlaced ? "#ecfdf5" : "#f1f5f9",
                    color: isPlaced ? "#059669" : "#475569",
                    border: isPlaced ? "1px solid #a7f3d0" : "1px solid #cbd5e1",
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
