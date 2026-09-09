import { Router, type Request, type Response } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

// Hard allowlist — never accept arbitrary collection names from the client.
const ALLOWED_COLLECTIONS = new Set([
  "jobs",
  "digTickets",
  "tasks",
  "userPrefs",
  "luminaMemories",
  "scratchpads",
  "syncRuns",
  "notifications",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Generic Firestore Query Endpoint (auth required via app middleware)
// ─────────────────────────────────────────────────────────────────────────────
router.post("/lumina/data/query", async (req: Request, res: Response) => {
  try {
    const { collection, filters = [], limit = 25 } = req.body;

    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ error: "collection name is required" });
    }

    if (!ALLOWED_COLLECTIONS.has(collection)) {
      return res.status(403).json({
        error: `Collection not allowed: ${collection}`,
        allowed: [...ALLOWED_COLLECTIONS],
      });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query: any = db().collection(collection);

    // Apply where clauses if provided
    if (Array.isArray(filters)) {
      for (const filter of filters) {
        if (filter.field && filter.operator && filter.value !== undefined) {
          query = query.where(filter.field, filter.operator, filter.value);
        }
      }
    }

    query = query.limit(Math.min(Number(limit) || 25, 100));

    const snap = await query.get();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const results: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snap.forEach((doc: any) => {
      results.push({ id: doc.id, ...doc.data() });
    });

    return res.json({ count: results.length, results });
  } catch (err) {
    console.error("[lumina/data/query] error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
