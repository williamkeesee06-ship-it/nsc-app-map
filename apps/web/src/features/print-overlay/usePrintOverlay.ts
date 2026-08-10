// Orchestrates the Print Overlay pipeline for one job: enumerate source PDFs,
// split the chosen source into page rasters (Stage 2), track reversible crops
// (Stage 3), transforms (Stage 4) and draft alignments (Stage 5), and persist
// the draft doc. Object URLs for in-session previews are tracked and revoked on
// job switch / unmount to avoid leaks. Storage uploads + persistence are
// best-effort: when Firebase credentials are absent (local dev) the studio
// still works against in-memory object URLs and surfaces the failure.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CropRect,
  GeoAlignment,
  Job,
  PrintOverlayDoc,
  PrintOverlayPage,
  PrintOverlaySource,
  PrintOverlayTransform,
} from "@nsc/types";
import { suggestCropRect, clampCropRect } from "@nsc/types";
import { api } from "../../lib/api.js";
import { uploadToStorage, uploadBlob, sanitizeStorageSegment } from "../../lib/storage.js";
import { splitPdf, countPdfPages, CancelledError, type RenderedPage } from "./pdfSplit.js";

export interface PageVM extends PrintOverlayPage {
  /** Transient blob URL for immediate preview (revoked on cleanup). */
  objectUrl: string | null;
  /** Original auto-crop suggestion, retained so Reset can restore it. */
  autoCrop: CropRect | null;
  transform: PrintOverlayTransform | null;
  alignment: GeoAlignment | null;
}

export type StudioPhase =
  | "choosing"
  | "processing"
  | "ready"
  | "error";

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB, consistent with heavy print PDFs.

function isPdf(name: string, contentType: string | null | undefined): boolean {
  if (contentType && contentType.toLowerCase().includes("pdf")) return true;
  return /\.pdf$/i.test(name || "");
}

/** Enumerate PDF sources already attached to the job (permits + prior overlay sources). */
export function listJobPdfSources(job: Job): PrintOverlaySource[] {
  const out: PrintOverlaySource[] = [];
  const seen = new Set<string>();
  const push = (s: PrintOverlaySource) => {
    if (s.downloadUrl && !seen.has(s.downloadUrl)) {
      seen.add(s.downloadUrl);
      out.push(s);
    }
  };
  for (const f of job.ziplyPrintLayer?.permitFiles ?? []) {
    if (f.downloadUrl && isPdf(f.name, f.contentType)) {
      push({
        documentId: f.id,
        name: f.name,
        origin: "attachment",
        storagePath: f.storagePath ?? null,
        downloadUrl: f.downloadUrl,
        contentType: f.contentType ?? "application/pdf",
        size: f.size ?? null,
        pageCount: null,
      });
    }
  }
  for (const s of job.printOverlay?.sources ?? []) {
    if (s.downloadUrl) push(s);
  }
  return out;
}

export function usePrintOverlay(job: Job) {
  const jobId = job.jobId;
  const [phase, setPhase] = useState<StudioPhase>("choosing");
  const [pages, setPages] = useState<PageVM[]>([]);
  const [activePageId, setActivePageId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draftStatus, setDraftStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [parsedEntities, setParsedEntities] = useState<any[]>(job.printOverlay?.parsedEntities ?? []);

  const abortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef<Set<string>>(new Set());
  // Known sources by documentId so buildDoc persists resolved Storage refs
  // (an uploaded PDF stays attached to the job and re-appears in the chooser).
  const sourcesRef = useRef<Map<string, PrintOverlaySource>>(new Map());

  const pagesRef = useRef(pages);
  useEffect(() => {
    pagesRef.current = pages;
  }, [pages]);

  const pendingUploadsRef = useRef<Map<string, Promise<any>>>(new Map());

  const revokeAllObjectUrls = useCallback(() => {
    for (const url of objectUrlsRef.current) URL.revokeObjectURL(url);
    objectUrlsRef.current.clear();
  }, []);

  // Cancel in-flight work + revoke URLs whenever the job changes or unmounts.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      revokeAllObjectUrls();
    };
  }, [jobId, revokeAllObjectUrls]);

  // Sync sourcesRef when job changes
  useEffect(() => {
    sourcesRef.current.clear();
    if (job.printOverlay?.sources) {
      for (const s of job.printOverlay.sources) {
        sourcesRef.current.set(s.documentId, s);
      }
    }
  }, [jobId, job.printOverlay?.sources]);

  const trackUrl = useCallback((url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  /** Load bytes for a source: uploaded File directly, else fetch the attachment. */
  const loadSourceBytes = useCallback(
    async (source: PrintOverlaySource, file: File | null): Promise<ArrayBuffer> => {
      if (file) return file.arrayBuffer();
      if (!source.downloadUrl) throw new Error("Source has no download URL");
      const res = await fetch(source.downloadUrl);
      if (!res.ok) throw new Error(`Could not fetch source PDF (${res.status})`);
      return res.arrayBuffer();
    },
    []
  );


  const cancelProcessing = useCallback(() => {
    abortRef.current?.abort();
    setPhase("choosing");
    setProgress(null);
  }, []);

  const selectPage = useCallback((id: string | null) => setActivePageId(id), []);

  const patchPage = useCallback((id: string, patch: Partial<PageVM>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }, []);

  // ── Stage 3: crop ─────────────────────────────────────────────────────────
  const setCrop = useCallback(
    (id: string, rect: CropRect | null, source: PrintOverlayPage["cropSource"]) => {
      patchPage(id, { crop: rect ? clampCropRect(rect) : null, cropSource: source });
    },
    [patchPage]
  );
  const resetCropToAuto = useCallback(
    (id: string) => {
      setPages((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const auto = p.autoCrop ?? null;
          return { ...p, crop: auto, cropSource: auto ? "auto" : null };
        })
      );
    },
    []
  );

  // ── Stage 4: transform ──────────────────────────────────────────────────────
  const setTransform = useCallback(
    (id: string, patch: Partial<PrintOverlayTransform>) => {
      setPages((prev) =>
        prev.map((p) => {
          if (p.id !== id) return p;
          const base: PrintOverlayTransform = p.transform ?? {
            center: job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 0, lng: 0 },
            scale: 1,
            rotationDeg: 0,
            opacity: 0.5,
          };
          return { ...p, transform: { ...base, ...patch } };
        })
      );
    },
    [job.geocode]
  );

  // ── Stage 5: alignment ──────────────────────────────────────────────────────
  const setAlignment = useCallback(
    (id: string, alignment: GeoAlignment | null) => patchPage(id, { alignment }),
    [patchPage]
  );

  // Reversible exclusion of a page from the overlay project (never touches the
  // original PDF or job document).
  const setExcluded = useCallback(
    (id: string, excluded: boolean) => patchPage(id, { excluded }),
    [patchPage]
  );

  const deletePage = useCallback(
    (id: string) => {
      setPages((prev) => {
        const next = prev.filter((p) => p.id !== id);
        pagesRef.current = next;
        return next;
      });
      if (activePageId === id) {
        setActivePageId(null);
      }
    },
    [activePageId]
  );

  const buildDoc = useCallback(
    (username: string | null): PrintOverlayDoc => {
      const currentPages = pagesRef.current;
      const transforms: Record<string, PrintOverlayTransform> = {};
      const alignments: Record<string, GeoAlignment> = {};
      const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
      for (const p of currentPages) {
        transforms[p.id] = p.transform ?? {
          center: defaultCenter,
          scale: 1,
          rotationDeg: 0,
          opacity: 0.5,
        };
        if (p.alignment) alignments[p.id] = p.alignment;
      }

      const activeDocIds = new Set<string>();
      for (const p of currentPages) {
        activeDocIds.add(p.documentId);
      }

      const mergedSources = new Map<string, PrintOverlaySource>();
      const mergedPages: PrintOverlayPage[] = [];
      const mergedTransforms: Record<string, PrintOverlayTransform> = {};
      const mergedAlignments: Record<string, GeoAlignment> = {};

      const existingDoc = job.printOverlay;
      if (existingDoc) {
        if (existingDoc.sources) {
          for (const s of existingDoc.sources) {
            if (!activeDocIds.has(s.documentId)) {
              mergedSources.set(s.documentId, s);
            }
          }
        }
        if (existingDoc.pages) {
          for (const p of existingDoc.pages) {
            if (!activeDocIds.has(p.documentId)) {
              mergedPages.push(p);
            }
          }
        }
        if (existingDoc.transforms) {
          for (const [key, t] of Object.entries(existingDoc.transforms)) {
            const pageDocId = key.split(":")[0];
            if (!activeDocIds.has(pageDocId)) {
              mergedTransforms[key] = t;
            }
          }
        }
        if (existingDoc.alignments) {
          for (const [key, a] of Object.entries(existingDoc.alignments)) {
            const pageDocId = key.split(":")[0];
            if (!activeDocIds.has(pageDocId)) {
              mergedAlignments[key] = a;
            }
          }
        }
      }

      for (const [docId, source] of sourcesRef.current.entries()) {
        if (!mergedSources.has(docId)) {
          mergedSources.set(docId, source);
        }
      }

      for (const p of currentPages) {
        if (!mergedSources.has(p.documentId)) {
          mergedSources.set(p.documentId, {
            documentId: p.documentId,
            name: p.label.replace(/ · p\d+$/, ""),
            origin: "upload",
            storagePath: null,
            downloadUrl: null,
            contentType: "application/pdf",
            size: null,
            pageCount: null,
          });
        }
      }

      mergedPages.push(...currentPages.map(stripVM));
      Object.assign(mergedTransforms, transforms);
      Object.assign(mergedAlignments, alignments);

      return {
        schemaVersion: 1,
        jobId,
        updatedAt: Date.now(),
        updatedBy: username,
        sources: [...mergedSources.values()],
        pages: mergedPages,
        transforms: mergedTransforms,
        alignments: mergedAlignments,
        parsedEntities: parsedEntities,
      };
    },
    [jobId, job.printOverlay, job.geocode, parsedEntities]
  );

  const save = useCallback(
    async (username: string | null) => {
      setSaving(true);
      setError(null);
      try {
        if (pendingUploadsRef.current.size > 0) {
          await Promise.all(Array.from(pendingUploadsRef.current.values()));
        }
        await api.putPrintOverlay(jobId, buildDoc(username));
        window.dispatchEvent(new Event("nsc:jobs-reload"));
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        setSaving(false);
      }
    },
    [jobId, buildDoc]
  );

  // Silent draft persistence for debounced auto-save (no big spinner). Surfaces
  // status via `draftStatus` so the UI can show a subtle indicator.
  const saveDraft = useCallback(
    async (username: string | null) => {
      setDraftStatus("saving");
      try {
        await api.putPrintOverlay(jobId, buildDoc(username));
        setDraftStatus("saved");
        window.dispatchEvent(new Event("nsc:jobs-reload"));
        return true;
      } catch (e) {
        console.warn("[print-overlay] draft auto-save failed", e);
        setDraftStatus("error");
        return false;
      }
    },
    [jobId, buildDoc]
  );

  const startProcessingSource = useCallback(
    async (source: PrintOverlaySource, file: File | null, username: string | null) => {
      const ac = new AbortController();
      abortRef.current = ac;
      setError(null);

      // Check for previously saved pages for this source
      const savedForSource = job.printOverlay?.pages?.filter((x) => x.documentId === source.documentId) ?? [];
      if (savedForSource.length > 0) {
        // If we already have saved pages in printOverlay, load them into pages state directly
        const loadedVMs: PageVM[] = savedForSource.map((sp) => {
          const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
          const transform = job.printOverlay?.transforms?.[sp.id] ?? {
            center: defaultCenter,
            scale: 1,
            rotationDeg: 0,
            opacity: 0.5,
          };
          const alignment = job.printOverlay?.alignments?.[sp.id] ?? null;
          return {
            ...sp,
            objectUrl: sp.previewUrl ?? null,
            autoCrop: sp.crop ?? null,
            transform,
            alignment,
          };
        });
        setPages(loadedVMs);
        pagesRef.current = loadedVMs;
        if (loadedVMs.length > 0) {
          setActivePageId(loadedVMs[0].id);
        }
        setPhase("ready");
        return;
      }

      setPhase("processing");
      const documentId = source.documentId;
      sourcesRef.current.set(documentId, source);
      try {
        if (file && !source.storagePath) {
          const path = `jobs/${jobId}/print-overlay/${documentId}/${sanitizeStorageSegment(file.name)}`;
          const sourceUploadPromise = uploadToStorage(path, file, { contentType: file.type || "application/pdf", signal: ac.signal })
            .then((r) => {
              source.storagePath = r.storagePath;
              source.downloadUrl = r.downloadUrl;
              sourcesRef.current.set(documentId, { ...source });
              pendingUploadsRef.current.delete(documentId);
              void saveDraft(username);
            })
            .catch((e) => {
              console.warn("[print-overlay] source PDF upload failed", e);
              pendingUploadsRef.current.delete(documentId);
            });
          pendingUploadsRef.current.set(documentId, sourceUploadPromise);
        }

        const bytes = await loadSourceBytes(source, file);
        source.pageCount = await countPdfPages(bytes.slice(0));

        await splitPdf(
          bytes,
          (rp: RenderedPage) => {
            const vm = buildPageVM(jobId, job, source, rp, trackUrl, job.printOverlay);
            setPages((prev) => [...prev, vm].sort((a, b) => a.pageNumber - b.pageNumber));
            pagesRef.current = [...pagesRef.current, vm].sort((a, b) => a.pageNumber - b.pageNumber);

            const previewPath = `jobs/${jobId}/print-overlay/${documentId}/p${rp.pageNumber}.png`;
            const previewUploadPromise = uploadBlob(previewPath, rp.blob, "image/png")
              .then((r) => {
                pagesRef.current = pagesRef.current.map((p) =>
                  p.id === vm.id
                    ? { ...p, previewStoragePath: r.storagePath, previewUrl: r.downloadUrl }
                    : p
                );
                setPages((prev) =>
                  prev.map((p) =>
                    p.id === vm.id
                      ? { ...p, previewStoragePath: r.storagePath, previewUrl: r.downloadUrl }
                      : p
                  )
                );
                pendingUploadsRef.current.delete(vm.id);
                if (pendingUploadsRef.current.size === 0) {
                  void saveDraft(username);
                }
              })
              .catch((e) => {
                console.warn("[print-overlay] preview upload failed", e);
                pendingUploadsRef.current.delete(vm.id);
              });
            pendingUploadsRef.current.set(vm.id, previewUploadPromise);
          },
          {
            signal: ac.signal,
            onProgress: (p) => setProgress({ done: p.done, total: p.total }),
          }
        );
        setPhase("ready");
      } catch (e) {
        if (e instanceof CancelledError) return;
        console.error("[print-overlay] split failed", e);
        setError(e instanceof Error ? e.message : String(e));
        setPhase("error");
      }
    },
    [jobId, job, loadSourceBytes, saveDraft, trackUrl]
  );

  return {
    phase,
    pages,
    activePageId,
    activePage: pages.find((p) => p.id === activePageId) ?? null,
    progress,
    error,
    saving,
    draftStatus,
    parsedEntities,
    setParsedEntities,
    cancelProcessing,
    selectPage,
    setCrop,
    resetCropToAuto,
    setTransform,
    setAlignment,
    setExcluded,
    deletePage,
    beginSource: startProcessingSource,
    startProcessingSource,
    save,
    saveDraft,
  };
}

function buildPageVM(
  jobId: string,
  job: Job,
  source: PrintOverlaySource,
  rp: RenderedPage,
  trackUrl: (url: string) => string,
  existingDoc: PrintOverlayDoc | null | undefined
): PageVM {
  const pageId = `${source.documentId}:p${rp.pageNumber}`;
  const objectUrl = trackUrl(URL.createObjectURL(rp.blob));
  const autoCrop = suggestCropRect(rp.contentBounds, rp.rasterWidth, rp.rasterHeight);

  const savedPage = existingDoc?.pages?.find((x) => x.id === pageId);
  const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
  const savedTransform = existingDoc?.transforms?.[pageId] ?? {
    center: defaultCenter,
    scale: 1,
    rotationDeg: 0,
    opacity: 0.5,
  };
  const savedAlignment = existingDoc?.alignments?.[pageId] ?? null;

  return {
    id: pageId,
    jobId,
    documentId: source.documentId,
    pageNumber: rp.pageNumber,
    label: `${source.name} · p${rp.pageNumber}`,
    status: "ready",
    pageWidth: rp.pageWidth,
    pageHeight: rp.pageHeight,
    previewStoragePath: savedPage?.previewStoragePath ?? null,
    previewUrl: savedPage?.previewUrl ?? objectUrl,
    crop: savedPage ? savedPage.crop : autoCrop,
    cropSource: savedPage ? savedPage.cropSource : (autoCrop ? "auto" : null),
    excluded: savedPage?.excluded ?? false,
    autoCrop,
    objectUrl,
    transform: savedTransform,
    alignment: savedAlignment,
  };
}

/** Strip transient VM fields before persisting a page record. */
function stripVM(p: PageVM): PrintOverlayPage {
  return {
    id: p.id,
    jobId: p.jobId,
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    label: p.label,
    status: p.status,
    pageWidth: p.pageWidth,
    pageHeight: p.pageHeight,
    previewStoragePath: p.previewStoragePath,
    previewUrl: p.previewUrl || p.objectUrl || "",
    crop: p.crop,
    cropSource: p.cropSource,
    excluded: p.excluded ?? false,
    errorMessage: p.errorMessage ?? null,
  };
}
