// Drawing context — central store for the Phase 3 drawing toolbar.
// Manages: active tool, style modifiers, undo/redo stack, selected objects,
// dirty flag, target job, and persistence to Firestore via the API.
import {
  createContext,
  useCallback,
  useContext,
  useReducer,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { AsBuiltDocument, DrawingObject, DrawingStyle, DrawingTool } from "@nsc/types";
import { api } from "../../lib/api.js";

// ─── Default styles per tool category ───────────────────────────────────────

export const COLORS = {
  neonGreen: "#39ff7a",
  neonRed: "#ff2d4a",
  cyan: "#3aa7ff",
  white: "#f4f8ff",
} as const;

function defaultStyleForTool(tool: DrawingTool): DrawingStyle {
  if (tool === "placed_cable") {
    return {
      strokeColor: COLORS.neonGreen,
      strokeWidth: 3,
      strokeStyle: "solid",
      fill: { kind: "none" },
      opacity: 1,
    };
  }
  if (tool === "removed_cable") {
    return {
      strokeColor: COLORS.neonRed,
      strokeWidth: 3,
      strokeStyle: "dashed",
      fill: { kind: "none" },
      opacity: 1,
    };
  }
  if (tool.endsWith("_new")) {
    return {
      strokeColor: COLORS.neonGreen,
      strokeWidth: 2,
      strokeStyle: "solid",
      fill: { kind: "solid", color: COLORS.neonGreen },
      opacity: 0.9,
    };
  }
  if (tool.endsWith("_removed")) {
    return {
      strokeColor: COLORS.neonRed,
      strokeWidth: 2,
      strokeStyle: "solid",
      fill: { kind: "solid", color: COLORS.neonRed },
      opacity: 0.9,
    };
  }
  if (tool === "text") {
    return {
      strokeColor: COLORS.white,
      strokeWidth: 1,
      strokeStyle: "solid",
      fill: { kind: "solid", color: "rgba(11,15,19,0.7)" },
      opacity: 1,
    };
  }
  // Basic tools default to cyan
  return {
    strokeColor: COLORS.cyan,
    strokeWidth: 2,
    strokeStyle: "solid",
    fill: { kind: "none" },
    opacity: 1,
  };
}

// ─── State shape ─────────────────────────────────────────────────────────────

export interface DrawingState {
  activeTool: DrawingTool | null;
  style: DrawingStyle;
  objects: DrawingObject[];
  selectedIds: Set<string>;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  targetJobId: string | null;
  targetWorkOrder: string | null;
}

type Action =
  | { type: "SET_TOOL"; tool: DrawingTool | null }
  | { type: "SET_STYLE"; patch: Partial<DrawingStyle> }
  | { type: "ADD_OBJECT"; obj: DrawingObject }
  | { type: "UPDATE_OBJECT"; obj: DrawingObject }
  | { type: "DELETE_SELECTED" }
  | { type: "SELECT"; ids: string[]; additive: boolean }
  | { type: "CLEAR_SELECTION" }
  | { type: "UNDO" }
  | { type: "REDO" }
  | { type: "SET_OBJECTS"; objects: DrawingObject[]; markDirty?: boolean }
  | { type: "LOAD_OBJECTS"; objects: DrawingObject[] }
  | { type: "MARK_SAVED" }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "SET_SAVE_ERROR"; error: string | null }
  | { type: "SET_TARGET"; jobId: string | null; workOrder: string | null };

// ─── Undo/redo stack (outside reducer so it doesn't re-render) ────────────

// We hold history outside React state to avoid extra renders.
// The reducer signals history pushes via a side-channel ref.
interface HistoryEntry {
  objects: DrawingObject[];
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

function initState(): DrawingState {
  return {
    activeTool: null,
    style: defaultStyleForTool("line"),
    objects: [],
    selectedIds: new Set(),
    dirty: false,
    saving: false,
    saveError: null,
    targetJobId: null,
    targetWorkOrder: null,
  };
}

// History is managed via a ref in the provider; reducer just mutates objects.
function reducer(state: DrawingState, action: Action): DrawingState {
  switch (action.type) {
    case "SET_TOOL": {
      const tool = action.tool;
      const newStyle = tool ? defaultStyleForTool(tool) : state.style;
      return { ...state, activeTool: tool, style: newStyle, selectedIds: new Set() };
    }
    case "SET_STYLE":
      return { ...state, style: { ...state.style, ...action.patch } };

    case "ADD_OBJECT":
      return { ...state, objects: [...state.objects, action.obj], dirty: true };

    case "UPDATE_OBJECT": {
      const objects = state.objects.map((o) => (o.id === action.obj.id ? action.obj : o));
      return { ...state, objects, dirty: true };
    }
    case "DELETE_SELECTED": {
      if (state.selectedIds.size === 0) return state;
      const objects = state.objects.filter((o) => !state.selectedIds.has(o.id));
      return { ...state, objects, selectedIds: new Set(), dirty: true };
    }
    case "SELECT": {
      const next = action.additive ? new Set(state.selectedIds) : new Set<string>();
      action.ids.forEach((id) => next.add(id));
      return { ...state, selectedIds: next };
    }
    case "CLEAR_SELECTION":
      return { ...state, selectedIds: new Set() };

    case "UNDO":
    case "REDO":
      // These are handled externally via the history ref + dispatch SET_OBJECTS
      return state;

    case "SET_OBJECTS":
      return {
        ...state,
        objects: action.objects,
        dirty: action.markDirty !== false,
      };

    case "LOAD_OBJECTS":
      // Loading from server: drop selection, clear dirty/save state.
      return {
        ...state,
        objects: action.objects,
        selectedIds: new Set(),
        dirty: false,
        saveError: null,
      };

    case "MARK_SAVED":
      return { ...state, dirty: false, saveError: null };

    case "SET_SAVING":
      return { ...state, saving: action.saving };

    case "SET_SAVE_ERROR":
      return { ...state, saveError: action.error };

    case "SET_TARGET":
      return { ...state, targetJobId: action.jobId, targetWorkOrder: action.workOrder };

    default:
      return state;
  }
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface DrawingContextValue {
  state: DrawingState;
  dispatch: React.Dispatch<Action>;
  // Convenience wrappers
  setTool: (tool: DrawingTool | null) => void;
  setStyle: (patch: Partial<DrawingStyle>) => void;
  addObject: (obj: DrawingObject) => void;
  updateObject: (obj: DrawingObject) => void;
  deleteSelected: () => void;
  select: (ids: string[], additive?: boolean) => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setTarget: (jobId: string | null, workOrder: string | null) => void;
  /**
   * Replace the current overlay with objects loaded from the server.
   * Clears selection, resets dirty flag, and pushes onto undo history.
   */
  loadObjects: (objects: DrawingObject[]) => void;
  save: () => Promise<void>;
  mapRef: MutableRefObject<google.maps.Map | null>;
}

const DrawingContext = createContext<DrawingContextValue | null>(null);

export function useDrawing(): DrawingContextValue {
  const ctx = useContext(DrawingContext);
  if (!ctx) throw new Error("useDrawing must be inside DrawingProvider");
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

interface Props {
  children: ReactNode;
  mapRef: MutableRefObject<google.maps.Map | null>;
}

export function DrawingProvider({ children, mapRef }: Props) {
  const [state, dispatch] = useReducer(reducer, undefined, initState);

  // Undo/redo managed outside React state to avoid cascading renders
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  // historyVersion bumps whenever the undo/redo stacks change so consumers
  // (toolbar buttons) re-render with fresh canUndo/canRedo flags.
  const [historyVersion, setHistoryVersion] = useState(0);
  const bumpHistory = useCallback(() => setHistoryVersion((v) => v + 1), []);

  // We need a stable ref to current objects for undo/redo
  const objectsRef = useRef<DrawingObject[]>([]);
  objectsRef.current = state.objects;

  const pushHistory = useCallback(() => {
    undoStack.current.push({ objects: [...objectsRef.current] });
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    bumpHistory();
  }, [bumpHistory]);

  const addObject = useCallback(
    (obj: DrawingObject) => {
      pushHistory();
      dispatch({ type: "ADD_OBJECT", obj });
    },
    [pushHistory]
  );

  const updateObject = useCallback(
    (obj: DrawingObject) => {
      pushHistory();
      dispatch({ type: "UPDATE_OBJECT", obj });
    },
    [pushHistory]
  );

  const deleteSelected = useCallback(() => {
    if (state.selectedIds.size === 0) return;
    pushHistory();
    dispatch({ type: "DELETE_SELECTED" });
  }, [state.selectedIds, pushHistory]);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ objects: [...objectsRef.current] });
    bumpHistory();
    dispatch({ type: "SET_OBJECTS", objects: prev.objects });
  }, [bumpHistory]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ objects: [...objectsRef.current] });
    bumpHistory();
    dispatch({ type: "SET_OBJECTS", objects: next.objects });
  }, [bumpHistory]);

  const setTool = useCallback((tool: DrawingTool | null) => {
    dispatch({ type: "SET_TOOL", tool });
  }, []);

  const setStyle = useCallback((patch: Partial<DrawingStyle>) => {
    dispatch({ type: "SET_STYLE", patch });
  }, []);

  const select = useCallback((ids: string[], additive = false) => {
    dispatch({ type: "SELECT", ids, additive });
  }, []);

  const clearSelection = useCallback(() => {
    dispatch({ type: "CLEAR_SELECTION" });
  }, []);

  const setTarget = useCallback((jobId: string | null, workOrder: string | null) => {
    dispatch({ type: "SET_TARGET", jobId, workOrder });
  }, []);

  const loadObjects = useCallback((objects: DrawingObject[]) => {
    // Loading from server is a hard reset — clear undo history so the user
    // can't "undo" the server state away.
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
    dispatch({ type: "LOAD_OBJECTS", objects });
  }, [bumpHistory]);

  const save = useCallback(async () => {
    const { targetJobId, objects } = state;
    if (!targetJobId) return;
    dispatch({ type: "SET_SAVING", saving: true });
    dispatch({ type: "SET_SAVE_ERROR", error: null });
    try {
      const payload = {
        jobId: targetJobId,
        objects,
        updatedAt: Date.now(),
        schemaVersion: 2 as const,
      };
      await api.putDrawing(targetJobId, payload as unknown as AsBuiltDocument);
      dispatch({ type: "MARK_SAVED" });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: "SET_SAVE_ERROR", error: msg });
    } finally {
      dispatch({ type: "SET_SAVING", saving: false });
    }
  }, [state]);

  const value: DrawingContextValue = {
    state,
    dispatch,
    setTool,
    setStyle,
    addObject,
    updateObject,
    deleteSelected,
    select,
    clearSelection,
    undo,
    redo,
    // canUndo/canRedo are read fresh each render. The historyVersion state
    // bump triggers the re-render so these stay in sync with the ref-backed
    // undo/redo stacks. The void-cast keeps TS happy about the unused value.
    canUndo: (void historyVersion, undoStack.current.length > 0),
    canRedo: redoStack.current.length > 0,
    setTarget,
    loadObjects,
    save,
    mapRef,
  };

  return <DrawingContext.Provider value={value}>{children}</DrawingContext.Provider>;
}
