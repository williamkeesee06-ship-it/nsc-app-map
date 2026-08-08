/**
 * Durable local store for print overlay artwork.
 * Caches blueprint images locally in IndexedDB to avoid Firestore document limits.
 */
import { getStorage, ref, getDownloadURL } from "firebase/storage";
import { app } from "../../lib/firebase.js";
import { uploadBlob } from "../../lib/storage.js";

const DB_NAME = "nsc-gis-blueprint-images";
const DB_VERSION = 1;
const STORE = "images";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function backupBlueprintImage(
  uid: string,
  id: string,
  dataUrl: string
): Promise<string | null> {
  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const storagePath = `users/${uid}/blueprints/${id}`;
    const result = await uploadBlob(storagePath, blob, "image/png");
    return result.downloadUrl;
  } catch (err) {
    console.warn("[NSC] Could not backup blueprint image to storage", err);
    return null;
  }
}

export async function restoreBlueprintImages(
  uid: string,
  ids: string[]
): Promise<Map<string, string>> {
  const recovered = new Map<string, string>();
  if (ids.length === 0) return recovered;

  const storage = getStorage(app);
  const CONCURRENCY = 2;
  let cursor = 0;

  async function worker() {
    while (cursor < ids.length) {
      const id = ids[cursor];
      cursor += 1;
      try {
        const storagePath = `users/${uid}/blueprints/${id}`;
        const url = await getDownloadURL(ref(storage, storagePath));
        const response = await fetch(url);
        if (!response.ok) continue;
        const blob = await response.blob();
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        await putBlueprintImage(id, dataUri);
        recovered.set(id, dataUri);
      } catch (err) {
        console.warn(`[NSC] Could not restore blueprint image ${id}`, err);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return recovered;
}

export async function putBlueprintImage(id: string, dataUrl: string): Promise<void> {
  if (!id || !dataUrl) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(dataUrl, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn("Could not persist blueprint image", id, err);
  }
}

export async function getAllBlueprintImages(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const store = tx.objectStore(STORE);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();

      tx.oncomplete = () => {
        const keys = keysReq.result as string[];
        const vals = valsReq.result as string[];
        keys.forEach((k, i) => {
          if (typeof vals[i] === "string" && vals[i]) out.set(String(k), vals[i]);
        });
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn("Could not read blueprint images", err);
  }
  return out;
}

export async function deleteBlueprintImage(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    console.warn("Could not delete blueprint image", id, err);
  }
}
