// DrawingEngine.ts — manages in-progress drawing state for all tools.
// This is a plain class (not React component) that attaches listeners to the
// google.maps.Map instance. DrawingOverlay.tsx instantiates one per map.

import type { DrawingObject, DrawingStyle, DrawingTool } from "@nsc/types";

export type CommitFn = (obj: DrawingObject) => void;

const FEET_PER_METER = 3.28084;

function genId(): string {
  return `d_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function latLng(e: google.maps.MapMouseEvent): { lat: number; lng: number } | null {
  if (!e.latLng) return null;
  return { lat: e.latLng.lat(), lng: e.latLng.lng() };
}

function distanceMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  return google.maps.geometry.spherical.computeDistanceBetween(
    new google.maps.LatLng(a.lat, a.lng),
    new google.maps.LatLng(b.lat, b.lng)
  );
}

function totalDistanceFeet(pts: Array<{ lat: number; lng: number }>): number {
  let d = 0;
  for (let i = 1; i < pts.length; i++) {
    d += distanceMeters(pts[i - 1]!, pts[i]!);
  }
  return d * FEET_PER_METER;
}

export class DrawingEngine {
  private map: google.maps.Map;
  private commit: CommitFn;

  // Listeners added to the map
  private listeners: google.maps.MapsEventListener[] = [];
  // Preview overlay for in-progress draw
  private previewLine: google.maps.Polyline | null = null;
  private previewRect: google.maps.Rectangle | null = null;
  private previewCircle: google.maps.Circle | null = null;
  // Freehand drawing flag
  private freehandActive = false;

  // In-progress vertices (polyline tools, polygon, freehand, measure)
  private vertices: Array<{ lat: number; lng: number }> = [];
  // Measure label info window
  private measureInfoWindow: google.maps.InfoWindow | null = null;

  // Rectangle / circle: track mouse-down origin
  private dragStart: { lat: number; lng: number } | null = null;
  private isDragging = false;

  private tool: DrawingTool | null = null;
  private style: DrawingStyle | null = null;

  // Callback for "drawing started" / "drawing in progress" (for UI hints)
  onDrawProgress?: (vertexCount: number, distanceFeet?: number) => void;
  onDrawEnd?: () => void;

  constructor(map: google.maps.Map, commit: CommitFn) {
    this.map = map;
    this.commit = commit;
  }

  activate(tool: DrawingTool, style: DrawingStyle): void {
    this.deactivate();
    this.tool = tool;
    this.style = style;
    this.map.setOptions({ draggableCursor: this.cursorFor(tool) });

    if (this.isPolylineTool(tool) || tool === "polygon" || tool === "measure") {
      this.setupPolylineTool();
    } else if (tool === "freehand") {
      this.setupFreehandTool();
    } else if (tool === "rectangle") {
      this.setupRectTool();
    } else if (tool === "circle") {
      this.setupCircleTool();
    } else if (this.isPointTool(tool)) {
      this.setupPointTool();
    } else if (tool === "text") {
      this.setupTextTool();
    }
  }

  deactivate(): void {
    this.listeners.forEach((l) => l.remove());
    this.listeners = [];
    this.previewLine?.setMap(null);
    this.previewLine = null;
    this.previewRect?.setMap(null);
    this.previewRect = null;
    this.previewCircle?.setMap(null);
    this.previewCircle = null;
    this.measureInfoWindow?.close();
    this.measureInfoWindow = null;
    this.vertices = [];
    this.dragStart = null;
    this.isDragging = false;
    this.freehandActive = false;
    this.tool = null;
    this.style = null;
    this.map.setOptions({ draggableCursor: null, draggable: true });
    this.onDrawEnd?.();
  }

  cancel(): void {
    this.deactivate();
  }

  private cursorFor(tool: DrawingTool): string {
    if (this.isPointTool(tool) || tool === "text") return "crosshair";
    return "crosshair";
  }

  private isPolylineTool(tool: DrawingTool): boolean {
    return ["placed_cable", "removed_cable", "line", "arrow"].includes(tool);
  }

  private isPointTool(tool: DrawingTool): boolean {
    return [
      "mh_new", "mh_removed",
      "hh_new", "hh_removed",
      "ped_new", "ped_removed",
      "pole_new", "pole_removed",
      "cabinet_new", "cabinet_removed",
      "anchor_new", "anchor_removed",
    ].includes(tool);
  }

  // ─── Polyline / polygon / measure ──────────────────────────────────────────

  private setupPolylineTool(): void {
    const style = this.style!;

    // Live preview polyline
    this.previewLine = new google.maps.Polyline({
      path: [],
      strokeColor: style.strokeColor,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
      strokeDashArray: style.strokeStyle === "dashed" ? "8 4" : undefined,
      map: this.map,
      clickable: false,
      zIndex: 10,
    } as google.maps.PolylineOptions);

    const click = this.map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const pt = latLng(e);
      if (!pt) return;
      this.vertices.push(pt);
      this.updatePolylinePreview();
      const dist = this.tool === "measure" ? totalDistanceFeet(this.vertices) : undefined;
      this.onDrawProgress?.(this.vertices.length, dist);
    });

    const dblclick = this.map.addListener("dblclick", (e: google.maps.MapMouseEvent) => {
      e.stop();
      this.finishPolyline();
    });

    // Track mouse for preview ghost segment
    const mousemove = this.map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (this.vertices.length === 0 || !e.latLng) return;
      const ghost = [...this.vertices, { lat: e.latLng.lat(), lng: e.latLng.lng() }];
      this.previewLine?.setPath(
        ghost.map((v) => new google.maps.LatLng(v.lat, v.lng))
      );
      if (this.tool === "measure" && ghost.length > 1) {
        const ft = totalDistanceFeet(ghost);
        this.onDrawProgress?.(this.vertices.length, ft);
      }
    });

    this.listeners.push(click, dblclick, mousemove);
  }

  private updatePolylinePreview(): void {
    this.previewLine?.setPath(
      this.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng))
    );
  }

  private finishPolyline(): void {
    const tool = this.tool;
    const style = this.style!;
    const verts = [...this.vertices];

    if (verts.length < 2) {
      this.deactivate();
      return;
    }

    const id = genId();
    const obj: DrawingObject = {
      id,
      tool: tool as "placed_cable" | "removed_cable" | "line" | "arrow" | "polygon" | "freehand" | "measure",
      vertices: verts,
      style,
    };
    this.deactivate();
    this.commit(obj);
  }

  // ─── Freehand ──────────────────────────────────────────────────────────────

  private setupFreehandTool(): void {
    const style = this.style!;
    this.map.setOptions({ draggable: false });

    this.previewLine = new google.maps.Polyline({
      path: [],
      strokeColor: style.strokeColor,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
      map: this.map,
      clickable: false,
      zIndex: 10,
    });

    const mousedown = this.map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
      const pt = latLng(e);
      if (!pt) return;
      this.freehandActive = true;
      this.vertices = [pt];
    });

    const mousemove = this.map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!this.freehandActive || !e.latLng) return;
      const pt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      this.vertices.push(pt);
      this.previewLine?.setPath(
        this.vertices.map((v) => new google.maps.LatLng(v.lat, v.lng))
      );
    });

    const mouseup = this.map.addListener("mouseup", () => {
      if (!this.freehandActive) return;
      this.freehandActive = false;
      this.finishFreehand();
    });

    this.listeners.push(mousedown, mousemove, mouseup);
  }

  private finishFreehand(): void {
    const style = this.style!;
    const verts = [...this.vertices];
    if (verts.length < 2) {
      this.deactivate();
      return;
    }
    const obj: DrawingObject = {
      id: genId(),
      tool: "freehand",
      vertices: verts,
      style,
    };
    this.deactivate();
    this.commit(obj);
  }

  // ─── Rectangle ─────────────────────────────────────────────────────────────

  private setupRectTool(): void {
    const style = this.style!;
    this.map.setOptions({ draggable: false });

    const fill = style.fill.kind === "solid" ? style.fill.color :
                 style.fill.kind === "hash" ? style.fill.color : "transparent";
    const fillOpacity = style.fill.kind === "none" ? 0 : style.opacity * 0.3;

    this.previewRect = new google.maps.Rectangle({
      bounds: { north: 0, south: 0, east: 0, west: 0 },
      strokeColor: style.strokeColor,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
      fillColor: fill,
      fillOpacity,
      map: null,
      clickable: false,
      zIndex: 10,
    });

    const mousedown = this.map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
      const pt = latLng(e);
      if (!pt) return;
      this.dragStart = pt;
      this.isDragging = true;
      this.previewRect?.setMap(this.map);
    });

    const mousemove = this.map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!this.isDragging || !this.dragStart || !e.latLng) return;
      const cur = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      this.previewRect?.setBounds({
        north: Math.max(this.dragStart.lat, cur.lat),
        south: Math.min(this.dragStart.lat, cur.lat),
        east: Math.max(this.dragStart.lng, cur.lng),
        west: Math.min(this.dragStart.lng, cur.lng),
      });
    });

    const mouseup = this.map.addListener("mouseup", (e: google.maps.MapMouseEvent) => {
      if (!this.isDragging || !this.dragStart || !e.latLng) return;
      const end = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const bounds = {
        n: Math.max(this.dragStart.lat, end.lat),
        s: Math.min(this.dragStart.lat, end.lat),
        e: Math.max(this.dragStart.lng, end.lng),
        w: Math.min(this.dragStart.lng, end.lng),
      };
      this.isDragging = false;
      if (Math.abs(bounds.n - bounds.s) < 0.00001 || Math.abs(bounds.e - bounds.w) < 0.00001) {
        this.deactivate();
        return;
      }
      const obj: DrawingObject = { id: genId(), tool: "rectangle", bounds, style };
      this.deactivate();
      this.commit(obj);
    });

    this.listeners.push(mousedown, mousemove, mouseup);
  }

  // ─── Circle ────────────────────────────────────────────────────────────────

  private setupCircleTool(): void {
    const style = this.style!;
    this.map.setOptions({ draggable: false });

    const fill = style.fill.kind === "solid" ? style.fill.color :
                 style.fill.kind === "hash" ? style.fill.color : "transparent";
    const fillOpacity = style.fill.kind === "none" ? 0 : style.opacity * 0.3;

    this.previewCircle = new google.maps.Circle({
      center: { lat: 0, lng: 0 },
      radius: 1,
      strokeColor: style.strokeColor,
      strokeWeight: style.strokeWidth,
      strokeOpacity: style.opacity,
      fillColor: fill,
      fillOpacity,
      map: null,
      clickable: false,
      zIndex: 10,
    });

    const mousedown = this.map.addListener("mousedown", (e: google.maps.MapMouseEvent) => {
      const pt = latLng(e);
      if (!pt) return;
      this.dragStart = pt;
      this.isDragging = true;
      this.previewCircle?.setCenter(new google.maps.LatLng(pt.lat, pt.lng));
      this.previewCircle?.setMap(this.map);
    });

    const mousemove = this.map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
      if (!this.isDragging || !this.dragStart || !e.latLng) return;
      const cur = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const r = distanceMeters(this.dragStart, cur);
      this.previewCircle?.setRadius(r);
    });

    const mouseup = this.map.addListener("mouseup", (e: google.maps.MapMouseEvent) => {
      if (!this.isDragging || !this.dragStart || !e.latLng) return;
      const end = { lat: e.latLng.lat(), lng: e.latLng.lng() };
      const r = distanceMeters(this.dragStart, end);
      if (r < 1) { this.deactivate(); return; }
      // Convert circle to bounds approximation for storage
      const center = this.dragStart;
      const latDelta = (r / 111320);
      const lngDelta = r / (111320 * Math.cos((center.lat * Math.PI) / 180));
      const bounds = {
        n: center.lat + latDelta,
        s: center.lat - latDelta,
        e: center.lng + lngDelta,
        w: center.lng - lngDelta,
      };
      const obj: DrawingObject = { id: genId(), tool: "circle", bounds, style };
      this.deactivate();
      this.commit(obj);
    });

    this.listeners.push(mousedown, mousemove, mouseup);
  }

  // ─── Point tools ───────────────────────────────────────────────────────────

  private setupPointTool(): void {
    const tool = this.tool as DrawingObject["tool"];
    const style = this.style!;

    const click = this.map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const pt = latLng(e);
      if (!pt) return;
      const obj: DrawingObject = {
        id: genId(),
        tool: tool as "mh_new",
        position: pt,
        style,
      };
      this.commit(obj);
      // Point tools stay active for multi-place
    });

    this.listeners.push(click);
  }

  // ─── Text tool ─────────────────────────────────────────────────────────────

  private setupTextTool(): void {
    const style = this.style!;

    const click = this.map.addListener("click", (e: google.maps.MapMouseEvent) => {
      const pt = latLng(e);
      if (!pt) return;
      const text = window.prompt("Enter text:");
      if (!text || !text.trim()) return;
      const obj: DrawingObject = {
        id: genId(),
        tool: "text",
        position: pt,
        text: text.trim(),
        style,
      };
      this.deactivate();
      this.commit(obj);
    });

    this.listeners.push(click);
  }
}
