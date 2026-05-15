// Jobs read endpoints. Frontend consumes these to render the Jobs Map + cards.
import { Router } from "express";
import { db } from "../lib/firestore.js";
import type { Job } from "@nsc/types";

const router = Router();

// GET /api/jobs
// Returns all jobs. The client filters in-memory \u2014 191 records is trivial.
// Optional query: ?inTracker=true to limit to currently-tracked jobs.
router.get("/jobs", async (req, res, next) => {
  try {
    const snap = await db().collection("jobs").get();
    const all = snap.docs.map((d) => d.data() as Job);
    const inTrackerFilter = req.query.inTracker;
    const jobs =
      inTrackerFilter === "true"
        ? all.filter((j) => j.inTracker)
        : inTrackerFilter === "false"
          ? all.filter((j) => !j.inTracker)
          : all;
    res.json({ jobs, count: jobs.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/jobs/:jobId
router.get("/jobs/:jobId", async (req, res, next) => {
  try {
    const doc = await db().collection("jobs").doc(req.params.jobId).get();
    if (!doc.exists) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job: doc.data() as Job });
  } catch (err) {
    next(err);
  }
});

export default router;
