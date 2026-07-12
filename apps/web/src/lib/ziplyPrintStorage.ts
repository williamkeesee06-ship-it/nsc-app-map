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

const INITIAL_PROGRESS_TIMEOUT_MS = 3 * 60_000;
const STALLED_PROGRESS_TIMEOUT_MS = 3 * 60_000;
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
  // Prefer the real app login (Email/Password). Only fall back to anonymous
  // if somehow no session exists (should not happen while the app is locked).
  if (auth.currentUser && !auth.currentUser.isAnonymous) {
    console.info("[ziply-print-upload] Using signed-in Firebase user for Storage", {
      uid: auth.currentUser.uid,
    });
    return;
  }
  if (auth.currentUser) {
    console.info("[ziply-print-upload] Firebase Auth already available for Storage upload", {
      uid: auth.currentUser.uid,
      isAnonymous: auth.currentUser.isAnonymous,
    });
    return;
  }

  try {
    const credential = await signInAnonymously(auth);
    console.info("[ziply-print-upload] Signed in anonymously for Storage upload", {
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

/**
 * Upload a Ziply engineering print or permit PDF/image to Firebase Storage.
 * Permits use the same `ziply-prints/` prefix so existing Storage rules apply
 * without a separate rule deploy (path: .../permits/...).
 */
export async function uploadZiplyPrint(
  jobId: string,
  file: File,
  onProgress?: (percent: number) => void,
  opts?: { kind?: "print" | "permit" }
): Promise<UploadedZiplyPrint> {
  const storageBucket = getConfiguredStorageBucket();
  await ensureFirebaseStorageAuth();

  const storage = getStorage(app);
  const safeJobId = sanitizePathSegment(jobId);
  const safeName = sanitizePathSegment(file.name);
  const sub =
    opts?.kind === "permit"
      ? `ziply-prints/${safeJobId}/permits/${Date.now()}-${crypto.randomUUID()}-${safeName}`
      : `ziply-prints/${safeJobId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const storagePath = sub;
  const storageRef = ref(storage, storagePath);
  const contentType = file.type || "application/octet-stream";
  console.info("[ziply-print-upload] Creating Firebase Storage upload task", {
    storageBucket,
    storagePath,
    fileName: file.name,
    size: file.size,
    contentType,
  });

  const task = uploadBytesResumable(storageRef, file, { contentType });

  console.info("[ziply-print-upload] Firebase Storage upload task created", {
    storageBucket,
    storagePath,
    fileName: file.name,
    size: file.size,
    contentType,
  });

  onProgress?.(0);

  return new Promise((resolve, reject) => {
    const uploadStartedAt = Date.now();
    let settled = false;
    let lastBytesTransferred = 0;
    let lastProgressAt = uploadStartedAt;
    let sawProgressEvent = false;
    let sawPositiveBytes = false;
    let lastSnapshotState: UploadTaskSnapshot["state"] | undefined;
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
        if (settled) return;

        const now = Date.now();
        const elapsedSinceStartMs = now - uploadStartedAt;
        const elapsedSinceProgressMs = now - lastProgressAt;
        const reason = new Error(
          lastBytesTransferred === 0
            ? `Ziply print upload did not transfer any bytes after ${Math.round(
                elapsedSinceStartMs / 1000
              )} seconds. The upload request may still be initializing, blocked, or unable to reach Firebase Storage; check the browser Network tab for the Firebase request status.`
            : `Ziply print upload stopped making progress for ${Math.round(
                elapsedSinceProgressMs / 1000
              )} seconds before it completed.`
        );

        console.error("[ziply-print-upload] Firebase Storage upload watchdog timed out", {
          storageBucket,
          storagePath,
          lastBytesTransferred,
          fileSize: file.size,
          sawProgressEvent,
          sawPositiveBytes,
          lastSnapshotState,
          elapsedSinceStartMs,
          elapsedSinceProgressMs,
          timeoutMs,
        });

        fail(reason);
        task.cancel();
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
        const previousBytesTransferred = lastBytesTransferred;
        const totalBytes = snapshot.totalBytes || file.size;
        const percent = totalBytes > 0 ? (snapshot.bytesTransferred / totalBytes) * 100 : 0;
        const isFirstProgressEvent = !sawProgressEvent;
        const madeProgress = snapshot.bytesTransferred > previousBytesTransferred;

        sawProgressEvent = true;
        lastSnapshotState = snapshot.state;
        lastBytesTransferred = snapshot.bytesTransferred;

        if (snapshot.bytesTransferred > 0) {
          sawPositiveBytes = true;
        }

        if (madeProgress || isFirstProgressEvent) {
          lastProgressAt = Date.now();
        }

        if (isFirstProgressEvent) {
          console.info("[ziply-print-upload] First Firebase Storage progress event received", {
            storageBucket,
            storagePath,
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes,
            state: snapshot.state,
            elapsedSinceStartMs: lastProgressAt - uploadStartedAt,
          });
        } else if (madeProgress) {
          console.debug("[ziply-print-upload] Firebase Storage upload progress", {
            storageBucket,
            storagePath,
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes,
            percent: Math.round(percent),
            state: snapshot.state,
          });
        }

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
