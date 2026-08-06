// Fail-loud env loader. Throws at boot if a required var is missing.
// Why: prior production crashes came from lazy env access at first request.
// Force redeploy to load rotated keys.

import { z } from "zod";

const Schema = z.object({
  FIREBASE_PROJECT_ID: z.string().min(1, "FIREBASE_PROJECT_ID is required"),
  FIREBASE_CLIENT_EMAIL: z.string().email("FIREBASE_CLIENT_EMAIL must be an email"),
  FIREBASE_PRIVATE_KEY: z.string().min(1, "FIREBASE_PRIVATE_KEY is required"),
  FIREBASE_STORAGE_BUCKET: z.string().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  SMARTSHEET_API_TOKEN: z.string().optional(),
  SMARTSHEET_SHEET_ID: z.string().optional(),
  ZIPLY_SMARTSHEET_SHEET_ID: z.string().optional(),
  // Numeric ID of Billy's rolled-up Ziply tracker report. When set, the
  // reconcile-tracker endpoint uses this as the source of truth for which
  // Ziply jobs count as "in tracker." Query param overrides this default.
  ZIPLY_TRACKER_REPORT_ID: z.string().optional(),
  // Ziply per-supervisor trackers are pre-filtered in Smartsheet and have no
  // supervisor column. Stamp every row with this supervisor so the UI filter
  // can find them. Defaults to "Billy Keesee" (his tracker is our only one today).
  ZIPLY_DEFAULT_SUPERVISOR: z.string().default("Billy Keesee"),
  // Shared secret gating POST /api/sync/admin. When unset, the endpoint
  // returns 503. Rotate this by updating the Vercel env var.
  SYNC_ADMIN_KEY: z.string().optional(),
  // Lumen sync is disabled by default. Set to "true" to re-enable.
  SYNC_LUMEN: z.string().default("false"),
  // Geocoding key for the Google Geocoding API. If unset, we'll fall back to
  // VITE_GOOGLE_MAPS_API_KEY — but a referrer-restricted browser key will
  // reject server-side calls, so a dedicated unrestricted (or IP-restricted)
  // backend key is recommended.
  GOOGLE_GEOCODING_API_KEY: z.string().optional(),
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional(),
  // Tracker filter — which supervisor's rows to sync. Defaults to Billy.
  SYNC_SUPERVISOR: z.string().default("Billy Keesee"),
  // Phase 9.7: allowlist of supervisors who can log in and have their jobs
  // synced into Firestore. Comma-separated, case-insensitive.
  // Overrides SYNC_SUPERVISOR when present.
  SYNC_SUPERVISORS: z
    .string()
    .default(
      "Billy Keesee,RJ Tudela,Rob Dautrich,Joe Watson,Jarrod Anderson,Dustin Halbert,Mike Smith,Mike Thoman,Robbie Thoman,Shawn Heenan,Jamey Beckwith"
    ),
  // Phase 9.7: managers see ALL supervisors' jobs and use the Supervisor
  // checkboxes as their primary filter (instead of status buckets). They
  // still need to be in SYNC_SUPERVISORS to pass the login allowlist gate.
  SYNC_MANAGERS: z.string().default("Robbie Thoman"),
  // Solo lock: comma-separated emails allowed to call the API (Firebase Auth).
  // Empty in production → reject all authenticated callers until configured.
  AUTH_ALLOWED_EMAILS: z.string().default(""),
  // CORS allowlist: primary production origin + optional extra origins.
  APP_ORIGIN: z.string().default("https://nsc-app-map.vercel.app"),
  APP_ORIGINS: z.string().default(""),
  // Vercel cron shared secret. Routes fail closed when empty.
  CRON_SECRET: z.string().default(""),
  // Solo operator profile used after Firebase login (Smartsheet / drawings owner).
  AUTH_OPERATOR_NAME: z.string().default("Billy Keesee"),
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
