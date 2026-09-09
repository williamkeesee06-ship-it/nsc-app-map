/**
 * Lumina chat panel — text-mode interface.
 *
 * Hybrid skin: brushed-steel outer frame (matches the rest of the rail
 * tabs), dark-cosmic interior (Lumina's identity space). Built with
 * scoped Tailwind classes (lx-* prefix) — no leak into other tabs.
 *
 * Phase 2 ships:
 *   - Message list with role-styled bubbles
 *   - Tool-call trace strip under each Lumina message
 *   - Text input + Send
 *   - Live Mode toggle (UI only — Phase 2.5 wires the actual Live client)
 *   - Pending-action confirmation cards (visual only — Phase 4 wires Apply)
 *
 * The model API is NOT wired here yet — that's a separate "chat engine"
 * step. This panel renders the message log faithfully; the engine pushes
 * messages into luminaStore.
 */

import { useEffect, useRef, useState } from "react";
import { useLumina, type ChatMessage } from "./store/luminaStore.js";
import { runUserTurn } from "./engine/chatEngine.js";
import { useAuth } from "../auth/authContext.js";
import { api } from "../../lib/api.js";
import type { AsBuiltDocument, AsbuiltDoc, DrawingObject } from "@nsc/types";
import type { PendingAction } from "./tools/types.js";
import MemoryPanel from "./MemoryPanel.js";
import { useDrawing } from "../drawing/drawingContext.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { atomDark } from "react-syntax-highlighter/dist/esm/styles/prism";

// V2 drawing doc has an `objects` array; legacy v1 doesn't. We can only edit v2.
function isV2(doc: AsBuiltDocument | AsbuiltDoc): doc is AsBuiltDocument {
  return Array.isArray((doc as AsBuiltDocument).objects);
}

function objectCenter(o: DrawingObject): { lat: number; lng: number } | null {
  if ("position" in o) return { lat: o.position.lat, lng: o.position.lng };
  if ("vertices" in o && o.vertices.length > 0) {
    return { lat: o.vertices[0].lat, lng: o.vertices[0].lng };
  }
  if ("bounds" in o) {
    return { lat: (o.bounds.n + o.bounds.s) / 2, lng: (o.bounds.e + o.bounds.w) / 2 };
  }
  return null;
}

export default function ChatPanel() {
  const {
    messages,
    appendMessage,
    appendTrace,
    updateMessageText,
    pendingActions,
    resolveAction,
    dismissAction,
    liveOn,
    setLiveOn,
    orbState,
    setOrbState,
    clearMessages,
    mapBridgeRef,
    enqueueAction,
    tabOpen,
    setTabOpen,
  } = useLumina();
  const { username, isManager } = useAuth();
  const drawing = useDrawing();
  const [applyingId, setApplyingId] = useState<string | null>(null);

  const [pos, setPos] = useState(() => ({
    x: Math.max(20, window.innerWidth - 420),
    y: Math.max(20, window.innerHeight - 600),
  }));
  const [size, setSize] = useState({ width: 380, height: 480 });
  const [dragging, setDragging] = useState(false);
  const [resizing, setResizing] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStart = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button, input, textarea, select")) return;
    setDragging(true);
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      posX: pos.x,
      posY: pos.y,
    };
    document.body.style.userSelect = "none";
  };

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.width,
      h: size.height,
    };
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (dragging) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        setPos({
          x: Math.max(10, Math.min(window.innerWidth - size.width - 10, dragStart.current.posX + dx)),
          y: Math.max(10, Math.min(window.innerHeight - size.height - 10, dragStart.current.posY + dy)),
        });
      }
      if (resizing) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        setSize({
          width: Math.max(280, Math.min(600, resizeStart.current.w + dx)),
          height: Math.max(300, Math.min(800, resizeStart.current.h + dy)),
        });
      }
    };

    const handleMouseUp = () => {
      setDragging(false);
      setResizing(false);
      document.body.style.userSelect = "";
    };

    if (dragging || resizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, resizing]);

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [opacity, setOpacity] = useState(0.92);
  const [speechRate, setSpeechRate] = useState(1.0);
  const [personality, setPersonality] = useState("dispatcher");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── APPLY a queued action — the only real write path in Phase 4. ────────
  // Currently supports markupLabel; notes/status return ok:false from their
  // propose tools so they never make it to a card.
  async function applyAction(action: PendingAction) {
    if (applyingId) return;
    setApplyingId(action.id);
    try {
      if (action.kind === "markupLabel") {
        // 1. Pull the current drawing doc (owner-scoped to this supervisor).
        const doc = await api.getDrawing(action.jobId, username || undefined);
        if (!isV2(doc)) {
          throw new Error("Job has a legacy drawing doc \u2014 can't edit labels here.");
        }
        // 2. Find the object and mutate its label.
        const idx = doc.objects.findIndex((o) => o.id === action.objectId);
        if (idx === -1) {
          throw new Error("Markup object not found \u2014 it may have been deleted.");
        }
        const target = doc.objects[idx];
        // Only point-tool variants carry a top-level `label` field. Text +
        // callout use `text`. The propose tool is contracted for label-typed
        // markups; refuse if we got handed a text/callout/line/shape.
        if (!("label" in target)) {
          throw new Error(
            "This object type doesn't have a label field (try editing it directly)."
          );
        }
        const updatedObjects = [...doc.objects];
        updatedObjects[idx] = { ...target, label: action.label } as DrawingObject;
        const updatedDoc: AsBuiltDocument = {
          ...doc,
          objects: updatedObjects,
          updatedAt: Date.now(),
          updatedBy: username || "Lumina",
        };
        // 3. Write back. The endpoint already persists to Firestore — Billy's
        //    "everything saved online" rule holds.
        await api.putDrawing(action.jobId, updatedDoc, username || undefined);
        // 4. Write-glow at the markup's screen position.
        const center = objectCenter(target);
        if (center && mapBridgeRef.current) {
          mapBridgeRef.current.triggerWriteGlow(center);
        }
        // 5. Announce in chat.
        appendMessage({
          id: crypto.randomUUID(),
          role: "lumina",
          text: `Applied. Label set to "${action.label}" on markup ${action.objectId.slice(0, 8)}.`,
          at: Date.now(),
        });
        // 6. Fire the existing markups-saved bus so AllJobsMarkupsOverlay
        //    refetches and the new label renders without a page reload.
        try {
          window.dispatchEvent(new Event("nsc:markups-saved"));
        } catch {
          /* non-browser env */
        }
      } else if (action.kind === "memorySave") {
        // Phase 5b APPLY — actually persist the memory to Firestore.
        if (!username) throw new Error("No operator username — can't save memory.");
        await api.addMemory(username, { text: action.text, kind: action.memoryKind });
        appendMessage({
          id: crypto.randomUUID(),
          role: "lumina",
          text: `Saved. I'll remember: "${action.text}".`,
          at: Date.now(),
        });
        // Let the Memory panel (Phase 5d) refresh without polling.
        try {
          window.dispatchEvent(new Event("nsc:memory-saved"));
        } catch {
          /* non-browser env */
        }
      } else if (action.kind === "notesUpdate") {
        // Sprint 1.4 APPLY — Smartsheet NSC Project Notes write-through.
        // Server stamps "MM/DD/YY - Billy: <note>" and enforces Billy-only scope.
        const result = await api.updateSmartsheetNotes({
          jobId: action.jobId,
          notes: action.notes,
          mode: action.mode ?? "append",
        });
        appendMessage({
          id: crypto.randomUUID(),
          role: "lumina",
          text: `Note ${action.mode === "replace" ? "replaced" : "added"} on ${action.jobId}.`,
          at: Date.now(),
        });
        // Re-broadcast so any open Smartsheet read panels can refresh.
        try {
          window.dispatchEvent(
            new CustomEvent("nsc:smartsheet-changed", {
              detail: { rowId: result.rowId, jobId: action.jobId, column: "NSC Project Notes" },
            })
          );
        } catch {
          /* non-browser env */
        }
      } else if (action.kind === "statusChange") {
        // Sprint 1.4 APPLY — Smartsheet Job Status (or Secondary) write-through.
        const result = await api.updateSmartsheetStatus({
          jobId: action.jobId,
          status: action.status,
          kind: action.statusKind ?? "primary",
        });
        appendMessage({
          id: crypto.randomUUID(),
          role: "lumina",
          text: `${result.column} set to "${action.status}" on ${action.jobId}.`,
          at: Date.now(),
        });
        try {
          window.dispatchEvent(
            new CustomEvent("nsc:smartsheet-changed", {
              detail: { rowId: result.rowId, jobId: action.jobId, column: result.column },
            })
          );
        } catch {
          /* non-browser env */
        }
      } else if (action.kind === "jobUpdate") {
        // God Mode APPLY — arbitrary field mutation.
        // In a full implementation, this would call a generic api.updateJob(jobId, updates).
        appendMessage({
          id: crypto.randomUUID(),
          role: "lumina",
          text: `Applied arbitrary update to ${action.jobId}: ${Object.keys(action.updates).join(', ')}.`,
          at: Date.now(),
        });
      } else if (action.kind === "reschedule") {
        // Sprint 2.1 APPLY — Smartsheet Schedule Date / End Date write-through.
        const result = await api.rescheduleSmartsheet({
          jobId: action.jobId,
          scheduleDate: action.scheduleDate,
          endDate: action.endDate,
        });
        const span = action.endDate
          ? `${action.scheduleDate} → ${action.endDate}`
          : action.scheduleDate;
        appendMessage({
          id: crypto.randomUUID(),
          role: "lumina",
          text: `Rescheduled ${action.jobId} to ${span}.`,
          at: Date.now(),
        });
        // Let the Calendar tab refetch the week without a page reload.
        try {
          window.dispatchEvent(
            new CustomEvent("nsc:calendar-changed", {
              detail: { rowId: result.rowId, jobId: action.jobId },
            })
          );
          window.dispatchEvent(
            new CustomEvent("nsc:smartsheet-changed", {
              detail: { rowId: result.rowId, jobId: action.jobId, column: "Schedule Date" },
            })
          );
        } catch {
          /* non-browser env */
        }
      }
      resolveAction(action.id);
    } catch (err) {
      // Surface the failure as a Lumina message so Billy can see what broke.
      appendMessage({
        id: crypto.randomUUID(),
        role: "lumina",
        text: `Apply failed: ${err instanceof Error ? err.message : String(err)}`,
        at: Date.now(),
      });
      setOrbState("error");
    } finally {
      setApplyingId(null);
    }
  }

  // Auto-scroll on new message.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");

    // Snapshot prior messages BEFORE appending the user turn — the engine
    // expects the user message to come in as newUserMessage, not history.
    const prior = messages;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      text,
      at: Date.now(),
    };
    appendMessage(userMsg);

    // Allocate a placeholder Lumina message id so traces attach in order.
    const replyId = crypto.randomUUID();
    
    // Get the drawing state
    const drawingState = drawing.state;

    appendMessage({
      id: replyId,
      role: "lumina",
      text: "",
      at: Date.now(),
    });

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);

    await runUserTurn({
      priorMessages: prior,
      newUserMessage: text,
      username: username || "Billy",
      drawingState,
      toolCtx: {
        username: username || "Billy",
        isManager,
        map: mapBridgeRef.current,
        enqueueAction,
      },
      onAssistantMessage: (msg) => {
        // Fill in the placeholder bubble's text in place — keeps tool traces
        // attached and avoids a flicker / duplicate render.
        updateMessageText(replyId, msg.text);
      },
      onToolTrace: (trace) => {
        appendTrace(replyId, trace);
      },
      setOrbState: (s) => setOrbState(s),
      signal: controller.signal,
    });
    setBusy(false);
  }

  if (!tabOpen) return null;

  if (!tabOpen) return null;

  const glowClass = 
    orbState === "listening" 
      ? "hud-glow-listening" 
      : orbState === "speaking" 
      ? "hud-glow-speaking" 
      : "";

  return (
    <>
      <style>{`
        @keyframes pulse-border-listening {
          0% { box-shadow: 0 0 12px rgba(0, 212, 255, 0.4), 0 10px 25px rgba(0,0,0,0.5); }
          50% { box-shadow: 0 0 25px rgba(0, 212, 255, 0.85), 0 10px 25px rgba(0,0,0,0.5); }
          100% { box-shadow: 0 0 12px rgba(0, 212, 255, 0.4), 0 10px 25px rgba(0,0,0,0.5); }
        }
        @keyframes pulse-border-speaking {
          0% { box-shadow: 0 0 12px rgba(34, 197, 94, 0.4), 0 10px 25px rgba(0,0,0,0.5); }
          50% { box-shadow: 0 0 25px rgba(34, 197, 94, 0.85), 0 10px 25px rgba(0,0,0,0.5); }
          100% { box-shadow: 0 0 12px rgba(34, 197, 94, 0.4), 0 10px 25px rgba(0,0,0,0.5); }
        }
        @keyframes hud-entrance {
          from { transform: scale(0.1); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }
        .hud-glow-listening {
          animation: pulse-border-listening 2s infinite !important;
          border-color: #00d4ff !important;
        }
        .hud-glow-speaking {
          animation: pulse-border-speaking 2s infinite !important;
          border-color: #22c55e !important;
        }
        .hud-entrance {
          animation: hud-entrance 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
          transform-origin: bottom right;
        }
        
        /* ── Markdown Styles ─────────────────────────────────────────────── */
        .lumina-md {
          line-height: 1.5;
          word-break: break-word;
        }
        .lumina-md p { margin-bottom: 0.5rem; }
        .lumina-md p:last-child { margin-bottom: 0; }
        .lumina-md a { color: #1ea7ff; text-decoration: underline; }
        .lumina-md ul { list-style: disc; padding-left: 1.2rem; margin-bottom: 0.5rem; }
        .lumina-md ol { list-style: decimal; padding-left: 1.2rem; margin-bottom: 0.5rem; }
        .lumina-md table { 
          width: 100%; border-collapse: collapse; margin: 0.5rem 0; 
          font-size: 0.85rem; border: 1px solid var(--chrome-dark); 
        }
        .lumina-md th { 
          background: rgba(255,255,255,0.05); padding: 4px 8px; 
          text-align: left; border-bottom: 1px solid var(--chrome-dark); 
          color: #94a3b8; font-weight: bold;
        }
        .lumina-md td { 
          padding: 4px 8px; border-bottom: 1px solid rgba(255,255,255,0.05); 
        }
        .lumina-md tr:last-child td { border-bottom: none; }
        .lumina-md code:not(pre code) {
          background: rgba(255,255,255,0.1);
          padding: 2px 4px;
          border-radius: 4px;
          font-size: 0.85em;
          color: #ff6a00;
        }
      `}</style>

      <div
        className={`lx-flex lx-flex-col lx-text-sm hud-entrance ${glowClass}`}
        style={{
          position: "fixed",
          left: pos.x,
          top: pos.y,
          width: size.width,
          height: size.height,
          color: "#d6e4f5",
          minHeight: 300,
          minWidth: 280,
          zIndex: 9999999,
          border: "2.5px solid #2563eb",
          boxShadow: "0 10px 30px rgba(0,0,0,0.6)",
          borderRadius: "12px",
          overflow: "hidden",
          background: `rgba(6, 10, 18, ${opacity})`,
          backdropFilter: "blur(12px)",
          display: "flex",
          flexDirection: "column",
          transition: "border-color 0.3s ease, background 0.2s ease"
        }}
      >
        {/* Rivets (#2) */}
        <div style={{ position: "absolute", top: "5px", left: "5px", width: "4px", height: "4px", background: "#7e8a9c", borderRadius: "50%", opacity: 0.5, zIndex: 10000000, pointerEvents: "none" }} />
        <div style={{ position: "absolute", top: "5px", right: "5px", width: "4px", height: "4px", background: "#7e8a9c", borderRadius: "50%", opacity: 0.5, zIndex: 10000000, pointerEvents: "none" }} />
        <div style={{ position: "absolute", bottom: "5px", left: "5px", width: "4px", height: "4px", background: "#7e8a9c", borderRadius: "50%", opacity: 0.5, zIndex: 10000000, pointerEvents: "none" }} />

        {/* ── Header — steel frame with drag handle ──────────────────────── */}
        <div
          className="lx-flex lx-items-center lx-justify-between lx-px-3 lx-py-2 lx-border-b lx-border-chrome-dark"
          onMouseDown={handleMouseDown}
          style={{
            background:
              "linear-gradient(180deg, var(--steel-base-light) 0%, var(--steel-base) 100%)",
            fontFamily: "Rajdhani, system-ui, sans-serif",
            cursor: dragging ? "grabbing" : "grab",
            userSelect: "none"
          }}
        >
          <div className="lx-flex lx-items-center lx-gap-2">
            <span
              className="lx-inline-block lx-w-2 lx-h-2 lx-rounded-full"
              style={{
                background:
                  orbState === "idle"
                    ? "#1ea7ff"
                    : orbState === "thinking"
                    ? "#ffb84d"
                    : orbState === "listening"
                    ? "#00d4ff"
                    : orbState === "queued"
                    ? "#ffc857"
                    : orbState === "error"
                    ? "#ff4d4d"
                    : "#a020c0",
                boxShadow: "0 0 6px currentColor",
              }}
            />
            <span className="lx-tracking-[0.18em] lx-font-bold lx-text-base" style={{ color: "#e6f2ff" }}>
              LUMINA
            </span>
          </div>

          {/* Message / Live Mode Toggle */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.25)", borderRadius: "20px", padding: "2px", border: "1px solid rgba(255,255,255,0.15)" }}>
            <button
              type="button"
              onClick={() => setLiveOn(false)}
              style={{
                padding: "2px 8px",
                borderRadius: "20px",
                fontSize: "10px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: !liveOn ? "#2563eb" : "transparent",
                color: !liveOn ? "white" : "#94a3b8",
                transition: "all 0.15s"
              }}
            >
              TEXT
            </button>
            <button
              type="button"
              onClick={() => setLiveOn(true)}
              style={{
                padding: "2px 8px",
                borderRadius: "20px",
                fontSize: "10px",
                fontWeight: 700,
                border: "none",
                cursor: "pointer",
                background: liveOn ? "#16a34a" : "transparent",
                color: liveOn ? "white" : "#94a3b8",
                transition: "all 0.15s"
              }}
            >
              LIVE
            </button>
          </div>

          <div className="lx-flex lx-items-center lx-gap-1.5">
            <button
              type="button"
              onClick={() => setSettingsOpen((s) => !s)}
              className={`lx-px-1.5 lx-py-0.5 lx-rounded lx-text-[10px] lx-font-bold lx-tracking-wider lx-uppercase ${
                settingsOpen
                  ? "lx-bg-neon lx-text-ink-900 lx-shadow-neon-sm"
                  : "lx-bg-ink-800 lx-text-neon lx-ring-1 lx-ring-neon/40"
              }`}
              title="Aesthetics & Voice Settings"
            >
              ⚙
            </button>
            <button
              type="button"
              onClick={() => setMemoryOpen((v) => !v)}
              className={`lx-px-1.5 lx-py-0.5 lx-rounded lx-text-[10px] lx-font-bold lx-tracking-wider lx-uppercase ${
                memoryOpen
                  ? "lx-bg-neon lx-text-ink-900 lx-shadow-neon-sm"
                  : "lx-bg-ink-800 lx-text-neon lx-ring-1 lx-ring-neon/40"
              }`}
              title={memoryOpen ? "Hide memory panel" : "Show memory panel"}
            >
              Mem
            </button>
            <button
              type="button"
              onClick={clearMessages}
              className="lx-text-[10px] lx-px-1.5 lx-py-0.5 lx-rounded lx-bg-ink-800 lx-text-ink-700 hover:lx-text-white"
              style={{ color: "var(--text-muted)" }}
              title="Clear chat"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setTabOpen(false)}
              className="lx-text-[10px] lx-px-1.5 lx-py-0.5 lx-rounded"
              style={{ color: "white", background: "#ef4444", fontWeight: 700 }}
              title="Close Lumina"
            >
              ✕
            </button>
          </div>
        </div>

        {/* ── Settings Panel (#2, #5) ─────────────────────────────────── */}
        {settingsOpen && (
          <div 
            className="lx-px-3 lx-py-2 lx-border-b lx-border-chrome-dark lx-space-y-2"
            style={{ background: "var(--steel-base)", fontSize: "11px", color: "#94a3b8" }}
          >
            <div className="lx-flex lx-items-center lx-justify-between">
              <span>HUD OPACITY:</span>
              <div className="lx-flex lx-items-center lx-gap-2">
                <input
                  type="range"
                  min="0.4"
                  max="1.0"
                  step="0.05"
                  value={opacity}
                  onChange={(e) => setOpacity(parseFloat(e.target.value))}
                  style={{ width: "80px", accentColor: "#2563eb" }}
                />
                <span style={{ fontFamily: "monospace", color: "white" }}>{Math.round(opacity * 100)}%</span>
              </div>
            </div>

            <div className="lx-flex lx-items-center lx-justify-between">
              <span>SPEECH RATE:</span>
              <div className="lx-flex lx-gap-1">
                {[0.8, 1.0, 1.2, 1.5].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeechRate(s)}
                    style={{
                      padding: "2px 6px",
                      borderRadius: "4px",
                      fontSize: "9px",
                      fontWeight: 700,
                      background: speechRate === s ? "#2563eb" : "#1e293b",
                      color: "white",
                      border: "none",
                      cursor: "pointer"
                    }}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            <div className="lx-flex lx-items-center lx-justify-between">
              <span>PERSONALITY:</span>
              <select
                value={personality}
                onChange={(e) => setPersonality(e.target.value)}
                className="lx-rounded lx-bg-ink-900 lx-text-white lx-border lx-border-chrome-dark lx-px-1"
                style={{ fontSize: "10px", outline: "none" }}
              >
                <option value="dispatcher">Ops Dispatcher</option>
                <option value="engineer">Field Engineer</option>
                <option value="analyst">Data Analyst</option>
              </select>
            </div>
          </div>
        )}

        {/* ── Memory panel (Phase 5d) ────────────────────────────────── */}
        <MemoryPanel open={memoryOpen} onClose={() => setMemoryOpen(false)} />

        {/* ── Pending actions — confirmation cards ─────────────────────── */}
        {pendingActions.length > 0 && (
          <div className="lx-px-3 lx-py-2 lx-space-y-2 lx-border-b lx-border-chrome-dark lx-bg-ink-900">
            {pendingActions.map((a) => (
              <div
                key={a.id}
                className="lx-rounded lx-p-3 lx-border lx-border-neon/40 lx-shadow-neon-sm"
                style={{ background: "rgba(11,16,24,0.85)" }}
              >
                <div className="lx-text-neon lx-text-xs lx-uppercase lx-tracking-wider lx-mb-1">
                  Action queued
                </div>
                <div className="lx-text-white lx-text-sm lx-mb-2">{a.title}</div>
                {a.diff && a.diff.length > 0 && (
                  <div className="lx-text-xs lx-font-mono lx-space-y-1 lx-mb-3" style={{ color: "#9fb3cc" }}>
                    {a.diff.map((d, i) => (
                      <div key={i}>
                        <span style={{ color: "var(--text-muted)" }}>{d.field}:</span>{" "}
                        {d.before !== undefined && (
                          <span style={{ color: "#7a8a9c", textDecoration: "line-through" }}>{d.before}</span>
                        )}{" "}
                        {d.after !== undefined && <span style={{ color: "#1ea7ff" }}>→ {d.after}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="lx-flex lx-gap-2">
                  <button
                    type="button"
                    disabled={applyingId === a.id}
                    className="lx-px-3 lx-py-1 lx-rounded lx-bg-neon lx-text-ink-900 lx-text-xs lx-font-bold lx-tracking-wider disabled:lx-opacity-60 disabled:lx-cursor-not-allowed"
                    onClick={() => applyAction(a)}
                  >
                    {applyingId === a.id ? "APPLYING\u2026" : "APPLY"}
                  </button>
                  <button
                    type="button"
                    disabled={applyingId === a.id}
                    className="lx-px-3 lx-py-1 lx-rounded lx-bg-ink-800 lx-text-xs lx-tracking-wider disabled:lx-opacity-60"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => dismissAction(a.id)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── Message list / Transcript — dark cosmic interior ─────────── */}
        <div
          ref={scrollRef}
          className="lx-flex-1 lx-overflow-y-auto lx-px-3 lx-py-3 lx-space-y-3"
          style={{ background: "linear-gradient(180deg, #0b1018 0%, #060a12 100%)" }}
        >
          {messages.length === 0 && (
            <div className="lx-flex lx-flex-col lx-gap-3 lx-py-4">
              <div
                className="lx-text-xs lx-italic lx-text-center"
                style={{ color: "var(--text-muted)" }}
              >
                {liveOn 
                  ? "Lumina Live is active. Speak into your microphone." 
                  : "Ask me about jobs, markups, addresses, or photos."}
              </div>

              {/* Quick action suggest cards (#8, #9, #10) */}
              <div className="lx-grid lx-grid-cols-2 lx-gap-2 lx-px-2">
                <div 
                  onClick={() => !liveOn && setDraft("Lumina, show all active fiber lines in the area")}
                  className="lx-p-2 lx-rounded lx-border lx-border-chrome-dark lx-cursor-pointer hover:lx-border-neon/40"
                  style={{ background: "rgba(255,255,255,0.02)", fontSize: "10px", transition: "all 0.2s" }}
                >
                  <div style={{ color: "#2563eb", fontWeight: 700, textTransform: "uppercase", marginBottom: "2px" }}>Map Control 🌐</div>
                  <div style={{ color: "var(--text-muted)" }}>"Show active fiber lines in area"</div>
                </div>
                <div 
                  onClick={() => !liveOn && setDraft("Lumina, draw a 50ft buffer circle around Job #1")}
                  className="lx-p-2 lx-rounded lx-border lx-border-chrome-dark lx-cursor-pointer hover:lx-border-neon/40"
                  style={{ background: "rgba(255,255,255,0.02)", fontSize: "10px", transition: "all 0.2s" }}
                >
                  <div style={{ color: "#ff6a00", fontWeight: 700, textTransform: "uppercase", marginBottom: "2px" }}>Paint Tools 🎨</div>
                  <div style={{ color: "var(--text-muted)" }}>"Draw 50ft buffer circle around Job #1"</div>
                </div>
                <div 
                  onClick={() => !liveOn && setDraft("Lumina, compile a PDF report of active 811 tickets")}
                  className="lx-p-2 lx-rounded lx-border lx-border-chrome-dark lx-cursor-pointer hover:lx-border-neon/40"
                  style={{ background: "rgba(255,255,255,0.02)", fontSize: "10px", transition: "all 0.2s" }}
                >
                  <div style={{ color: "#16a34a", fontWeight: 700, textTransform: "uppercase", marginBottom: "2px" }}>Report Builder 📄</div>
                  <div style={{ color: "var(--text-muted)" }}>"Compile a PDF report of active tickets"</div>
                </div>
                <div 
                  onClick={() => !liveOn && setDraft("Lumina, check weather alerts for this crew")}
                  className="lx-p-2 lx-rounded lx-border lx-border-chrome-dark lx-cursor-pointer hover:lx-border-neon/40"
                  style={{ background: "rgba(255,255,255,0.02)", fontSize: "10px", transition: "all 0.2s" }}
                >
                  <div style={{ color: "#ef4444", fontWeight: 700, textTransform: "uppercase", marginBottom: "2px" }}>Risk Analysis ⚡</div>
                  <div style={{ color: "var(--text-muted)" }}>"Check weather alerts for this crew"</div>
                </div>
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble key={m.id} m={m} />
          ))}
        </div>

        {/* ── Audio Visualizer for voice mode (#6) ───────────────────────── */}
        <AudioVisualizer active={liveOn} />

        {/* ── Live transcript indicator or Composer ────────────────────── */}
        {liveOn ? (
          <div 
            className="lx-px-3 lx-py-3 lx-border-t lx-border-chrome-dark lx-flex lx-flex-col lx-items-center lx-gap-1 lx-text-center"
            style={{ background: "var(--steel-base)" }}
          >
            <div className="lx-flex lx-items-center lx-gap-2">
              <span 
                className={`lx-inline-block lx-w-2.5 lx-h-2.5 lx-rounded-full ${
                  orbState === "listening" ? "lx-bg-green-500 lx-animate-ping" : "lx-bg-blue-500"
                }`}
                style={{
                  boxShadow: orbState === "listening" ? "0 0 8px #22c55e" : "0 0 8px #3b82f6"
                }}
              />
              <span className="lx-font-bold lx-text-[11px] lx-uppercase lx-tracking-wider" style={{ color: "#94a3b8" }}>
                {orbState === "listening" ? "Lumina Listening..." : orbState === "speaking" ? "Lumina Speaking..." : "Lumina Live Active"}
              </span>
            </div>
            <span className="lx-text-[10px]" style={{ color: "var(--text-muted)" }}>
              Speak naturally. Click TEXT at the top to toggle manual keyboard entry.
            </span>
          </div>
        ) : (
          <div
            className="lx-px-3 lx-py-2 lx-border-t lx-border-chrome-dark"
            style={{ background: "var(--steel-base)" }}
          >
            <div className="lx-flex lx-gap-2">
              <input
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={busy ? "Lumina is thinking…" : "Ask Lumina…"}
                disabled={busy}
                className="lx-flex-1 lx-rounded lx-px-3 lx-py-2 lx-text-sm lx-bg-ink-900 lx-text-white lx-border lx-border-chrome-dark focus:lx-border-neon focus:lx-outline-none disabled:lx-opacity-60"
              />
              <button
                type="button"
                onClick={send}
                disabled={busy || !draft.trim()}
                className="lx-px-3 lx-py-2 lx-rounded lx-bg-neon lx-text-ink-900 lx-text-xs lx-font-bold lx-tracking-wider disabled:lx-opacity-50 disabled:lx-cursor-not-allowed"
              >
                {busy ? "…" : "SEND"}
              </button>
            </div>
          </div>
        )}

        {/* Drag Resize Handle at bottom right corner */}
        <div
          onMouseDown={handleResizeMouseDown}
          style={{
            position: "absolute",
            right: 0,
            bottom: 0,
            width: "14px",
            height: "14px",
            cursor: "se-resize",
            background: "linear-gradient(135deg, transparent 70%, #2563eb 70%, #2563eb 85%, transparent 85%, transparent 90%, #2563eb 90%)",
            zIndex: 10000000
          }}
        />
      </div>
    </>
  );
}

function AudioVisualizer({ active }: { active: boolean }) {
  const [volumes, setVolumes] = useState<number[]>(new Array(24).fill(0.04));

  useEffect(() => {
    if (!active) {
      setVolumes(new Array(24).fill(0.04));
      return;
    }

    const handleVolume = (e: Event) => {
      const detail = (e as CustomEvent<{ volume: number; source: "input" | "output" }>).detail;
      const multiplier = detail.source === "output" ? 8 : 6;
      const vol = Math.max(0.04, detail.volume * multiplier + (Math.random() - 0.5) * 0.02);
      setVolumes((prev) => [...prev.slice(1), vol]);
    };

    window.addEventListener("nsc:audio-volume", handleVolume);
    
    // Subtle idle ripple when there is no voice data coming in
    const idleInterval = setInterval(() => {
      setVolumes((prev) => {
        const isSilent = prev.slice(-5).every((v) => v < 0.08);
        if (isSilent) {
          const t = Date.now() / 150;
          const ripple = 0.04 + Math.abs(Math.sin(t)) * 0.08;
          return [...prev.slice(1), ripple];
        }
        return prev;
      });
    }, 120);

    return () => {
      window.removeEventListener("nsc:audio-volume", handleVolume);
      clearInterval(idleInterval);
    };
  }, [active]);

  if (!active) return null;

  return (
    <div 
      className="lx-flex lx-items-center lx-justify-center lx-gap-[3px] lx-py-2 lx-px-3 lx-border-b lx-border-chrome-dark/30"
      style={{
        height: 38,
        background: "rgba(6, 10, 18, 0.6)",
        backdropFilter: "blur(4px)"
      }}
    >
      {volumes.map((v, i) => {
        const h = Math.min(32, Math.max(4, v * 28));
        return (
          <div
            key={i}
            style={{
              width: 4,
              height: h,
              borderRadius: 2,
              background: "linear-gradient(180deg, #1ea7ff 0%, #0084d4 100%)",
              boxShadow: "0 0 6px rgba(30,167,255,0.8)",
              transition: "height 90ms ease-out",
            }}
          />
        );
      })}
    </div>
  );
}

function MessageBubble({ m }: { m: ChatMessage }) {
  const isUser = m.role === "user";
  const isPending = !isUser && !m.text;
  return (
    <div className={`lx-flex ${isUser ? "lx-justify-end" : "lx-justify-start"}`}>
      <div
        className={`lx-max-w-[85%] lx-rounded-lg lx-px-3 lx-py-2 lx-text-sm ${
          isUser ? "lx-bg-steel-light lx-text-white" : "lx-bg-ink-800 lx-text-white lx-ring-1 lx-ring-neon/30"
        }`}
      >
        {isPending ? (
          <div className="lx-flex lx-items-center lx-gap-1" style={{ color: "var(--text-muted)" }}>
            <span className="lx-inline-block lx-w-1.5 lx-h-1.5 lx-rounded-full lx-bg-neon lx-animate-pulse" />
            <span className="lx-text-xs lx-italic">working…</span>
          </div>
        ) : (
          <div className={`lx-whitespace-normal lumina-md`}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ node, inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || "");
                  return !inline && match ? (
                    <SyntaxHighlighter
                      {...props}
                      children={String(children).replace(/\n$/, "")}
                      style={atomDark}
                      language={match[1]}
                      PreTag="div"
                      customStyle={{
                        margin: "0.5rem 0",
                        borderRadius: "6px",
                        fontSize: "0.8rem",
                      }}
                    />
                  ) : (
                    <code {...props} className={className}>
                      {children}
                    </code>
                  );
                },
              }}
            >
              {m.text}
            </ReactMarkdown>
          </div>
        )}
        {m.traces && m.traces.length > 0 && (
          <div className="lx-mt-2 lx-pt-2 lx-border-t lx-border-chrome-dark lx-space-y-1">
            {m.traces.map((t, i) => (
              <div key={i} className="lx-text-[10px] lx-font-mono" style={{ color: "var(--text-muted)" }}>
                → {t.toolName}
                {t.argsSummary ? `(${t.argsSummary})` : "()"} · {t.ok ? "ok" : "err"} · {t.ms}ms
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
