// Drawing context — central store for the Phase 3/5 drawing toolbar.
// Manages: active tool, style modifiers, undo/redo stack, selected objects,
// dirty flag, target job, persistence, Phase 5 auto-save, and Phase 5.2 localStorage draft.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import type { AsBuiltDocument, DrawingObject, DrawingStyle, DrawingTool, JobLayer } from "@nsc/types";
import { api } from "../../lib/api.js";

// ─── localStorage draft helpers ──────────────────────────────────────────────
const LS_OBJECTS_KEY = "nsc.draft.objects";
const LS_JOB_KEY = "nsc.draft.targetJobId";
const LS_WO_KEY = "nsc.draft.targetWorkOrder";

function lsSaveDraft(
  objects: DrawingObject[],
  targetJobId: string | null,
  targetWorkOrder: string | null
) {
  try {
    localStorage.setItem(LS_OBJECTS_KEY, JSON.stringify(objects));
    if (targetJobId) {
      localStorage.setItem(LS_JOB_KEY, targetJobId);
    } else {
      localStorage.removeItem(LS_JOB_KEY);
    }
    if (targetWorkOrder) {
      localStorage.setItem(LS_WO_KEY, targetWorkOrder);
    } else {
      localStorage.removeItem(LS_WO_KEY);
    }
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

function lsClearDraft(targetJobId?: string | null) {
  try {
    const storedJobId = localStorage.getItem(LS_JOB_KEY);
    // Only clear if the stored draft belongs to the same job (or no job)
    if (targetJobId === undefined || storedJobId === targetJobId) {
      localStorage.removeItem(LS_OBJECTS_KEY);
      localStorage.removeItem(LS_JOB_KEY);
      localStorage.removeItem(LS_WO_KEY);
    }
  } catch {
    // ignore
  }
}

interface LsDraft {
  objects: import("@nsc/types").DrawingObject[];
  targetJobId: string | null;
  targetWorkOrder: string | null;
}

function lsReadDraft(): LsDraft | null {
  try {
    const raw = localStorage.getItem(LS_OBJECTS_KEY);
    if (!raw) return null;
    const objects = JSON.parse(raw) as import("@nsc/types").DrawingObject[];
    if (!Array.isArray(objects) || objects.length === 0) return null;
    const targetJobId = localStorage.getItem(LS_JOB_KEY);
    const targetWorkOrder = localStorage.getItem(LS_WO_KEY);
    return { objects, targetJobId, targetWorkOrder };
  } catch {
    return null;
  }
}


// ─── Default styles per tool category ───────────────────────────────────────

export const COLORS = {
  neonGreen: "#39ff7a",
  neonRed: "#ff2d4a",
  cyan: "#3aa7ff",
  white: "#f4f8ff",
  black: "#000000",
} as const;

function defaultStyleForTool(tool: DrawingTool): DrawingStyle {
  // Phase 4: cable colors are hardcoded in DrawingOverlay, but we still set
  // them here so the modifier strip can show the right color swatch.
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
      strokeStyle: "solid",
      fill: { kind: "none" },
      opacity: 1,
    };
  }
  // Point tools (MH, HH, PED, POLE, CABINET, ANCHOR variants) — black
  if (tool.endsWith("_new") || tool.endsWith("_removed")) {
    return {
      strokeColor: COLORS.black,
      strokeWidth: 2,
      strokeStyle: "solid",
      fill: { kind: "none" },
      opacity: 1,
    };
  }
  if (tool === "text") {
    return {
      strokeColor: COLORS.black,
      strokeWidth: 1,
      strokeStyle: "solid",
      fill: { kind: "solid", color: "rgba(255,255,255,0.85)" },
      opacity: 1,
    };
  }
  // Basic tools default to cobalt blue
  return {
    strokeColor: "#1565C0",
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
  /** Phase 9: per-job MyMaps layers. */
  layers: JobLayer[];
  /** Phase 9: active layer id — new objects join this layer. */
  activeLayerId: string | null;
  selectedIds: Set<string>;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  targetJobId: string | null;
  targetWorkOrder: string | null;
  /** Phase 5: workspace mode auto-save countdown (seconds until save), null if idle */
  autoSaveCountdown: number | null;
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
  | { type: "LOAD_OBJECTS"; objects: DrawingObject[]; layers?: JobLayer[] }
  | { type: "MARK_SAVED" }
  | { type: "SET_SAVING"; saving: boolean }
  | { type: "SET_SAVE_ERROR"; error: string | null }
  | { type: "SET_TARGET"; jobId: string | null; workOrder: string | null }
  | { type: "SET_AUTO_SAVE_COUNTDOWN"; countdown: number | null }
  | { type: "SET_LAYERS"; layers: JobLayer[] }
  | { type: "SET_ACTIVE_LAYER"; layerId: string | null };

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
    layers: [],
    activeLayerId: null,
    selectedIds: new Set(),
    dirty: false,
    saving: false,
    saveError: null,
    targetJobId: null,
    targetWorkOrder: null,
    autoSaveCountdown: null,
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

    case "ADD_OBJECT": {
      const layerId = action.obj.style.layerId ?? state.activeLayerId ?? undefined;
      const objWithLayer: DrawingObject = layerId
        ? { ...action.obj, style: { ...action.obj.style, layerId } }
        : action.obj;
      return { ...state, objects: [...state.objects, objWithLayer], dirty: true };
    }

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
        layers: action.layers ?? state.layers,
        activeLayerId:
          action.layers && action.layers.length > 0
            ? action.layers[0]!.id
            : state.activeLayerId,
        selectedIds: new Set(),
        dirty: false,
        saveError: null,
      };

    case "SET_LAYERS":
      return { ...state, layers: action.layers, dirty: true };

    case "SET_ACTIVE_LAYER":
      return { ...state, activeLayerId: action.layerId };

    case "MARK_SAVED":
      return { ...state, dirty: false, saveError: null };

    case "SET_SAVING":
      return { ...state, saving: action.saving };

    case "SET_SAVE_ERROR":
      return { ...state, saveError: action.error };

    case "SET_TARGET":
      return { ...state, targetJobId: action.jobId, targetWorkOrder: action.workOrder };

    case "SET_AUTO_SAVE_COUNTDOWN":
      return { ...state, autoSaveCountdown: action.countdown };

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
  /** Phase 5: update a single object's style fields without full replace */
  patchObjectStyle: (id: string, stylePartial: Partial<DrawingStyle>) => void;
  /** Phase 5.3: update an object's geometry (vertices / bounds) after drag edit */
  updateObjectGeometry: (id: string, vertices: Array<{ lat: number; lng: number }>) => void;
  /** Phase 5.3: update a point object's position after marker drag */
  updateObjectPosition: (id: string, position: { lat: number; lng: number }) => void;
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
  loadObjects: (objects: DrawingObject[], layers?: JobLayer[]) => void;
  /** Phase 9: layer management. */
  addLayer: (label: string) => string;
  renameLayer: (id: string, label: string) => void;
  deleteLayer: (id: string) => void;
  toggleLayerVisibility: (id: string) => void;
  setActiveLayer: (id: string | null) => void;
  moveObjectsToLayer: (objIds: string[], layerId: string | null) => void;
  save: () => Promise<void>;
  /** Phase 5.2: clear the localStorage draft for the current target (or any draft) */
  clearDraft: () => void;
  mapRef: MutableRefObject<google.maps.Map | null>;
  /** Phase 5: workspace mode — when set, enables auto-save (10s debounce) */
  workspaceJobId: string | null;
  setWorkspaceJobId: (id: string | null) => void;
}

export const DrawingContext = createContext<DrawingContextValue | null>(null);

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

  // Phase 5: workspace job id for auto-save
  const [workspaceJobId, setWorkspaceJobId] = useState<string | null>(null);

  // We need a stable ref to current objects for undo/redo
  const objectsRef = useRef<DrawingObject[]>([]);
  objectsRef.current = state.objects;
  const stateRef = useRef(state);
  stateRef.current = state;

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

  const loadObjects = useCallback((objects: DrawingObject[], layers?: JobLayer[]) => {
    // Loading from server is a hard reset — clear undo history so the user
    // can't "undo" the server state away.
    undoStack.current = [];
    redoStack.current = [];
    bumpHistory();
    dispatch({ type: "LOAD_OBJECTS", objects, layers });
  }, [bumpHistory]);

  // ─── Phase 9: layer ops ────────────────────────────────────────────────
  const addLayer = useCallback((label: string): string => {
    const id = `layer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const layer: JobLayer = { id, label: label.trim() || "New Layer" };
    const next = [...stateRef.current.layers, layer];
    dispatch({ type: "SET_LAYERS", layers: next });
    dispatch({ type: "SET_ACTIVE_LAYER", layerId: id });
    return id;
  }, []);

  const renameLayer = useCallback((id: string, label: string) => {
    const next = stateRef.current.layers.map((l) => (l.id === id ? { ...l, label } : l));
    dispatch({ type: "SET_LAYERS", layers: next });
  }, []);

  const deleteLayer = useCallback((id: string) => {
    const next = stateRef.current.layers.filter((l) => l.id !== id);
    dispatch({ type: "SET_LAYERS", layers: next });
    // Objects on the deleted layer become unsorted
    const objs = stateRef.current.objects.map((o) =>
      o.style.layerId === id ? ({ ...o, style: { ...o.style, layerId: undefined } } as DrawingObject) : o
    );
    dispatch({ type: "SET_OBJECTS", objects: objs });
    if (stateRef.current.activeLayerId === id) {
      dispatch({ type: "SET_ACTIVE_LAYER", layerId: next[0]?.id ?? null });
    }
  }, []);

  const toggleLayerVisibility = useCallback((id: string) => {
    const next = stateRef.current.layers.map((l) =>
      l.id === id ? { ...l, hidden: !l.hidden } : l
    );
    dispatch({ type: "SET_LAYERS", layers: next });
    // Hide/show all objects on this layer
    const layerHidden = next.find((l) => l.id === id)?.hidden ?? false;
    const objs = stateRef.current.objects.map((o) =>
      o.style.layerId === id ? ({ ...o, style: { ...o.style, hidden: layerHidden } } as DrawingObject) : o
    );
    dispatch({ type: "SET_OBJECTS", objects: objs });
  }, []);

  const setActiveLayer = useCallback((id: string | null) => {
    dispatch({ type: "SET_ACTIVE_LAYER", layerId: id });
  }, []);

  const moveObjectsToLayer = useCallback((objIds: string[], layerId: string | null) => {
    const set = new Set(objIds);
    const objs = stateRef.current.objects.map((o) =>
      set.has(o.id)
        ? ({ ...o, style: { ...o.style, layerId: layerId ?? undefined } } as DrawingObject)
        : o
    );
    dispatch({ type: "SET_OBJECTS", objects: objs });
  }, []);

  const patchObjectStyle = useCallback((id: string, stylePartial: Partial<DrawingStyle>) => {
    const obj = objectsRef.current.find((o) => o.id === id);
    if (!obj) return;
    dispatch({ type: "UPDATE_OBJECT", obj: { ...obj, style: { ...obj.style, ...stylePartial } } });
  }, []);

  const updateObjectGeometry = useCallback((id: string, vertices: Array<{ lat: number; lng: number }>) => {
    const obj = objectsRef.current.find((o) => o.id === id);
    if (!obj || !("vertices" in obj)) return;
    // No pushHistory — geometry drags are continuous; caller handles undo granularity
    dispatch({ type: "UPDATE_OBJECT", obj: { ...obj, vertices } });
  }, []);

  const updateObjectPosition = useCallback((id: string, position: { lat: number; lng: number }) => {
    const obj = objectsRef.current.find((o) => o.id === id);
    if (!obj || !("position" in obj)) return;
    dispatch({ type: "UPDATE_OBJECT", obj: { ...obj, position } as DrawingObject });
  }, []);

  const save = useCallback(async () => {
    const { targetJobId, objects } = stateRef.current;
    if (!targetJobId) {
      dispatch({
        type: "SET_SAVE_ERROR",
        error: "No job selected. Click a pin on the map first, then save.",
      });
      return;
    }
    dispatch({ type: "SET_SAVING", saving: true });
    dispatch({ type: "SET_SAVE_ERROR", error: null });
    dispatch({ type: "SET_AUTO_SAVE_COUNTDOWN", countdown: null });
    try {
      const payload = {
        jobId: targetJobId,
        objects,
        layers: stateRef.current.layers,
        updatedAt: Date.now(),
        schemaVersion: 2 as const,
      };
      await api.putDrawing(targetJobId, payload as unknown as AsBuiltDocument);
      dispatch({ type: "MARK_SAVED" });
      // Phase 5.2: clear localStorage draft after successful server save
      lsClearDraft(targetJobId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      dispatch({ type: "SET_SAVE_ERROR", error: msg });
    } finally {
      dispatch({ type: "SET_SAVING", saving: false });
    }
  }, []);

  const clearDraft = useCallback(() => {
    lsClearDraft(stateRef.current.targetJobId);
  }, []);

  // Phase 5: auto-save — 10-second debounce when workspace mode is active
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const AUTO_SAVE_DELAY = 10; // seconds

  const clearAutoSaveTimers = useCallback(() => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
  }, []);

  const saveRef = useRef(save);
  saveRef.current = save;

  useEffect(() => {
    // Auto-save when a target job is set (workspace or main map) and there are unsaved changes
    if (!state.targetJobId || !state.dirty || state.saving) return;

    clearAutoSaveTimers();

    let remaining = AUTO_SAVE_DELAY;
    dispatch({ type: "SET_AUTO_SAVE_COUNTDOWN", countdown: remaining });

    countdownTimerRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        dispatch({ type: "SET_AUTO_SAVE_COUNTDOWN", countdown: remaining });
      } else {
        if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      }
    }, 1000);

    autoSaveTimerRef.current = setTimeout(() => {
      clearAutoSaveTimers();
      void saveRef.current();
    }, AUTO_SAVE_DELAY * 1000);

    return clearAutoSaveTimers;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.targetJobId, state.dirty, state.objects]);

  // Phase 5.2: persist to localStorage on every objects change (debounced 500ms)
  const lsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (lsDebounceRef.current) clearTimeout(lsDebounceRef.current);
    lsDebounceRef.current = setTimeout(() => {
      lsSaveDraft(state.objects, state.targetJobId, state.targetWorkOrder);
    }, 500);
    return () => {
      if (lsDebounceRef.current) clearTimeout(lsDebounceRef.current);
    };
  // We intentionally run this for every objects/target change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.objects, state.targetJobId, state.targetWorkOrder]);

  // Phase 5.2: hydrate from localStorage on mount (only when in-memory state is empty)
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    // Only restore if we have no objects in memory yet
    if (state.objects.length > 0) return;
    const draft = lsReadDraft();
    if (!draft) return;
    // Restore the draft objects and target into the drawing state
    dispatch({ type: "SET_OBJECTS", objects: draft.objects, markDirty: true });
    if (draft.targetJobId) {
      dispatch({ type: "SET_TARGET", jobId: draft.targetJobId, workOrder: draft.targetWorkOrder });
    }
  // Run once on mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn before tab close/navigation when there are unsaved drawings
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (state.dirty && state.objects.length > 0) {
        e.preventDefault();
        e.returnValue = "";
        return "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.dirty, state.objects.length]);

  const value: DrawingContextValue = {
    state,
    dispatch,
    setTool,
    setStyle,
    addObject,
    updateObject,
    patchObjectStyle,
    updateObjectGeometry,
    updateObjectPosition,
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
    addLayer,
    renameLayer,
    deleteLayer,
    toggleLayerVisibility,
    setActiveLayer,
    moveObjectsToLayer,
    save,
    clearDraft,
    mapRef,
    workspaceJobId,
    setWorkspaceJobId,
  };

  return <DrawingContext.Provider value={value}>{children}</DrawingContext.Provider>;
}
