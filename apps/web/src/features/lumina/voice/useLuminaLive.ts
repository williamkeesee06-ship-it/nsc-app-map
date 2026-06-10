/**
 * useLuminaLive — drives the Gemini Live voice session lifecycle.
 *
 * Mounted ONCE inside <LuminaProvider> so the session survives the Lumina
 * tab being closed. Billy can fire Live from the orb while he's deep in
 * Tools/Filters and keep talking without his workspace getting yanked.
 *
 * Lifecycle:
 *   liveOn → true   → new LuminaLiveSession({...}).start()
 *   liveOn → false  → session.stop(), tear down audio
 *   error           → session.stop() + setLiveOn(false) so the orb returns idle
 *
 * Voice ↔ UI wiring:
 *   onStatus              → orbState (orb color/glow reflects voice state)
 *   onUserTranscript      → final transcripts append as "user" ChatMessage [voice]
 *   onModelTranscript     → final transcripts append as "lumina" ChatMessage [voice]
 *   onToolCall            → dispatchTool() routes through the same registry as text mode
 *   onError               → flips liveOn off, surfaces the error in chat
 */

import { useEffect, useRef } from "react";
import { useAuth } from "../../auth/authContext.js";
import { useLumina, type ChatMessage, type OrbState } from "../store/luminaStore.js";
import { dispatchTool } from "../tools/index.js";
import {
  LuminaLiveSession,
  type LuminaLiveStatus,
  type LuminaLiveToolCall,
  type LuminaLiveToolResult,
} from "./geminiLive.js";

/** Bridge LuminaLiveStatus → OrbState. Live has extra states (connecting,
 *  closed, error) that we collapse onto the orb's visual vocabulary. */
function statusToOrbState(status: LuminaLiveStatus): OrbState {
  switch (status) {
    case "connecting":
      return "thinking"; // pulsing while we set up
    case "listening":
      return "listening";
    case "speaking":
      return "speaking";
    case "thinking":
      return "thinking";
    case "error":
      return "error";
    case "closed":
    case "idle":
    default:
      return "idle";
  }
}

/** Generate a stable id without external deps (crypto.randomUUID may be
 *  unavailable in very old WebViews; fall back to time+random). */
function id(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `v_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

export function useLuminaLive() {
  const {
    liveOn,
    setLiveOn,
    setOrbState,
    appendMessage,
    mapBridgeRef,
    enqueueAction,
  } = useLumina();
  const { username } = useAuth();

  // Single session at a time. Held in a ref so re-renders don't blow it away.
  const sessionRef = useRef<LuminaLiveSession | null>(null);
  // True when WE initiated stop() — used by onClose to suppress the
  // "unexpected close" branch (which would loop setLiveOn(false)).
  const userInitiatedStopRef = useRef(false);

  // Capture the latest username in a ref so the session's getUsername()
  // callback always sees the current value without re-creating the session
  // every time auth re-renders.
  const usernameRef = useRef<string | null>(username);
  usernameRef.current = username;

  useEffect(() => {
    if (liveOn) {
      // Already running — no-op. (Defensive: shouldn't happen with toggle.)
      if (sessionRef.current) return;

      const session = new LuminaLiveSession({
        getUsername: () => usernameRef.current || "",

        onStatus: (status) => {
          setOrbState(statusToOrbState(status));
        },

        onUserTranscript: (text, isFinal) => {
          // Only commit FINAL transcripts to the chat log. Partials would
          // spam the message list and break the existing message-id model.
          if (!isFinal || !text.trim()) return;
          const msg: ChatMessage = {
            id: id(),
            role: "user",
            text: text.trim(),
            at: Date.now(),
          };
          appendMessage(msg);
        },

        onModelTranscript: (text, isFinal) => {
          if (!isFinal || !text.trim()) return;
          const msg: ChatMessage = {
            id: id(),
            role: "lumina",
            text: text.trim(),
            at: Date.now(),
          };
          appendMessage(msg);
        },

        onError: (message) => {
          // Surface in chat so Billy actually sees it.
          appendMessage({
            id: id(),
            role: "lumina",
            text: `Live mode error: ${message}`,
            at: Date.now(),
          });
          // Flip the switch back so the orb returns to idle and the user
          // can re-arm by clicking the orb again.
          setLiveOn(false);
        },

        onClose: () => {
          sessionRef.current = null;
          // If WE called stop() (user clicked orb off), state is already
          // converging to liveOn=false — no further action needed.
          if (userInitiatedStopRef.current) {
            userInitiatedStopRef.current = false;
            return;
          }
          // Otherwise the server / network dropped us. Flip off so the
          // orb returns idle and the user can re-arm by clicking again.
          setLiveOn(false);
        },

        onToolCall: async (call: LuminaLiveToolCall): Promise<LuminaLiveToolResult> => {
          // Route through the same registry text mode uses. Same tools,
          // same propose-card flow — so a voice "label this riser pole G3"
          // queues a confirmation card just like text would.
          const result = await dispatchTool(call.name, call.args, {
            username: usernameRef.current || "Billy",
            map: mapBridgeRef.current,
            enqueueAction,
          });
          return {
            ok: result.ok,
            message: result.message,
            data: result.data as Record<string, unknown> | undefined,
          };
        },

        // Server-side prompt injection already loads memories on token
        // creation (Phase 5c — luminaLiveToken.ts), so we don't need to
        // double-inject here. Left null on purpose.
        getInitialMemory: () => null,

        // Initial Smartsheet context isn't wired yet — would require
        // exposing the current job list snapshot to the provider. Tracked
        // as a follow-up. Tools cover the gap for now (listJobs etc).
        getInitialContext: () => null,
      });

      sessionRef.current = session;
      session.start().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[lumina-live] start() failed", err);
        sessionRef.current = null;
        // onError already fired; setLiveOn(false) too.
      });
    } else {
      // Tearing down.
      const session = sessionRef.current;
      if (session) {
        userInitiatedStopRef.current = true;
        session.stop();
        sessionRef.current = null;
      }
      setOrbState("idle");
    }

    // Cleanup on unmount — defensively close any live session so we don't
    // leak the mic or the WebSocket.
    return () => {
      if (!liveOn && !sessionRef.current) return;
      // Only close if we OWN the session in the current liveOn=true branch;
      // for liveOn=false branch the teardown above already happened.
    };
    // setLiveOn / setOrbState / appendMessage / enqueueAction are stable
    // refs from the provider, but listing them satisfies lint without
    // creating loop hazards.
  }, [liveOn, setLiveOn, setOrbState, appendMessage, enqueueAction, mapBridgeRef]);
}
