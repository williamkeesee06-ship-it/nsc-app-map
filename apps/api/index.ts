// Vercel serverless entry. The file path matches `functions` in vercel.json.
// Every request to /api/* is rewritten to /api/index by vercel.json.
import { createApp } from "./src/app.js";

const app = createApp();

export default app;
