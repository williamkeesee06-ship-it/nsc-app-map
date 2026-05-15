// screenshot.ts — composites a Static Maps base with SVG drawing overlay
// then triggers a PNG download.
//
// Approach:
//   1. Fetch current map center + zoom from the google.maps.Map instance
//   2. Request a Static Maps image (1280x800) from Google's API
//   3. Draw it onto a hidden <canvas>
//   4. Overlay the drawing SVG (rendered as an SVGElement) on top via canvas.drawImage
//   5. canvas.toBlob → trigger download

import type { DrawingObject } from "@nsc/types";

const W = 1280;
const H = 800;

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

export async function downloadScreenshot(
  map: google.maps.Map,
  objects: DrawingObject[]
): Promise<void> {
  if (!API_KEY) {
    console.error("[Screenshot] VITE_GOOGLE_MAPS_API_KEY not set");
    alert("Screenshot failed: Google Maps API key missing.");
    return;
  }

  const center = map.getCenter();
  const zoom = map.getZoom();

  if (!center || zoom == null) {
    alert("Map is not ready yet.");
    return;
  }

  const lat = center.lat();
  const lng = center.lng();

  const staticUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${lat},${lng}` +
    `&zoom=${zoom}` +
    `&size=${W}x${H}` +
    `&maptype=roadmap` +
    `&style=element:geometry%7Ccolor:0x0b0f13` +
    `&style=element:labels.text.fill%7Ccolor:0x8a95a3` +
    `&style=element:labels.text.stroke%7Ccolor:0x0b0f13` +
    `&style=feature:road%7Celement:geometry%7Ccolor:0x1a212a` +
    `&style=feature:water%7Celement:geometry%7Ccolor:0x111827` +
    `&key=${API_KEY}`;

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    alert("Screenshot failed: canvas context unavailable.");
    return;
  }

  // Fetch Static Maps image via a proxy-friendly approach
  try {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Static Maps image failed to load. Ensure the Static Maps API is enabled for your key."));
      img.src = staticUrl;
    });
    ctx.drawImage(img, 0, 0, W, H);
  } catch (err) {
    console.error("[Screenshot] Static Maps load error:", err);
    // Fall back to a dark background
    ctx.fillStyle = "#0b0f13";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#8a95a3";
    ctx.font = "14px monospace";
    ctx.fillText("Static Maps unavailable — drawings only", 20, 30);
  }

  // Draw overlay objects if any exist
  if (objects.length > 0) {
    // Convert lat/lng to pixel using the map's projection
    const proj = map.getProjection();
    const bounds = map.getBounds();
    if (proj && bounds) {
      const ne = bounds.getNorthEast();
      const sw = bounds.getSouthWest();
      const scale = Math.pow(2, zoom);

      function toPixel(lat: number, lng: number): { x: number; y: number } {
        const worldPt = proj!.fromLatLngToPoint(new google.maps.LatLng(lat, lng))!;
        const nePt = proj!.fromLatLngToPoint(ne)!;
        const swPt = proj!.fromLatLngToPoint(sw)!;
        const width = (nePt.x - swPt.x) * scale;
        const height = (swPt.y - nePt.y) * scale;
        const x = ((worldPt.x - swPt.x) * scale / width) * W;
        const y = ((worldPt.y - nePt.y) * scale / height) * H;
        return { x, y };
      }

      objects.forEach((obj) => {
        ctx.save();
        ctx.globalAlpha = obj.style.opacity;
        ctx.strokeStyle = obj.style.strokeColor;
        ctx.lineWidth = obj.style.strokeWidth;
        if (obj.style.strokeStyle === "dashed") {
          ctx.setLineDash([8, 4]);
        }

        if ("vertices" in obj && obj.vertices.length > 0) {
          ctx.beginPath();
          const pts = obj.vertices.map((v) => toPixel(v.lat, v.lng));
          ctx.moveTo(pts[0]!.x, pts[0]!.y);
          pts.slice(1).forEach((p) => ctx.lineTo(p.x, p.y));
          if (obj.tool === "polygon") ctx.closePath();
          ctx.stroke();
        }

        if ("bounds" in obj) {
          const nw = toPixel(obj.bounds.n, obj.bounds.w);
          const se = toPixel(obj.bounds.s, obj.bounds.e);
          ctx.beginPath();
          ctx.rect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
          ctx.stroke();
        }

        if ("position" in obj && "text" in obj) {
          const { x, y } = toPixel(obj.position.lat, obj.position.lng);
          ctx.fillStyle = obj.style.strokeColor;
          ctx.font = `bold 14px ui-monospace, monospace`;
          ctx.fillText(obj.text, x, y);
        }

        ctx.restore();
      });
    }
  }

  // Watermark
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.font = "11px monospace";
  ctx.fillText(`NSC APP MAP · ${new Date().toLocaleString()} · zoom ${zoom}`, 10, H - 10);

  // Trigger download
  canvas.toBlob((blob) => {
    if (!blob) { alert("Screenshot failed: could not create image."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `nsc-map-${Date.now()}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, "image/png");
}
