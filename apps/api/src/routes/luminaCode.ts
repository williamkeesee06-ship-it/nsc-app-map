import { Router, type Request, type Response } from "express";
import fs from "fs/promises";
import path from "path";

const router = Router();

// Define the root of the workspace (D:\1_NSC MAP APP)
const WORKSPACE_ROOT = path.resolve(process.cwd(), "../.."); // Assumes api runs from apps/api

/** Helper to ensure path is within workspace */
function getSafePath(targetPath: string): string | null {
  // Try to resolve it relative to workspace root first
  let resolved = path.resolve(WORKSPACE_ROOT, targetPath);
  
  // If it's an absolute path that starts with D:\ or C:\, check if it's in the workspace
  if (path.isAbsolute(targetPath)) {
    resolved = path.normalize(targetPath);
  }

  if (!resolved.startsWith(WORKSPACE_ROOT)) {
    return null;
  }
  return resolved;
}

// ─────────────────────────────────────────────────────────────────────────────
// Read File Endpoint
// ─────────────────────────────────────────────────────────────────────────────
router.post("/lumina/code/read", async (req: Request, res: Response) => {
  try {
    const { filePath } = req.body;
    if (!filePath || typeof filePath !== "string") {
      return res.status(400).json({ error: "filePath is required" });
    }

    const safePath = getSafePath(filePath);
    if (!safePath) {
      return res.status(403).json({ error: "Access denied: path outside workspace." });
    }

    const stat = await fs.stat(safePath).catch(() => null);
    if (!stat || !stat.isFile()) {
      return res.status(404).json({ error: `File not found: ${filePath}` });
    }

    const content = await fs.readFile(safePath, "utf-8");
    return res.json({ path: safePath, content });
  } catch (err) {
    console.error("[lumina/code/read] error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Search Codebase Endpoint (Recursive regex search)
// ─────────────────────────────────────────────────────────────────────────────
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);
const ALLOWED_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".css", ".md", ".json", ".html"]);

async function searchDirectory(dir: string, regex: RegExp, results: { file: string, line: number, text: string }[], limit: number = 50) {
  if (results.length >= limit) return;

  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (results.length >= limit) break;

    const fullPath = path.join(dir, entry.name);
    
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        await searchDirectory(fullPath, regex, results, limit);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!ALLOWED_EXTS.has(ext)) continue;

      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i])) {
            results.push({
              file: path.relative(WORKSPACE_ROOT, fullPath),
              line: i + 1,
              text: lines[i].trim()
            });
            if (results.length >= limit) break;
          }
        }
      } catch (err) {
        // ignore read errors on specific files
      }
    }
  }
}

router.post("/lumina/code/search", async (req: Request, res: Response) => {
  try {
    const { query, isRegex = false } = req.body;
    if (!query || typeof query !== "string") {
      return res.status(400).json({ error: "query is required" });
    }

    let regex: RegExp;
    try {
      const pattern = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      regex = new RegExp(pattern, "i");
    } catch (e) {
      return res.status(400).json({ error: "Invalid regex query" });
    }

    const results: { file: string, line: number, text: string }[] = [];
    await searchDirectory(WORKSPACE_ROOT, regex, results, 50);

    return res.json({ results });
  } catch (err) {
    console.error("[lumina/code/search] error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

export default router;
