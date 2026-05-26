// User preferences endpoint — stores per-user UI state in Firestore so
// settings (filters, panel widths, etc.) follow the user across devices.
//
//   GET  /api/prefs/:username  → { prefs: { ... } }
//   PUT  /api/prefs/:username  body: any JSON → stored as-is
//
// Key safety: username is normalised to lowercase + non-alphanum stripped.
import { Router } from "express";
import { db } from "../lib/firestore.js";

const router = Router();

function normUser(u: string): string {
  return String(u || "").toLowerCase().replace(/[^a-z0-9_.@-]/g, "");
}

router.get("/prefs/:username", async (req, res, next) => {
  try {
    const user = normUser(req.params.username);
    if (!user) return res.status(400).json({ error: "Invalid username" });
    const snap = await db().collection("userPrefs").doc(user).get();
    if (!snap.exists) return res.json({ prefs: {} });
    res.json({ prefs: snap.data() || {} });
  } catch (err) {
    next(err);
  }
});

router.put("/prefs/:username", async (req, res, next) => {
  try {
    const user = normUser(req.params.username);
    if (!user) return res.status(400).json({ error: "Invalid username" });
    const prefs = req.body && typeof req.body === "object" ? req.body : {};
    // Strip top-level keys with massive values to keep doc small (<256KB Firestore limit).
    const safe: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(prefs)) {
      const s = JSON.stringify(v);
      if (s && s.length < 50_000) safe[k] = v;
    }
    safe._updatedAt = Date.now();
    await db().collection("userPrefs").doc(user).set(safe, { merge: true });
    res.json({ ok: true, prefs: safe });
  } catch (err) {
    next(err);
  }
});

export default router;
