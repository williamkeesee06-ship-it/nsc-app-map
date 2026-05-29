// Tiny shared store of all current map markups, keyed for search.
// Populated by AllJobsMarkupsOverlay after each fetch. Consumed by SearchBar
// so the user can search for any text they typed on the map (e.g. "cable
// removed", "big copper") and jump straight to it.
import { useEffect, useState } from "react";
import type { DrawingObject } from "@nsc/types";

export interface MarkupSearchEntry {
  jobId: string;
  objId: string;
  tool: string;             // "MH" | "Pole" | "rect" | "freehand" | etc.
  label: string;            // userLabel | description | text
  lat: number;              // representative point
  lng: number;
}

const EVT = "nsc:markupSearch-changed";

let _entries: MarkupSearchEntry[] = [];

function entriesFromDocs(docs: Array<{ jobId: string; objects: DrawingObject[] }>): MarkupSearchEntry[] {
  const out: MarkupSearchEntry[] = [];
  for (const doc of docs) {
    for (const obj of doc.objects) {
      const label = pickLabel(obj);
      if (!label) continue;
      const pos = pickPoint(obj);
      if (!pos) continue;
      out.push({
        jobId: doc.jobId,
        objId: obj.id,
        tool: String(obj.tool),
        label,
        lat: pos.lat,
        lng: pos.lng,
      });
    }
  }
  return out;
}

function pickLabel(obj: DrawingObject): string {
  // Mirror the priority used by createLabelMarker in AllJobsMarkupsOverlay:
  // userLabel > description > text content
  const style = (obj as { style?: { userLabel?: string; description?: string } }).style ?? {};
  if (style.userLabel && style.userLabel.trim()) return style.userLabel.trim();
  if (style.description && style.description.trim()) return style.description.trim();
  const text = (obj as { text?: string }).text;
  if (text && text.trim()) return text.trim();
  return "";
}

function pickPoint(obj: DrawingObject): { lat: number; lng: number } | null {
  // Points/text/icons have .position; shapes/freehand have .vertices/.points
  const anyObj = obj as unknown as {
    position?: { lat: number; lng: number };
    vertices?: Array<{ lat: number; lng: number }>;
    points?: Array<{ lat: number; lng: number }>;
  };
  if (anyObj.position) return anyObj.position;
  const verts = anyObj.vertices ?? anyObj.points;
  if (verts && verts.length > 0) {
    // Use centroid of first few points to land on the shape
    let sumLat = 0, sumLng = 0, n = 0;
    for (const v of verts) {
      if (typeof v?.lat === "number" && typeof v?.lng === "number") {
        sumLat += v.lat; sumLng += v.lng; n++;
      }
    }
    if (n > 0) return { lat: sumLat / n, lng: sumLng / n };
  }
  return null;
}

export function setMarkupSearchDocs(docs: Array<{ jobId: string; objects: DrawingObject[] }>): void {
  _entries = entriesFromDocs(docs);
  window.dispatchEvent(new CustomEvent(EVT));
}

export function getMarkupSearchEntries(): MarkupSearchEntry[] {
  return _entries;
}

export function useMarkupSearchEntries(): MarkupSearchEntry[] {
  const [v, setV] = useState<MarkupSearchEntry[]>(_entries);
  useEffect(() => {
    const onChange = () => setV(_entries);
    window.addEventListener(EVT, onChange);
    return () => window.removeEventListener(EVT, onChange);
  }, []);
  return v;
}
