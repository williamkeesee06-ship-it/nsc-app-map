// Express app factory. Pure ESM. No top-level side effects beyond imports.
import express, { type Request, type Response, type NextFunction } from "express";
import healthRouter from "./routes/health.js";
import asbuiltRouter from "./routes/asbuilt.js";
import prefsRouter from "./routes/prefs.js";
import syncRouter from "./routes/sync.js";
import jobsRouter from "./routes/jobs.js";
import scratchpadRouter from "./routes/scratchpad.js";
import photosRouter from "./routes/photos.js";
import luminaLiveTokenRouter from "./routes/luminaLiveToken.js";
import luminaChatRouter from "./routes/luminaChat.js";
import luminaGeocodeRouter from "./routes/luminaGeocode.js";
import luminaMemoriesRouter from "./routes/luminaMemories.js";
import luminaWebSearchRouter from "./routes/luminaWebSearch.js";
import luminaWeatherRouter from "./routes/luminaWeather.js";
import luminaInboxRouter from "./routes/luminaInbox.js";
import luminaPushRouter from "./routes/luminaPush.js";
import luminaSmartsheetRouter from "./routes/luminaSmartsheet.js";
import luminaBriefRouter from "./routes/luminaBrief.js";
import tasksRouter from "./routes/tasks.js";
import luminaStaleTasksRouter from "./routes/luminaStaleTasks.js";

export function createApp() {
  const app = express();
  // Photos can push the payload up to ~200KB — raise the body limit so the
  // photo upload route isn't rejected as 413 before reaching the handler.
  app.use(express.json({ limit: "4mb" }));

  // All routes mount under /api (the Vercel rewrite already strips the prefix
  // at the platform level, but we keep it explicit so local dev matches prod).
  app.use("/api", healthRouter);
  app.use("/api", asbuiltRouter);
  app.use("/api", syncRouter);
  app.use("/api", jobsRouter);
  app.use("/api", prefsRouter);
  app.use("/api", scratchpadRouter);
  app.use("/api", photosRouter);
  app.use("/api", luminaLiveTokenRouter);
  app.use("/api", luminaChatRouter);
  app.use("/api", luminaGeocodeRouter);
  app.use("/api", luminaMemoriesRouter);
  app.use("/api", luminaWebSearchRouter);
  app.use("/api", luminaWeatherRouter);
  app.use("/api", luminaInboxRouter);
  app.use("/api", luminaPushRouter);
  app.use("/api", luminaSmartsheetRouter);
  app.use("/api", luminaBriefRouter);
  app.use("/api", tasksRouter);
  app.use("/api", luminaStaleTasksRouter);

  // Catch-all error handler — never let an uncaught error crash the function.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : "Unknown error";
    // eslint-disable-next-line no-console
    console.error("[api] error:", err);
    res.status(500).json({ error: message });
  });

  return app;
}
