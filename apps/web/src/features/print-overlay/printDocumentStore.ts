/**
 * Durable local store for raw PDF source prints.
 * Caches PDF array buffers in IndexedDB so pages can be re-rendered on demand.
 */
import { getStorage, ref, getDownloadURL } from "firebase/storage";
import { app } from "../../lib/firebase.js";
import { uploadBlob } from "../../lib/storage.js";
// @ts-ignore
import pdfjsWorkerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

const DB_NAME = "nsc-gis-print-documents";
const DB_VERSION = 1;
const STORE = "documents";

export interface PrintDocumentMeta {
  id: string;
  jobId?: string;
  fileName: string;
  revisionLabel?: string;
  pageCount: number;
  byteSize: number;
  uploadedAt: string;
  cloudUrl?: string;
  supersedesId?: string;
}

interface StoredRecord {
  id: string;
  bytes: ArrayBuffer;
}

// In-memory cache for loaded PDF ArrayBuffers to eliminate IndexedDB IPC overhead
const documentMemoryCache = new Map<string, ArrayBuffer>();

let dbPromise: Promise<IDBDatabase> | null = null;

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onclose = () => { dbPromise = null; };
        db.onerror = () => { dbPromise = null; };
        resolve(db);
      };
      request.onerror = () => {
        dbPromise = null;
        reject(request.error);
      };
    });
  }
  return dbPromise;
}

export function printDocumentPath(uid: string, documentId: string): string {
  return `users/${uid}/prints/${documentId}.pdf`;
}

export async function putPrintDocument(id: string, bytes: ArrayBuffer): Promise<void> {
  documentMemoryCache.set(id, bytes);
  try {
    const db = await getDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ id, bytes } satisfies StoredRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[NSC] Could not cache the source print locally.", err);
  }
}

export async function getPrintDocument(id: string): Promise<ArrayBuffer | null> {
  if (documentMemoryCache.has(id)) {
    return documentMemoryCache.get(id)!;
  }
  try {
    const db = await getDb();
    const record = await new Promise<StoredRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result as StoredRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (record?.bytes) {
      documentMemoryCache.set(id, record.bytes);
    }
    return record?.bytes ?? null;
  } catch {
    return null;
  }
}

export async function deletePrintDocument(id: string): Promise<void> {
  documentMemoryCache.delete(id);
  try {
    const db = await getDb();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // harmless
  }
}

export async function backupPrintDocument(
  uid: string,
  id: string,
  bytes: ArrayBuffer
): Promise<string | null> {
  try {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const storagePath = printDocumentPath(uid, id);
    const result = await uploadBlob(storagePath, blob, "application/pdf");
    return result.downloadUrl;
  } catch (err) {
    console.warn("[NSC] Could not backup print PDF to storage", err);
    return null;
  }
}

export async function restorePrintDocument(
  meta: PrintDocumentMeta
): Promise<ArrayBuffer | null> {
  if (!meta.cloudUrl) return null;
  try {
    const response = await fetch(meta.cloudUrl);
    if (!response.ok) return null;
    const bytes = await response.arrayBuffer();
    await putPrintDocument(meta.id, bytes);
    return bytes;
  } catch (err) {
    console.warn("[NSC] Could not restore print PDF", err);
    return null;
  }
}

export async function resolvePrintDocument(
  meta: PrintDocumentMeta
): Promise<ArrayBuffer | null> {
  const local = await getPrintDocument(meta.id);
  if (local) return local;
  return restorePrintDocument(meta);
}

export async function renderPagesFromDocument(
  bytes: ArrayBuffer,
  pageNumbers: number[],
  scale = 2.0
): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (pageNumbers.length === 0) return out;

  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;

    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > pdf.numPages) continue;

      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context) continue;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: context, viewport, canvas } as any).promise;
      out.set(pageNumber, canvas.toDataURL("image/png"));
    }
  } catch (err) {
    console.warn("[NSC] Could not re-render pages from the source print.", err);
  }

  return out;
}

export async function readPageCount(bytes: ArrayBuffer): Promise<number> {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;
    const pdf = await pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
    return pdf.numPages;
  } catch {
    return 0;
  }
}
