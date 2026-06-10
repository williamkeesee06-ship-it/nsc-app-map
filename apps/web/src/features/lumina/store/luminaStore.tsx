/**
 * Lumina state store — React Context (matches the map app's existing
 * state pattern instead of importing Zustand into this workspace).
 *
 * Holds:
 *   - orb state (idle / listening / thinking / speaking / queued / error)
 *   - chat message log
 *   - pending actions queue (write tools enqueue here)
 *   - tab open/closed
 *   - live-mode on/off
 *   - imperative MapBridge handle (set by MapBridge.tsx)
 *
 * NOTE: Anti-hallucination rule — message log keeps tool-call traces
 * alongside text turns so the UI can render them and Billy can audit.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LuminaMapBridge, PendingAction } from "../tools/types.js";
import { useLuminaLive } from "../voice/useLuminaLive.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type OrbState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking"
  | "queued"
  | "error";

export interface ToolTrace {
  toolName: string;
  argsSummary?: string;
  ok: boolean;
  ms: number;
  message?: string;
  /** When it fired (epoch ms). */
  at: number;
}

export interface ChatMessage {
  id: string;
  role: "user" | "lumina";
  text: string;
  at: number;
  /** Tool calls that fired during this turn. Rendered as trace strips. */
  traces?: ToolTrace[];
  /** If this message announces a queued action, the pending action id. */
  pendingActionId?: string;
}

interface LuminaContextValue {
  // Orb state
  orbState: OrbState;
  setOrbState: (s: OrbState) => void;
  // Tab visibility
  tabOpen: boolean;
  setTabOpen: (b: boolean) => void;
  toggleTab: () => void;
  // Live mode
  liveOn: boolean;
  setLiveOn: (b: boolean) => void;
  // Messages
  messages: ChatMessage[];
  appendMessage: (m: ChatMessage) => void;
  appendTrace: (messageId: string, trace: ToolTrace) => void;
  /** Replace the text of an existing message (used by the engine to fill
   *  a placeholder Lumina bubble after the model produces its final reply). */
  updateMessageText: (messageId: string, text: string) => void;
  clearMessages: () => void;
  // Pending actions
  pendingActions: PendingAction[];
  enqueueAction: (a: PendingAction) => string;
  resolveAction: (id: string) => PendingAction | undefined;
  dismissAction: (id: string) => void;
  // Map bridge (set by MapBridge component on mount)
  mapBridgeRef: React.MutableRefObject<LuminaMapBridge | null>;
  setMapBridge: (b: LuminaMapBridge | null) => void;
}

const Ctx = createContext<LuminaContextValue | null>(null);

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

export function LuminaProvider({ children }: { children: ReactNode }) {
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [tabOpen, setTabOpen] = useState(false);
  const [liveOn, setLiveOn] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pendingActions, setPendingActions] = useState<PendingAction[]>([]);
  const mapBridgeRef = useRef<LuminaMapBridge | null>(null);

  const appendMessage = useCallback((m: ChatMessage) => {
    setMessages((prev) => [...prev, m]);
  }, []);

  const appendTrace = useCallback((messageId: string, trace: ToolTrace) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, traces: [...(m.traces ?? []), trace] } : m))
    );
  }, []);

  const updateMessageText = useCallback((messageId: string, text: string) => {
    setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, text } : m)));
  }, []);

  const clearMessages = useCallback(() => setMessages([]), []);

  const enqueueAction = useCallback((a: PendingAction): string => {
    setPendingActions((prev) => [...prev, a]);
    return a.id;
  }, []);

  const resolveAction = useCallback(
    (id: string): PendingAction | undefined => {
      let removed: PendingAction | undefined;
      setPendingActions((prev) => {
        const idx = prev.findIndex((a) => a.id === id);
        if (idx === -1) return prev;
        removed = prev[idx];
        return [...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
      return removed;
    },
    []
  );

  const dismissAction = useCallback((id: string) => {
    setPendingActions((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const setMapBridge = useCallback((b: LuminaMapBridge | null) => {
    mapBridgeRef.current = b;
  }, []);

  const toggleTab = useCallback(() => setTabOpen((v) => !v), []);

  const value = useMemo<LuminaContextValue>(
    () => ({
      orbState,
      setOrbState,
      tabOpen,
      setTabOpen,
      toggleTab,
      liveOn,
      setLiveOn,
      messages,
      appendMessage,
      appendTrace,
      updateMessageText,
      clearMessages,
      pendingActions,
      enqueueAction,
      resolveAction,
      dismissAction,
      mapBridgeRef,
      setMapBridge,
    }),
    [
      orbState,
      tabOpen,
      toggleTab,
      liveOn,
      messages,
      appendMessage,
      appendTrace,
      updateMessageText,
      clearMessages,
      pendingActions,
      enqueueAction,
      resolveAction,
      dismissAction,
      setMapBridge,
    ]
  );

  return (
    <Ctx.Provider value={value}>
      <LuminaLiveDriver />
      {children}
    </Ctx.Provider>
  );
}

/**
 * Invisible component that owns the Gemini Live session lifecycle.
 * Mounted inside the provider so it consumes the same context that
 * components below use — keeps the orb, ChatPanel, and Live session
 * all reading/writing the same store. Survives Lumina tab open/close.
 */
function LuminaLiveDriver() {
  useLuminaLive();
  return null;
}

export function useLumina(): LuminaContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useLumina must be used inside <LuminaProvider>");
  return v;
}
