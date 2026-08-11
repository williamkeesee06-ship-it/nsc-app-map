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
  LatLng,
  PrintOverlayDoc,
  PrintOverlayPage,
  PrintOverlaySource,
  PrintOverlayTransform,
} from "@nsc/types";
import { suggestCropRect, clampCropRect } from "@nsc/types";
import { api } from "../../lib/api.js";
import { uploadToStorage, uploadBlob, sanitizeStorageSegment } from "../../lib/storage.js";
import { splitPdf, countPdfPages, CancelledError, type RenderedPage } from "./pdfSplit.js";
import { putPrintDocument, backupPrintDocument, resolvePrintDocument, renderPagesFromDocument, type PrintDocumentMeta } from "./printDocumentStore.js";
import { putBlueprintImage, getBlueprintImage } from "./blueprintImageStore.js";

export interface PageVM extends PrintOverlayPage {
  /** Transient blob URL for immediate preview (revoked on cleanup). */
  objectUrl: string | null;
  /** Durable Base64 Data URL fallback if Storage upload is pending or fails. */
  dataUrl?: string | null;
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
    const key = s.documentId || s.downloadUrl;
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  };
  for (const f of job.ziplyPrintLayer?.permitFiles ?? []) {
    if (isPdf(f.name, f.contentType)) {
      push({
        documentId: f.id,
        name: f.name,
        origin: "attachment",
        storagePath: f.storagePath ?? null,
        downloadUrl: f.downloadUrl ?? null,
        contentType: f.contentType ?? "application/pdf",
        size: f.size ?? null,
        pageCount: null,
      });
    }
  }
  for (const s of job.printOverlay?.sources ?? []) {
    push(s);
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

  // Tombstones for pages the operator explicitly hard-deleted this session.
  // buildDoc must respect these so it does NOT resurrect them from
  // existingDoc.pages during the merge (which is what created "stuck"
  // overlays that the red X couldn't remove). The set survives across
  // renders and is checked on every save.
  const deletedIdsRef = useRef<Set<string>>(new Set());

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

  // Synchronize saved pages from job.printOverlay on mount / update
  useEffect(() => {
    const existingPages = job.printOverlay?.pages;
    if (!existingPages || existingPages.length === 0) return;

    const defaultCenter = job.geocode
      ? { lat: job.geocode.lat, lng: job.geocode.lng }
      : { lat: 47.6062, lng: -122.3321 };

    setPages((prev) => {
      const loadedVMs: PageVM[] = existingPages.map((sp) => {
        const transform = job.printOverlay?.transforms?.[sp.id] ?? {
          center: defaultCenter,
          scale: 1,
          rotationDeg: 0,
          opacity: 0.5,
        };
        const alignment = job.printOverlay?.alignments?.[sp.id] ?? null;
        const prevVM = prev.find((p) => p.id === sp.id);

        return {
          ...sp,
          objectUrl: prevVM?.objectUrl ?? null,
          dataUrl: prevVM?.dataUrl ?? null,
          previewUrl: sp.previewUrl && !sp.previewUrl.startsWith("blob:") ? sp.previewUrl : (prevVM?.previewUrl ?? null),
          autoCrop: sp.crop ?? null,
          transform,
          alignment,
        };
      });

      const combined = [...loadedVMs];
      for (const p of prev) {
        if (!combined.some((c) => c.id === p.id)) {
          combined.push(p);
        }
      }
      pagesRef.current = combined;
      return combined;
    });

    setPhase((currentPhase) => (currentPhase === "choosing" ? "ready" : currentPhase));

    setActivePageId((currentId) => {
      if (currentId) return currentId;
      return existingPages.length > 0 ? existingPages[0].id : null;
    });
  }, [jobId, job.printOverlay, job.geocode]);

  // Resolve missing preview images for loaded pages (Tier 1 IndexedDB -> Tier 3 PDF Re-render)
  useEffect(() => {
    const missingPages = pages.filter(
      (p) => !p.dataUrl && (!p.previewUrl || p.previewUrl.startsWith("blob:")) && !p.objectUrl
    );
    if (missingPages.length === 0) return;

    let cancelled = false;

    async function resolvePageImages() {
      const resolvedFromDb: Record<string, string> = {};
      const stillMissing: PageVM[] = [];

      for (const p of missingPages) {
        const cached = await getBlueprintImage(p.id);
        if (cached) {
          resolvedFromDb[p.id] = cached;
        } else {
          stillMissing.push(p);
        }
      }

      if (cancelled) return;

      if (Object.keys(resolvedFromDb).length > 0) {
        setPages((prev) =>
          prev.map((p) =>
            resolvedFromDb[p.id] ? { ...p, dataUrl: resolvedFromDb[p.id] } : p
          )
        );
      }

      if (stillMissing.length > 0) {
        const byDoc = new Map<string, PageVM[]>();
        for (const p of stillMissing) {
          const arr = byDoc.get(p.documentId) ?? [];
          arr.push(p);
          byDoc.set(p.documentId, arr);
        }

        const docSources = job.printOverlay?.sources ?? [];

        for (const [docId, docPages] of byDoc.entries()) {
          if (cancelled) break;
          const src: PrintOverlaySource | undefined =
            sourcesRef.current.get(docId) ?? docSources.find((s) => s.documentId === docId);

          const meta: PrintDocumentMeta = {
            id: docId,
            jobId: jobId,
            fileName: src?.name ?? `${docId}.pdf`,
            pageCount: src?.pageCount ?? 1,
            byteSize: src?.size ?? 0,
            uploadedAt: new Date().toISOString(),
            cloudUrl: src?.downloadUrl ?? undefined,
          };

          const bytes = await resolvePrintDocument(meta);
          if (!bytes || cancelled) continue;

          const pageNumbers = Array.from(new Set(docPages.map((p) => p.pageNumber)));
          const rendered = await renderPagesFromDocument(bytes.slice(0), pageNumbers, 2.0);

          for (const p of docPages) {
            const dataUrl = rendered.get(p.pageNumber);
            if (dataUrl && !cancelled) {
              await putBlueprintImage(p.id, dataUrl);
              setPages((prev) =>
                prev.map((item) => (item.id === p.id ? { ...item, dataUrl } : item))
              );
            }
          }
        }
      }
    }

    void resolvePageImages();

    return () => {
      cancelled = true;
    };
  }, [pages, jobId, job.printOverlay?.sources]);

  const trackUrl = useCallback((url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  }, []);

  /** Load bytes for a source: uploaded File directly, else fetch the attachment. */
  const loadSourceBytes = useCallback(
    async (source: PrintOverlaySource, file: File | null): Promise<ArrayBuffer> => {
      if (file) return file.arrayBuffer();

      // Tier 1: Check IndexedDB local document cache
      const meta: PrintDocumentMeta = {
        id: source.documentId,
        jobId,
        fileName: source.name,
        pageCount: source.pageCount ?? 1,
        byteSize: source.size ?? 0,
        uploadedAt: new Date().toISOString(),
        cloudUrl: source.downloadUrl ?? undefined,
      };

      const cachedBytes = await resolvePrintDocument(meta);
      if (cachedBytes) return cachedBytes;

      let downloadUrl = source.downloadUrl;
      if (!downloadUrl && source.storagePath) {
        try {
          const { getStorage, ref, getDownloadURL } = await import("firebase/storage");
          const storage = getStorage();
          downloadUrl = await getDownloadURL(ref(storage, source.storagePath));
          source.downloadUrl = downloadUrl;
        } catch (err) {
          console.warn("[print-overlay] Could not get download URL from storage path", err);
        }
      }

      if (!downloadUrl) throw new Error("Source has no download URL or cached copy on this device.");
      const res = await fetch(downloadUrl);
      if (!res.ok) throw new Error(`Could not fetch source PDF (${res.status})`);
      const bytes = await res.arrayBuffer();
      void putPrintDocument(source.documentId, bytes);
      return bytes;
    },
    [jobId]
  );


  const cancelProcessing = useCallback(() => {
    abortRef.current?.abort();
    setPhase("choosing");
    setProgress(null);
  }, []);

  const selectPage = useCallback((id: string | null) => setActivePageId(id), []);

  const patchPage = useCallback((id: string, patch: Partial<PageVM>) => {
    // Update the ref SYNCHRONOUSLY so that immediate follow-up reads of
    // pagesRef.current (e.g. Complete-button flow: setAlignment(...) then
    // save() which calls buildDoc which reads pagesRef.current) see the
    // latest patch. Previously we mutated pagesRef.current inside the
    // setPages updater callback, which React may defer past the awaited
    // save() call → buildDoc read a stale ref → the anchor data Studio
    // displayed was NOT what got persisted. Symptom: Studio renders the
    // page correctly anchored, but on Complete the map render uses stale
    // (or default) alignment and the print appears shifted.
    const prev = pagesRef.current;
    const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
    pagesRef.current = next;
    setPages(next);
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
  // In-memory setTransform scrubs the legacy rectangular-bounds fields
  // (southWestLat/Lng, northEastLat/Lng, rotationDegrees) from the merged
  // result. Together with buildDoc's sanitizer, this means every placement
  // update permanently retires the parallel bounds system — so the main-map
  // renderer can never fall through to the stale-bounds override path.
  const setTransform = useCallback(
    (id: string, patch: Partial<PrintOverlayTransform>) => {
      setPages((prev) => {
        const next = prev.map((p) => {
          if (p.id !== id) return p;
          const base: PrintOverlayTransform = p.transform ?? {
            center: job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 },
            scale: 1,
            rotationDeg: 0,
            opacity: 0.5,
          };
          const merged = { ...base, ...patch };
          // Strip retired legacy fields regardless of what merged in.
          delete (merged as any).southWestLat;
          delete (merged as any).southWestLng;
          delete (merged as any).northEastLat;
          delete (merged as any).northEastLng;
          delete (merged as any).rotationDegrees;
          return { ...p, transform: merged };
        });
        pagesRef.current = next;
        return next;
      });
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
      // Mark as tombstoned so buildDoc's merge step can't resurrect it from
      // existingDoc.pages on the next save.
      deletedIdsRef.current.add(id);
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

  // Sanitizer: strip legacy rectangular-bounds fields (southWestLat/Lng,
  // northEastLat/Lng, rotationDegrees) from every transform on save. These
  // fields are the leftover from an old placement system and, if left in
  // place, silently override the canonical (center/scale/rotationDeg) or
  // anchor-based placement inside PageOverlay. Killing them at write time
  // permanently retires that parallel data track for both current and
  // pre-existing merged transforms.
  function sanitizeTransform(t: PrintOverlayTransform | null | undefined, fallbackCenter: LatLng): PrintOverlayTransform {
    const base = t ?? {
      center: fallbackCenter,
      scale: 1,
      rotationDeg: 0,
      opacity: 0.5,
    };
    return {
      center: base.center,
      scale: base.scale,
      rotationDeg: base.rotationDeg,
      opacity: base.opacity,
      ...(base.blendMode !== undefined ? { blendMode: base.blendMode } : {}),
      ...(base.isLocked !== undefined ? { isLocked: base.isLocked } : {}),
      // Deliberately omit: southWestLat/Lng, northEastLat/Lng, rotationDegrees.
    };
  }

  const buildDoc = useCallback(
    (username: string | null): PrintOverlayDoc => {
      const currentPages = pagesRef.current;
      const transforms: Record<string, PrintOverlayTransform> = {};
      const alignments: Record<string, GeoAlignment> = {};
      const defaultCenter = job.geocode ? { lat: job.geocode.lat, lng: job.geocode.lng } : { lat: 47.6062, lng: -122.3321 };
      for (const p of currentPages) {
        transforms[p.id] = sanitizeTransform(p.transform, defaultCenter);
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
        const activePageIds = new Set(currentPages.map((p) => p.id));

        const tombstoned = deletedIdsRef.current;
        if (existingDoc.pages) {
          for (const p of existingDoc.pages) {
            if (!activePageIds.has(p.id) && !tombstoned.has(p.id)) {
              mergedPages.push(p);
            }
          }
        }
        if (existingDoc.transforms) {
          for (const [key, t] of Object.entries(existingDoc.transforms)) {
            if (!activePageIds.has(key) && !tombstoned.has(key)) {
              // Also sanitize legacy fields off inactive/merged transforms so a
              // multi-source save permanently retires stale bounds everywhere,
              // not just the pages currently open in the studio.
              mergedTransforms[key] = sanitizeTransform(t, defaultCenter);
            }
          }
        }
        if (existingDoc.alignments) {
          for (const [key, a] of Object.entries(existingDoc.alignments)) {
            if (!activePageIds.has(key) && !tombstoned.has(key)) {
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
        try {
          const bc = new BroadcastChannel("nsc_jobs_channel");
          bc.postMessage("nsc:jobs-reload");
          bc.close();
        } catch {}
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
        try {
          const bc = new BroadcastChannel("nsc_jobs_channel");
          bc.postMessage("nsc:jobs-reload");
          bc.close();
        } catch {}
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
          const transform = job.printOverlay?.transforms?.[sp.id] ?? null;
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
        void putPrintDocument(documentId, bytes.slice(0));
        source.pageCount = await countPdfPages(bytes.slice(0));

        await splitPdf(
          bytes,
          (rp: RenderedPage) => {
            const vm = buildPageVM(jobId, job, source, rp, trackUrl, job.printOverlay);
            setPages((prev) => [...prev, vm].sort((a, b) => a.pageNumber - b.pageNumber));
            pagesRef.current = [...pagesRef.current, vm].sort((a, b) => a.pageNumber - b.pageNumber);

            void blobToDataUrl(rp.blob).then((dUrl) => {
              void putBlueprintImage(vm.id, dUrl);
              pagesRef.current = pagesRef.current.map((p) =>
                p.id === vm.id ? { ...p, dataUrl: dUrl } : p
              );
              setPages((prev) =>
                prev.map((p) => (p.id === vm.id ? { ...p, dataUrl: dUrl } : p))
              );
            });

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
  const savedTransform = existingDoc?.transforms?.[pageId] ?? null;
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

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(blob);
  });
}

/** Strip transient VM fields before persisting a page record. */
function stripVM(p: PageVM): PrintOverlayPage {
  let url = p.previewUrl || "";
  if (url.startsWith("blob:") || url.startsWith("data:")) {
    url = p.previewStoragePath && p.previewUrl && !p.previewUrl.startsWith("data:") && !p.previewUrl.startsWith("blob:")
      ? p.previewUrl
      : "";
  }
  return {
    id: p.id,
    jobId: p.jobId,
    documentId: p.documentId,
    pageNumber: p.pageNumber,
    label: p.label,
    status: p.status,
    pageWidth: p.pageWidth,
    pageHeight: p.pageHeight,
    previewStoragePath: p.previewStoragePath ?? null,
    previewUrl: url,
    crop: p.crop,
    cropSource: p.cropSource,
    excluded: p.excluded ?? false,
    errorMessage: p.errorMessage ?? null,
  };
}
