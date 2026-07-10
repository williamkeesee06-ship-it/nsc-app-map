import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getDownloadURL,
  getStorage,
  ref,
  type StorageError,
  type UploadTaskSnapshot,
  uploadBytesResumable,
} from "firebase/storage";
import { app } from "./firebase.js";

export interface UploadedZiplyPrint {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  name: string;
  size: number;
  storageBucket?: string;
}

const INITIAL_PROGRESS_TIMEOUT_MS = 45_000;
const STALLED_PROGRESS_TIMEOUT_MS = 90_000;
const MAX_UPLOAD_TIMEOUT_MS = 10 * 60_000;

function sanitizePathSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

function formatUploadError(err: unknown): Error {
  const code = typeof (err as { code?: unknown })?.code === "string" ? (err as { code: string }).code : "";
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "Unknown upload error";

  if (code === "storage/unauthorized") {
    return new Error(
      "Firebase Storage rejected the Ziply print upload. Confirm the signed-in Firebase user is allowed to create ziply-prints files in Storage rules."
    );
  }

  if (code === "storage/canceled") {
    return new Error("Ziply print upload was canceled because it stopped making progress. Please try again.");
  }

  if (code === "auth/operation-not-allowed") {
    return new Error(
      "Firebase anonymous authentication is not enabled, so the browser cannot authenticate to Storage. Enable Anonymous sign-in in Firebase Auth or adjust Storage rules."
    );
  }

  if (code) return new Error(`${message} (${code})`);
  return new Error(message);
}

async function ensureFirebaseStorageAuth(): Promise<void> {
  const auth = getAuth(app);
  if (auth.currentUser) return;

  try {
    const credential = await signInAnonymously(auth);
    console.info("[ziply-print-upload] Signed in to Firebase Auth for Storage upload", {
      uid: credential.user.uid,
      isAnonymous: credential.user.isAnonymous,
    });
  } catch (err) {
    console.error("[ziply-print-upload] Firebase Auth sign-in failed", err);
    throw formatUploadError(err);
  }
}

function getConfiguredStorageBucket(): string {
  const bucket = app.options.storageBucket;
  if (typeof bucket !== "string" || bucket.trim().length === 0) {
    throw new Error(
      "Firebase Storage bucket is not configured. Set VITE_FIREBASE_STORAGE_BUCKET in the web app environment."
    );
  }
  return bucket;
}

export async function uploadZiplyPrint(
  jobId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadedZiplyPrint> {
  const storageBucket = getConfiguredStorageBucket();
  await ensureFirebaseStorageAuth();

  const storage = getStorage(app);
  const safeJobId = sanitizePathSegment(jobId);
  const safeName = sanitizePathSegment(file.name);
  const storagePath = `ziply-prints/${safeJobId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const storageRef = ref(storage, storagePath);
  const contentType = file.type || "application/octet-stream";
  const task = uploadBytesResumable(storageRef, file, { contentType });

  console.info("[ziply-print-upload] Starting Firebase Storage upload", {
    storageBucket,
    storagePath,
    fileName: file.name,
    size: file.size,
    contentType,
  });

  onProgress?.(0);

  return new Promise((resolve, reject) => {
    let settled = false;
    let lastBytesTransferred = 0;
    let stallTimer: ReturnType<typeof window.setTimeout> | undefined;
    let maxTimer: ReturnType<typeof window.setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;

    const clearTimers = () => {
      if (stallTimer) window.clearTimeout(stallTimer);
      if (maxTimer) window.clearTimeout(maxTimer);
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      clearTimers();
      try {
        unsubscribe?.();
      } catch {
        // Ignore listener cleanup failures.
      }
      const uploadError = formatUploadError(err);
      console.error("[ziply-print-upload] Firebase Storage upload failed", {
        storageBucket,
        storagePath,
        error: uploadError,
        originalError: err,
      });
      reject(uploadError);
    };

    const resetStallTimer = (timeoutMs: number) => {
      if (stallTimer) window.clearTimeout(stallTimer);
      stallTimer = window.setTimeout(() => {
        const reason = new Error(
          lastBytesTransferred === 0
            ? "Ziply print upload did not start transferring data. Check Firebase Storage CORS, bucket configuration, and Storage rules."
            : "Ziply print upload stopped making progress before it completed."
        );
        task.cancel();
        fail(reason);
      }, timeoutMs);
    };

    resetStallTimer(INITIAL_PROGRESS_TIMEOUT_MS);
    maxTimer = window.setTimeout(() => {
      task.cancel();
      fail(new Error("Ziply print upload timed out before Firebase Storage reported completion."));
    }, MAX_UPLOAD_TIMEOUT_MS);

    unsubscribe = task.on(
      "state_changed",
      (snapshot: UploadTaskSnapshot) => {
        const totalBytes = snapshot.totalBytes || file.size;
        const percent = totalBytes > 0 ? (snapshot.bytesTransferred / totalBytes) * 100 : 0;
        lastBytesTransferred = snapshot.bytesTransferred;
        onProgress?.(Math.max(0, Math.min(100, percent)));
        resetStallTimer(snapshot.bytesTransferred > 0 ? STALLED_PROGRESS_TIMEOUT_MS : INITIAL_PROGRESS_TIMEOUT_MS);
      },
      (err: StorageError) => {
        fail(err);
      },
      () => {
        void (async () => {
          try {
            const finalSnapshot = task.snapshot;
            const downloadUrl = await getDownloadURL(finalSnapshot.ref);
            if (settled) return;
            settled = true;
            clearTimers();
            onProgress?.(100);
            console.info("[ziply-print-upload] Firebase Storage upload complete", {
              storageBucket,
              storagePath,
              bytesTransferred: finalSnapshot.bytesTransferred,
              totalBytes: finalSnapshot.totalBytes,
            });
            resolve({
              storagePath,
              downloadUrl,
              contentType,
              name: file.name,
              size: file.size,
              storageBucket,
            });
          } catch (err) {
            fail(err);
          }
        })();
      }
    );
  });
}
