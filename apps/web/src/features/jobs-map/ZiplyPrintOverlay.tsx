import { useEffect, useState } from "react";
import type { Job } from "@nsc/types";
import { InfoWindow, Marker, useMap } from "@vis.gl/react-google-maps";

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
                fillColor: "#00E676",
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
                <Marker
                  key={`${job.jobId}-mst-${idx}`}
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
                    fillColor: "#2196F3",
                    fillOpacity: 0.9,
                    strokeColor: "#ffffff",
                    strokeWeight: 1,
                    scale: 6,
                  }}
                />
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
                  <div style={{ marginTop: 6, padding: 4, background: "#f5f5f5", borderRadius: 4, fontStyle: "italic", fontSize: 11 }}>
                    {selectedObj.details.specialNotes}
                  </div>
                )}
              </>
            ) : (
              <>
                <p style={{ margin: "4px 0" }}><strong>Terminal Model:</strong> {selectedObj.details.type || "N/A"}</p>
              </>
            )}
          </div>
        </InfoWindow>
      )}
    </>
  );
}
