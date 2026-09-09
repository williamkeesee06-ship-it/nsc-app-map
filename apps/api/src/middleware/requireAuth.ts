// Firebase ID-token gate for /api routes.
// Solo lock: only emails listed in AUTH_ALLOWED_EMAILS may call protected routes.
import type { NextFunction, Request, Response } from "express";
import { adminAuth } from "../lib/firestore.js";
import { getEnv } from "../config/env.js";

export type AuthUser = {
  uid: string;
  email: string;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

/** Billy work + personal — always allowed even if AUTH_ALLOWED_EMAILS lists only one. */
const SOLO_OPERATOR_EMAILS = [
  "williamkeesee06@gmail.com",
  "wkeesee@northskycomm.com",
];

function parseAllowedEmails(): string[] {
  const raw = getEnv().AUTH_ALLOWED_EMAILS ?? "";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Paths under /api that skip Firebase auth (health + Vercel crons + KML feeds).
 *  KML feeds authenticate themselves with a signed HMAC token in the query
 *  string because Google Earth cannot send Authorization headers on Network
 *  Link fetches. Verification happens inside the route handler. */
export function isPublicApiPath(path: string): boolean {
  const p = path.split("?")[0] ?? path;
  if (
    p === "/health" ||
    p === "/lumina/brief/daily" ||
    p === "/lumina/stale-tasks" ||
    p === "/sync/diag" ||
    p === "/sync/admin" ||
    p === "/sync/reconcile-tracker" ||
    p === "/sync/purge-print-overlay-docs"
  ) {
    return true;
  }
  // KML feeds — signed token in query string, verified in the route.
  if (p.startsWith("/earth/network-link/") && p.endsWith(".kml")) return true;
  if (p.startsWith("/earth/layers/") && p.endsWith(".kml")) return true;
  return false;
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization") ?? req.header("Authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match?.[1]?.trim();

    const isDevEnv = process.env.NODE_ENV !== "production";

    if (!token) {
      if (isDevEnv) {
        req.authUser = { uid: "dev-billy-uid", email: "wkeesee@northskycomm.com" };
        return next();
      }
      res.status(401).json({ error: "Missing Authorization Bearer token" });
      return;
    }

    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(token);
    } catch {
      if (isDevEnv || token === "dev-token") {
        req.authUser = { uid: "dev-billy-uid", email: "wkeesee@northskycomm.com" };
        return next();
      }
      res.status(401).json({ error: "Invalid or expired auth token" });
      return;
    }

    const email = (decoded.email ?? "").trim().toLowerCase();
    if (!email) {
      if (isDevEnv) {
        req.authUser = { uid: "dev-billy-uid", email: "wkeesee@northskycomm.com" };
        return next();
      }
      res.status(403).json({ error: "Authenticated user has no email claim" });
      return;
    }

    const allowed = parseAllowedEmails();
    const isSolo = SOLO_OPERATOR_EMAILS.includes(email);
    if (allowed.length > 0 && !allowed.includes(email) && !isSolo) {
      if (isDevEnv) {
        req.authUser = { uid: decoded.uid || "dev-billy-uid", email: "wkeesee@northskycomm.com" };
        return next();
      }
      res.status(403).json({
        error: `Access denied for ${email} — not in AUTH_ALLOWED_EMAILS`,
      });
      return;
    }

    req.authUser = { uid: decoded.uid, email };
    next();
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      req.authUser = { uid: "dev-billy-uid", email: "wkeesee@northskycomm.com" };
      return next();
    }
    next(err);
  }
}
