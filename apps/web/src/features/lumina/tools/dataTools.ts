import { z } from "zod";
import type { LuminaTool } from "./types.js";
import { api } from "../../../lib/api.js";

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Firestore Query Tool
// ─────────────────────────────────────────────────────────────────────────────
const queryFirestoreSchema = z.object({
  collection: z.string().describe("The Firestore collection name to query (e.g. 'jobs', 'digTickets', 'users')"),
  filters: z.array(
    z.object({
      field: z.string(),
      operator: z.enum(["==", "!=", "<", "<=", ">", ">=", "array-contains", "in", "not-in", "array-contains-any"]),
      value: z.any()
    })
  ).optional().describe("Optional array of where clauses to filter the query"),
  limit: z.number().optional().describe("Max number of documents to return (default 25, max 100)")
});

export const queryFirestoreTool: LuminaTool<z.infer<typeof queryFirestoreSchema>, any> = {
  name: "queryFirestore",
  description:
    "Execute a dynamic query against ANY Firestore collection. Use this to read raw data, lookup related records, or investigate database state beyond standard tools.",
  kind: "read",
  run: async (args) => {
    try {
      const data = await api.queryFirestore(args);
      if ("error" in data) {
        return { ok: false, message: String(data.error) };
      }
      return { ok: true, data };
    } catch (err) {
      return { ok: false, message: `Failed to query Firestore: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
