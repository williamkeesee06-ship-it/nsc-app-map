/**
 * Lumina tool registry — types.
 *
 * Every Lumina tool is one of these shapes. The same definition is used by
 * both the chat surface (text-mode) and the live-voice surface — they share
 * the registry. The registry is what makes anti-hallucination structural:
 * Lumina cannot "know" any North Sky fact unless one of these functions
 * just returned it.
 *
 * Patterns:
 *   - "read"     → runs immediately, returns real data.
 *   - "navigate" → runs immediately, drives the map UI. No data write.
 *   - "propose"  → does NOT mutate. Enqueues a pending action; the user
 *                  must Apply it from a confirmation card before any real
 *                  API call runs. The model is told the action is queued.
 */

import type { ReactNode } from "react";

/** What kind of side-effect the tool produces. */
export type LuminaToolKind = "read" | "navigate" | "propose";

/** Shared context every tool can use at run time. */
export interface LuminaToolContext {
  /** Username of the operator (Billy / Robbie / Joe / etc). */
  username: string;
  /** Imperative handle to drive the map (set by MapBridge in Phase 2). */
  map: LuminaMapBridge | null;
  /** Pending-actions queue (set by luminaStore). */
  enqueueAction: (action: PendingAction) => string;
  /** Abort signal so a slow tool can be interrupted by the next user turn. */
  signal?: AbortSignal;
}

/** What every tool's run() resolves to. The model sees `data` as JSON. */
export interface LuminaToolResult<TData = unknown> {
  ok: boolean;
  /** Short human-readable summary. Lumina is allowed to quote this. */
  message?: string;
  /** Structured payload the model can reason over. Kept lean — large
   *  blobs (full job rows, photo data URLs) are summarized first. */
  data?: TData;
  /** For propose-* tools: the queued action id so the UI can render the
   *  confirmation card and the model can be told it's queued. */
  pendingActionId?: string;
}

export interface LuminaTool<TInput = unknown, TData = unknown> {
  /** Function name as the model sees it (must match the declaration in
   *  apps/api/src/routes/luminaLiveToken.ts). */
  name: string;
  /** Human description, also shown to the model. */
  description: string;
  /** Side-effect class — drives UI behavior (e.g. propose-* shows a card). */
  kind: LuminaToolKind;
  /** Run the tool. Must NEVER throw — return ok:false on failure. */
  run(input: TInput, ctx: LuminaToolContext): Promise<LuminaToolResult<TData>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Map bridge — imperative handle for navigation tools.
// Implemented in Phase 2 by features/lumina/MapBridge.tsx; tools call into it.
// ─────────────────────────────────────────────────────────────────────────────

export interface LuminaMapBridge {
  panTo(coords: { lat: number; lng: number }): void;
  zoomTo(zoom: number): void;
  setMapType(t: "roadmap" | "satellite" | "hybrid" | "terrain"): void;
  /** Drop a Lumina-owned temporary pin (separate from job markups). */
  dropPin(args: { lat: number; lng: number; label?: string; id?: string }): string;
  clearPins(): void;
  /** Trigger Option-C neon ring sweep from orb to a target screen position. */
  triggerArrivalGlow(target: { lat: number; lng: number }): void;
  /** Briefly glow a target lat/lng after a write was Applied. Caller supplies
   *  the coordinates (looked up from the just-saved drawing doc). */
  triggerWriteGlow(args: { lat: number; lng: number }): void;
  /** Open the job card (same as clicking the job pin). */
  selectJob(jobId: string): void;
  /** Apply a non-default filter to the job list (crew/status/age/city). */
  applyFilter(args: { crew?: string; status?: string; olderThanDays?: number; city?: string }): {
    matched: number;
    description: string;
  };
  /** Restore default filters (all jobs visible). */
  resetFilters(): void;
  /** Pan + zoom + arrival glow as a single composed move. */
  flyTo(args: { lat: number; lng: number; zoom?: number; label?: string }): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending actions — write tools queue these for the confirmation card UI.
// ─────────────────────────────────────────────────────────────────────────────

export interface PendingActionBase {
  id: string;
  /** When it was proposed (epoch ms). */
  createdAt: number;
  /** Short summary for the card title. */
  title: string;
  /** Optional structured before/after diff rendered as a list of rows. */
  diff?: Array<{ field: string; before?: string; after?: string }>;
  /** Optional ReactNode for richer card body content. */
  body?: ReactNode;
}

export interface PendingNotesUpdate extends PendingActionBase {
  kind: "notesUpdate";
  jobId: string;
  notes: string;
}

export interface PendingStatusChange extends PendingActionBase {
  kind: "statusChange";
  jobId: string;
  status: string;
}

export interface PendingMarkupLabel extends PendingActionBase {
  kind: "markupLabel";
  jobId: string;
  objectId: string;
  label: string;
}

export type PendingAction = PendingNotesUpdate | PendingStatusChange | PendingMarkupLabel;
