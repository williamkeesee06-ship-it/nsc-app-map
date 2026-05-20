import React, { useMemo, useState, useRef, useEffect } from "react";
import { useDrawing } from "../drawing/drawingContext.js";
import { aggregateUnits, type BillingEntry } from "../asbuilt/billing.js";
import "./FloatingBillingCard.css";

function fmtQty(qty: number, unit: string): string {
  // Preserve decimals — contract rule: SELECT BACKFILL 0.5 CY etc. (no rounding).
  if (unit === "FT") return `${Math.round(qty).toLocaleString()} ft`;
  if (qty === Math.floor(qty)) return `${qty.toLocaleString()} ${unit}`;
  return `${qty.toFixed(2)} ${unit}`;
}

export default function FloatingBillingCard() {
  const { state } = useDrawing();
  const [minimized, setMinimized] = useState(false);
  const [position, setPosition] = useState<{ top?: number; left?: number; bottom?: number; right?: number }>({
    bottom: 24,
    right: 24,
  });

  const dragRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ startX: number; startY: number; initLeft: number; initTop: number } | null>(null);

  const activeLayerId = state.activeLayerId;

  const activeEntries = useMemo<BillingEntry[]>(() => {
    if (!activeLayerId) return [];
    const objs = state.objects.filter((o) => o.style.layerId === activeLayerId);
    return aggregateUnits(objs);
  }, [state.objects, activeLayerId]);

  const jobEntries = useMemo<BillingEntry[]>(
    () => aggregateUnits(state.objects),
    [state.objects],
  );

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!draggingRef.current || !dragRef.current) return;
      const { startX, startY, initLeft, initTop } = draggingRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      setPosition({
        left: initLeft + dx,
        top: initTop + dy,
      });
    };

    const handleMouseUp = () => {
      draggingRef.current = null;
      document.body.style.userSelect = "";
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!dragRef.current) return;
    const rect = dragRef.current.getBoundingClientRect();
    draggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      initLeft: rect.left,
      initTop: rect.top,
    };
    setPosition({
      left: rect.left,
      top: rect.top,
    });
    document.body.style.userSelect = "none";
  };

  const renderTable = (entries: BillingEntry[], label: string, emptyMessage: string) => {
    return (
      <div style={{ paddingBottom: 8 }}>
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 4 }}>
          {label}
        </div>
        {entries.length === 0 ? (
          <div className="units-empty">{emptyMessage}</div>
        ) : (
          <div>
            {entries.map((e) => (
              <div key={`${e.unit_code}::${e.unit}`} className="unit-row">
                <span className="unit-code" title={e.desc}>{e.unit_code}</span>
                <span className="unit-qty">{fmtQty(e.qty, e.unit)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={dragRef}
      className={`units-dashboard ${minimized ? "units-dashboard--minimized" : ""}`}
      style={{
        ...position,
        ...(position.left !== undefined ? { right: "auto", bottom: "auto" } : {}),
      }}
    >
      <div className="units-header" onMouseDown={handleMouseDown}>
        <span className="units-drag-icon">⠿</span>
        <span className="units-title">BILLABLE UNITS</span>
        <div className="units-header-btns">
          <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => setMinimized(!minimized)}>
            {minimized ? "▲" : "▼"}
          </button>
        </div>
      </div>
      {!minimized && (
        <div className="units-body">
          {renderTable(activeEntries, "Active Layer Totals", activeLayerId ? "No billable units on active layer yet." : "Select or create an active layer.")}
          {renderTable(jobEntries, "Job Totals", "No billable units yet.")}
        </div>
      )}
    </div>
  );
}
