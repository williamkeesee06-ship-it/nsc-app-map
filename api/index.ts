// Vercel serverless entry. Lives at /api/index.ts at repo root (required by Vercel).
// Imports the Express app factory from the workspace.
import { createApp } from "../apps/api/src/app.js";

export default createApp();
