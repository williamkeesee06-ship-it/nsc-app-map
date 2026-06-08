// MarkupPhotosPopup — small floating panel that opens when the user
// right-clicks a markup (pole, MH, splice, etc.). Lets them:
//   - Take a photo from the camera
//   - Pick a photo from disk
//   - View existing photos for this markup
//   - Delete a photo
//
// Photos are downscaled client-side to max 1200px wide / ~150KB JPEG before
// upload so they fit comfortably within Firestore document limits.
//
// Billy 6/8.

import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api.js";

interface Photo {
  id: string;
  objectId: string;
  dataUrl: string;
  takenAt: number;
  takenBy: string;
}

interface Props {
  jobId: string;
  objectId: string;
  /** Display label for the markup (e.g. pole's ATAG). */
  markupLabel?: string;
  /** Logged-in user name for the takenBy field. */
  takenBy: string;
  /** Screen position to anchor the popup. */
  x: number;
  y: number;
  onClose: () => void;
}

const MAX_DIMENSION = 1200;
const JPEG_QUALITY = 0.7;

async function fileToCompressedDataUrl(file: File): Promise<string> {
  const reader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("image load failed"));
    img.src = dataUrl;
  });

  let { width, height } = img;
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height);
    width = Math.round(width * ratio);
    height = Math.round(height * ratio);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d unavailable");
  ctx.drawImage(img, 0, 0, width, height);

  // Try progressively lower quality if needed
  let quality = JPEG_QUALITY;
  let out = canvas.toDataURL("image/jpeg", quality);
  while (out.length > 180_000 && quality > 0.3) {
    quality -= 0.1;
    out = canvas.toDataURL("image/jpeg", quality);
  }
  return out;
}

export default function MarkupPhotosPopup({
  jobId,
  objectId,
  markupLabel,
  takenBy,
  x,
  y,
  onClose,
}: Props) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoomed, setZoomed] = useState<Photo | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current) return;
      if (zoomed) return; // zoomed lightbox handles its own dismiss
      if (!rootRef.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (zoomed) setZoomed(null);
        else onClose();
      }
    }
    const t = setTimeout(() => document.addEventListener("mousedown", onDocClick), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose, zoomed]);

  // Load photos
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const r = await api.listPhotos(jobId);
        if (cancelled) return;
        const mine = r.photos.filter((p) => p.objectId === objectId);
        mine.sort((a, b) => b.takenAt - a.takenAt);
        setPhotos(mine);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId, objectId]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToCompressedDataUrl(file);
        const saved = await api.addPhoto(jobId, { objectId, dataUrl, takenBy });
        setPhotos((prev) => [saved, ...prev]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function deletePhoto(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    try {
      await api.deletePhoto(jobId, photoId);
      setPhotos((prev) => prev.filter((p) => p.id !== photoId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed");
    }
  }

  const W = 320;
  const H = 420;
  const left = Math.max(8, Math.min(window.innerWidth - W - 8, x + 12));
  const top = Math.max(8, Math.min(window.innerHeight - H - 8, y + 12));

  return (
    <>
      <div
        ref={rootRef}
        style={{
          position: "fixed",
          left,
          top,
          width: W,
          maxHeight: H,
          zIndex: 9999,
          background: "#0b1220",
          color: "#f4f8ff",
          border: "1px solid #1f2a44",
          borderRadius: 10,
          boxShadow: "0 16px 40px rgba(0,0,0,0.5)",
          padding: 12,
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 12,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <strong style={{ fontSize: 12, letterSpacing: 0.5 }}>
            PHOTOS {markupLabel ? `· ${markupLabel}` : ""}
          </strong>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", color: "#9aa4b2", border: "none", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}
          >
            ×
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <button
            type="button"
            onClick={() => cameraInputRef.current?.click()}
            disabled={uploading}
            style={{
              flex: 1,
              background: "#00e5ff",
              color: "#0a0f1c",
              border: "none",
              borderRadius: 6,
              padding: "6px 10px",
              fontWeight: 700,
              cursor: uploading ? "wait" : "pointer",
              fontSize: 12,
            }}
          >
            📷 Camera
          </button>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            style={{
              flex: 1,
              background: "transparent",
              color: "#cbd5e1",
              border: "1px solid #1f2a44",
              borderRadius: 6,
              padding: "6px 10px",
              cursor: uploading ? "wait" : "pointer",
              fontSize: 12,
            }}
          >
            Upload
          </button>
        </div>

        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = "";
          }}
        />

        {error && (
          <div style={{ color: "#ff6b7a", fontSize: 11, marginBottom: 6 }}>{error}</div>
        )}
        {uploading && (
          <div style={{ color: "#00e5ff", fontSize: 11, marginBottom: 6 }}>Uploading…</div>
        )}

        <div style={{ flex: 1, overflowY: "auto", borderTop: "1px solid #1f2a44", paddingTop: 8 }}>
          {loading && <div style={{ color: "#9aa4b2", fontSize: 11 }}>Loading…</div>}
          {!loading && photos.length === 0 && (
            <div style={{ color: "#9aa4b2", fontSize: 11, textAlign: "center", padding: "16px 0" }}>
              No photos yet. Tap Camera to add one.
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
            {photos.map((p) => (
              <div key={p.id} style={{ position: "relative", aspectRatio: "1 / 1", overflow: "hidden", borderRadius: 4, border: "1px solid #1f2a44" }}>
                <img
                  src={p.dataUrl}
                  alt=""
                  onClick={() => setZoomed(p)}
                  style={{ width: "100%", height: "100%", objectFit: "cover", cursor: "zoom-in" }}
                />
                <button
                  type="button"
                  onClick={() => deletePhoto(p.id)}
                  title="Delete"
                  style={{
                    position: "absolute",
                    top: 2,
                    right: 2,
                    background: "rgba(0,0,0,0.7)",
                    color: "#ff6b7a",
                    border: "none",
                    borderRadius: 3,
                    width: 18,
                    height: 18,
                    cursor: "pointer",
                    fontSize: 12,
                    lineHeight: 1,
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Lightbox */}
      {zoomed && (
        <div
          onClick={() => setZoomed(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.9)",
            zIndex: 10000,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "zoom-out",
          }}
        >
          <img
            src={zoomed.dataUrl}
            alt=""
            style={{ maxWidth: "95vw", maxHeight: "95vh", objectFit: "contain" }}
          />
        </div>
      )}
    </>
  );
}
