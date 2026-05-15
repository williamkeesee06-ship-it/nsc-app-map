// Fail-loud env loader. Throws at boot if a required var is missing.
// Why: prior production crashes came from lazy env access at first request.

import { z } from "zod";

const Schema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
  FIREBASE_CLIENT_EMAIL: z.string().email("FIREBASE_CLIENT_EMAIL must be an email"),
  FIREBASE_PRIVATE_KEY: z.string().min(1, "FIREBASE_PRIVATE_KEY is required"),
  // Phase 2 — optional in Phase 1
  SMARTSHEET_API_TOKEN: z.string().optional(),
  SMARTSHEET_SHEET_ID: z.string().optional(),
  NODE_ENV: z.string().default("development"),
});

export type Env = z.infer<typeof Schema>;

let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = Schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`[env] Invalid environment configuration:\n${issues}`);
  }
  // Normalize the PEM: Vercel/CI typically stores \n as literal "\n"
  const normalized: Env = {
    ...parsed.data,
    FIREBASE_PRIVATE_KEY: parsed.data.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  };
  cached = normalized;
  return normalized;
}
