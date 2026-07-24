// Stage 3 — reversible crop editor. Shows the page preview with a draggable /
// resizable rectangle in NORMALIZED (0..1) page coordinates. The auto
// suggestion is presented as a starting point the user can accept, adjust,
// reset, or skip — content is never silently removed.
import { useCallback, useEffect, useRef, useState } from "react";
import { clampCropRect, type CropRect } from "@nsc/types";

interface Props {
  imageUrl: string;
  label: string;
  /** Initial rect (auto suggestion or previously-saved crop). */
  initial: CropRect | null;
  /** The auto suggestion, used by Reset. */
  auto: CropRect | null;
  onAccept: (rect: CropRect | null, source: "auto" | "manual") => void;
  onSkip: () => void;
  onCancel: () => void;
}

type DragKind = "move" | "nw" | "ne" | "sw" | "se" | null;

const FULL: CropRect = { x: 0, y: 0, width: 1, height: 1 };

export default function CropEditor({
  imageUrl,
  label,
  initial,
  auto,
  onAccept,
  onSkip,
  onCancel,
}: Props) {
  const [rect, setRect] = useState<CropRect>(initial ?? auto ?? FULL);
  const [edited, setEdited] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ kind: DragKind; startX: number; startY: number; start: CropRect; box: DOMRect } | null>(
    null
  );

  const box = useCallback((): DOMRect | null => {
    const img = stageRef.current?.querySelector("img");
    return img ? img.getBoundingClientRect() : null;
  }, []);

  const onDown = (kind: DragKind) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const b = box();
    if (!b) return;
    dragRef.current = { kind, startX: e.clientX, startY: e.clientY, start: rect, box: b };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const b = drag.box;
    const dx = (e.clientX - drag.startX) / b.width;
    const dy = (e.clientY - drag.startY) / b.height;
    const s = drag.start;
    let next: CropRect = { ...s };
    if (drag.kind === "move") {
      next.x = s.x + dx;
      next.y = s.y + dy;
    } else {
      let x0 = s.x;
      let y0 = s.y;
      let x1 = s.x + s.width;
      let y1 = s.y + s.height;
      if (drag.kind === "nw") {
        x0 += dx;
        y0 += dy;
      } else if (drag.kind === "ne") {
        x1 += dx;
        y0 += dy;
      } else if (drag.kind === "sw") {
        x0 += dx;
        y1 += dy;
      } else if (drag.kind === "se") {
        x1 += dx;
        y1 += dy;
      }
      next = { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
    }
    setRect(clampCropRect(next));
    setEdited(true);
  };

  const onUp = (e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const reset = () => {
    setRect(auto ?? FULL);
    setEdited(false);
  };

  const accept = () => {
    // A full-page rect means "no crop".
    const isFull = rect.width >= 0.995 && rect.height >= 0.995 && rect.x <= 0.005 && rect.y <= 0.005;
    onAccept(isFull ? null : rect, edited ? "manual" : "auto");
  };

  const pct = (v: number) => `${v * 100}%`;
  const shades = [
    { top: 0, left: 0, width: "100%", height: pct(rect.y) },
    { top: pct(rect.y + rect.height), left: 0, width: "100%", bottom: 0 },
    { top: pct(rect.y), left: 0, width: pct(rect.x), height: pct(rect.height) },
    { top: pct(rect.y), left: pct(rect.x + rect.width), right: 0, height: pct(rect.height) },
  ];
  const handles: Array<{ k: Exclude<DragKind, "move" | null>; style: React.CSSProperties }> = [
    { k: "nw", style: { left: pct(rect.x), top: pct(rect.y), marginLeft: -6, marginTop: -6, cursor: "nwse-resize" } },
    { k: "ne", style: { left: pct(rect.x + rect.width), top: pct(rect.y), marginLeft: -6, marginTop: -6, cursor: "nesw-resize" } },
    { k: "sw", style: { left: pct(rect.x), top: pct(rect.y + rect.height), marginLeft: -6, marginTop: -6, cursor: "nesw-resize" } },
    { k: "se", style: { left: pct(rect.x + rect.width), top: pct(rect.y + rect.height), marginLeft: -6, marginTop: -6, cursor: "nwse-resize" } },
  ];

  return (
    <div className="po-cropdock" role="region" aria-label={`Crop ${label}`}>
      <div className="po-cropdock__panel">
        <div>
          <h2 className="po-dialog__title">Crop suggestion · {label}</h2>
          <p className="po-dialog__subtitle">
            The suggested box trims only plain borders, title blocks, revision boxes and blank
            margins — map geometry, footages, cable sizes, splice details, counts, installation
            methods, pole numbers and callouts are always preserved. Drag the box or its corners to
            adjust. This is reversible — the original page is never modified. Accept, reset to the
            suggestion, or skip cropping; either way you go straight to placing the page.
          </p>
        </div>

        <div className="po-crop-stage">
          <div
            ref={stageRef}
            className="po-crop-canvas"
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          >
            <img src={imageUrl} alt={label} draggable={false} />
            {shades.map((s, i) => (
              <div key={i} className="po-crop-shade" style={s} />
            ))}
            <div
              className="po-crop-rect"
              style={{ left: pct(rect.x), top: pct(rect.y), width: pct(rect.width), height: pct(rect.height) }}
              onPointerDown={onDown("move")}
            />
            {handles.map((h) => (
              <div
                key={h.k}
                className="po-crop-handle"
                style={h.style}
                onPointerDown={onDown(h.k)}
                role="slider"
                aria-label={`Resize crop ${h.k}`}
                aria-valuenow={0}
                tabIndex={0}
              />
            ))}
          </div>
        </div>

        <div className="po-dialog__actions">
          <button className="po-btn po-btn--ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="po-btn" onClick={onSkip}>
            Skip crop
          </button>
          <button className="po-btn" onClick={reset} disabled={!auto && !edited}>
            Reset to auto
          </button>
          <button className="po-btn po-btn--primary" onClick={accept}>
            Accept crop
          </button>
        </div>
      </div>
    </div>
  );
}
