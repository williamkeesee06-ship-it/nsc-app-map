// Renders the translucent page copy onto the REAL Google Map (Stage 4/5).
//
// A google.maps.OverlayView drives placement: on every map draw we project the
// page's geo-corners (derived from a GeoSolution) to div pixels and apply the
// resulting affine matrix to a portal container element created imperatively.
// Because placement is geographic, the sheet tracks the map correctly across
// pan/zoom without DOM stealing or React reconciliation strobing.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { pageToLatLng, type CropRect, type GeoSolution, type LatLng, type PagePoint } from "@nsc/types";

export type OverlayMode = "move" | "pickPage" | "idle";

export interface AnchorDot {
  key: string;
  kind: "a" | "b" | "c";
  label: string;
  page: PagePoint;
}

interface Props {
  map: google.maps.Map;
  imageUrl: string;
  imgW: number;
  imgH: number;
  crop: CropRect | null;
  solution: GeoSolution;
  opacity: number;
  locked: boolean;
  mode: OverlayMode;
  anchors: AnchorDot[];
  /** Current free-transform scale/rotation, for interactive handles. */
  scale: number;
  rotationDeg: number;
  onDragCenter: (center: LatLng) => void;
  onPagePoint: (pt: PagePoint) => void;
  onScale: (scale: number) => void;
  onRotate: (deg: number) => void;
}

// clip-path inset from a normalized crop rect (trims plain margins visually
// while keeping the page's full pixel coordinate space intact for the math).
function cropClip(crop: CropRect | null): string | undefined {
  if (!crop) return undefined;
  const top = crop.y * 100;
  const left = crop.x * 100;
  const right = (1 - (crop.x + crop.width)) * 100;
  const bottom = (1 - (crop.y + crop.height)) * 100;
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`;
}

export default function PageOverlay({
  map,
  imageUrl,
  imgW,
  imgH,
  crop,
  solution,
  opacity,
  locked,
  mode,
  anchors,
  scale,
  rotationDeg,
  onDragCenter,
  onPagePoint,
  onScale,
  onRotate,
}: Props) {
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const overlayRef = useRef<google.maps.OverlayView | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  // Latest props for the imperative draw loop (avoids stale closures).
  const drawRef = useRef({ solution, imgW, imgH });
  drawRef.current = { solution, imgW, imgH };
  // Current draw matrix, kept for back-projecting overlay clicks → page pixels.
  const matrixRef = useRef<[number, number, number, number, number, number] | null>(null);

  // Create the container element and OverlayView once map exists.
  useEffect(() => {
    if (!map) return;

    const el = document.createElement("div");
    el.style.position = "absolute";
    el.style.top = "0";
    el.style.left = "0";
    el.style.transformOrigin = "top left";
    elRef.current = el;

    class PagePane extends google.maps.OverlayView {
      onAdd() {
        this.getPanes()?.overlayMouseTarget.appendChild(el);
      }
      onRemove() {
        el.parentNode?.removeChild(el);
      }
      draw() {
        const proj = this.getProjection();
        if (!proj) return;
        const { solution: sol, imgW: w, imgH: h } = drawRef.current;
        const toPx = (p: PagePoint) => {
          const ll = pageToLatLng(sol, p);
          return proj.fromLatLngToDivPixel(new google.maps.LatLng(ll.lat, ll.lng));
        };
        const tl = toPx({ x: 0, y: 0 });
        const tr = toPx({ x: w, y: 0 });
        const bl = toPx({ x: 0, y: h });
        if (!tl || !tr || !bl) return;
        const a = (tr.x - tl.x) / w;
        const b = (tr.y - tl.y) / w;
        const c = (bl.x - tl.x) / h;
        const d = (bl.y - tl.y) / h;
        matrixRef.current = [a, b, c, d, tl.x, tl.y];
        el.style.width = `${w}px`;
        el.style.height = `${h}px`;
        el.style.transform = `matrix(${a},${b},${c},${d},${tl.x},${tl.y})`;
        // On-screen size of one page pixel along x; used to counter-scale the
        // resize/rotate handles so they stay a constant size regardless of the
        // sheet's current zoom/scale on the map.
        const screenScale = Math.hypot(a, b) || 1;
        el.style.setProperty("--po-inv", String(1 / screenScale));
      }
    }

    const ov = new PagePane();
    overlayRef.current = ov;
    ov.setMap(map);
    setContainerEl(el);

    return () => {
      ov.setMap(null);
      overlayRef.current = null;
      setContainerEl(null);
      elRef.current = null;
    };
  }, [map]);

  // Force a redraw when placement-affecting props change.
  useEffect(() => {
    overlayRef.current?.draw();
  }, [solution, imgW, imgH]);

  // ── Drag to reposition (Stage 4, unlocked, "move" mode) ──────────────────
  const dragRef = useRef<{
    startX: number;
    startY: number;
    centerDiv: { x: number; y: number };
  } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (mode === "pickPage") {
      // Element-local offset IS page-pixel space (pre-transform coordinates).
      onPagePoint({ x: e.nativeEvent.offsetX, y: e.nativeEvent.offsetY });
      return;
    }
    if (mode !== "move" || locked) return;
    const proj = overlayRef.current?.getProjection();
    if (!proj) return;
    const ll = pageToLatLng(drawRef.current.solution, {
      x: drawRef.current.imgW / 2,
      y: drawRef.current.imgH / 2,
    });
    const centerDiv = proj.fromLatLngToDivPixel(new google.maps.LatLng(ll.lat, ll.lng));
    if (!centerDiv) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      centerDiv: { x: centerDiv.x, y: centerDiv.y },
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    map.setOptions({ gestureHandling: "none" });
    e.stopPropagation();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const proj = overlayRef.current?.getProjection();
    if (!proj) return;
    const nx = drag.centerDiv.x + (e.clientX - drag.startX);
    const ny = drag.centerDiv.y + (e.clientY - drag.startY);
    const ll = proj.fromDivPixelToLatLng(new google.maps.Point(nx, ny));
    if (ll) onDragCenter({ lat: ll.lat(), lng: ll.lng() });
  };

  const endDrag = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    map.setOptions({ gestureHandling: "greedy" });
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  // ── Direct resize / rotate handles (Stage 4, unlocked, "move" mode) ───────
  const gestureRef = useRef<
    | { kind: "rotate"; cx: number; cy: number; startAngle: number; startRot: number }
    | { kind: "resize"; cx: number; cy: number; startDist: number; startScale: number }
    | null
  >(null);

  const centerClient = (): { x: number; y: number } | null => {
    const r = elRef.current?.getBoundingClientRect();
    if (!r) return null;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  const onRotateDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const c = centerClient();
    if (!c) return;
    gestureRef.current = {
      kind: "rotate",
      cx: c.x,
      cy: c.y,
      startAngle: Math.atan2(e.clientY - c.y, e.clientX - c.x),
      startRot: rotationDeg,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    map.setOptions({ gestureHandling: "none" });
  };

  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const c = centerClient();
    if (!c) return;
    gestureRef.current = {
      kind: "resize",
      cx: c.x,
      cy: c.y,
      startDist: Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1,
      startScale: scale,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    map.setOptions({ gestureHandling: "none" });
  };

  const onHandleMove = (e: React.PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    e.stopPropagation();
    if (g.kind === "rotate") {
      const ang = Math.atan2(e.clientY - g.cy, e.clientX - g.cx);
      const deltaDeg = ((ang - g.startAngle) * 180) / Math.PI;
      let deg = g.startRot + deltaDeg;
      deg = ((deg + 180) % 360 + 360) % 360 - 180; // normalize to (-180, 180]
      onRotate(Math.round(deg));
    } else {
      const dist = Math.hypot(e.clientX - g.cx, e.clientY - g.cy);
      const next = g.startScale * (dist / g.startDist);
      onScale(Math.min(8, Math.max(0.05, next)));
    }
  };

  const onHandleUp = (e: React.PointerEvent) => {
    gestureRef.current = null;
    map.setOptions({ gestureHandling: "greedy" });
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  const showHandles = mode === "move" && !locked;
  const corners: Array<{ k: string; x: number; y: number }> = [
    { k: "nw", x: 0, y: 0 },
    { k: "ne", x: imgW, y: 0 },
    { k: "sw", x: 0, y: imgH },
    { k: "se", x: imgW, y: imgH },
  ];

  const cls = [
    "po-map-overlay",
    dragRef.current ? "po-map-overlay--dragging" : "",
    locked ? "po-map-overlay--locked" : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (!containerEl) return null;

  return createPortal(
    <div
      className={cls}
      style={{ opacity }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img
        src={imageUrl}
        alt="Print overlay page"
        draggable={false}
        style={{ clipPath: cropClip(crop), WebkitClipPath: cropClip(crop) }}
      />
      {anchors.map((an) => (
        <div
          key={an.key}
          className={`po-anchor-dot po-anchor-dot--${an.kind}`}
          style={{ left: an.page.x, top: an.page.y }}
          aria-hidden
        >
          {an.label}
        </div>
      ))}
      {showHandles && (
        <>
          {corners.map((c) => (
            <div key={c.k} className="po-handle-anchor" style={{ left: `${c.x}px`, top: `${c.y}px` }}>
              <div
                className={`po-handle po-handle--resize po-handle--${c.k}`}
                onPointerDown={onResizeDown}
                onPointerMove={onHandleMove}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
                role="slider"
                aria-label="Resize page"
                aria-valuenow={Math.round(scale * 100)}
                tabIndex={0}
              />
            </div>
          ))}
          <div className="po-handle-anchor" style={{ left: `${imgW / 2}px`, top: 0 }}>
            <div
              className="po-handle po-handle--rotate"
              onPointerDown={onRotateDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              onPointerCancel={onHandleUp}
              role="slider"
              aria-label="Rotate page"
              aria-valuenow={Math.round(rotationDeg)}
              tabIndex={0}
            />
          </div>
        </>
      )}
    </div>,
    containerEl
  );
}
