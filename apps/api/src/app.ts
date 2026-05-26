// Express app factory. Pure ESM. No top-level side effects beyond imports.
import express, { type Request, type Response, type NextFunction } from "express";
import healthRouter from "./routes/health.js";
import asbuiltRouter from "./routes/asbuilt.js";
import prefsRouter from "./routes/prefs.js";
import syncRouter from "./routes/sync.js";
import jobsRouter from "./routes/jobs.js";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // All routes mount under /api (the Vercel rewrite already strips the prefix
  // at the platform level, but we keep it explicit so local dev matches prod).
  app.use("/api", healthRouter);
  app.use("/api", asbuiltRouter);
  app.use("/api", syncRouter);
  app.use("/api", jobsRouter);
  app.use("/api", prefsRouter);

  // Catch-all error handler — never let an uncaught error crash the function.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("[api] error:", err);
    res.status(500).json({ error: message });
  });

  return app;
}
