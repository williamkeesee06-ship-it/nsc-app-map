import { Router, type Request, type Response } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Generic Firestore Query Endpoint
// ─────────────────────────────────────────────────────────────────────────────
router.post("/lumina/data/query", async (req: Request, res: Response) => {
  try {
    const { collection, filters = [], limit = 25 } = req.body;
    
    if (!collection || typeof collection !== "string") {
      return res.status(400).json({ error: "collection name is required" });
    }

    let query: any = db().collection(collection);

    // Apply where clauses if provided
    if (Array.isArray(filters)) {
      for (const filter of filters) {
        if (filter.field && filter.operator && filter.value !== undefined) {
          query = query.where(filter.field, filter.operator, filter.value);
        }
      }
    }

    query = query.limit(Math.min(limit, 100)); // Cap at 100 to prevent massive payloads

    const snap = await query.get();
    const results: any[] = [];
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
