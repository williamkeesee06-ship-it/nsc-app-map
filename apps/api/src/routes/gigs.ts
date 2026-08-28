import { Router } from "express";
import { db } from "../lib/firestore.js";
import type { Gig } from "@nsc/types";

const router = Router();

function gigsCol() {
  return db().collection("gigs");
}

// GET /api/gigs — fetch gigs, optionally filter by jobId
router.get("/gigs", async (req, res, next) => {
  try {
    const jobId = typeof req.query.jobId === "string" ? req.query.jobId : "";
    const status = typeof req.query.status === "string" ? req.query.status : "";

    let q: any = gigsCol();

    if (jobId) {
      q = q.where("jobId", "==", jobId);
    }
    if (status) {
      q = q.where("status", "==", status);
    }

    // Sort by createdAt descending
    const snap = await q.orderBy("createdAt", "desc").get();
    const gigs: Gig[] = snap.docs.map((d: any) => ({
      ...(d.data() as Gig),
      id: d.id,
    }));

    res.json({ gigs });
  } catch (err) {
    next(err);
  }
});

// POST /api/gigs — create a new gig tied to a job
router.post("/gigs", async (req, res, next) => {
  try {
    const body = req.body as {
      jobId?: string;
      task?: string;
    };

    const jobId = String(body.jobId ?? "").trim();
    const task = String(body.task ?? "").trim();

    if (!jobId || !task) {
      res.status(400).json({ error: "jobId and task text are required" });
      return;
    }

    // Resolve job's Work Order for display
    let jobDoc = await db().collection("jobs").doc(jobId).get();
    let jobData: any = null;
    let actualJobId = jobId;

    if (jobDoc.exists) {
      jobData = jobDoc.data();
    } else {
      // Fallback: search by workOrder
      const snap = await db()
        .collection("jobs")
        .where("workOrder", "==", jobId)
        .limit(1)
        .get();
      if (!snap.empty) {
        jobDoc = snap.docs[0];
        jobData = jobDoc.data();
        actualJobId = jobDoc.id;
      }
    }

    if (!jobData) {
      res.status(400).json({ error: `Job not found: ${jobId}` });
      return;
    }

    const workOrder = jobData.workOrder || jobData.jobId || actualJobId;

    const newId = gigsCol().doc().id;
    const gig: Gig = {
      id: newId,
      jobId: actualJobId,
      workOrder,
      task,
      status: "open",
      createdAt: Date.now(),
      completedAt: null,
    };

    await gigsCol().doc(newId).set(gig);
    res.status(201).json({ gig });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/gigs/:id — update or complete a gig
router.patch("/gigs/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    const ref = gigsCol().doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      res.status(404).json({ error: `Gig not found: ${id}` });
      return;
    }

    const body = req.body as Partial<Pick<Gig, "status" | "task">>;
    const updates: Partial<Gig> = {};

    if (body.task !== undefined) {
      updates.task = String(body.task).trim();
    }
    if (body.status !== undefined) {
      updates.status = body.status === "completed" ? "completed" : "open";
      updates.completedAt = updates.status === "completed" ? Date.now() : null;
    }

    await ref.update(updates as Record<string, any>);
    const updated = (await ref.get()).data() as Gig;

    res.json({ gig: { ...updated, id } });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/gigs/:id — delete/remove a gig
router.delete("/gigs/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }

    await gigsCol().doc(id).delete();
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
