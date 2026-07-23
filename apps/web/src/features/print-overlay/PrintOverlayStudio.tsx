// Print Overlay Studio (Stages 1–5) — the full georeferencing workspace.
//
// Rendered INSIDE the map context (uses useMap()) so the translucent page copy
// is placed on the real Google Map and the map stays navigable underneath.
// Chrome (top bar, page carousel, control panel, dialogs) docks at the screen
// edges; the center is click-through to the map. Nothing here mutates existing
// map/jobs/Ziply state — the studio only reads the job and writes its own
// print-overlay doc via the API.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import { Layers, X, Crop, Move, MapPin, RotateCw, Undo2, EyeOff, RotateCcw } from "lucide-react";
import {
  alignmentResidualFt,
  solveGeoSolution,
  type GeoAlignment,
  type GeoAnchor,
  type GeoSolution,
  type LatLng,
  type PagePoint,
  type PrintOverlaySource,
} from "@nsc/types";
import type { Job } from "@nsc/types";
import { useAuth } from "../auth/authContext.js";
import { usePrintOverlay, listJobPdfSources, type PageVM } from "./usePrintOverlay.js";
import { solutionFromTransform } from "./geoPlacement.js";
import PageOverlay, { type AnchorDot, type OverlayMode } from "./PageOverlay.js";
import CropEditor from "./CropEditor.js";
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

// Two-point alignments within this residual read as "Good"; above it the UI
// nudges the user to add/check a third control point. Deliberately generous —
// the primary UI shows a plain Good / Check indicator, not feet.
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
  } = studio;

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [showChooser, setShowChooser] = useState(true);
  const [cropPageId, setCropPageId] = useState<string | null>(null);
  const [overlayMode, setOverlayMode] = useState<OverlayMode>("move");
  const [pendingAnchor, setPendingAnchor] = useState<PendingAnchor>(null);
  const [anchorDraft, setAnchorDraft] = useState<Record<string, AnchorDraft>>({});
  const [savedNote, setSavedNote] = useState<string | null>(null);
  // Pages whose crop suggestion the user has explicitly accepted or skipped this
  // session. Opening a not-yet-confirmed page shows the inline crop step first
  // (decision 5); confirming it flows straight into placement.
  const [cropConfirmed, setCropConfirmed] = useState<Set<string>>(new Set());

  const sources = useMemo(() => listJobPdfSources(job), [job]);
  const jobCenter: LatLng = job.geocode
    ? { lat: job.geocode.lat, lng: job.geocode.lng }
    : { lat: 0, lng: 0 };

  const didInitialFlyRef = useRef(false);
  useEffect(() => {
    if (map && job.geocode && !didInitialFlyRef.current) {
      didInitialFlyRef.current = true;
      map.panTo({ lat: job.geocode.lat, lng: job.geocode.lng });
      map.setZoom(18);
    }
  }, [map, job.geocode]);

  const curDraft: AnchorDraft = activePageId ? anchorDraft[activePageId] ?? {} : {};

  useEffect(() => {
    if (phase === "ready" || phase === "processing") setShowChooser(false);
  }, [phase]);

  // ── Stage 1 — choose a source ────────────────────────────────────────────
  const chooseExisting = useCallback(
    (s: PrintOverlaySource) => {
      setShowChooser(false);
      void beginSource(s, null);
    },
    [beginSource]
  );

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
      void beginSource(src, file);
    },
    [beginSource]
  );

  // ── Stage 4 — select a page and place it (seed transform + anchor draft) ──
  const selectAndPlace = useCallback(
    (page: PageVM) => {
      selectPage(page.id);
      setOverlayMode("move");
      setPendingAnchor(null);
      if (!page.transform) {
        const c = map?.getCenter();
        const center = c ? { lat: c.lat(), lng: c.lng() } : jobCenter;
        setTransform(page.id, DEFAULT_TRANSFORM(center));
      }
      setAnchorDraft((prev) => {
        if (prev[page.id]) return prev;
        const seed: AnchorDraft = page.alignment
          ? { A: page.alignment.anchorA, B: page.alignment.anchorB, C: page.alignment.control ?? undefined }
          : {};
        return { ...prev, [page.id]: seed };
      });
    },
    [selectPage, setTransform, map, jobCenter]
  );

  // Decision 5 — opening a page shows the inline crop step first (once), then
  // flows into placement. Confirmed pages jump straight to the map.
  const openPage = useCallback(
    (p: PageVM) => {
      if (p.excluded) return;
      if (!cropConfirmed.has(p.id)) {
        selectPage(p.id);
        setCropPageId(p.id);
        return;
      }
      selectAndPlace(p);
    },
    [cropConfirmed, selectAndPlace, selectPage]
  );

  // ── Stage 5 — a map click completes the pending anchor ───────────────────
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

  // Persist a valid draft alignment onto the page record (draft is UI truth).
  useEffect(() => {
    if (!activePage) return;
    const al = draftToAlignment(curDraft);
    if (JSON.stringify(al) !== JSON.stringify(activePage.alignment ?? null)) {
      setAlignment(activePage.id, al);
    }
  }, [curDraft, activePage, setAlignment]);

  // ── Decision 8 — debounced draft auto-save ───────────────────────────────
  // Any change to crop / position / rotation / opacity / anchors flows into the
  // `pages` state; persist quietly a short beat later so drafts survive without
  // an explicit Save. Surfaced subtly via `draftStatus`, never a blocking spinner.
  const draftTimer = useRef<number | null>(null);
  useEffect(() => {
    if (phase !== "ready" || pages.length === 0) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      void saveDraft(username);
    }, 1200);
    return () => {
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
    };
  }, [pages, phase, saveDraft, username]);

  const beginAnchor = useCallback((slot: AnchorSlot) => {
    setOverlayMode("pickPage");
    setPendingAnchor({ slot, page: { x: 0, y: 0 } });
  }, []);

  // Decision 9 — pick the page point from the split-view preview: convert a
  // click in the displayed preview to page-pixel space (independent of preview
  // display size), then await the matching map click to complete the anchor.
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

  // Solution driving overlay placement: georeferenced once A+B exist, else the
  // free Stage 4 transform.
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
  // Decision 11 — plain Good / Check indicator. Without a 3rd control point the
  // residual is unmeasurable, so two-point alignments read as Good by default;
  // the "check accuracy" affordance lets the user add point C to verify.
  const qualityGood = residual == null ? true : residual < GOOD_RESIDUAL_FT;
  // Decision 10 — third point is optional and only surfaces once the user opts
  // to check accuracy (or has already set it).
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

  const doSave = useCallback(async () => {
    const ok = await save(username);
    setSavedNote(ok ? "Draft saved to job." : null);
    if (ok) setTimeout(() => setSavedNote(null), 2500);
  }, [save, username]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !cropPageId) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, cropPageId]);

  const overlayImg = activePage?.previewUrl || activePage?.objectUrl || null;
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
          {!showChooser && pages.length > 0 && (
            <span className={`po-draftstatus po-draftstatus--${draftStatus}`}>
              {draftStatus === "saving"
                ? "Saving draft…"
                : draftStatus === "saved"
                  ? "Draft saved"
                  : draftStatus === "error"
                    ? "Auto-save failed"
                    : ""}
            </span>
          )}
          {savedNote && <span className="po-quality">{savedNote}</span>}
          <button
            className="po-btn po-btn--primary"
            onClick={doSave}
            disabled={saving || pages.length === 0}
          >
            {saving ? "Saving…" : "Save draft"}
          </button>
          <button className="po-btn po-btn--ghost" onClick={onClose} aria-label="Close studio">
            <X size={18} />
          </button>
        </div>
      </div>

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
        />
      )}

      {/* ── Split-view anchor preview (Stage 5, decision 9) ─────────────── */}
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
              style={{ clipPath: undefined }}
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
          <div className="po-anchorview__hint">
            Then click the matching real-world spot on the map. The two panels stay in sync.
          </div>
        </div>
      )}

      {/* ── Control panel (Stage 4/5) ───────────────────────────────────── */}
      {activePage && !showChooser && (
        <div className="po-panel" role="region" aria-label="Overlay controls">
          <h3 className="po-panel__section-title">
            <Move size={14} /> Transform · {activePage.label}
          </h3>

          <div className="po-field">
            <label htmlFor="po-scale">
              Scale <b>{(activePage.transform?.scale ?? 1).toFixed(2)}×</b>
            </label>
            <input
              id="po-scale"
              type="range"
              min={0.1}
              max={4}
              step={0.05}
              value={activePage.transform?.scale ?? 1}
              disabled={isGeoreferenced}
              onChange={(e) => setTransform(activePage.id, { scale: Number(e.target.value) })}
            />
          </div>

          <div className="po-field">
            <label htmlFor="po-rot">
              Rotation <b>{Math.round(activePage.transform?.rotationDeg ?? 0)}°</b>
            </label>
            <div className="po-field__row">
              <input
                id="po-rot"
                type="range"
                min={-180}
                max={180}
                step={1}
                value={activePage.transform?.rotationDeg ?? 0}
                disabled={isGeoreferenced}
                onChange={(e) => setTransform(activePage.id, { rotationDeg: Number(e.target.value) })}
              />
              <input
                className="po-field__num"
                type="number"
                value={Math.round(activePage.transform?.rotationDeg ?? 0)}
                disabled={isGeoreferenced}
                onChange={(e) => setTransform(activePage.id, { rotationDeg: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="po-field">
            <label htmlFor="po-op">
              Opacity <b>{Math.round((activePage.transform?.opacity ?? 0.5) * 100)}%</b>
            </label>
            <input
              id="po-op"
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={activePage.transform?.opacity ?? 0.5}
              onChange={(e) => setTransform(activePage.id, { opacity: Number(e.target.value) })}
            />
          </div>

          <div className="po-field__row">
            <button className="po-btn" onClick={() => setCropPageId(activePage.id)} style={{ flex: 1 }}>
              <Crop size={14} /> Crop
            </button>
            <button className="po-btn" onClick={resetPage} style={{ flex: 1 }}>
              <RotateCw size={14} /> Reset
            </button>
          </div>

          <div className="po-divider" />

          <h3 className="po-panel__section-title">
            <MapPin size={14} /> Georeference
          </h3>
          <div className="po-anchor-list">
            {anchorSlots.map((slot) => {
              const done = !!curDraft[slot];
              const active = pendingAnchor?.slot === slot;
              return (
                <div
                  key={slot}
                  className={`po-anchor ${done ? "po-anchor--done" : ""} ${active ? "po-anchor--active" : ""}`}
                >
                  <span className="po-anchor__label">
                    Point {slot}
                    {slot === "C" ? " · check" : ""}
                  </span>
                  <span className="po-anchor__state">
                    {active ? "pick on print, then map…" : done ? "set ✓" : "not set"}
                  </span>
                  <button className="po-btn po-btn--ghost" onClick={() => beginAnchor(slot)}>
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
                {qualityGood ? "Alignment: Good" : "Check Alignment — adjust anchors"}
              </div>
              <div className="po-field__row">
                {!curDraft.C && (
                  <button className="po-btn" style={{ flex: 1 }} onClick={() => beginAnchor("C")}>
                    <MapPin size={14} /> Check accuracy
                  </button>
                )}
                <button className="po-btn" style={{ flex: 1 }} onClick={clearAlignment}>
                  <Undo2 size={14} /> Undo alignment
                </button>
              </div>
            </>
          ) : (
            <div className="po-quality">
              Set points A and B — click the print preview, then the matching spot on the map.
            </div>
          )}

          {error && <div className="po-error">{error}</div>}
        </div>
      )}

      {/* ── Bottom carousel (Stage 2) ───────────────────────────────────── */}
      {pages.length > 0 && !showChooser && (
        <div className="po-carousel" role="list" aria-label="Print pages">
          {pages.map((p) => {
            const thumb = p.previewUrl || p.objectUrl || "";
            const excluded = p.excluded ?? false;
            return (
              <div
                key={p.id}
                role="listitem"
                className={`po-thumb ${p.id === activePageId ? "po-thumb--active" : ""} ${excluded ? "po-thumb--excluded" : ""}`}
              >
                <button
                  type="button"
                  className="po-thumb__hit"
                  onClick={() => (excluded ? toggleExcluded(p) : openPage(p))}
                  aria-pressed={p.id === activePageId}
                  aria-label={`${p.label}${p.crop ? ", cropped" : ""}${excluded ? ", removed" : ""}`}
                >
                  {thumb ? <img src={thumb} alt="" /> : null}
                  <span className="po-thumb__label">{p.label}</span>
                  {p.cropSource === "skipped" ? (
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
              <p className="po-dialog__subtitle">
                Pick a PDF already attached to this job, or upload a new engineering print. The
                original file stays intact — cropping and alignment are saved as reversible metadata.
              </p>
            </div>

            {sources.length > 0 && (
              <div className="po-source-list">
                {sources.map((s) => (
                  <button
                    key={s.downloadUrl ?? s.documentId}
                    className="po-source"
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

            <button className="po-upload" onClick={() => fileInputRef.current?.click()}>
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

      {/* ── Processing ──────────────────────────────────────────────────── */}
      {phase === "processing" && !showChooser && (
        <div className="po-scrim" role="dialog" aria-modal="true" aria-label="Processing PDF">
          <div className="po-dialog" style={{ maxWidth: 380 }}>
            <div className="po-progress">
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

      {/* ── Error (fatal) ───────────────────────────────────────────────── */}
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

      {/* ── Stage 3 crop editor ─────────────────────────────────────────── */}
      {cropPage && (
        <CropEditor
          imageUrl={cropPage.previewUrl || cropPage.objectUrl || ""}
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
