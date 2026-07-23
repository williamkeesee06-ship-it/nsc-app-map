// Stage 2 — PDF page splitting + rasterization.
//
// Uses the repo's existing pdfjs-dist (v3) with a LOCALLY BUNDLED worker (no
// CDN dependency) so it is production-suitable under the Vite toolchain. Pages
// render on offscreen canvases with bounded concurrency and cooperative
// cancellation so large multi-sheet prints never freeze the UI. Each page
// yields a PNG Blob (uploaded to Storage by the caller) plus the detected
// drawing-content bounds used to seed the Stage 3 crop suggestion.
import type { ContentBounds } from "@nsc/types";
import type * as pdfjsLib from "pdfjs-dist";

let workerReady = false;
let pdfjsInstance: any = null;

async function ensureWorker(): Promise<void> {
  if (workerReady) return;
  if (!pdfjsInstance) {
    pdfjsInstance = await import("pdfjs-dist");
    const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.js?url")).default;
    pdfjsInstance.GlobalWorkerOptions.workerSrc = workerUrl;
  }
  workerReady = true;
}

/** Cap the rasterized preview's longest edge so memory stays bounded. */
const MAX_PREVIEW_EDGE_PX = 2000;
/** How many pages render simultaneously (canvas work is main-thread heavy). */
const RENDER_CONCURRENCY = 2;
/** Pixel stride for the content-bounds scan (perf vs. precision tradeoff). */
const SCAN_STRIDE = 4;
/** A pixel darker than this on any channel counts as "drawing content". */
const CONTENT_THRESHOLD = 240;

export class CancelledError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "CancelledError";
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

export interface RenderedPage {
  pageNumber: number;
  /** Intrinsic PDF page size in CSS points (viewport at scale 1). */
  pageWidth: number;
  pageHeight: number;
  /** Rasterized preview dimensions (px). */
  rasterWidth: number;
  rasterHeight: number;
  blob: Blob;
  /** Pixel bbox of detected content within the raster (for crop suggestion). */
  contentBounds: ContentBounds;
}

export interface SplitProgress {
  done: number;
  total: number;
  pageNumber: number;
}

/** Scan the rendered canvas for the bounding box of non-white (drawing) pixels. */
function scanContentBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number
): ContentBounds {
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < height; y += SCAN_STRIDE) {
    for (let x = 0; x < width; x += SCAN_STRIDE) {
      const i = (y * width + x) * 4;
      const alpha = data[i + 3];
      if (alpha === 0) continue; // transparent → treat as blank
      if (
        data[i] < CONTENT_THRESHOLD ||
        data[i + 1] < CONTENT_THRESHOLD ||
        data[i + 2] < CONTENT_THRESHOLD
      ) {
        found = true;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { minX: 0, minY: 0, maxX: width, maxY: height };
  return { minX, minY, maxX, maxY };
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob returned null"))),
      "image/png"
    );
  });
}

async function renderOnePage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  signal?: AbortSignal
): Promise<RenderedPage> {
  throwIfAborted(signal);
  const page = await pdf.getPage(pageNumber);
  try {
    const base = page.getViewport({ scale: 1 });
    const longestEdge = Math.max(base.width, base.height);
    const scale = Math.min(2, MAX_PREVIEW_EDGE_PX / longestEdge);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Could not acquire 2D canvas context");
    // White backdrop so transparent PDFs scan as blank, not black.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const task = page.render({ canvasContext: ctx, viewport });
    if (signal) {
      signal.addEventListener("abort", () => task.cancel(), { once: true });
    }
    await task.promise;
    throwIfAborted(signal);

    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const contentBounds = scanContentBounds(imgData.data, canvas.width, canvas.height);
    const blob = await canvasToBlob(canvas);

    // Free canvas memory promptly (large prints accumulate fast).
    canvas.width = 0;
    canvas.height = 0;

    return {
      pageNumber,
      pageWidth: base.width,
      pageHeight: base.height,
      rasterWidth: imgData.width,
      rasterHeight: imgData.height,
      blob,
      contentBounds,
    };
  } finally {
    page.cleanup();
  }
}

/**
 * Split a PDF into per-page rasters, invoking `onPage` as each finishes so the
 * UI can stream thumbnails. Bounded concurrency keeps the main thread
 * responsive; `signal` cancels remaining work and destroys the document.
 */
export async function splitPdf(
  data: ArrayBuffer,
  onPage: (page: RenderedPage) => void,
  opts: { signal?: AbortSignal; onProgress?: (p: SplitProgress) => void } = {}
): Promise<number> {
  await ensureWorker();
  const { signal, onProgress } = opts;
  throwIfAborted(signal);

  const loadingTask = pdfjsInstance.getDocument({ data });
  const pdf = await loadingTask.promise;
  try {
    const total = pdf.numPages;
    let done = 0;
    let next = 1;

    async function worker(): Promise<void> {
      for (;;) {
        throwIfAborted(signal);
        const pageNumber = next++;
        if (pageNumber > total) return;
        const rendered = await renderOnePage(pdf, pageNumber, signal);
        onPage(rendered);
        done += 1;
        onProgress?.({ done, total, pageNumber });
      }
    }

    const workers = Array.from(
      { length: Math.min(RENDER_CONCURRENCY, total) },
      () => worker()
    );
    await Promise.all(workers);
    return total;
  } finally {
    await pdf.destroy();
  }
}

/** Read the page count without rasterizing (used for source metadata). */
export async function countPdfPages(data: ArrayBuffer): Promise<number> {
  await ensureWorker();
  const pdf = await pdfjsInstance.getDocument({ data }).promise;
  try {
    return pdf.numPages;
  } finally {
    await pdf.destroy();
  }
}
