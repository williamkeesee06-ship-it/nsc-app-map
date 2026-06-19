// TASKS tab — Lumina-aware task list with rich-text inline editing,
// drag-to-reorder, subtask nesting, and 30s polling for Lumina-added tasks.
//
// Billy 6/18: "I WANT A TASKS TAB THAT REPLACES ROUTE IN THE LEFT RAIL."
//
// Layout: variable width (320–720px) inside the left rail scroll area.
// Royal blue (#0052cc) is the canonical Lumina/NSC accent — used for FAB,
// lumina-sourced task text color, envelope chips, etc.

import "./tasks-tab.css";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface EmailRef {
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
  dateIso: string;
  gmailUrl: string;
}

interface JobRef {
  id: string;
  label: string;
}

interface Task {
  id: string;
  ownerName: string;
  text: string;
  done: boolean;
  parentId: string | null;
  orderIndex: number;
  source: "user" | "lumina-chat" | "lumina-email";
  emailRef: EmailRef | null;
  jobRef: JobRef | null;
  createdAt: number;
  completedAt: number | null;
  lastPingedAt: number | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const OWNER = "Billy Keesee";
const ROYAL_BLUE = "#0052cc";
const POLL_MS = 30_000;
const FADE_MS = 250;

// ─── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText })) as { error?: string };
    throw new Error(err.error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

function loadTasks(): Promise<{ tasks: Task[] }> {
  return apiFetch<{ tasks: Task[] }>(`/api/tasks?owner=${encodeURIComponent(OWNER)}`);
}

function createTask(body: {
  ownerName: string;
  text: string;
  parentId?: string | null;
  source?: Task["source"];
  jobRef?: JobRef | null;
}): Promise<{ task: Task }> {
  return apiFetch<{ task: Task }>("/api/tasks", { method: "POST", body: JSON.stringify(body) });
}

function updateTask(id: string, body: Partial<Pick<Task, "text" | "done" | "parentId" | "orderIndex" | "jobRef">>): Promise<{ task: Task }> {
  return apiFetch<{ task: Task }>(`/api/tasks/${id}`, { method: "PATCH", body: JSON.stringify(body) });
}

function deleteTask(id: string): Promise<void> {
  return apiFetch<void>(`/api/tasks/${id}`, { method: "DELETE" });
}

function reorderTasks(ownerName: string, parentId: string | null, orderedIds: string[]): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>("/api/tasks/reorder", {
    method: "POST",
    body: JSON.stringify({ ownerName, parentId, orderedIds }),
  });
}

// ─── Formatting toolbar ────────────────────────────────────────────────────────

// The toolbar applies formatting to whichever tiptap editor is currently focused.
// We track focus via a ref shared upward.

type ActiveEditorRef = React.MutableRefObject<ReturnType<typeof useEditor> | null>;

function FormattingToolbar({ activeEditorRef }: { activeEditorRef: ActiveEditorRef }) {
  const COLOR_SWATCHES = [
    { label: "Black", value: "#15202c" },
    { label: "Blue", value: ROYAL_BLUE },
    { label: "Red", value: "#d63333" },
    { label: "Gray", value: "#5b6776" },
  ];

  function cmd(action: (ed: NonNullable<ReturnType<typeof useEditor>>) => void) {
    const ed = activeEditorRef.current;
    if (!ed) return;
    action(ed);
    ed.commands.focus();
  }

  return (
    <div className="tasks-toolbar">
      <button
        className="tasks-toolbar__btn"
        title="Bold"
        onMouseDown={(e) => { e.preventDefault(); cmd((ed) => ed.chain().toggleBold().run()); }}
      >
        <strong>B</strong>
      </button>
      <button
        className="tasks-toolbar__btn"
        title="Italic"
        onMouseDown={(e) => { e.preventDefault(); cmd((ed) => ed.chain().toggleItalic().run()); }}
      >
        <em>I</em>
      </button>
      <button
        className="tasks-toolbar__btn"
        title="Underline"
        onMouseDown={(e) => { e.preventDefault(); cmd((ed) => ed.chain().toggleUnderline().run()); }}
      >
        <u>U</u>
      </button>
      <button
        className="tasks-toolbar__btn"
        title="Strikethrough"
        onMouseDown={(e) => { e.preventDefault(); cmd((ed) => ed.chain().toggleStrike().run()); }}
      >
        <s>S</s>
      </button>
      <div className="tasks-toolbar__swatches">
        {COLOR_SWATCHES.map((sw) => (
          <button
            key={sw.value}
            className="tasks-toolbar__swatch"
            title={sw.label}
            style={{ background: sw.value }}
            onMouseDown={(e) => {
              e.preventDefault();
              cmd((ed) => ed.chain().setColor(sw.value).run());
            }}
          />
        ))}
      </div>
    </div>
  );
}

// ─── Single task row ───────────────────────────────────────────────────────────

interface TaskRowProps {
  task: Task;
  isSubtask: boolean;
  subtaskCount: number;
  doneSubtaskCount: number;
  activeEditorRef: ActiveEditorRef;
  onCheck: (task: Task) => void;
  onTextChange: (task: Task, html: string) => void;
  onTab: (task: Task) => void;
  onShiftTab: (task: Task) => void;
  onAddSubtask: (parentId: string) => void;
}

function TaskRow({
  task,
  isSubtask,
  subtaskCount,
  doneSubtaskCount,
  activeEditorRef,
  onCheck,
  onTextChange,
  onTab,
  onShiftTab,
  onAddSubtask,
}: TaskRowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const isLumina = task.source === "lumina-chat" || task.source === "lumina-email";

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Disable block-level constructs — this is inline-only.
        heading: false,
        codeBlock: false,
        horizontalRule: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
      }),
      Underline,
      TextStyle,
      Color,
    ],
    content: task.text || "",
    onFocus: () => {
      activeEditorRef.current = editor;
    },
    onBlur: () => {
      // Keep ref so toolbar stays usable briefly after blur.
    },
    onUpdate: ({ editor: ed }) => {
      onTextChange(task, ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: `tasks-row__editor${isLumina ? " tasks-row__editor--lumina" : ""}`,
      },
      handleKeyDown(_, event) {
        if (event.key === "Tab") {
          event.preventDefault();
          if (event.shiftKey) {
            onShiftTab(task);
          } else {
            onTab(task);
          }
          return true;
        }
        return false;
      },
    },
  });

  // Sync content when task.text changes externally (poll update).
  const lastTextRef = useRef(task.text);
  useEffect(() => {
    if (!editor) return;
    if (task.text !== lastTextRef.current && !editor.isFocused) {
      editor.commands.setContent(task.text || "", { emitUpdate: false });
      lastTextRef.current = task.text;
    }
  }, [editor, task.text]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`tasks-row${isSubtask ? " tasks-row--subtask" : ""}${isLumina ? " tasks-row--lumina" : ""}`}
    >
      {/* Drag handle */}
      <span
        className="tasks-row__grip"
        {...attributes}
        {...listeners}
        title="Drag to reorder"
        aria-label="Drag handle"
      >
        ⠿
      </span>

      {/* Checkbox */}
      <input
        type="checkbox"
        className="tasks-row__checkbox"
        checked={false}
        onChange={() => onCheck(task)}
        aria-label="Mark task complete"
      />

      {/* Inline editor */}
      <div className="tasks-row__text">
        <EditorContent editor={editor} />
      </div>

      {/* Subtask badge */}
      {!isSubtask && subtaskCount > 0 && (
        <span className="tasks-row__subtask-badge">
          {doneSubtaskCount}/{subtaskCount}
        </span>
      )}

      {/* Email chip for lumina-email tasks */}
      {task.source === "lumina-email" && task.emailRef && (
        <a
          className="tasks-row__email-chip"
          href={task.emailRef.gmailUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={`From: ${task.emailRef.from}\n${task.emailRef.subject}`}
        >
          ✉
        </a>
      )}

      {/* Job pill */}
      {task.jobRef && (
        <span
          className="tasks-row__job-pill"
          title={task.jobRef.id}
        >
          {task.jobRef.label}
        </span>
      )}

      {/* + subtask button (top-level tasks only, hover-visible via CSS) */}
      {!isSubtask && (
        <button
          className="tasks-row__add-subtask"
          onClick={() => onAddSubtask(task.id)}
          title="Add subtask"
        >
          + subtask
        </button>
      )}
    </div>
  );
}

// ─── Main TasksTab component ───────────────────────────────────────────────────

export default function TasksTab() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  const activeEditorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  const textPendingRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // ─── Data fetching ────────────────────────────────────────────────────────

  const fetchTasks = useCallback(async () => {
    try {
      const { tasks: fetched } = await loadTasks();
      setTasks(fetched);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[TasksTab] fetch error:", err);
    }
  }, []);

  useEffect(() => {
    void fetchTasks();
    const interval = setInterval(() => void fetchTasks(), POLL_MS);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  // ─── Derived state ────────────────────────────────────────────────────────

  const topLevel = tasks.filter((t) => t.parentId === null);
  const byParentId = new Map<string, Task[]>();
  tasks.forEach((t) => {
    if (t.parentId !== null) {
      const arr = byParentId.get(t.parentId) ?? [];
      arr.push(t);
      byParentId.set(t.parentId, arr);
    }
  });

  // ─── Optimistic mutations ─────────────────────────────────────────────────

  const handleCheck = useCallback(async (task: Task) => {
    // Fade out, then delete.
    setFadingIds((prev) => new Set([...prev, task.id]));
    // Also fade subtasks.
    const children = byParentId.get(task.id) ?? [];
    children.forEach((c) => {
      setFadingIds((prev) => new Set([...prev, c.id]));
    });

    setTimeout(async () => {
      setTasks((prev) => prev.filter((t) => t.id !== task.id && t.parentId !== task.id));
      setFadingIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      try {
        await deleteTask(task.id);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[TasksTab] delete error:", err);
        // Revert: re-fetch.
        void fetchTasks();
      }
    }, FADE_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byParentId, fetchTasks]);

  // Debounced text save (300ms after last keystroke).
  const handleTextChange = useCallback((task: Task, html: string) => {
    setTasks((prev) => prev.map((t) => (t.id === task.id ? { ...t, text: html } : t)));
    // Clear any pending save for this task.
    const pending = textPendingRef.current.get(task.id);
    if (pending !== undefined) clearTimeout(pending);
    const timer = setTimeout(async () => {
      textPendingRef.current.delete(task.id);
      try {
        await updateTask(task.id, { text: html });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[TasksTab] text update error:", err);
      }
    }, 300);
    textPendingRef.current.set(task.id, timer);
  }, []);

  // Tab → demote to subtask of the task above in the top-level list.
  const handleTab = useCallback(async (task: Task) => {
    if (task.parentId !== null) return; // already a subtask, no deeper nesting
    const idx = topLevel.findIndex((t) => t.id === task.id);
    if (idx <= 0) return; // nothing above to be a child of
    const parent = topLevel[idx - 1];
    const siblings = byParentId.get(parent.id) ?? [];
    const newOrderIndex = siblings.length > 0
      ? Math.max(...siblings.map((s) => s.orderIndex)) + 1
      : 0;

    // Optimistic update.
    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, parentId: parent.id, orderIndex: newOrderIndex } : t
      )
    );
    try {
      await updateTask(task.id, { parentId: parent.id, orderIndex: newOrderIndex });
    } catch {
      void fetchTasks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevel, byParentId, fetchTasks]);

  // Shift+Tab → promote subtask to top-level.
  const handleShiftTab = useCallback(async (task: Task) => {
    if (task.parentId === null) return;
    const newOrderIndex = topLevel.length > 0
      ? Math.max(...topLevel.map((t) => t.orderIndex)) + 1
      : 0;

    setTasks((prev) =>
      prev.map((t) =>
        t.id === task.id ? { ...t, parentId: null, orderIndex: newOrderIndex } : t
      )
    );
    try {
      await updateTask(task.id, { parentId: null, orderIndex: newOrderIndex });
    } catch {
      void fetchTasks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevel, fetchTasks]);

  const handleAddSubtask = useCallback(async (parentId: string) => {
    const siblings = byParentId.get(parentId) ?? [];
    const orderIndex = siblings.length > 0
      ? Math.max(...siblings.map((s) => s.orderIndex)) + 1
      : 0;
    try {
      const { task } = await createTask({
        ownerName: OWNER,
        text: "",
        parentId,
        source: "user",
        orderIndex,
      } as Parameters<typeof createTask>[0] & { orderIndex?: number });
      setTasks((prev) => [...prev, task]);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[TasksTab] add subtask error:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byParentId]);

  // FAB: add top-level task.
  const handleAddTopLevel = useCallback(async () => {
    const orderIndex = topLevel.length > 0
      ? Math.max(...topLevel.map((t) => t.orderIndex)) + 1
      : 0;
    try {
      const { task } = await createTask({
        ownerName: OWNER,
        text: "",
        parentId: null,
        source: "user",
        orderIndex,
      } as Parameters<typeof createTask>[0] & { orderIndex?: number });
      setTasks((prev) => [...prev, task]);
      // Focus the new editor after React re-renders.
      // (The TaskRow will auto-focus via its ref on mount if needed.)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[TasksTab] add task error:", err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topLevel]);

  // ─── DnD ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const handleDragEnd = useCallback(
    async (event: DragEndEvent, parentId: string | null) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const siblingList = parentId === null
        ? topLevel
        : (byParentId.get(parentId) ?? []);

      const oldIdx = siblingList.findIndex((t) => t.id === active.id);
      const newIdx = siblingList.findIndex((t) => t.id === over.id);
      if (oldIdx < 0 || newIdx < 0) return;

      const reordered = arrayMove(siblingList, oldIdx, newIdx);
      const orderedIds = reordered.map((t) => t.id);

      // Optimistic reorder.
      setTasks((prev) => {
        const others = prev.filter((t) => !orderedIds.includes(t.id));
        const updated = reordered.map((t, i) => ({ ...t, orderIndex: i }));
        return [...others, ...updated];
      });

      try {
        await reorderTasks(OWNER, parentId, orderedIds);
      } catch {
        void fetchTasks();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topLevel, byParentId, fetchTasks]
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const openCount = tasks.length;

  return (
    <div className="tasks-tab">
      {/* Header */}
      <div className="tasks-header">
        <span className="tasks-header__title">Tasks</span>
        {openCount > 0 && (
          <span className="tasks-header__count">{openCount} open</span>
        )}
      </div>

      {/* Formatting toolbar */}
      <FormattingToolbar activeEditorRef={activeEditorRef} />

      {/* Empty state */}
      {openCount === 0 && (
        <div className="tasks-empty">
          <span className="tasks-empty__sparkle">✦</span>
          <span>No tasks. Tap + to add one or ask Lumina.</span>
        </div>
      )}

      {/* Task list */}
      {openCount > 0 && (
        <div className="tasks-list">
          {/* Top-level sortable context */}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={(e) => void handleDragEnd(e, null)}
          >
            <SortableContext
              items={topLevel.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {topLevel.map((task) => {
                const children = byParentId.get(task.id) ?? [];
                const isFading = fadingIds.has(task.id);
                return (
                  <div
                    key={task.id}
                    className={`tasks-group${isFading ? " tasks-group--fading" : ""}`}
                    style={{ transition: `opacity ${FADE_MS}ms`, opacity: isFading ? 0 : 1 }}
                  >
                    <TaskRow
                      task={task}
                      isSubtask={false}
                      subtaskCount={children.length}
                      doneSubtaskCount={0}
                      activeEditorRef={activeEditorRef}
                      onCheck={handleCheck}
                      onTextChange={handleTextChange}
                      onTab={handleTab}
                      onShiftTab={handleShiftTab}
                      onAddSubtask={handleAddSubtask}
                    />

                    {/* Subtasks sortable context */}
                    {children.length > 0 && (
                      <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={(e) => void handleDragEnd(e, task.id)}
                      >
                        <SortableContext
                          items={children.map((c) => c.id)}
                          strategy={verticalListSortingStrategy}
                        >
                          {children.map((child) => {
                            const childFading = fadingIds.has(child.id);
                            return (
                              <div
                                key={child.id}
                                style={{ transition: `opacity ${FADE_MS}ms`, opacity: childFading ? 0 : 1 }}
                              >
                                <TaskRow
                                  task={child}
                                  isSubtask
                                  subtaskCount={0}
                                  doneSubtaskCount={0}
                                  activeEditorRef={activeEditorRef}
                                  onCheck={handleCheck}
                                  onTextChange={handleTextChange}
                                  onTab={handleTab}
                                  onShiftTab={handleShiftTab}
                                  onAddSubtask={handleAddSubtask}
                                />
                              </div>
                            );
                          })}
                        </SortableContext>
                      </DndContext>
                    )}
                  </div>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* Floating + FAB */}
      <button
        className="tasks-fab"
        onClick={() => void handleAddTopLevel()}
        title="Add task"
        aria-label="Add new task"
      >
        +
      </button>
    </div>
  );
}
