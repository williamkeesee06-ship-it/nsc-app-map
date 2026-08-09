import { useState, useEffect, useCallback, useMemo } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { Sparkles, FileText, Check, Plus, Play, Info } from "lucide-react";
import { useDrawing } from "../drawing/drawingContext.js";
import { api } from "../../lib/api.js";
import { extractPrintEntities, PLACEABLE_KINDS, type StoredPrintEntity } from "./printParser.js";
import { surveyPlacements } from "./printGeoreference.js";
import { comparePrintRevisions } from "./printRevisionDiff.js";
import type { Job } from "@nsc/types";
import type { MapImageOverlay } from "./types.js";

interface Props {
  selectedJob: Job | null;
}

export default function PrintParserTab({ selectedJob }: Props) {
  const map = useMap();
  const { addObject } = useDrawing();

  const [activeTab, setActiveTab] = useState<"PARSER" | "REVISION_DIFF">("PARSER");
  const [parsedEntities, setParsedEntities] = useState<StoredPrintEntity[]>([]);
  const [armedEntity, setArmedEntity] = useState<StoredPrintEntity | null>(null);
  const [diffResult, setDiffResult] = useState<any | null>(null);
  const [printDataBusy, setPrintDataBusy] = useState(false);
  const [revisionName, setRevisionName] = useState<string | null>(null);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);

  const jobId = selectedJob?.jobId ?? "";

  // Load existing parsed entities when active job changes
  useEffect(() => {
    if (!jobId) {
      setParsedEntities([]);
      return;
    }
    api.getPrintOverlay(jobId).then((res) => {
      if (res?.printOverlay?.parsedEntities) {
        setParsedEntities(res.printOverlay.parsedEntities);
      } else {
        setParsedEntities([]);
      }
    }).catch(err => {
      console.error("Failed to load parsed entities", err);
      setParsedEntities([]);
    });
  }, [jobId]);

  // List of unique page numbers in the parsed list
  const pageNumbers = useMemo(() => {
    const pages = new Set<number>();
    parsedEntities.forEach((e) => {
      if (e.page) pages.add(e.page);
    });
    return [...pages].sort((a, b) => a - b);
  }, [parsedEntities]);

  // Sync active page selection to the first available page if current is invalid
  useEffect(() => {
    if (pageNumbers.length > 0 && !pageNumbers.includes(activePageNumber)) {
      setActivePageNumber(pageNumbers[0]);
    }
  }, [pageNumbers, activePageNumber]);

  // Place armed entity on map click
  useEffect(() => {
    if (!map || !armedEntity || !selectedJob) return;

    const mapDiv = map.getDiv();
    const prevCursor = mapDiv.style.cursor;
    mapDiv.style.cursor = "crosshair";

    const listener = map.addListener("click", async (e: google.maps.MapMouseEvent) => {
      const ll = e.latLng;
      if (!ll) return;

      const toolMap: Record<string, string> = {
        terminal: "ziply_terminal",
        pole: "ziply_pole",
        handhole: "ziply_handhole",
        manhole: "mh_new",
        pedestal: "ped_new",
        riser: "ziply_riser",
        splitter: "ziply_splitter",
        hub: "ziply_hub",
        flowerpot: "ziply_flower_pot",
      };

      const tool = toolMap[armedEntity.kind] || "ziply_terminal";
      const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      addObject({
        id: objId,
        tool: tool as any,
        position: { lat: ll.lat(), lng: ll.lng() },
        style: {
          strokeColor: "#0284c7",
          strokeWidth: 2,
          strokeStyle: "solid",
          fill: { kind: "none" },
          opacity: 0.8,
          userLabel: armedEntity.mapTag || armedEntity.label,
          description: armedEntity.summary,
        } as any
      });

      const updatedEntities = parsedEntities.map((x) =>
        x.id === armedEntity.id ? { ...x, placedMarkerId: objId } : x
      );
      setParsedEntities(updatedEntities);
      setArmedEntity(null);

      // Save to Firebase Firestore
      try {
        const existing = await api.getPrintOverlay(selectedJob.jobId);
        const updatedDoc = {
          ...existing.printOverlay,
          parsedEntities: updatedEntities,
        } as any;
        await api.putPrintOverlay(selectedJob.jobId, updatedDoc);
        window.dispatchEvent(new Event("nsc:jobs-reload"));
      } catch (err) {
        console.error("Failed to update placed marker in print overlay", err);
      }
    });

    return () => {
      listener.remove();
      mapDiv.style.cursor = prevCursor;
    };
  }, [map, armedEntity, addObject, parsedEntities, selectedJob]);

  // Place all unplaced structures for the active print page
  const onPlaceAllFromPrint = useCallback(async () => {
    if (!selectedJob) return;

    // Load overlays from job record
    const overlayDoc = selectedJob.printOverlay;
    if (!overlayDoc) {
      alert("No print overlay configuration found for this job. Set up the overlay first.");
      return;
    }

    const overlays: MapImageOverlay[] = (overlayDoc.pages || []).map((p) => {
      const tr = overlayDoc.transforms?.[p.id];
      return {
        id: p.id,
        mapProjectId: selectedJob.jobId,
        jobId: selectedJob.jobId,
        title: p.label,
        imageUri: p.previewUrl || "",
        southWestLat: tr?.southWestLat ?? 0,
        southWestLng: tr?.southWestLng ?? 0,
        northEastLat: tr?.northEastLat ?? 0,
        northEastLng: tr?.northEastLng ?? 0,
        opacity: tr?.opacity ?? 0.5,
        rotationDegrees: tr?.rotationDegrees ?? tr?.rotationDeg ?? 0,
        isVisible: true,
        isAnchored: !!overlayDoc.alignments?.[p.id],
        pageNumber: p.pageNumber,
      };
    });

    const targetOverlay = overlays.find((o) => o.pageNumber === activePageNumber);
    if (!targetOverlay || (!targetOverlay.isAnchored && targetOverlay.southWestLat === 0)) {
      alert(`Page ${activePageNumber} is not georeferenced/calibrated yet. Align it in the Studio first.`);
      return;
    }

    const pageEntities = parsedEntities.filter(
      (e) => e.page === activePageNumber && !e.placedMarkerId
    );

    const survey = surveyPlacements(pageEntities, overlays, PLACEABLE_KINDS);

    if (survey.plans.length === 0) {
      alert(`No unplaced structures found for Page ${activePageNumber}.`);
      return;
    }

    const toolMap: Record<string, string> = {
      terminal: "ziply_terminal",
      pole: "ziply_pole",
      handhole: "ziply_handhole",
      manhole: "mh_new",
      pedestal: "ped_new",
      riser: "ziply_riser",
      splitter: "ziply_splitter",
      hub: "ziply_hub",
      flowerpot: "ziply_flower_pot",
    };

    let placedCount = 0;
    const updatedEntities = [...parsedEntities];

    survey.plans.forEach((plan) => {
      const tool = toolMap[plan.entity.kind] || "ziply_terminal";
      const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      addObject({
        id: objId,
        tool: tool as any,
        position: plan.position,
        style: {
          strokeColor: "#0284c7",
          strokeWidth: 2,
          strokeStyle: "solid",
          fill: { kind: "none" },
          opacity: 0.8,
          userLabel: plan.entity.mapTag || plan.entity.label,
          description: plan.entity.summary,
        } as any
      });

      const idx = updatedEntities.findIndex((x) => x.id === plan.entity.id);
      if (idx !== -1) {
        updatedEntities[idx] = { ...updatedEntities[idx], placedMarkerId: objId };
      }
      placedCount++;
    });

    setParsedEntities(updatedEntities);

    // Save back to Firestore
    try {
      const existing = await api.getPrintOverlay(selectedJob.jobId);
      const updatedDoc = {
        ...existing.printOverlay,
        parsedEntities: updatedEntities,
      } as any;
      await api.putPrintOverlay(selectedJob.jobId, updatedDoc);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      alert(`Placed ${placedCount} structures onto the map successfully.`);
    } catch (err) {
      console.error("Failed to update placed markers in print overlay", err);
      alert(`Placed ${placedCount} structures, but failed to save status to cloud.`);
    }
  }, [selectedJob, activePageNumber, parsedEntities, addObject]);

  if (!selectedJob) {
    return (
      <div style={{ padding: "20px 16px", textAlign: "center", color: "#64748b" }}>
        <Info size={28} style={{ margin: "0 auto 10px auto", opacity: 0.6 }} />
        <p style={{ fontSize: "12px", fontWeight: 600 }}>Please select a job first to parse prints.</p>
      </div>
    );
  }

  const kindLabels: Record<string, string> = {
    terminal: "term",
    pole: "pole",
    handhole: "vault",
    flowerpot: "pot",
    manhole: "mh",
    pedestal: "ped",
    riser: "riser",
    splitter: "splt",
    hub: "hub"
  };

  const filteredEntities = parsedEntities.filter((e) => e.page === activePageNumber);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", padding: "12px 14px", gap: "12px", overflowY: "auto" }}>
      <div className="hud-tab-bar">
        <button
          className={`hud-tab ${activeTab === "PARSER" ? "hud-tab--active" : ""}`}
          onClick={() => setActiveTab("PARSER")}
        >
          Checklist
        </button>
        <button
          className={`hud-tab ${activeTab === "REVISION_DIFF" ? "hud-tab--active" : ""}`}
          onClick={() => setActiveTab("REVISION_DIFF")}
        >
          Revision comparison
        </button>
      </div>

      {activeTab === "PARSER" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {parsedEntities.length === 0 ? (
            <div style={{ textAlign: "center", padding: "30px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              <FileText size={32} style={{ margin: "0 auto", color: "#64748b" }} />
              <p style={{ fontSize: "11px", color: "#94a3b8" }}>No engineering data parsed for this job.</p>
              <label className="po-btn po-btn--primary cursor-pointer w-full text-center" style={{ width: "100%", boxSizing: "border-box" }}>
                {printDataBusy ? "Parsing PDF..." : "Read PDF Vector Data"}
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="hidden"
                  disabled={printDataBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    setPrintDataBusy(true);
                    try {
                      const parsed = await extractPrintEntities(file);
                      if (parsed.length === 0) {
                        alert("No vector text layers found in this PDF.");
                      } else {
                        const jobParsed = parsed.map((item) => ({
                          ...item,
                          jobId,
                          sourceFile: file.name,
                        }));
                        setParsedEntities(jobParsed);

                        // Save to Firebase
                        const existing = await api.getPrintOverlay(jobId);
                        const updatedDoc = {
                          ...existing.printOverlay,
                          parsedEntities: jobParsed,
                        } as any;
                        await api.putPrintOverlay(jobId, updatedDoc);
                        window.dispatchEvent(new Event("nsc:jobs-reload"));
                      }
                    } catch (err) {
                      console.error("Print parser error", err);
                      alert("Could not extract structures from this PDF.");
                    } finally {
                      setPrintDataBusy(false);
                    }
                  }}
                />
              </label>
            </div>
          ) : (
            <>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px" }}>
                <span style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", color: "#94a3b8" }}>
                  EXTRACTED STRUCTURES
                </span>
                <span style={{ fontSize: "12px", fontFamily: "monospace", fontWeight: "bold", color: "#22d3ee" }}>
                  {parsedEntities.filter((e) => e.placedMarkerId).length} / {parsedEntities.length}
                </span>
              </div>

              {pageNumbers.length > 1 && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontSize: "10px", fontWeight: "bold", color: "#94a3b8" }}>Active Sheet:</span>
                  <select
                    value={activePageNumber}
                    onChange={(e) => setActivePageNumber(Number(e.target.value))}
                    style={{ flex: 1, background: "#1e293b", border: "1px solid #475569", color: "#f1f5f9", borderRadius: "4px", padding: "2px 6px", fontSize: "11px" }}
                  >
                    {pageNumbers.map((p) => (
                      <option key={p} value={p}>
                        Page {p} ({parsedEntities.filter(x => x.page === p).length} structures)
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={onPlaceAllFromPrint}
                className="po-btn po-btn--primary w-full text-xs font-black uppercase flex items-center justify-center gap-1.5"
                style={{ width: "100%", boxSizing: "border-box" }}
              >
                <Sparkles size={13} /> Place Page {activePageNumber} Structures
              </button>

              <div className="parser-list" style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "280px" }}>
                {filteredEntities.map((entity) => {
                  const isPlaced = !!entity.placedMarkerId;
                  const isArmed = armedEntity?.id === entity.id;
                  return (
                    <div
                      key={entity.id}
                      className={`parser-item ${isPlaced ? "parser-item--placed" : ""} ${
                        isArmed ? "parser-item--armed" : ""
                      }`}
                      onClick={() => {
                        if (isPlaced) return;
                        setArmedEntity(isArmed ? null : entity);
                      }}
                    >
                      <span className={`parser-tag parser-tag--${entity.kind}`}>
                        {kindLabels[entity.kind] || entity.kind.slice(0, 4)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-200 truncate leading-none">
                          {entity.label}
                        </p>
                        <p className="text-[10px] text-slate-400 truncate mt-1">
                          {entity.summary}
                        </p>
                      </div>
                      {isPlaced ? (
                        <Check size={14} className="text-emerald-400 shrink-0" />
                      ) : (
                        <Plus size={14} className="text-cyan-400 shrink-0" />
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === "REVISION_DIFF" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ textAlign: "center", padding: "20px 16px", display: "flex", flexDirection: "column", gap: "12px" }}>
            <Play size={28} style={{ margin: "0 auto", color: "#64748b" }} />
            <p style={{ fontSize: "11px", color: "#94a3b8" }}>Compare your current print against another revision PDF.</p>
            <label className="po-btn po-btn--ghost cursor-pointer w-full text-center border border-slate-700" style={{ width: "100%", boxSizing: "border-box" }}>
              Upload revision PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  setRevisionName(file.name);
                  try {
                    const parsed = await extractPrintEntities(file);
                    const diff = comparePrintRevisions(parsedEntities, parsed);
                    setDiffResult(diff);
                  } catch (err) {
                    alert("Failed to compare print revisions.");
                  }
                }}
              />
            </label>
          </div>

          {diffResult && (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "6px" }}>
              <p style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#94a3b8" }}>
                CHANGES DETECTED IN {revisionName}
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
                {diffResult.changes.map((ch: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-2 rounded bg-slate-950/80 border-l-2 border-amber-500 text-[10px] text-slate-300"
                  >
                    <span className="font-bold uppercase mr-1">{ch.kind}:</span>
                    {ch.summary}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
