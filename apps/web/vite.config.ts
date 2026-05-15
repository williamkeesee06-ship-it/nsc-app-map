import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// During local dev, /api/* is proxied to the Express dev server on :3001.
// In production on Vercel, the same /api/* path is served by the serverless
// function via the rewrite in vercel.json — so the frontend code is identical.
export default defineConfig({
  plugins: [react()],
  // Load .env from the monorepo root so web and api share the same file.
  envDir: resolve(__dirname, "../.."),
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
