import { useEffect, useState } from "react";
import type { Job } from "@nsc/types";
import { InfoWindow, Marker, useMap } from "@vis.gl/react-google-maps";

// Helper to draw a glowing line on the map
function GlowingFiberLine({ path }: { path: google.maps.LatLngLiteral[] }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    
    // Core line
    const core = new google.maps.Polyline({
      path,
      map,
      strokeColor: "#00ffff", // cyan core
      strokeWeight: 2,
      zIndex: 10,
    });
    
    // Glow effect
    const glow = new google.maps.Polyline({
      path,
      map,
      strokeColor: "#00E676", // electric green glow
      strokeWeight: 8,
      strokeOpacity: 0.3,
      zIndex: 9,
    });

    return () => {
      core.setMap(null);
      glow.setMap(null);
    };
  }, [map, path]);

  return null;
}

interface Props {
  jobs: Job[];
  visible: boolean;
}

export default function ZiplyPrintOverlay({ jobs, visible }: Props) {
  const map = useMap();
  const [selectedObj, setSelectedObj] = useState<{
    job: Job;
    type: "FDH" | "MST";
    label: string;
    details: any;
    position: google.maps.LatLngLiteral;
  } | null>(null);

  // Local state to track which items are marked as "Placed" for markup readiness.
  // In production, this would sync to the job's firestore document.
  const [completedElements, setCompletedElements] = useState<Set<string>>(new Set());

  const handleMarkCompleted = (label: string) => {
    const next = new Set(completedElements);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    setCompletedElements(next);
  };

  if (!visible) return null;

  // Filter jobs that have print layers
  const printJobs = jobs.filter((j) => j.customerProject === "Ziply" && j.ziplyPrintLayer && j.geocode);

  return (
    <>
      {printJobs.map((job) => {
        const layer = job.ziplyPrintLayer!;
        const center = { lat: job.geocode!.lat, lng: job.geocode!.lng };

        return (
          <div key={job.jobId}>
            {/* 1. FDH Cabinet Diamond Marker */}
            <Marker
              position={center}
              title={`FDH Cabinet: ${layer.hubId || "Unknown"}`}
              onClick={() =>
                setSelectedObj({
                  job,
                  type: "FDH",
                  label: layer.hubId || "FDH",
                  details: layer,
                  position: center,
                })
              }
              icon={{
                path: "M 0,-10 L 10,0 L 0,10 L -10,0 Z",
                fillColor: completedElements.has(layer.hubId || "FDH") ? "#00E676" : "#4facfe",
                fillOpacity: 1,
                strokeColor: "#000",
                strokeWeight: 2,
                scale: 1.2,
              }}
            />

            {/* 2. MST Terminals scattered slightly around the FDH (so they don't stack directly) */}

            {layer.mapObjects?.terminals?.map((mst, idx) => {
              // Offset slightly so they form a neat ring around the FDH
              const angle = (idx * 2 * Math.PI) / (layer.mapObjects?.terminals?.length || 1);
              const r = 0.00015; // roughly 50 feet
              const mstPos = {
                lat: center.lat + r * Math.sin(angle),
                lng: center.lng + r * Math.cos(angle),
              };

              return (
                <div key={`${job.jobId}-mst-${idx}`}>
                  <GlowingFiberLine path={[center, mstPos]} />
                  <Marker
                    position={mstPos}
                    title={`MST: ${mst.label} (${mst.type})`}
                    onClick={() =>
                      setSelectedObj({
                        job,
                        type: "MST",
                        label: mst.label,
                        details: mst,
                        position: mstPos,
                      })
                    }
                    icon={{
                      path: google.maps.SymbolPath.CIRCLE,
                      fillColor: completedElements.has(mst.label) ? "#00E676" : "#2196F3",
                      fillOpacity: 0.9,
                      strokeColor: "#ffffff",
                      strokeWeight: 1,
                      scale: 6,
                    }}
                  />
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Info Window Details */}
      {selectedObj && (
        <InfoWindow
          position={selectedObj.position}
          onCloseClick={() => setSelectedObj(null)}
        >
          <div style={{ color: "#000", fontFamily: "sans-serif", fontSize: 12, minWidth: 200, padding: 4 }}>
            <h4 style={{ margin: "0 0 6px 0", color: selectedObj.type === "FDH" ? "#00843d" : "#0052cc", fontSize: 13, borderBottom: "1px solid #ddd", paddingBottom: 4 }}>
              {selectedObj.type === "FDH" ? "⚡ FDH CABINET" : "🔵 MST TERMINAL"}: {selectedObj.label}
            </h4>
            <p style={{ margin: "4px 0" }}><strong>Work Order:</strong> {selectedObj.job.workOrder}</p>
            <p style={{ margin: "4px 0" }}><strong>Address:</strong> {selectedObj.job.address || "N/A"}</p>
            
            {selectedObj.type === "FDH" ? (
              <>
                <p style={{ margin: "4px 0" }}><strong>Cabinet Model:</strong> {selectedObj.details.hubTypeSize || "N/A"}</p>
                <p style={{ margin: "4px 0" }}><strong>MST Count:</strong> {selectedObj.details.terminalCount || 0}</p>
                <p style={{ margin: "4px 0" }}><strong>Total Home Passes:</strong> {selectedObj.details.drops?.total || 0}</p>
                {selectedObj.details.specialNotes && (
                  <p style={{ margin: "4px 0", fontStyle: "italic", color: "#666" }}>Notes: {selectedObj.details.specialNotes}</p>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: "4px 0" }}><strong>Type:</strong> {selectedObj.details.type}</p>
                <p style={{ margin: "4px 0" }}><strong>Port Count:</strong> {selectedObj.details.portCount}</p>
                {selectedObj.details.footings && (
                  <p style={{ margin: "4px 0" }}><strong>Footings:</strong> {selectedObj.details.footings}</p>
                )}
              </>
            )}

            <button
              onClick={() => handleMarkCompleted(selectedObj.label)}
              style={{
                marginTop: 12, width: "100%", padding: "6px 0",
                background: completedElements.has(selectedObj.label) ? "#374151" : "#00E676",
                color: completedElements.has(selectedObj.label) ? "#9ca3af" : "#000",
                border: "none", borderRadius: 4, cursor: "pointer", fontWeight: "bold"
              }}
            >
              {completedElements.has(selectedObj.label) ? "Undo Placement" : "Mark Placed"}
            </button>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
