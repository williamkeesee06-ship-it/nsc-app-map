import { z } from "zod";
import type { LuminaTool } from "./types.js";
import { api } from "../../../lib/api.js";

// ─────────────────────────────────────────────────────────────────────────────
// Codebase Search Tool
// ─────────────────────────────────────────────────────────────────────────────
const searchCodebaseSchema = z.object({
  query: z.string().describe("The string or regex pattern to search for"),
  isRegex: z.boolean().optional().describe("Set to true if query is a regular expression"),
});

export const searchCodebaseTool: LuminaTool<z.infer<typeof searchCodebaseSchema>, any> = {
  name: "searchCodebase",
  description:
    "Regex search the entire NSC MAP APP codebase. Use this to find where variables, functions, or classes are defined, or to locate specific UI components. Returns up to 50 matching lines across files.",
  kind: "read",
  run: async (args) => {
    try {
      const data = await api.searchCodebase(args);
      if ("error" in data) {
        return { ok: false, message: String(data.error) };
      }
      const results = (data as { results: any[] }).results;
      if (!results || results.length === 0) {
        return { ok: true, message: `No matches found for query: ${args.query}` };
      }
      return { ok: true, data: { results } };
    } catch (err) {
      return { ok: false, message: `Failed to search codebase: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Read Source File Tool
// ─────────────────────────────────────────────────────────────────────────────
const readSourceFileSchema = z.object({
  filePath: z.string().describe("The relative path to the file (e.g. apps/web/src/main.tsx)"),
});

export const readSourceFileTool: LuminaTool<z.infer<typeof readSourceFileSchema>, any> = {
  name: "readSourceFile",
  description:
    "Read the exact implementation of a specific file in the codebase. Always use searchCodebase first to find the correct file path.",
  kind: "read",
  run: async (args) => {
    try {
      const data = await api.readSourceFile(args);
      if ("error" in data) {
        return { ok: false, message: String(data.error) };
      }
      return { ok: true, data: { content: (data as any).content } };
    } catch (err) {
      return { ok: false, message: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
