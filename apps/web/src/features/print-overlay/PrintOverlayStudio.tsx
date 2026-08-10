import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import {
  Layers,
  X,
  Crop,
  Move,
  MapPin,
  RotateCw,
  Undo2,
  EyeOff,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  FileText,
  Check,
  Plus,
  Play,
  Scale,
  Lock,
  Unlock,
} from "lucide-react";
import {
  alignmentResidualFt,
  pageToLatLng,
  solveGeoSolution,
  type GeoAlignment,
  type GeoAnchor,
  type GeoSolution,
  type LatLng,
  type PagePoint,
  type PrintOverlaySource,
  type PrintOverlayTransform,
} from "@nsc/types";
import type { Job } from "@nsc/types";
import { useAuth } from "../auth/authContext.js";
import { usePrintOverlay, listJobPdfSources, type PageVM } from "./usePrintOverlay.js";
import { solutionFromTransform } from "./geoPlacement.js";
import PageOverlay, { type AnchorDot, type OverlayMode } from "./PageOverlay.js";
import CropEditor from "./CropEditor.js";
import { SapphireGlassCard, TitaniumHexBolt } from "../../components/HorologyMetalBezel.js";
import { extractPrintEntities, PLACEABLE_KINDS, type StoredPrintEntity } from "./printParser.js";
import { surveyPlacements, projectPageToLatLng } from "./printGeoreference.js";
import { comparePrintRevisions } from "./printRevisionDiff.js";
import { useDrawing } from "../drawing/drawingContext.js";
import type { MapImageOverlay } from "./types.js";
import "./printOverlay.css";

interface Props {
  job: Job;
  onClose: () => void;
}

type AnchorSlot = "A" | "B" | "C";
type AnchorDraft = Partial<Record<AnchorSlot, GeoAnchor>>;
type PendingAnchor = { slot: AnchorSlot; page: PagePoint } | null;

const DEFAULT_TRANSFORM = (center: LatLng) => ({
  center,
  scale: 1,
  rotationDeg: 0,
  opacity: 0.5,
});

const GOOD_RESIDUAL_FT = 10;

function draftToAlignment(d: AnchorDraft): GeoAlignment | null {
  if (d.A && d.B && !samePoint(d.A.page, d.B.page)) {
    return { anchorA: d.A, anchorB: d.B, control: d.C ?? null };
  }
  return null;
}

export default function PrintOverlayStudio({ job, onClose }: Props) {
  const map = useMap();
  const { username } = useAuth();
  const studio = usePrintOverlay(job);
  const { addObject } = useDrawing();
  const {
    phase,
    pages,
    activePage,
    activePageId,
    progress,
    error,
    saving,
    draftStatus,
    beginSource,
    cancelProcessing,
    selectPage,
    setCrop,
    setTransform,
    setAlignment,
    setExcluded,
    save,
    saveDraft,
    parsedEntities,
    setParsedEntities,
  } = studio;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const revisionInputRef = useRef<HTMLInputElement | null>(null);
  const [showChooser, setShowChooser] = useState(true);
  const [cropPageId, setCropPageId] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("move");
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor>(null);
  const [anchorDraft, setAnchorDraft] = useState<Record<string, AnchorDraft>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [cropConfirmed, setCropConfirmed] = useState<Set<string>>(new Set());

  // Visual Design & Telecom Workflow state
  const [blendMode, setBlendModeState] = useState<"normal" | "multiply" | "screen" | "difference">("multiply");
  const [gridSnapEnabled, setGridSnapEnabled] = useState(true);
  const [showStructureOverlay, setShowStructureOverlay] = useState(true);

  // Left Rail checklist states
  const [leftTab, setLeftTab] = useState<"PARSER" | "REVISION_DIFF">("PARSER");
  const [armedEntity, setArmedEntity] = useState<StoredPrintEntity | null>(null);
  const [diffResult, setDiffResult] = useState<any | null>(null);
  const [printDataBusy, setPrintDataBusy] = useState(false);
  const [revisionName, setRevisionName] = useState<string | null>(null);

  const updateBlendMode = (mode: "normal" | "multiply" | "screen" | "difference") => {
    setBlendModeState(mode);
    if (activePage) {
      setTransform(activePage.id, { blendMode: mode });
    }
  };

  const structureBadges = useMemo(() => {
    if (!showStructureOverlay || !parsedEntities || !activePage) return [];
    const pageEntities = parsedEntities.filter((e) => e.pageNumber === activePage.pageNumber);
    return pageEntities.map((e) => ({
      id: e.id,
      x: e.bbox.x + e.bbox.w / 2,
      y: e.bbox.y + e.bbox.h / 2,
      kind: e.kind,
      label: e.label,
      placed: e.placed,
    }));
  }, [showStructureOverlay, parsedEntities, activePage]);

  const handleSelectStructure = useCallback(
    (id: string) => {
      const entity = parsedEntities.find((e) => e.id === id);
      if (entity) {
        setArmedEntity(entity);
        setLeftTab("PARSER");
      }
    },
    [parsedEntities]
  );

  const stitchAdjacentSeam = useCallback(() => {
    if (!activePage || pages.length < 2) return;
    const prevPage = pages.find((p) => p.pageNumber === activePage.pageNumber - 1 && p.alignment);
    if (!prevPage || !prevPage.alignment) return;
    const prevAlg = prevPage.alignment;
    const newAlignment: GeoAlignment = {
      anchorA: {
        page: { x: 0, y: activePage.pageHeight / 2 },
        map: prevAlg.anchorB.map,
      },
      anchorB: {
        page: { x: activePage.pageWidth, y: activePage.pageHeight / 2 },
        map: {
          lat: prevAlg.anchorB.map.lat + 0.0005,
          lng: prevAlg.anchorB.map.lng + 0.0005,
        },
      },
      control: null,
    };
    setAlignment(activePage.id, newAlignment);
    setAnchorDraft((prev) => ({
      ...prev,
      [activePage.id]: { A: newAlignment.anchorA, B: newAlignment.anchorB },
    }));
  }, [activePage, pages, setAlignment]);

  const sources = useMemo(() => listJobPdfSources(job), [job]);
  const jobId = job.jobId;
  const jobCenter: LatLng = job.geocode
    ? { lat: job.geocode.lat, lng: job.geocode.lng }
    : { lat: 47.6062, lng: -122.3321 };

  const didInitialFlyRef = useRef(false);
  useEffect(() => {
    if (map && job.geocode && !didInitialFlyRef.current) {
      didInitialFlyRef.current = true;
      window.dispatchEvent(
        new CustomEvent("nsc:pan-to", {
          detail: { lat: job.geocode.lat, lng: job.geocode.lng, zoom: 18 },
        })
      );
    }
  }, [map, job.geocode]);

  const curDraft: AnchorDraft = activePageId ? anchorDraft[activePageId] ?? {} : {};

  useEffect(() => {
    if (phase === "ready" || phase === "processing") setShowChooser(false);
  }, [phase]);

  // Choose a source
  const chooseExisting = useCallback(
    (s: PrintOverlaySource) => {
      setShowChooser(false);
      void beginSource(s, null, username);
    },
    [beginSource, username]
  );

  const autoLoadedRef = useRef(false);
  useEffect(() => {
    autoLoadedRef.current = false;
  }, [jobId]);

  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (sources.length > 0 && phase === "choosing") {
      autoLoadedRef.current = true;
      chooseExisting(sources[0]);
    }
  }, [sources, phase, chooseExisting]);

  const onUploadPick = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const src: PrintOverlaySource = {
        documentId: `upload-${Date.now()}`,
        name: file.name,
        origin: "upload",
        storagePath: null,
        downloadUrl: null,
        contentType: file.type || "application/pdf",
        size: file.size,
        pageCount: null,
      };
      setShowChooser(false);
      void beginSource(src, file, username);
    },
    [beginSource, username]
  );

  // Select a page and place it on current viewport center (spawns wherever operator is working)
  const selectAndPlace = useCallback(
    (page: PageVM) => {
      selectPage(page.id);
      setOverlayMode("move");
      setPendingAnchor(null);

      const mapCenter = map?.getCenter();
      const currentWorkingCenter = mapCenter
        ? { lat: mapCenter.lat(), lng: mapCenter.lng() }
        : activePage?.transform?.center ?? jobCenter;

      const isUnplaced = !page.transform || (!page.alignment && sameLatLng(page.transform.center, jobCenter));

      if (isUnplaced) {
        const prevTransform = activePage?.transform;
        const newTransform: PrintOverlayTransform = {
          center: currentWorkingCenter,
          scale: prevTransform?.scale ?? 1,
          rotationDeg: prevTransform?.rotationDeg ?? 0,
          opacity: prevTransform?.opacity ?? 0.5,
        };
        setTransform(page.id, newTransform);
      } else if (map && page.transform?.center) {
        map.panTo({ lat: page.transform.center.lat, lng: page.transform.center.lng });
      }

      setAnchorDraft((prev) => {
        if (prev[page.id]) return prev;
        const seed: AnchorDraft = page.alignment
          ? { A: page.alignment.anchorA, B: page.alignment.anchorB, C: page.alignment.control ?? undefined }
          : {};
        return { ...prev, [page.id]: seed };
      });
    },
    [selectPage, setTransform, map, jobCenter, activePage]
  );

  const openPage = useCallback(
    (p: PageVM) => {
      if (p.excluded) return;
      void saveDraft(username);
      if (!cropConfirmed.has(p.id)) {
        selectPage(p.id);
        setCropPageId(p.id);
        return;
      }
      selectAndPlace(p);
    },
    [cropConfirmed, selectAndPlace, selectPage, saveDraft, username]
  );

  // A map click completes the pending anchor
  useEffect(() => {
    if (!map || !activePageId || overlayMode !== "pickPage" || !pendingAnchor) return;
    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const ll = e.latLng;
      if (!ll) return;
      const anchor: GeoAnchor = { page: pendingAnchor.page, map: { lat: ll.lat(), lng: ll.lng() } };
      setAnchorDraft((prev) => ({
        ...prev,
        [activePageId]: { ...(prev[activePageId] ?? {}), [pendingAnchor.slot]: anchor },
      }));
      setPendingAnchor(null);
      setOverlayMode("move");
    });
    return () => listener.remove();
  }, [map, activePageId, overlayMode, pendingAnchor]);

  // Persist a valid draft alignment onto the page record
  useEffect(() => {
    if (!activePage) return;
    const al = draftToAlignment(curDraft);
    if (JSON.stringify(al) !== JSON.stringify(activePage.alignment ?? null)) {
      setAlignment(activePage.id, al);
    }
  }, [curDraft, activePage, setAlignment]);

  const beginAnchor = useCallback((slot: AnchorSlot) => {
    setOverlayMode("pickPage");
    setPendingAnchor({ slot, page: { x: 0, y: 0 } });
  }, []);

  const onPreviewPick = useCallback(
    (e: React.MouseEvent<HTMLImageElement>) => {
      if (!activePage || overlayMode !== "pickPage") return;
      const r = e.currentTarget.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const px = ((e.clientX - r.left) / r.width) * activePage.pageWidth;
      const py = ((e.clientY - r.top) / r.height) * activePage.pageHeight;
      onPagePoint({ x: px, y: py });
    },
    [activePage, overlayMode]
  );

  const onPagePoint = useCallback((pt: PagePoint) => {
    setPendingAnchor((prev) => (prev ? { ...prev, page: pt } : prev));
  }, []);

  const alignment = useMemo(() => draftToAlignment(curDraft), [curDraft]);
  const isGeoreferenced = !!alignment;

  const solution: GeoSolution | null = useMemo(() => {
    if (!activePage) return null;
    if (alignment) {
      const solved = solveGeoSolution(alignment);
      if (solved) return solved;
    }
    if (activePage.transform) {
      return solutionFromTransform(activePage.transform, activePage.pageWidth, activePage.pageHeight);
    }
    return null;
  }, [activePage, alignment]);

  const residual = useMemo(() => (alignment ? alignmentResidualFt(alignment) : null), [alignment]);
  const qualityGood = residual == null ? true : residual < GOOD_RESIDUAL_FT;
  const anchorSlots: AnchorSlot[] = ["A", "B"];
  if (curDraft.C || pendingAnchor?.slot === "C") anchorSlots.push("C");

  const anchorDots: AnchorDot[] = useMemo(() => {
    const dots: AnchorDot[] = [];
    if (curDraft.A) dots.push({ key: "a", kind: "a", label: "A", page: curDraft.A.page });
    if (curDraft.B) dots.push({ key: "b", kind: "b", label: "B", page: curDraft.B.page });
    if (curDraft.C) dots.push({ key: "c", kind: "c", label: "C", page: curDraft.C.page });
    if (pendingAnchor && (pendingAnchor.page.x !== 0 || pendingAnchor.page.y !== 0)) {
      dots.push({
        key: "pending",
        kind: pendingAnchor.slot === "A" ? "a" : pendingAnchor.slot === "B" ? "b" : "c",
        label: pendingAnchor.slot,
        page: pendingAnchor.page,
      });
    }
    return dots;
  }, [curDraft, pendingAnchor]);

  const toggleExcluded = useCallback(
    (p: PageVM) => {
      const next = !(p.excluded ?? false);
      setExcluded(p.id, next);
      if (next && p.id === activePageId) selectPage(null);
    },
    [setExcluded, activePageId, selectPage]
  );

  const clearAlignment = useCallback(() => {
    if (!activePageId) return;
    setAnchorDraft((prev) => ({ ...prev, [activePageId]: {} }));
    setPendingAnchor(null);
    setOverlayMode("move");
  }, [activePageId]);

  const resetPage = useCallback(() => {
    if (!activePage) return;
    const c = map?.getCenter();
    const center = c ? { lat: c.lat(), lng: c.lng() } : jobCenter;
    setTransform(activePage.id, DEFAULT_TRANSFORM(center));
    clearAlignment();
  }, [activePage, map, jobCenter, setTransform, clearAlignment]);

  // Save to Firestore and close the studio (only explicitly triggered by operator)
  const doSave = useCallback(async () => {
    const ok = await save(username);
    setSavedNote(ok ? "Draft saved to Firebase." : null);
    if (ok) {
      setTimeout(() => setSavedNote(null), 2500);
      onClose();
    }
  }, [save, username, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cropPageId) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, cropPageId]);

  // ── Place armed entity on map click ──────────────────────────────────────
  useEffect(() => {
    if (!map || !armedEntity) return;

    const mapDiv = map.getDiv();
    const prevCursor = mapDiv.style.cursor;
    mapDiv.style.cursor = "crosshair";

    const listener = map.addListener("click", (e: google.maps.MapMouseEvent) => {
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

      setParsedEntities((prev) =>
        prev.map((x) => (x.id === armedEntity.id ? { ...x, placedMarkerId: objId } : x))
      );
      setArmedEntity(null);
    });

    return () => {
      listener.remove();
      mapDiv.style.cursor = prevCursor;
    };
  }, [map, armedEntity, addObject, setParsedEntities]);

  // ── Place all unplaced structures from the print ─────────────────────────
  const onPlaceAllFromPrint = useCallback(() => {
    if (!activePage) return;

    const sol = activePage.alignment && activePage.alignment.anchorA && activePage.alignment.anchorB
      ? (() => { try { return solveGeoSolution(activePage.alignment); } catch { return null; } })()
      : (activePage.transform ? solutionFromTransform(activePage.transform, activePage.pageWidth, activePage.pageHeight) : null);

    if (!sol) {
      alert("Page is not placed on the map yet. Place or align it in the Studio first.");
      return;
    }

    const pageEntities = parsedEntities.filter(
      (e) => e.page === activePage.pageNumber && !e.placedMarkerId
    );

    if (pageEntities.length === 0) {
      alert(`No unplaced structures found on page ${activePage.pageNumber}.`);
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
      cable: "ziply_distribution",
    };

    let placedCount = 0;
    const updatedEntities = [...parsedEntities];

    pageEntities.forEach((entity) => {
      const pos = pageToLatLng(sol, { x: entity.x, y: entity.y });
      if (!pos || isNaN(pos.lat) || isNaN(pos.lng)) return;

      const tool = toolMap[entity.kind] || "ziply_terminal";
      const objId = `obj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      addObject({
        id: objId,
        tool: tool as any,
        position: pos,
        style: {
          strokeColor: "#0284c7",
          strokeWidth: 2,
          strokeStyle: "solid",
          fill: { kind: "none" },
          opacity: 0.8,
          userLabel: entity.mapTag || entity.label,
          description: entity.summary,
        } as any,
      });

      const idx = updatedEntities.findIndex((x) => x.id === entity.id);
      if (idx !== -1) {
        updatedEntities[idx] = { ...updatedEntities[idx], placedMarkerId: objId };
      }
      placedCount++;
    });

    setParsedEntities(updatedEntities);
    alert(`Placed ${placedCount} structures onto the map successfully.`);
  }, [activePage, parsedEntities, addObject, setParsedEntities]);

  // ── Precision Nudging Controls ───────────────────────────────────────────
  const nudgeCenter = (dir: "N" | "S" | "E" | "W") => {
    if (!activePage) return;
    const latOffset = 2.747e-7; // ~0.1 feet
    const currentCenter = activePage.transform?.center ?? jobCenter;
    const lngOffset = 2.747e-7 / Math.cos((currentCenter.lat * Math.PI) / 180);

    let { lat, lng } = currentCenter;
    if (dir === "N") lat += latOffset;
    if (dir === "S") lat -= latOffset;
    if (dir === "E") lng += lngOffset;
    if (dir === "W") lng -= lngOffset;

    const patch: Partial<PrintOverlayTransform> = { center: { lat, lng } };

    const swLat = activePage.transform?.southWestLat;
    const swLng = activePage.transform?.southWestLng;
    const neLat = activePage.transform?.northEastLat;
    const neLng = activePage.transform?.northEastLng;
    if (swLat !== undefined && swLng !== undefined && neLat !== undefined && neLng !== undefined) {
      let dLat = 0, dLng = 0;
      if (dir === "N") dLat = latOffset;
      if (dir === "S") dLat = -latOffset;
      if (dir === "E") dLng = lngOffset;
      if (dir === "W") dLng = -lngOffset;

      patch.southWestLat = swLat + dLat;
      patch.southWestLng = swLng + dLng;
      patch.northEastLat = neLat + dLat;
      patch.northEastLng = neLng + dLng;
    }

    setTransform(activePage.id, patch);
  };

  const nudgeRotate = (delta: number) => {
    if (!activePage) return;
    const deg = (activePage.transform?.rotationDeg ?? 0) + delta;
    const currentRotDegrees = activePage.transform?.rotationDegrees ?? 0;
    setTransform(activePage.id, {
      rotationDeg: deg,
      rotationDegrees: currentRotDegrees + delta,
    });
  };

  const nudgeScale = (factor: number) => {
    if (!activePage) return;
    const currentScale = activePage.transform?.scale ?? 1;
    const nextScale = currentScale * factor;
    const patch: Partial<PrintOverlayTransform> = {
      scale: Math.max(0.05, Math.min(8, nextScale)),
    };

    const swLat = activePage.transform?.southWestLat;
    const swLng = activePage.transform?.southWestLng;
    const neLat = activePage.transform?.northEastLat;
    const neLng = activePage.transform?.northEastLng;
    if (swLat !== undefined && swLng !== undefined && neLat !== undefined && neLng !== undefined) {
      const cLat = (swLat + neLat) / 2;
      const cLng = (swLng + neLng) / 2;
      const dLat = (neLat - swLat) * factor;
      const dLng = (neLng - swLng) * factor;
      patch.southWestLat = cLat - dLat / 2;
      patch.southWestLng = cLng - dLng / 2;
      patch.northEastLat = cLat + dLat / 2;
      patch.northEastLng = cLng + dLng / 2;
    }
    setTransform(activePage.id, patch);
  };

  const overlayImg = activePage?.previewUrl || activePage?.dataUrl || activePage?.objectUrl || null;
  const cropPage = cropPageId ? pages.find((p) => p.id === cropPageId) ?? null : null;

  const phaseHint = showChooser
    ? "Choose a print PDF to begin"
    : phase === "processing"
      ? "Splitting pages…"
      : activePage
        ? overlayMode === "pickPage"
          ? `Click point ${pendingAnchor?.slot ?? ""} on the overlay, then click the matching spot on the map`
          : isGeoreferenced
            ? "Georeferenced — fine-tune anchors or save"
            : "Drag, scale & rotate the page onto the map, or set anchors to georeference"
        : "Select a page from the carousel to place it on the map";

  return (
    <div className="po-root">
      <input
        ref={fileInputRef}
        type="file"
        accept="application/pdf,.pdf"
        style={{ display: "none" }}
        onChange={onUploadPick}
      />

      {/* ── Top bar ─────────────────────────────────────────────────────── */}
      <div className="po-topbar">
        <h2 className="po-title">
          <Layers size={16} className="po-title__accent" />
          Print Overlay Studio
          <span className="po-title__accent">· {job.workOrder ?? job.jobId}</span>
        </h2>
        <span className="po-phasehint">{phaseHint}</span>
        <div className="po-topbar__actions">
          {!showChooser && (
            <button className="po-btn" onClick={() => setShowChooser(true)}>
              Change source
            </button>
          )}
          {savedNote && <span className="po-quality">{savedNote}</span>}
          <button
            className="po-btn po-btn--primary"
            onClick={doSave}
            disabled={saving || pages.length === 0}
          >
            {saving ? "Saving…" : "Complete"}
          </button>
          <button className="po-btn po-btn--ghost" onClick={onClose} aria-label="Close studio">
            <X size={18} />
          </button>
        </div>
      </div>

      {/* ── Background read-only overlays (already aligned pages) ──────── */}
      {map && pages.map((p) => {
        if (p.id === activePageId || p.excluded) return null;
        const img = p.previewUrl || p.dataUrl || p.objectUrl;
        if (!img) return null;
        const sol = p.alignment && p.alignment.anchorA && p.alignment.anchorB
          ? (() => { try { return solveGeoSolution(p.alignment); } catch { return null; } })()
          : (p.transform ? solutionFromTransform(p.transform, p.pageWidth, p.pageHeight) : null);
        if (!sol) return null;

        return (
          <PageOverlay
            key={p.id}
            map={map}
            imageUrl={img}
            imgW={p.pageWidth}
            imgH={p.pageHeight}
            crop={p.crop}
            solution={sol}
            opacity={p.transform?.opacity ?? 0.5}
            locked={true}
            mode="move"
            anchors={[]}
            scale={p.transform?.scale ?? 1}
            rotationDeg={p.transform?.rotationDeg ?? 0}
            onDragCenter={() => {}}
            onPagePoint={() => {}}
            onScale={() => {}}
            onRotate={() => {}}
            southWestLat={p.alignment ? undefined : p.transform?.southWestLat}
            southWestLng={p.alignment ? undefined : p.transform?.southWestLng}
            northEastLat={p.alignment ? undefined : p.transform?.northEastLat}
            northEastLng={p.alignment ? undefined : p.transform?.northEastLng}
            rotationDegrees={p.alignment ? undefined : p.transform?.rotationDegrees}
          />
        );
      })}

      {/* ── Page overlay on the real map (Stage 4/5) ────────────────────── */}
      {map && activePage && overlayImg && solution && (
        <PageOverlay
          map={map}
          imageUrl={overlayImg}
          imgW={activePage.pageWidth}
          imgH={activePage.pageHeight}
          crop={activePage.crop}
          solution={solution}
          opacity={activePage.transform?.opacity ?? 0.5}
          locked={isGeoreferenced}
          mode={overlayMode}
          anchors={anchorDots}
          scale={activePage.transform?.scale ?? 1}
          rotationDeg={activePage.transform?.rotationDeg ?? 0}
          onDragCenter={(center) => setTransform(activePage.id, { center })}
          onPagePoint={onPagePoint}
          onScale={(s) => setTransform(activePage.id, { scale: s })}
          onRotate={(d) => setTransform(activePage.id, { rotationDeg: d })}
          southWestLat={isGeoreferenced ? undefined : activePage.transform?.southWestLat}
          southWestLng={isGeoreferenced ? undefined : activePage.transform?.southWestLng}
          northEastLat={isGeoreferenced ? undefined : activePage.transform?.northEastLat}
          northEastLng={isGeoreferenced ? undefined : activePage.transform?.northEastLng}
          rotationDegrees={isGeoreferenced ? undefined : activePage.transform?.rotationDegrees}
          blendMode={blendMode}
          structureBadges={structureBadges}
          onSelectStructure={handleSelectStructure}
        />
      )}

      {/* ── Split-view anchor preview ──────────────────────────────────── */}
      {activePage && overlayImg && overlayMode === "pickPage" && (
        <div className="po-anchorview" role="region" aria-label="Print preview for anchoring">
          <div className="po-anchorview__head">
            <MapPin size={14} /> Click point {pendingAnchor?.slot ?? ""} on the print
          </div>
          <div className="po-anchorview__stage">
            <img
              src={overlayImg}
              alt={`${activePage.label} preview`}
              draggable={false}
              onClick={onPreviewPick}
            />
            {anchorDots
              .filter((d) => d.page.x !== 0 || d.page.y !== 0)
              .map((d) => (
                <div
                  key={d.key}
                  className={`po-anchor-dot po-anchor-dot--${d.kind}`}
                  style={{
                    left: `${(d.page.x / activePage.pageWidth) * 100}%`,
                    top: `${(d.page.y / activePage.pageHeight) * 100}%`,
                  }}
                  aria-hidden
                >
                  {d.label}
                </div>
              ))}
          </div>
        </div>
      )}


      {/* ── Right-side locked HUD calibration panel ───────────────────── */}
      {activePage && !showChooser && (
        <div className="po-panel--right">
          <SapphireGlassCard headerTitle="ALIGNMENT & NUDGE">
            <h3 className="po-panel__section-title mb-2">
              <Move size={14} className="inline mr-1" /> View settings · p{activePage.pageNumber}
            </h3>

            <div className="po-field mb-3">
              <label htmlFor="po-op-hud">
                Opacity <b>{Math.round((activePage.transform?.opacity ?? 0.5) * 100)}%</b>
              </label>
              <input
                id="po-op-hud"
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={activePage.transform?.opacity ?? 0.5}
                onChange={(e) => setTransform(activePage.id, { opacity: Number(e.target.value) })}
              />
            </div>

            <div className="po-field__row mb-3">
              <button className="po-btn" onClick={() => setCropPageId(activePage.id)} style={{ flex: 1 }}>
                <Crop size={14} /> Crop margins
              </button>
              <button className="po-btn" onClick={resetPage} style={{ flex: 1 }}>
                <RotateCw size={14} /> Reset all
              </button>
            </div>

            <div className="mb-3">
              <button
                className={`po-btn w-full ${isGeoreferenced || activePage.transform?.isLocked ? "po-btn--locked" : "po-btn--primary"}`}
                onClick={() => setTransform(activePage.id, { isLocked: !(activePage.transform?.isLocked ?? false) })}
              >
                {isGeoreferenced || activePage.transform?.isLocked ? (
                  <>
                    <Lock size={14} className="inline mr-1 text-red-400" /> LOCKED IN (PAGE SAVED)
                  </>
                ) : (
                  <>
                    <Unlock size={14} className="inline mr-1" /> LOCK IN PAGE
                  </>
                )}
              </button>
            </div>

            <div className="po-divider my-3" />

            <h3 className="po-panel__section-title mb-3">
              <Scale size={14} className="inline mr-1" /> Precision Nudge HUD
            </h3>

            {/* Translation D-Pad */}
            <div className="hud-nudge-grid">
              <div />
              <button
                className="hud-nudge-btn"
                title="Nudge North 0.1ft"
                onClick={() => nudgeCenter("N")}
              >
                <ChevronUp size={18} />
              </button>
              <div />

              <button
                className="hud-nudge-btn"
                title="Nudge West 0.1ft"
                onClick={() => nudgeCenter("W")}
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex items-center justify-center text-[9px] uppercase tracking-tighter text-slate-500 font-bold">
                Nudge
              </div>
              <button
                className="hud-nudge-btn"
                title="Nudge East 0.1ft"
                onClick={() => nudgeCenter("E")}
              >
                <ChevronRight size={18} />
              </button>

              <div />
              <button
                className="hud-nudge-btn"
                title="Nudge South 0.1ft"
                onClick={() => nudgeCenter("S")}
              >
                <ChevronDown size={18} />
              </button>
              <div />
            </div>

            {/* Fine Rotate Row */}
            <div className="hud-control-group">
              <button
                className="po-btn text-[10px] px-2"
                onClick={() => nudgeRotate(-1.0)}
                title="Rotate CCW 1 degree"
              >
                <RotateCcw size={12} className="inline" /> -1°
              </button>
              <button
                className="po-btn text-[10px] px-2"
                onClick={() => nudgeRotate(-0.1)}
                title="Rotate CCW 0.1 degree"
              >
                -0.1°
              </button>
              <span className="text-[10px] text-slate-400 font-mono">Rotate</span>
              <button
                className="po-btn text-[10px] px-2"
                onClick={() => nudgeRotate(0.1)}
                title="Rotate CW 0.1 degree"
              >
                +0.1°
              </button>
              <button
                className="po-btn text-[10px] px-2"
                onClick={() => nudgeRotate(1.0)}
                title="Rotate CW 1 degree"
              >
                <RotateCw size={12} className="inline" /> +1°
              </button>
            </div>

            {/* Fine Scale Row */}
            <div className="hud-control-group">
              <button
                className="po-btn text-[10px] px-3 w-1/2"
                onClick={() => nudgeScale(0.999)}
                title="Scale down 0.1%"
              >
                Scale down -0.1%
              </button>
              <button
                className="po-btn text-[10px] px-3 w-1/2"
                onClick={() => nudgeScale(1.001)}
                title="Scale up 0.1%"
              >
                Scale up +0.1%
              </button>
            </div>

            <div className="po-divider my-3" />

            {/* Print Blend Mode Selector */}
            <div className="mb-3">
              <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">
                Print Blend Mode
              </span>
              <div className="grid grid-cols-4 gap-1">
                {(["multiply", "screen", "normal", "difference"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`po-btn text-[9px] py-1 capitalize ${blendMode === mode ? "po-btn--primary" : ""}`}
                    onClick={() => updateBlendMode(mode)}
                    title={mode === "multiply" ? "Removes white paper background completely over satellite map" : undefined}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid Snap & Seam Stitch Row */}
            <div className="flex gap-2 mb-3">
              <button
                className={`po-btn text-[10px] py-1 flex-1 ${gridSnapEnabled ? "po-btn--primary" : ""}`}
                onClick={() => setGridSnapEnabled((v) => !v)}
                title="Toggle magnetic grid snapping"
              >
                Grid Snap: {gridSnapEnabled ? "ON" : "OFF"}
              </button>
              <button
                className="po-btn po-btn--ghost text-[10px] py-1 flex-1"
                onClick={stitchAdjacentSeam}
                title="Stitch seam to previous sheet match line"
              >
                Auto-Stitch Seam
              </button>
            </div>

            {/* Structure Badges Toggle */}
            <div className="mb-3">
              <button
                className={`po-btn text-[10px] py-1 w-full ${showStructureOverlay ? "po-btn--primary" : "po-btn--ghost"}`}
                onClick={() => setShowStructureOverlay((v) => !v)}
              >
                Structure Badges: {showStructureOverlay ? "VISIBLE" : "HIDDEN"} ({structureBadges.length})
              </button>
            </div>

            <div className="po-divider my-3" />

            <h3 className="po-panel__section-title mb-2">
              <MapPin size={14} className="inline mr-1" /> A/B Anchor Calibration
            </h3>
            <div className="po-anchor-list mb-3">
              {anchorSlots.map((slot) => {
                const done = !!curDraft[slot];
                const active = pendingAnchor?.slot === slot;
                return (
                  <div
                    key={slot}
                    className={`po-anchor ${done ? "po-anchor--done" : ""} ${active ? "po-anchor--active" : ""}`}
                  >
                    <span className="po-anchor__label text-slate-300">
                      Point {slot}
                      {slot === "C" ? " · check" : ""}
                    </span>
                    <button className="po-btn po-btn--ghost text-[10px] py-1" onClick={() => beginAnchor(slot)}>
                      {done ? "Redo" : "Set"}
                    </button>
                  </div>
                );
              })}
            </div>

            {isGeoreferenced ? (
              <>
                <div
                  className={`po-quality ${qualityGood ? "po-quality--good" : "po-quality--warn"}`}
                  title={residual != null ? `Residual ≈ ${residual.toFixed(1)} ft` : "Two-point alignment"}
                >
                  {qualityGood ? "Calibration: Good" : "Accuracy warning — adjust anchors"}
                </div>
                <div className="po-field__row mt-2">
                  {!curDraft.C && (
                    <button className="po-btn" style={{ flex: 1 }} onClick={() => beginAnchor("C")}>
                      <MapPin size={14} /> Check accuracy
                    </button>
                  )}
                  <button className="po-btn" style={{ flex: 1 }} onClick={clearAlignment}>
                    <Undo2 size={14} /> Clear Anchors
                  </button>
                </div>
              </>
            ) : (
              <div className="po-quality text-[11px] leading-relaxed">
                A/B Anchoring is required to compute matrix projection. Set A and B on the print, then map.
              </div>
            )}

            {error && <div className="po-error mt-2">{error}</div>}
          </SapphireGlassCard>
        </div>
      )}

      {/* ── Bottom carousel ─────────────────────────────────────────────── */}
      {pages.length > 0 && !showChooser && (
        <div className="po-carousel" role="list" aria-label="Print pages">
          {pages.map((p) => {
            const thumb = p.previewUrl || p.dataUrl || p.objectUrl || "";
            const excluded = p.excluded ?? false;
            const isPageLocked = !!p.alignment || !!p.transform?.isLocked;
            return (
              <div
                key={p.id}
                role="listitem"
                className={`po-thumb ${p.id === activePageId ? "po-thumb--active" : ""} ${excluded ? "po-thumb--excluded" : ""} ${isPageLocked ? "po-thumb--locked" : ""}`}
              >
                <button
                  type="button"
                  className="po-thumb__hit"
                  onClick={() => (excluded ? toggleExcluded(p) : openPage(p))}
                  aria-pressed={p.id === activePageId}
                  aria-label={`${p.label}${p.crop ? ", cropped" : ""}${excluded ? ", removed" : ""}${isPageLocked ? ", locked" : ""}`}
                >
                  {thumb ? <img src={thumb} alt="" /> : null}
                  <span className="po-thumb__label">{p.label}</span>
                  {isPageLocked ? (
                    <span className="po-thumb__badge po-thumb__badge--lock">
                      <Lock size={9} className="inline mr-0.5" /> LOCKED
                    </span>
                  ) : p.cropSource === "skipped" ? (
                    <span className="po-thumb__badge po-thumb__badge--skip">skip</span>
                  ) : p.crop ? (
                    <span className="po-thumb__badge po-thumb__badge--crop">crop</span>
                  ) : null}
                  {excluded && <span className="po-thumb__removed">Removed · tap to restore</span>}
                </button>
                <button
                  type="button"
                  className="po-thumb__action"
                  title={excluded ? "Restore page to overlay" : "Remove page from overlay"}
                  aria-label={excluded ? `Restore ${p.label}` : `Remove ${p.label}`}
                  onClick={() => toggleExcluded(p)}
                >
                  {excluded ? <RotateCcw size={13} /> : <EyeOff size={13} />}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Stage 1 source chooser ──────────────────────────────────────── */}
      {showChooser && (
        <div className="po-scrim" role="dialog" aria-modal="true" aria-label="Choose print source">
          <div className="po-dialog">
            <div>
              <h2 className="po-dialog__title">Print Overlay · choose a source</h2>
              <p className="po-dialog__subtitle mt-1">
                Pick a PDF already attached to this job, or upload a new engineering print. The
                original file stays intact — cropping and alignment are saved as reversible metadata.
              </p>
            </div>

            {sources.length > 0 && (
              <div className="po-source-list">
                {sources.map((s) => (
                  <button
                    key={s.downloadUrl ?? s.documentId}
                    className="po-source font-sans"
                    onClick={() => chooseExisting(s)}
                  >
                    <Layers size={18} className="po-title__accent" />
                    <span>
                      <span className="po-source__name">{s.name}</span>
                      <br />
                      <span className="po-source__meta">
                        {s.origin === "attachment" ? "Attached PDF" : "Prior overlay source"}
                        {s.pageCount ? ` · ${s.pageCount} pages` : ""}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button className="po-upload font-sans" onClick={() => fileInputRef.current?.click()}>
              <Layers size={16} /> Upload a new PDF
            </button>

            {error && <div className="po-error">{error}</div>}

            <div className="po-dialog__actions">
              <button className="po-btn po-btn--ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Processing spinner ──────────────────────────────────────────── */}
      {phase === "processing" && !showChooser && (
        <div className="po-scrim" role="dialog" aria-modal="true" aria-label="Processing PDF">
          <div className="po-dialog" style={{ maxWidth: 380 }}>
            <div className="po-progress font-sans">
              <div className="po-spinner" />
              <div className="po-progress__text">
                {progress ? `Rendering page ${progress.done} of ${progress.total}…` : "Reading PDF…"}
              </div>
              {progress && progress.total > 0 && (
                <div className="po-progress__bar">
                  <div
                    className="po-progress__fill"
                    style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
                  />
                </div>
              )}
            </div>
            <div className="po-dialog__actions">
              <button className="po-btn" onClick={cancelProcessing}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error dialog ────────────────────────────────────────────────── */}
      {phase === "error" && !showChooser && pages.length === 0 && (
        <div className="po-scrim" role="dialog" aria-modal="true" aria-label="Processing failed">
          <div className="po-dialog" style={{ maxWidth: 420 }}>
            <h2 className="po-dialog__title">Couldn’t process that PDF</h2>
            <div className="po-error">{error}</div>
            <div className="po-dialog__actions">
              <button className="po-btn po-btn--ghost" onClick={onClose}>
                Close
              </button>
              <button className="po-btn po-btn--primary" onClick={() => setShowChooser(true)}>
                Try another PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Crop editor ─────────────────────────────────────────────────── */}
      {cropPage && (
        <CropEditor
          imageUrl={cropPage.previewUrl || cropPage.dataUrl || cropPage.objectUrl || ""}
          label={cropPage.label}
          initial={cropPage.crop}
          auto={cropPage.autoCrop}
          onAccept={(rect, source) => {
            setCrop(cropPage.id, rect, source);
            setCropConfirmed((s) => new Set(s).add(cropPage.id));
            setCropPageId(null);
            selectAndPlace(cropPage);
          }}
          onSkip={() => {
            setCrop(cropPage.id, null, "skipped");
            setCropConfirmed((s) => new Set(s).add(cropPage.id));
            setCropPageId(null);
            selectAndPlace(cropPage);
          }}
          onCancel={() => setCropPageId(null)}
        />
      )}
    </div>
  );
}

function samePoint(a: PagePoint, b: PagePoint): boolean {
  return Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
}

function sameLatLng(a: LatLng, b: LatLng): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}
