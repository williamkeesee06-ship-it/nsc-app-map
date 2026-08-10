import { useState, useEffect, useCallback, useMemo } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { Sparkles, FileText, Check, Plus, Play, Info } from "lucide-react";
import { useDrawing, defaultStyleForTool } from "../drawing/drawingContext.js";
import { api } from "../../lib/api.js";
import { extractPrintEntities, PLACEABLE_KINDS, type StoredPrintEntity, type PrintEntity } from "./printParser.js";
import { pageToLatLng, solveGeoSolution } from "@nsc/types";
import type { Job } from "@nsc/types";
import { solutionFromTransform } from "./geoPlacement.js";
import { comparePrintRevisions } from "./printRevisionDiff.js";
import type { MapImageOverlay } from "./types.js";

interface Props {
  selectedJob: Job | null;
}

export default function PrintParserTab({ selectedJob }: Props) {
  const map = useMap();
  const { addObject, updateObject, deleteObjects, state } = useDrawing();
  const [lastPlacedIds, setLastPlacedIds] = useState<string[]>([]);

  const [activeTab, setActiveTab] = useState<"PARSER" | "REVISION_DIFF">("PARSER");
  const [parsedEntities, setParsedEntities] = useState<StoredPrintEntity[]>([]);
  const [armedEntity, setArmedEntity] = useState<StoredPrintEntity | null>(null);
  const [diffResult, setDiffResult] = useState<any | null>(null);
  const [printDataBusy, setPrintDataBusy] = useState(false);
  const [revisionName, setRevisionName] = useState<string | null>(null);
  const [activePageNumber, setActivePageNumber] = useState<number>(1);
  const [checkedChanges, setCheckedChanges] = useState<Set<number>>(new Set());

  // Automatically check all revision changes when diff loaded
  useEffect(() => {
    if (diffResult?.changes) {
      setCheckedChanges(new Set(diffResult.changes.map((_: any, idx: number) => idx)));
    } else {
      setCheckedChanges(new Set());
    }
  }, [diffResult]);

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

  // Revert all placed structures and lines from the last auto-placement
  const onUndoLastAutoPlacement = useCallback(async () => {
    if (lastPlacedIds.length === 0 || !selectedJob) return;
    deleteObjects(lastPlacedIds);

    const updatedEntities = parsedEntities.map((x) =>
      x.placedMarkerId && lastPlacedIds.includes(x.placedMarkerId)
        ? { ...x, placedMarkerId: undefined }
        : x
    );
    setParsedEntities(updatedEntities);
    setLastPlacedIds([]);

    try {
      const existing = await api.getPrintOverlay(selectedJob.jobId);
      const updatedDoc = {
        ...existing.printOverlay,
        parsedEntities: updatedEntities,
      } as any;
      await api.putPrintOverlay(selectedJob.jobId, updatedDoc);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      alert("Undo successful. Placed objects removed from the map.");
    } catch (err) {
      console.error("Failed to save undo to cloud", err);
      alert("Successfully removed from local view, but failed to save to cloud.");
    }
  }, [lastPlacedIds, parsedEntities, deleteObjects, selectedJob]);

  // Apply selected revision comparison changes to the map drawings
  const onApplySelectedChanges = useCallback(async () => {
    if (!selectedJob || !diffResult) return;

    const overlayDoc = selectedJob.printOverlay;
    if (!overlayDoc) {
      alert("No print overlay configuration found for this job.");
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

    let appliedCount = 0;
    const updatedEntities = [...parsedEntities];
    const placedIds: string[] = [];

    const getGeoSolutionForPage = (pageNum: number) => {
      const page = overlayDoc?.pages?.find((p) => p.pageNumber === pageNum);
      if (!page) return null;
      const transform = overlayDoc?.transforms?.[page.id];
      const alignment = overlayDoc?.alignments?.[page.id];
      if (alignment && alignment.anchorA && alignment.anchorB) {
        try {
          const sol = solveGeoSolution(alignment);
          if (sol) return sol;
        } catch { /* ignore */ }
      }
      if (transform) {
        return solutionFromTransform(transform, page.pageWidth, page.pageHeight);
      }
      return null;
    };

    const projectEntity = (entity: PrintEntity) => {
      const sol = getGeoSolutionForPage(entity.page);
      if (!sol) return null;
      return pageToLatLng(sol, { x: entity.x, y: entity.y });
    };

    const getProjectedPointsForPage = (pageNum: number) => {
      const sol = getGeoSolutionForPage(pageNum);
      if (!sol) return [];
      
      return parsedEntities
        .filter((e) => e.page === pageNum && e.kind !== "cable")
        .map((e) => {
          const pos = pageToLatLng(sol, { x: e.x, y: e.y });
          return pos ? { entity: e, pos } : null;
        })
        .filter(Boolean) as Array<{ entity: StoredPrintEntity; pos: { lat: number; lng: number } }>;
    };

    function distanceToSegment(
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number
    ): number {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    for (let idx = 0; idx < diffResult.changes.length; idx++) {
      if (!checkedChanges.has(idx)) continue;
      const change = diffResult.changes[idx];

      if (change.kind === "added" && change.next) {
        const entity = change.next;
        if (entity.kind === "cable") {
          const projectedPoints = getProjectedPointsForPage(entity.page);
          let bestPair: [typeof projectedPoints[0], typeof projectedPoints[0]] | null = null;
          let minDistance = Infinity;

          for (let i = 0; i < projectedPoints.length; i++) {
            for (let j = i + 1; j < projectedPoints.length; j++) {
              const ptA = projectedPoints[i];
              const ptB = projectedPoints[j];
              const d = distanceToSegment(
                entity.x,
                entity.y,
                ptA.entity.x,
                ptA.entity.y,
                ptB.entity.x,
                ptB.entity.y
              );
              if (d < minDistance) {
                minDistance = d;
                bestPair = [ptA, ptB];
              }
            }
          }

          if (bestPair && minDistance < 350) {
            let tool = "ziply_distribution";
            if (/BORE/i.test(entity.summary)) tool = "ziply_bore";
            else if (/TRENCH/i.test(entity.summary)) tool = "ziply_bore";
            else if (/FEEDER/i.test(entity.summary)) tool = "ziply_feeder";
            else if (/DROP/i.test(entity.summary)) tool = "ziply_drop";

            const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            placedIds.push(objId);

            addObject({
              id: objId,
              tool: tool as any,
              vertices: [bestPair[0].pos, bestPair[1].pos],
              style: {
                ...defaultStyleForTool(tool as any),
                userLabel: entity.label,
                description: entity.summary,
              } as any,
            });

            const newEntity: StoredPrintEntity = {
              ...entity,
              jobId: selectedJob.jobId,
              sourceFile: revisionName || "revision_pdf",
              placedMarkerId: objId,
            };
            updatedEntities.push(newEntity);
            appliedCount++;
          }
        } else {
          const pos = projectEntity(entity);
          if (pos) {
            const tool = toolMap[entity.kind] || "ziply_terminal";
            const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            placedIds.push(objId);

            addObject({
              id: objId,
              tool: tool as any,
              position: pos,
              style: {
                ...defaultStyleForTool(tool as any),
                userLabel: entity.mapTag || entity.label,
                description: entity.summary,
              } as any,
            });

            const newEntity: StoredPrintEntity = {
              ...entity,
              jobId: selectedJob.jobId,
              sourceFile: revisionName || "revision_pdf",
              placedMarkerId: objId,
            };
            updatedEntities.push(newEntity);
            appliedCount++;
          }
        }
      }

      else if (change.kind === "removed" && change.previous) {
        const entity = change.previous;
        const match = updatedEntities.find((e) => e.id === entity.id);
        if (match?.placedMarkerId) {
          deleteObjects([match.placedMarkerId]);
          match.placedMarkerId = undefined;
        }
        const idxInList = updatedEntities.findIndex((e) => e.id === entity.id);
        if (idxInList !== -1) {
          updatedEntities.splice(idxInList, 1);
        }
        appliedCount++;
      }

      else if (change.kind === "moved" && change.next && change.previous) {
        const entity = change.next;
        const prevEntity = change.previous;
        const match = updatedEntities.find((e) => e.id === prevEntity.id);
        if (match?.placedMarkerId) {
          const obj = state.objects.find((o) => o.id === match.placedMarkerId);
          if (obj) {
            if ("position" in obj) {
              const pos = projectEntity(entity);
              if (pos) {
                updateObject({
                  ...obj,
                  position: pos,
                  style: {
                    ...obj.style,
                    description: entity.summary,
                  },
                } as any);
              }
            } else if ("vertices" in obj && obj.vertices.length === 2) {
              const projectedPoints = getProjectedPointsForPage(entity.page);
              let bestPair: [typeof projectedPoints[0], typeof projectedPoints[0]] | null = null;
              let minDistance = Infinity;

              for (let i = 0; i < projectedPoints.length; i++) {
                for (let j = i + 1; j < projectedPoints.length; j++) {
                  const ptA = projectedPoints[i];
                  const ptB = projectedPoints[j];
                  const d = distanceToSegment(
                    entity.x,
                    entity.y,
                    ptA.entity.x,
                    ptA.entity.y,
                    ptB.entity.x,
                    ptB.entity.y
                  );
                  if (d < minDistance) {
                    minDistance = d;
                    bestPair = [ptA, ptB];
                  }
                }
              }

              if (bestPair && minDistance < 350) {
                updateObject({
                  ...obj,
                  vertices: [bestPair[0].pos, bestPair[1].pos],
                  style: {
                    ...obj.style,
                    description: entity.summary,
                  },
                } as any);
              }
            }
          }
          match.x = entity.x;
          match.y = entity.y;
          match.details = entity.details;
          match.summary = entity.summary;
        }
        appliedCount++;
      }

      else if (change.kind === "changed" && change.next && change.previous) {
        const entity = change.next;
        const prevEntity = change.previous;
        const match = updatedEntities.find((e) => e.id === prevEntity.id);
        if (match?.placedMarkerId) {
          const obj = state.objects.find((o) => o.id === match.placedMarkerId);
          if (obj) {
            updateObject({
              ...obj,
              style: {
                ...obj.style,
                userLabel: entity.mapTag || entity.label,
                description: entity.summary,
              },
            } as any);
          }
          match.label = entity.label;
          match.mapTag = entity.mapTag;
          match.details = entity.details;
          match.summary = entity.summary;
        }
        appliedCount++;
      }
    }

    setParsedEntities(updatedEntities);
    setLastPlacedIds(placedIds);

    try {
      const existing = await api.getPrintOverlay(selectedJob.jobId);
      const updatedDoc = {
        ...existing.printOverlay,
        parsedEntities: updatedEntities,
      } as any;
      await api.putPrintOverlay(selectedJob.jobId, updatedDoc);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      setDiffResult(null);
      alert(`Applied ${appliedCount} changes successfully.`);
    } catch (err) {
      console.error("Failed to update placed markers in print overlay", err);
      alert(`Applied ${appliedCount} changes, but failed to save status to cloud.`);
    }
  }, [selectedJob, diffResult, parsedEntities, checkedChanges, state.objects, addObject, updateObject, deleteObjects, revisionName]);

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

    const activePageObj = overlayDoc.pages?.find((p) => p.pageNumber === activePageNumber);
    const activeTransform = activePageObj ? overlayDoc.transforms?.[activePageObj.id] : null;
    const activeAlignment = activePageObj ? overlayDoc.alignments?.[activePageObj.id] : null;

    const targetSol = activeAlignment && activeAlignment.anchorA && activeAlignment.anchorB
      ? (() => { try { return solveGeoSolution(activeAlignment); } catch { return null; } })()
      : (activeTransform && activePageObj ? solutionFromTransform(activeTransform, activePageObj.pageWidth, activePageObj.pageHeight) : null);

    if (!targetSol) {
      alert(`Page ${activePageNumber} is not placed on the map yet. Place or align it in the Studio first.`);
      return;
    }

    const pageEntities = parsedEntities.filter(
      (e) => e.page === activePageNumber && !e.placedMarkerId
    );

    // ── Cable span parsing & connection logic ──────────────────────────────
    const allPointEntities = parsedEntities.filter(
      (e) => e.page === activePageNumber && e.kind !== "cable"
    );
    const unplacedCables = pageEntities.filter((e) => e.kind === "cable");

    // Project all point structures to georeferenced LatLngs
    const projectedPoints = allPointEntities
      .map((e) => {
        const pos = pageToLatLng(targetSol, { x: e.x, y: e.y });
        return pos ? { entity: e, pos } : null;
      })
      .filter(Boolean) as Array<{ entity: StoredPrintEntity; pos: { lat: number; lng: number } }>;

    // Helper: distance to segment
    function distanceToSegment(
      px: number,
      py: number,
      ax: number,
      ay: number,
      bx: number,
      by: number
    ): number {
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) return Math.hypot(px - ax, py - ay);
      let t = ((px - ax) * dx + (py - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    const cablePlans: Array<{
      entity: StoredPrintEntity;
      vertices: Array<{ lat: number; lng: number }>;
    }> = [];

    unplacedCables.forEach((cable) => {
      let bestPair: [typeof projectedPoints[0], typeof projectedPoints[0]] | null = null;
      let minDistance = Infinity;

      for (let i = 0; i < projectedPoints.length; i++) {
        for (let j = i + 1; j < projectedPoints.length; j++) {
          const ptA = projectedPoints[i];
          const ptB = projectedPoints[j];
          const d = distanceToSegment(
            cable.x,
            cable.y,
            ptA.entity.x,
            ptA.entity.y,
            ptB.entity.x,
            ptB.entity.y
          );
          if (d < minDistance) {
            minDistance = d;
            bestPair = [ptA, ptB];
          }
        }
      }

      // Max threshold: 350 PDF points (approx 4.8 inches)
      if (bestPair && minDistance < 350) {
        cablePlans.push({
          entity: cable,
          vertices: [bestPair[0].pos, bestPair[1].pos],
        });
      }
    });

    if (projectedPoints.length === 0 && cablePlans.length === 0) {
      alert(`No unplaced structures or cables found for Page ${activePageNumber}.`);
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
    const placedIds: string[] = [];

    // Place points
    projectedPoints.forEach(({ entity, pos }) => {
      const tool = toolMap[entity.kind] || "ziply_terminal";
      const existingObj = state.objects.find(
        (obj) =>
          obj.tool === tool &&
          ("position" in obj) &&
          (obj.style.userLabel === entity.mapTag || obj.style.userLabel === entity.label)
      );

      if (existingObj && "position" in existingObj) {
        // Update its position and description
        updateObject({
          ...existingObj,
          position: pos,
          style: {
            ...existingObj.style,
            description: entity.summary,
          },
        } as any);

        const idx = updatedEntities.findIndex((x) => x.id === entity.id);
        if (idx !== -1) {
          updatedEntities[idx] = { ...updatedEntities[idx], placedMarkerId: existingObj.id };
        }
      } else {
        const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        placedIds.push(objId);

        const defaultStyle = defaultStyleForTool(tool as any);

        addObject({
          id: objId,
          tool: tool as any,
          position: pos,
          style: {
            ...defaultStyle,
            userLabel: entity.mapTag || entity.label,
            description: entity.summary,
          } as any,
        });

        const idx = updatedEntities.findIndex((x) => x.id === entity.id);
        if (idx !== -1) {
          updatedEntities[idx] = { ...updatedEntities[idx], placedMarkerId: objId };
        }
      }
      placedCount++;
    });

    // Place cables
    cablePlans.forEach((plan) => {
      let tool = "ziply_distribution";
      if (/BORE/i.test(plan.entity.summary)) tool = "ziply_bore";
      else if (/TRENCH/i.test(plan.entity.summary)) tool = "ziply_bore";
      else if (/FEEDER/i.test(plan.entity.summary)) tool = "ziply_feeder";
      else if (/DROP/i.test(plan.entity.summary)) tool = "ziply_drop";

      // Check for existing line connecting the same pair of points
      const hasExistingLine = state.objects.some(
        (obj) =>
          obj.tool === tool &&
          "vertices" in obj &&
          obj.vertices.length === 2 &&
          ((Math.abs(obj.vertices[0].lat - plan.vertices[0].lat) < 0.00001 &&
            Math.abs(obj.vertices[0].lng - plan.vertices[0].lng) < 0.00001 &&
            Math.abs(obj.vertices[1].lat - plan.vertices[1].lat) < 0.00001 &&
            Math.abs(obj.vertices[1].lng - plan.vertices[1].lng) < 0.00001) ||
           (Math.abs(obj.vertices[0].lat - plan.vertices[1].lat) < 0.00001 &&
            Math.abs(obj.vertices[0].lng - plan.vertices[1].lng) < 0.00001 &&
            Math.abs(obj.vertices[1].lat - plan.vertices[0].lat) < 0.00001 &&
            Math.abs(obj.vertices[1].lng - plan.vertices[0].lng) < 0.00001))
      );

      if (hasExistingLine) {
        return;
      }

      const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      placedIds.push(objId);

      const defaultStyle = defaultStyleForTool(tool as any);

      addObject({
        id: objId,
        tool: tool as any,
        vertices: plan.vertices,
        style: {
          ...defaultStyle,
          userLabel: plan.entity.label,
          description: plan.entity.summary,
        } as any,
      });

      const idx = updatedEntities.findIndex((x) => x.id === plan.entity.id);
      if (idx !== -1) {
        updatedEntities[idx] = { ...updatedEntities[idx], placedMarkerId: objId };
      }
      placedCount++;
    });

    setParsedEntities(updatedEntities);
    setLastPlacedIds(placedIds);

    // Save back to Firestore
    try {
      const existing = await api.getPrintOverlay(selectedJob.jobId);
      const updatedDoc = {
        ...existing.printOverlay,
        parsedEntities: updatedEntities,
      } as any;
      await api.putPrintOverlay(selectedJob.jobId, updatedDoc);
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      alert(`Placed ${placedCount} structures/cables onto the map successfully.`);
    } catch (err) {
      console.error("Failed to update placed markers in print overlay", err);
      alert(`Placed ${placedCount} items, but failed to save status to cloud.`);
    }
  }, [selectedJob, activePageNumber, parsedEntities, addObject, updateObject, state.objects, lastPlacedIds]);

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
              {lastPlacedIds.length > 0 && (
                <button
                  onClick={onUndoLastAutoPlacement}
                  className="po-btn po-btn--ghost w-full text-xs font-black uppercase flex items-center justify-center gap-1.5 border border-red-500/30 text-red-400 hover:bg-red-500/10 mt-2"
                  style={{ width: "100%", boxSizing: "border-box" }}
                >
                  Undo Auto-Placement ({lastPlacedIds.length} items)
                </button>
              )}

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
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: "10px", display: "flex", flexDirection: "column", gap: "10px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "10px", fontWeight: 800, textTransform: "uppercase", color: "#94a3b8" }}>
                  CHANGES DETECTED ({diffResult.changes.length})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (checkedChanges.size === diffResult.changes.length) {
                      setCheckedChanges(new Set());
                    } else {
                      setCheckedChanges(new Set(diffResult.changes.map((_: any, idx: number) => idx)));
                    }
                  }}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#22d3ee",
                    fontSize: "10px",
                    fontWeight: 700,
                    cursor: "pointer",
                    padding: 0
                  }}
                >
                  {checkedChanges.size === diffResult.changes.length ? "Deselect All" : "Select All"}
                </button>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "240px", overflowY: "auto" }}>
                {diffResult.changes.map((ch: any, idx: number) => {
                  const isChecked = checkedChanges.has(idx);
                  const borderColors = {
                    added: "rgba(16, 185, 129, 0.4)",
                    removed: "rgba(239, 68, 68, 0.4)",
                    moved: "rgba(245, 158, 11, 0.4)",
                    changed: "rgba(6, 182, 212, 0.4)"
                  };
                  const bgColors = {
                    added: "rgba(16, 185, 129, 0.05)",
                    removed: "rgba(239, 68, 68, 0.05)",
                    moved: "rgba(245, 158, 11, 0.05)",
                    changed: "rgba(6, 182, 212, 0.05)"
                  };
                  return (
                    <label
                      key={idx}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "8px",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        background: bgColors[ch.kind as "added" | "removed" | "moved" | "changed"] || "rgba(255,255,255,0.02)",
                        border: `1px solid ${borderColors[ch.kind as "added" | "removed" | "moved" | "changed"] || "rgba(255,255,255,0.08)"}`,
                        cursor: "pointer",
                        transition: "all 0.2s ease"
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {
                          const next = new Set(checkedChanges);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          setCheckedChanges(next);
                        }}
                        style={{ marginTop: "2px", accentColor: "#22d3ee" }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <span style={{
                            fontSize: "8px",
                            fontWeight: 900,
                            textTransform: "uppercase",
                            padding: "1px 4px",
                            borderRadius: "3px",
                            background: borderColors[ch.kind as "added" | "removed" | "moved" | "changed"],
                            color: "#fff",
                          }}>
                            {ch.kind}
                          </span>
                        </div>
                        <p style={{ fontSize: "10px", color: "#cbd5e1", marginTop: "4px", lineHeight: "1.3" }}>
                          {ch.summary}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>

              <button
                onClick={onApplySelectedChanges}
                disabled={checkedChanges.size === 0}
                className="po-btn po-btn--primary w-full text-xs font-black uppercase flex items-center justify-center gap-1.5"
                style={{
                  width: "100%",
                  boxSizing: "border-box",
                  opacity: checkedChanges.size === 0 ? 0.5 : 1,
                  cursor: checkedChanges.size === 0 ? "not-allowed" : "pointer",
                  marginTop: "8px"
                }}
              >
                Apply Selected Changes ({checkedChanges.size})
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
