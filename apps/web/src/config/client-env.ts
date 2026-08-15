import { z } from "zod";

const ClientEnvSchema = z.object({
  VITE_FIREBASE_API_KEY: z.string().optional(),
  VITE_FIREBASE_AUTH_DOMAIN: z.string().optional(),
  VITE_FIREBASE_PROJECT_ID: z.string().optional(),
  VITE_FIREBASE_STORAGE_BUCKET: z.string().optional(),
  VITE_FIREBASE_MESSAGING_SENDER_ID: z.string().optional(),
  VITE_FIREBASE_APP_ID: z.string().optional(),
  VITE_GOOGLE_MAPS_API_KEY: z.string().optional(),
  VITE_MAP_ID: z.string().optional(),
  VITE_AUTH_ALLOWED_EMAILS: z.string().optional(),
  MODE: z.string().default("development"),
  DEV: z.boolean().default(false),
  PROD: z.boolean().default(true),
});

export type ClientEnv = z.infer<typeof ClientEnvSchema>;

let cachedClientEnv: ClientEnv | null = null;

export function getClientEnv(): ClientEnv {
  if (cachedClientEnv) return cachedClientEnv;
  const raw = {
    VITE_FIREBASE_API_KEY: import.meta.env.VITE_FIREBASE_API_KEY,
    VITE_FIREBASE_AUTH_DOMAIN: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    VITE_FIREBASE_PROJECT_ID: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    VITE_FIREBASE_STORAGE_BUCKET: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    VITE_FIREBASE_MESSAGING_SENDER_ID: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    VITE_FIREBASE_APP_ID: import.meta.env.VITE_FIREBASE_APP_ID,
    VITE_GOOGLE_MAPS_API_KEY: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
    VITE_MAP_ID: import.meta.env.VITE_MAP_ID,
    VITE_AUTH_ALLOWED_EMAILS: import.meta.env.VITE_AUTH_ALLOWED_EMAILS,
    MODE: import.meta.env.MODE,
    DEV: import.meta.env.DEV,
    PROD: import.meta.env.PROD,
  };
  const parsed = ClientEnvSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn("[client-env] Missing/invalid optional client env:", parsed.error);
    cachedClientEnv = raw as ClientEnv;
    return cachedClientEnv;
  }
  cachedClientEnv = parsed.data;
  return cachedClientEnv;
}
