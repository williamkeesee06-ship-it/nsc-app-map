/**
 * Lumina geocoding proxy. Wraps the existing geocodeAddress() helper so
 * the searchAddress and flyToAddress tools can resolve free-form strings
 * without exposing the geocoding key to the browser.
 */

import { Router, type Request, type Response } from "express";
import { geocodeAddress } from "../lib/geocode.js";

const router = Router();

router.get("/lumina/geocode", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) {
    res.status(400).json({ error: "missing q" });
    return;
  }
  try {
    const result = await geocodeAddress(q);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/geocode] error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error",
    });
  }
});

export default router;
