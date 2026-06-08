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

export default function ChatPanel() {
  const {
    messages,
    appendMessage,
    appendTrace,
    updateMessageText,
    pendingActions,
    dismissAction,
    liveOn,
    setLiveOn,
    orbState,
    setOrbState,
    clearMessages,
    mapBridgeRef,
    enqueueAction,
  } = useLumina();
  const { username } = useAuth();

  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

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
      toolCtx: {
        username: username || "Billy",
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

  return (
    <div
      className="lx-flex lx-flex-col lx-h-full lx-w-full lx-text-sm"
      style={{ color: "#d6e4f5", minHeight: 0, minWidth: 0 }}
    >
      {/* ── Header — steel frame ─────────────────────────────────────── */}
      <div
        className="lx-flex lx-items-center lx-justify-between lx-px-3 lx-py-2 lx-border-b lx-border-chrome-dark"
        style={{
          background:
            "linear-gradient(180deg, var(--steel-base-light) 0%, var(--steel-base) 100%)",
          fontFamily: "Rajdhani, system-ui, sans-serif",
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
          <span className="lx-text-xs lx-uppercase lx-tracking-wider" style={{ color: "var(--text-muted)" }}>
            {orbState}
          </span>
        </div>
        <div className="lx-flex lx-items-center lx-gap-2">
          <button
            type="button"
            onClick={() => setLiveOn(!liveOn)}
            className={`lx-px-2 lx-py-1 lx-rounded lx-text-xs lx-font-bold lx-tracking-wider lx-uppercase ${
              liveOn
                ? "lx-bg-neon lx-text-ink-900 lx-shadow-neon-sm"
                : "lx-bg-ink-800 lx-text-neon lx-ring-1 lx-ring-neon/40"
            }`}
            title={liveOn ? "Live voice on" : "Click to enable live voice"}
          >
            {liveOn ? "Live • On" : "Live"}
          </button>
          <button
            type="button"
            onClick={clearMessages}
            className="lx-text-xs lx-px-2 lx-py-1 lx-rounded lx-bg-ink-800 lx-text-ink-700 hover:lx-text-white"
            style={{ color: "var(--text-muted)" }}
            title="Clear chat"
          >
            Clear
          </button>
        </div>
      </div>

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
                  className="lx-px-3 lx-py-1 lx-rounded lx-bg-neon lx-text-ink-900 lx-text-xs lx-font-bold lx-tracking-wider"
                  onClick={() => {
                    // Phase 4 will wire the real API call here.
                    dismissAction(a.id);
                  }}
                >
                  APPLY
                </button>
                <button
                  type="button"
                  className="lx-px-3 lx-py-1 lx-rounded lx-bg-ink-800 lx-text-xs lx-tracking-wider"
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

      {/* ── Message list — dark cosmic interior ──────────────────────── */}
      <div
        ref={scrollRef}
        className="lx-flex-1 lx-overflow-y-auto lx-px-3 lx-py-3 lx-space-y-3"
        style={{ background: "linear-gradient(180deg, #0b1018 0%, #060a12 100%)" }}
      >
        {messages.length === 0 && (
          <div
            className="lx-text-xs lx-italic lx-text-center lx-py-8"
            style={{ color: "var(--text-muted)" }}
          >
            Ask me about jobs, markups, addresses, or photos.
            <br />
            Hold the orb to talk.
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} m={m} />
        ))}
      </div>

      {/* ── Composer ─────────────────────────────────────────────────── */}
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
          <div className="lx-whitespace-pre-wrap">{m.text}</div>
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
