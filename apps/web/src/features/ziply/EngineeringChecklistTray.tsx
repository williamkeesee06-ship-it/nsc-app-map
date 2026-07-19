import React, { useMemo } from "react";
import type { Job } from "@nsc/types";
import { useDrawing } from "../drawing/drawingContext.js";

interface Props {
  job: Job | null;
}

export default function EngineeringChecklistTray({ job }: Props) {
  const { state } = useDrawing();
  const mapObjects = job?.ziplyPrintLayer?.mapObjects;

  const { placedTerminals, unplacedTerminals, placedCables, unplacedCables } = useMemo(() => {
    if (!mapObjects) {
      return { placedTerminals: [], unplacedTerminals: [], placedCables: [], unplacedCables: [] };
    }

    const drawnObjects = Array.from(state.objects.values());

    // Terminals
    const terminals = mapObjects.terminals || [];
    const pTerms: typeof terminals = [];
    const uTerms: typeof terminals = [];

    terminals.forEach(t => {
      // Check if there is a drawn object (ziply_terminal, ziply_ped, etc) with a matching label
      const isPlaced = drawnObjects.some(
        // @ts-ignore - ziply_ped might not be officially typed in the union yet
        obj => (obj.tool === "ziply_terminal" || obj.tool === "ziply_ped") && obj.style?.userLabel === t.label
      );
      if (isPlaced) pTerms.push(t);
      else uTerms.push(t);
    });

    // Cables / Bores
    const cables = mapObjects.cables || [];
    const pCables: typeof cables = [];
    const uCables: typeof cables = [];

    cables.forEach(c => {
      // Check if there is a drawn line that matches the cable type and footage (or close enough)
      // For now, let's just check if ANY drawn object has a matching ziplyFootage and ziplyCableType
      const isPlaced = drawnObjects.some(
        obj => 
          obj.style?.ziplyFootage === Math.round(c.lengthFt || 0) &&
          // @ts-ignore
          (c.fiberCount ? obj.style?.ziplyCableType === c.fiberCount : true)
      );
      if (isPlaced) pCables.push(c);
      else uCables.push(c);
    });

    return {
      placedTerminals: pTerms,
      unplacedTerminals: uTerms,
      placedCables: pCables,
      unplacedCables: uCables,
    };
  }, [mapObjects, state.objects]);

  if (!job || job.customerProject !== "Ziply" || !mapObjects) return null;

  return (
    <div
      style={{
        background: "#ffffff",
        border: "1px solid #e2e8f0",
        borderRadius: 6,
        padding: 12,
        marginBottom: 16,
        boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: "#0f172a", marginBottom: 8, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>ENGINEERING CHECKLIST</span>
        <span style={{ color: "#3aa7ff" }}>
          {placedTerminals.length + placedCables.length} / {mapObjects.terminals?.length || 0 + (mapObjects.cables?.length || 0)}
        </span>
      </div>

      <div style={{ maxHeight: 200, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {unplacedTerminals.map((t, i) => (
          <div key={`ut-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#475569" }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, border: "1px solid #cbd5e1" }} />
            <span>Terminal {t.label}</span>
          </div>
        ))}
        {placedTerminals.map((t, i) => (
          <div key={`pt-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#94a3b8", textDecoration: "line-through" }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>✓</span>
            <span>Terminal {t.label}</span>
          </div>
        ))}
        
        {unplacedCables.map((c, i) => (
          <div key={`uc-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#475569" }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, border: "1px solid #cbd5e1" }} />
            <span>{c.buildType === "bore" ? "Bore" : "Cable"} - {Math.round(c.lengthFt || 0)}'</span>
          </div>
        ))}
        {placedCables.map((c, i) => (
          <div key={`pc-${i}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#94a3b8", textDecoration: "line-through" }}>
            <span style={{ width: 12, height: 12, borderRadius: 2, background: "#10b981", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 9 }}>✓</span>
            <span>{c.buildType === "bore" ? "Bore" : "Cable"} - {Math.round(c.lengthFt || 0)}'</span>
          </div>
        ))}
      </div>
    </div>
  );
}
