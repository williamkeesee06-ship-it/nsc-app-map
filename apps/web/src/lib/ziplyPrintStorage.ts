import { getDownloadURL, getStorage, ref, uploadBytesResumable } from "firebase/storage";
import { app } from "./firebase.js";

export interface UploadedZiplyPrint {
  storagePath: string;
  downloadUrl: string;
  contentType: string;
  name: string;
  size: number;
  storageBucket?: string;
}

function sanitizePathSegment(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "file";
}

export function uploadZiplyPrint(
  jobId: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<UploadedZiplyPrint> {
  const storage = getStorage(app);
  const safeJobId = sanitizePathSegment(jobId);
  const safeName = sanitizePathSegment(file.name);
  const storagePath = `ziply-prints/${safeJobId}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;
  const storageRef = ref(storage, storagePath);
  const contentType = file.type || "application/octet-stream";
  const task = uploadBytesResumable(storageRef, file, { contentType });

  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snapshot) => {
        if (snapshot.totalBytes > 0) {
          onProgress?.((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
        }
      },
      reject,
      async () => {
        try {
          const downloadUrl = await getDownloadURL(task.snapshot.ref);
          onProgress?.(100);
          const uploaded: UploadedZiplyPrint = {
            storagePath,
            downloadUrl,
            contentType,
            name: file.name,
            size: file.size,
          };
          if (storage.app.options.storageBucket) {
            uploaded.storageBucket = storage.app.options.storageBucket;
          }
          resolve(uploaded);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}
