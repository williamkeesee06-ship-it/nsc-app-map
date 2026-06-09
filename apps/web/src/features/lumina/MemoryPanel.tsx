/**
 * MemoryPanel — Phase 5d.
 *
 * Inline panel rendered inside the Lumina tab between the header and the
 * pending-actions strip. Lets Billy directly manage what Lumina remembers
 * about him without having to ask her in chat. CRUD + pin all hit the
 * /api/lumina/memories/:user endpoints.
 *
 * Why inline (not a separate route or modal):
 *  - The Lumina tab already owns the entire right-of-tabstrip area; no
 *    routing exists for sub-views.
 *  - A modal would hide the chat — Billy wants to see both at once
 *    ("did Lumina just save it? yes, there it is in the list").
 *  - Collapsed by default so chat keeps its full vertical real estate.
 *
 * Refresh strategy:
 *  - Loads on mount (and whenever username changes).
 *  - Refreshes when the global `nsc:memory-saved` event fires (dispatched
 *    by ChatPanel's APPLY handler after a Lumina-initiated save).
 *  - User-initiated CRUD updates state from the server response directly
 *    so no extra round-trip is needed.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type LuminaMemoryItem } from "../../lib/api.js";
import { useAuth } from "../auth/authContext.js";

interface MemoryPanelProps {
  /** Whether the panel is expanded. Parent owns the toggle. */
  open: boolean;
  /** Notify parent when expanded so it can adjust adjacent UI if needed. */
  onClose: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sorting + filtering helpers — pinned first, then most-recently-updated.
// ─────────────────────────────────────────────────────────────────────────────
function sortMemories(items: LuminaMemoryItem[]): LuminaMemoryItem[] {
  return [...items].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}

function formatRelative(ts: number): string {
  const ms = Date.now() - ts;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

export default function MemoryPanel({ open, onClose }: MemoryPanelProps) {
  const { username } = useAuth();
  const [items, setItems] = useState<LuminaMemoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Add-form state
  const [newText, setNewText] = useState("");
  const [newKind, setNewKind] = useState<string>("fact");
  const [adding, setAdding] = useState(false);

  // Inline edit state — only one row editing at a time.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  // ── Load ───────────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    if (!username) return;
    setLoading(true);
    setError(null);
    try {
      const { items: fetched } = await api.listMemories(username);
      setItems(sortMemories(fetched));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [username]);

  // Load on mount and whenever username changes. Only fetch when the panel
  // is open the first time — but once loaded we keep it fresh via the event
  // bus so it's accurate the next time the user toggles it open.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  // Listen for chat-initiated memory saves so the panel reflects them
  // immediately when expanded. Cheap — single doc read.
  useEffect(() => {
    const handler = () => {
      void refresh();
    };
    window.addEventListener("nsc:memory-saved", handler);
    return () => window.removeEventListener("nsc:memory-saved", handler);
  }, [refresh]);

  // ── CRUD handlers ─────────────────────────────────────────────────────────
  async function handleAdd() {
    if (!username) return;
    const text = newText.trim();
    if (!text) return;
    setAdding(true);
    setError(null);
    try {
      const res = await api.addMemory(username, { text, kind: newKind });
      setItems(sortMemories(res.items));
      setNewText("");
      setNewKind("fact");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAdding(false);
    }
  }

  async function handleTogglePin(item: LuminaMemoryItem) {
    if (!username || savingId) return;
    setSavingId(item.id);
    try {
      const res = await api.updateMemory(username, item.id, { pinned: !item.pinned });
      setItems(sortMemories(res.items));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  async function handleSaveEdit(item: LuminaMemoryItem) {
    if (!username || savingId) return;
    const text = editDraft.trim();
    if (!text || text === item.text) {
      setEditingId(null);
      return;
    }
    setSavingId(item.id);
    try {
      const res = await api.updateMemory(username, item.id, { text });
      setItems(sortMemories(res.items));
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  async function handleDelete(item: LuminaMemoryItem) {
    if (!username || savingId) return;
    // Friendly confirm — these are durable, easy to mis-tap.
    const ok = window.confirm(`Delete this memory?\n\n"${item.text}"`);
    if (!ok) return;
    setSavingId(item.id);
    try {
      const res = await api.deleteMemory(username, item.id);
      setItems(sortMemories(res.items));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingId(null);
    }
  }

  if (!open) return null;

  return (
    <div
      className="lx-px-3 lx-py-2 lx-border-b lx-border-chrome-dark"
      style={{ background: "rgba(8,12,18,0.95)" }}
    >
      {/* Section header */}
      <div className="lx-flex lx-items-center lx-justify-between lx-mb-2">
        <div className="lx-flex lx-items-center lx-gap-2">
          <span
            className="lx-text-xs lx-uppercase lx-tracking-[0.18em] lx-font-bold"
            style={{ color: "var(--lx-neon, #3cffd2)" }}
          >
            Memory
          </span>
          <span className="lx-text-xs" style={{ color: "var(--text-muted)" }}>
            {items.length}/200
          </span>
          {loading && (
            <span className="lx-text-xs" style={{ color: "var(--text-muted)" }}>
              loading…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="lx-text-xs lx-px-2 lx-py-0.5 lx-rounded lx-bg-ink-800 hover:lx-text-white"
          style={{ color: "var(--text-muted)" }}
          title="Hide memory panel"
        >
          ▴
        </button>
      </div>

      {error && (
        <div
          className="lx-text-xs lx-mb-2 lx-px-2 lx-py-1 lx-rounded"
          style={{ background: "rgba(255,77,77,0.1)", color: "#ff8a8a" }}
        >
          {error}
        </div>
      )}

      {/* Add row */}
      <div className="lx-flex lx-gap-1 lx-mb-2">
        <input
          type="text"
          value={newText}
          onChange={(e) => setNewText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !adding) {
              e.preventDefault();
              void handleAdd();
            }
          }}
          placeholder="Add a memory… (Heritage handles UG splices, etc.)"
          maxLength={500}
          className="lx-flex-1 lx-px-2 lx-py-1 lx-rounded lx-text-xs lx-bg-ink-900 lx-border lx-border-chrome-dark"
          style={{ color: "#e6f2ff" }}
        />
        <select
          value={newKind}
          onChange={(e) => setNewKind(e.target.value)}
          className="lx-px-1 lx-py-1 lx-rounded lx-text-xs lx-bg-ink-900 lx-border lx-border-chrome-dark"
          style={{ color: "#e6f2ff" }}
          title="Memory bucket"
        >
          <option value="fact">fact</option>
          <option value="pref">pref</option>
          <option value="shortcut">shortcut</option>
        </select>
        <button
          type="button"
          onClick={handleAdd}
          disabled={adding || !newText.trim()}
          className="lx-px-2 lx-py-1 lx-rounded lx-text-xs lx-font-bold lx-tracking-wider lx-bg-neon lx-text-ink-900 disabled:lx-opacity-40 disabled:lx-cursor-not-allowed"
        >
          {adding ? "…" : "ADD"}
        </button>
      </div>

      {/* List — capped height; scroll when overflow so chat below stays usable. */}
      <div
        className="lx-space-y-1 lx-overflow-y-auto"
        style={{ maxHeight: 280 }}
      >
        {items.length === 0 && !loading && (
          <div
            className="lx-text-xs lx-italic lx-py-2"
            style={{ color: "var(--text-muted)" }}
          >
            No memories yet. Tell Lumina "remember that…" or use the field above.
          </div>
        )}
        {items.map((m) => {
          const isEditing = editingId === m.id;
          const isSaving = savingId === m.id;
          return (
            <div
              key={m.id}
              className="lx-flex lx-items-start lx-gap-1 lx-px-2 lx-py-1 lx-rounded"
              style={{
                background: m.pinned
                  ? "rgba(60,255,210,0.06)"
                  : "rgba(255,255,255,0.02)",
                border: m.pinned
                  ? "1px solid rgba(60,255,210,0.25)"
                  : "1px solid rgba(255,255,255,0.04)",
              }}
            >
              {/* Pin toggle */}
              <button
                type="button"
                onClick={() => handleTogglePin(m)}
                disabled={isSaving}
                className="lx-text-xs lx-px-1 disabled:lx-opacity-40"
                style={{
                  color: m.pinned ? "var(--lx-neon, #3cffd2)" : "var(--text-muted)",
                  cursor: isSaving ? "wait" : "pointer",
                }}
                title={m.pinned ? "Unpin" : "Pin to top"}
              >
                {m.pinned ? "★" : "☆"}
              </button>

              {/* Kind chip */}
              <span
                className="lx-text-[10px] lx-uppercase lx-tracking-wider lx-px-1 lx-rounded lx-shrink-0"
                style={{
                  background: "rgba(30,167,255,0.12)",
                  color: "#1ea7ff",
                  alignSelf: "center",
                }}
              >
                {m.kind}
              </span>

              {/* Text (edit-in-place) */}
              {isEditing ? (
                <input
                  type="text"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void handleSaveEdit(m);
                    } else if (e.key === "Escape") {
                      setEditingId(null);
                    }
                  }}
                  onBlur={() => void handleSaveEdit(m)}
                  autoFocus
                  maxLength={500}
                  className="lx-flex-1 lx-text-xs lx-px-1 lx-py-0.5 lx-rounded lx-bg-ink-900 lx-border lx-border-chrome-dark"
                  style={{ color: "#e6f2ff" }}
                />
              ) : (
                <span
                  className="lx-flex-1 lx-text-xs lx-cursor-text"
                  style={{ color: "#d6e4f5", lineHeight: 1.4 }}
                  onClick={() => {
                    setEditDraft(m.text);
                    setEditingId(m.id);
                  }}
                  title="Click to edit"
                >
                  {m.text}
                </span>
              )}

              {/* Timestamp */}
              <span
                className="lx-text-[10px] lx-shrink-0"
                style={{ color: "var(--text-muted)", alignSelf: "center" }}
                title={new Date(m.updatedAt).toLocaleString()}
              >
                {formatRelative(m.updatedAt)}
              </span>

              {/* Delete */}
              <button
                type="button"
                onClick={() => handleDelete(m)}
                disabled={isSaving}
                className="lx-text-xs lx-px-1 disabled:lx-opacity-40"
                style={{ color: "#ff6680", cursor: isSaving ? "wait" : "pointer" }}
                title="Delete this memory"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
