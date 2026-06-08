/**
 * Lumina memory layer — per-user durable facts/prefs/shortcuts Firestore-backed
 * so Lumina can remember things across sessions and devices (Phase 5 of the
 * Lumina × Map App build).
 *
 *   GET    /api/lumina/memories/:username                → { items: MemoryItem[] }
 *   POST   /api/lumina/memories/:username                → add item; returns full list
 *      body: { text: string, kind?: "fact"|"pref"|"shortcut" }
 *   PATCH  /api/lumina/memories/:username/:id            → edit text/pinned
 *      body: { text?: string, pinned?: boolean }
 *   DELETE /api/lumina/memories/:username/:id            → remove item
 *
 * Caps to keep doc under Firestore's 1MB limit comfortably:
 *   - 200 items per user, 500 chars per item, 64 char kind.
 *
 * Why arrays-in-doc (not subcollection): the full memory set is read on every
 * Lumina chat turn (injected into system prompt). A single doc read is cheaper
 * and faster than fanning out a subcollection query.
 */
import { Router } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

const MAX_ITEMS = 200;
const MAX_TEXT_LEN = 500;
const KIND_RX = /^[a-z_]{1,32}$/;

export interface MemoryItem {
  id: string;
  text: string;
  kind: string; // "fact" | "pref" | "shortcut" | custom; not enforced server-side
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
}

function normUser(u: string): string {
  return String(u || "")
    .toLowerCase()
    .replace(/[^a-z0-9_.@-]/g, "");
}

function newId(): string {
  return (
    Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8)
  );
}

function sanitizeKind(k: unknown): string {
  if (typeof k !== "string") return "fact";
  const lower = k.toLowerCase().trim();
  return KIND_RX.test(lower) ? lower : "fact";
}

function sanitizeText(t: unknown): string | null {
  if (typeof t !== "string") return null;
  const trimmed = t.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT_LEN);
}

async function loadDoc(user: string): Promise<MemoryItem[]> {
  const snap = await db().collection("luminaMemories").doc(user).get();
  if (!snap.exists) return [];
  const data = snap.data() as { items?: MemoryItem[] } | undefined;
  return Array.isArray(data?.items) ? (data!.items as MemoryItem[]) : [];
}

async function saveDoc(user: string, items: MemoryItem[]): Promise<void> {
  await db()
    .collection("luminaMemories")
    .doc(user)
    .set({ items, updatedAt: Date.now() }, { merge: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// GET — list
// ─────────────────────────────────────────────────────────────────────────────
router.get("/lumina/memories/:username", async (req, res, next) => {
  try {
    const user = normUser(req.params.username);
    if (!user) return res.status(400).json({ error: "Invalid username" });
    const items = await loadDoc(user);
    res.json({ items });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST — add a new memory item
// ─────────────────────────────────────────────────────────────────────────────
router.post("/lumina/memories/:username", async (req, res, next) => {
  try {
    const user = normUser(req.params.username);
    if (!user) return res.status(400).json({ error: "Invalid username" });

    const body = (req.body || {}) as { text?: unknown; kind?: unknown };
    const text = sanitizeText(body.text);
    if (!text) return res.status(400).json({ error: "text required" });
    const kind = sanitizeKind(body.kind);

    const items = await loadDoc(user);
    if (items.length >= MAX_ITEMS) {
      return res
        .status(400)
        .json({ error: `memory limit reached (${MAX_ITEMS})` });
    }

    const now = Date.now();
    const item: MemoryItem = {
      id: newId(),
      text,
      kind,
      createdAt: now,
      updatedAt: now,
      pinned: false,
    };
    items.push(item);
    await saveDoc(user, items);
    res.json({ ok: true, item, items });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH — edit text or toggle pinned
// ─────────────────────────────────────────────────────────────────────────────
router.patch("/lumina/memories/:username/:id", async (req, res, next) => {
  try {
    const user = normUser(req.params.username);
    if (!user) return res.status(400).json({ error: "Invalid username" });
    const id = String(req.params.id || "");

    const body = (req.body || {}) as { text?: unknown; pinned?: unknown };
    const items = await loadDoc(user);
    const idx = items.findIndex((m) => m.id === id);
    if (idx < 0) return res.status(404).json({ error: "not found" });

    if (typeof body.text === "string") {
      const cleaned = sanitizeText(body.text);
      if (!cleaned) return res.status(400).json({ error: "text invalid" });
      items[idx].text = cleaned;
    }
    if (typeof body.pinned === "boolean") {
      items[idx].pinned = body.pinned;
    }
    items[idx].updatedAt = Date.now();

    await saveDoc(user, items);
    res.json({ ok: true, item: items[idx], items });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE — remove an item
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/lumina/memories/:username/:id", async (req, res, next) => {
  try {
    const user = normUser(req.params.username);
    if (!user) return res.status(400).json({ error: "Invalid username" });
    const id = String(req.params.id || "");

    const items = await loadDoc(user);
    const filtered = items.filter((m) => m.id !== id);
    if (filtered.length === items.length) {
      return res.status(404).json({ error: "not found" });
    }
    await saveDoc(user, filtered);
    res.json({ ok: true, items: filtered });
  } catch (err) {
    next(err);
  }
});

/**
 * Internal helper — used by luminaChat to inject memories into the system
 * prompt. Returns up to N items, pinned first then most-recently-updated.
 */
export async function loadMemoriesForPrompt(
  username: string,
  limit = 100
): Promise<MemoryItem[]> {
  const user = normUser(username);
  if (!user) return [];
  const items = await loadDoc(user);
  items.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
  return items.slice(0, limit);
}

export default router;
