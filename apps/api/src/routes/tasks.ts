// Tasks CRUD — per-owner, Firestore-backed action-item list.
//
// Billy 6/18: "I want a TASKS tab that replaces ROUTE in the left rail.
// Tasks can come from me, from Lumina chat, or from Lumina scanning my inbox."
//
// Firestore collection: tasks/{taskId}
// Owner scoping: tasks are queried by ownerSlug field (slugified ownerName).
//
// Endpoints (all mounted at /api by app.ts):
//   GET  /tasks?owner=Billy%20Keesee → { tasks: Task[] } — only open (done=false)
//   POST /tasks                      → { task }
//   PATCH /tasks/:id                 → partial update, { task }
//   DELETE /tasks/:id                → 204
//   POST /tasks/reorder              → batch orderIndex update, { ok }

import { Router } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmailRef {
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
  dateIso: string;
  gmailUrl: string;
}

export interface JobRef {
  id: string;
  label: string;
}

export interface Task {
  id: string;
  ownerName: string;
  ownerSlug: string;
  text: string;            // HTML — rich text (tiptap)
  done: boolean;
  parentId: string | null; // null = top-level; else parent task id (one level deep)
  orderIndex: number;
  source: "user" | "lumina-chat" | "lumina-email";
  emailRef: EmailRef | null;
  jobRef: JobRef | null;
  createdAt: number;        // ms epoch
  completedAt: number | null;
  lastPingedAt: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function slugifyOwner(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

function tasksCol() {
  return db().collection("tasks");
}

/** Returns the highest existing orderIndex for tasks matching owner + parentId. */
async function nextOrderIndex(ownerSlug: string, parentId: string | null): Promise<number> {
  const q = tasksCol()
    .where("ownerSlug", "==", ownerSlug)
    .where("parentId", "==", parentId ?? null)
    .orderBy("orderIndex", "desc")
    .limit(1);
  const snap = await q.get();
  if (snap.empty) return 0;
  const last = snap.docs[0].data() as Task;
  return (typeof last.orderIndex === "number" ? last.orderIndex : 0) + 1;
}

// ─── GET /tasks?owner= ────────────────────────────────────────────────────────

router.get("/tasks", async (req, res, next) => {
  try {
    const ownerRaw = typeof req.query.owner === "string" ? req.query.owner : "";
    if (!ownerRaw) {
      res.status(400).json({ error: "owner query param required" });
      return;
    }
    const slug = slugifyOwner(ownerRaw);

    // Only return open tasks, sorted by parentId (nulls first — Firestore
    // sorts null before strings) then orderIndex.
    const snap = await tasksCol()
      .where("ownerSlug", "==", slug)
      .where("done", "==", false)
      .orderBy("parentId")
      .orderBy("orderIndex")
      .get();

    const tasks: Task[] = snap.docs.map((d) => ({
      ...(d.data() as Task),
      id: d.id,
    }));

    res.json({ tasks });
  } catch (err) {
    next(err);
  }
});

// ─── POST /tasks ──────────────────────────────────────────────────────────────

router.post("/tasks", async (req, res, next) => {
  try {
    const body = req.body as {
      ownerName?: string;
      text?: string;
      parentId?: string | null;
      source?: Task["source"];
      emailRef?: EmailRef | null;
      jobRef?: JobRef | null;
    };

    const ownerName = String(body.ownerName ?? "").trim();
    if (!ownerName) {
      res.status(400).json({ error: "ownerName required" });
      return;
    }
    const text = String(body.text ?? "").trim();
    const parentId = body.parentId ?? null;
    const source: Task["source"] = body.source ?? "user";
    const ownerSlug = slugifyOwner(ownerName);

    const orderIndex = await nextOrderIndex(ownerSlug, parentId);
    const now = Date.now();

    const newId = tasksCol().doc().id;
    const task: Task = {
      id: newId,
      ownerName,
      ownerSlug,
      text,
      done: false,
      parentId,
      orderIndex,
      source,
      emailRef: body.emailRef ?? null,
      jobRef: body.jobRef ?? null,
      createdAt: now,
      completedAt: null,
      lastPingedAt: null,
    };

    await tasksCol().doc(newId).set(task);
    res.status(201).json({ task });
  } catch (err) {
    next(err);
  }
});

// ─── PATCH /tasks/:id ─────────────────────────────────────────────────────────

router.patch("/tasks/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    const ref = tasksCol().doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: `Task ${id} not found` });
      return;
    }

    const body = req.body as Partial<Pick<Task, "text" | "done" | "parentId" | "orderIndex" | "jobRef">>;
    const updates: Partial<Task> = {};

    if (body.text !== undefined) updates.text = String(body.text);
    if (body.done !== undefined) {
      updates.done = Boolean(body.done);
      if (updates.done) updates.completedAt = Date.now();
    }
    if (body.parentId !== undefined) updates.parentId = body.parentId ?? null;
    if (body.orderIndex !== undefined) updates.orderIndex = Number(body.orderIndex);
    if (body.jobRef !== undefined) updates.jobRef = body.jobRef;

    await ref.update(updates as Record<string, unknown>);

    const updated = (await ref.get()).data() as Task;
    res.json({ task: { ...updated, id } });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /tasks/:id ────────────────────────────────────────────────────────

// Hard delete — the UI fades out the row first, then calls this.
// Per spec: "checked = removed". If task has subtasks, caller should
// also delete them (or we delete them here as a cascade).
router.delete("/tasks/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    // Cascade: delete any subtasks that have parentId === id.
    const childSnap = await tasksCol().where("parentId", "==", id).get();
    const batch = db().batch();
    for (const doc of childSnap.docs) {
      batch.delete(doc.ref);
    }
    batch.delete(tasksCol().doc(id));
    await batch.commit();

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ─── POST /tasks/reorder ─────────────────────────────────────────────────────

// Body: { ownerName, parentId: string|null, orderedIds: string[] }
// Batch-writes orderIndex 0..N for the given ids within the same parent.
router.post("/tasks/reorder", async (req, res, next) => {
  try {
    const body = req.body as {
      ownerName?: string;
      parentId?: string | null;
      orderedIds?: string[];
    };

    if (!body.ownerName || !Array.isArray(body.orderedIds)) {
      res.status(400).json({ error: "ownerName and orderedIds required" });
      return;
    }

    const batch = db().batch();
    body.orderedIds.forEach((taskId, idx) => {
      batch.update(tasksCol().doc(taskId), { orderIndex: idx });
    });
    await batch.commit();

    res.json({ ok: true, reordered: body.orderedIds.length });
  } catch (err) {
    next(err);
  }
});

export default router;
