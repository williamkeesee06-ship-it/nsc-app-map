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

/** Paths under /api that skip Firebase auth (health + Vercel crons). */
export function isPublicApiPath(path: string): boolean {
  const p = path.split("?")[0] ?? path;
  return (
    p === "/health" ||
    p === "/lumina/brief/daily" ||
    p === "/lumina/stale-tasks" ||
    p === "/sync/diag" ||
    p === "/sync/admin"
  );
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const header = req.header("authorization") ?? req.header("Authorization") ?? "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) {
      res.status(401).json({ error: "Missing Authorization Bearer token" });
      return;
    }

    const token = match[1].trim();
    let decoded;
    try {
      decoded = await adminAuth().verifyIdToken(token);
    } catch {
      res.status(401).json({ error: "Invalid or expired auth token" });
      return;
    }

    const email = (decoded.email ?? "").trim().toLowerCase();
    if (!email) {
      res.status(403).json({ error: "Authenticated user has no email claim" });
      return;
    }

    const allowed = parseAllowedEmails();
    // Solo lock: Billy's known emails always pass. Empty allowlist accepts any
    // verified Firebase user. Non-empty allowlist restricts others.
    const isSolo = SOLO_OPERATOR_EMAILS.includes(email);
    if (allowed.length > 0 && !allowed.includes(email) && !isSolo) {
      res.status(403).json({
        error: `Access denied for ${email} — not in AUTH_ALLOWED_EMAILS`,
      });
      return;
    }

    req.authUser = { uid: decoded.uid, email };
    next();
  } catch (err) {
    next(err);
  }
}
