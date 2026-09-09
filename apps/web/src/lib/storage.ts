// Browser-side Firebase Storage helpers for Print Overlay binaries.
//
// Original PDFs and rendered page-preview PNGs are uploaded directly to
// Firebase Storage (object storage) so we never persist giant base64 blobs in
// Firestore. Only Storage paths + download URLs are saved in the overlay doc.
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  uploadBytesResumable,
  getDownloadURL,
  type UploadMetadata,
} from "firebase/storage";
import { app } from "./firebase.js";

const storage = getStorage(app);

export interface UploadResult {
  storagePath: string;
  downloadUrl: string;
  contentType: string | null;
  size: number;
}

/** Sanitize an arbitrary file/segment name into a Storage-safe token. */
export function sanitizeStorageSegment(name: string): string {
  return (name || "file")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 120) || "file";
}

/**
 * Upload a Blob/File to Storage with progress + cancellation. Returns the
 * Storage path and a resolved download URL. The returned `cancel()` aborts the
 * transfer; awaiting the promise after cancel rejects with a "canceled" error.
 */
export function uploadToStorage(
  path: string,
  data: Blob,
  opts: {
    contentType?: string;
    onProgress?: (fraction: number) => void;
    signal?: AbortSignal;
  } = {}
): Promise<UploadResult> {
  const metadata: UploadMetadata | undefined = opts.contentType
    ? { contentType: opts.contentType }
    : undefined;
  const task = uploadBytesResumable(storageRef(storage, path), data, metadata);

  const onAbort = () => task.cancel();
  if (opts.signal) {
    if (opts.signal.aborted) task.cancel();
    else opts.signal.addEventListener("abort", onAbort, { once: true });
  }

  return new Promise<UploadResult>((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        if (opts.onProgress && snap.totalBytes > 0) {
          opts.onProgress(snap.bytesTransferred / snap.totalBytes);
        }
      },
      (err) => {
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        reject(err);
      },
      async () => {
        if (opts.signal) opts.signal.removeEventListener("abort", onAbort);
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          resolve({
            storagePath: path,
            downloadUrl,
            contentType: task.snapshot.metadata.contentType ?? opts.contentType ?? null,
            size: task.snapshot.metadata.size ?? data.size,
          });
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

/** One-shot upload without progress (small blobs). */
export async function uploadBlob(
  path: string,
  data: Blob,
  contentType?: string
): Promise<UploadResult> {
  const snap = await uploadBytes(
    storageRef(storage, path),
    data,
    contentType ? { contentType } : undefined
  );
  const downloadUrl = await getDownloadURL(snap.ref);
  return {
    storagePath: path,
    downloadUrl,
    contentType: snap.metadata.contentType ?? contentType ?? null,
    size: snap.metadata.size ?? data.size,
  };
}

/** Resolve a fresh download URL for a previously-stored object path. */
export function resolveDownloadUrl(path: string): Promise<string> {
  return getDownloadURL(storageRef(storage, path));
}
