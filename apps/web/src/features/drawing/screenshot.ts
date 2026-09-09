// screenshot.ts — full-screen capture of the entire app (topbar, map, overlays,
// drawings, UI chrome) saved as a JPEG. Uses html2canvas against document.body
// so what you see on screen is literally what you get in the file.
//
// `map` and `objects` are accepted for API compatibility but are no longer used
// — the live DOM is what we capture.

import type { DrawingObject } from "@nsc/types";

export async function downloadScreenshot(
  _map: google.maps.Map,
  _objects: DrawingObject[]
): Promise<void> {
  try {
    const target = document.body;
    const html2canvas = (await import("html2canvas")).default;
    const canvas = await html2canvas(target, {
      useCORS: true,
      allowTaint: false,
      backgroundColor: "#0b0f13",
      logging: false,
      // Capture at the device-pixel resolution for crisp output.
      scale: Math.min(window.devicePixelRatio || 1, 2),
      // Skip absolutely-positioned scroll bars / fixed overlays we don't want.
      ignoreElements: (el) => el.classList?.contains("no-screenshot") ?? false,
    });

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          alert("Screenshot failed: could not create image.");
          return;
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `nsc-map-${Date.now()}.jpg`;
        a.click();
        URL.revokeObjectURL(url);
      },
      "image/jpeg",
      0.92
    );
  } catch (err) {
    console.error("[Screenshot] capture failed:", err);
    alert(`Screenshot failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
