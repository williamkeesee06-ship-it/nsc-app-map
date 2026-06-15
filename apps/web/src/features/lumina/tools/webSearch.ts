/**
 * Tool: webSearch
 *
 * General-purpose web search so Lumina isn't stuck quoting only NSC data. She
 * uses this for anything outside Billy's private dataset — weather context,
 * NEC code references, splice procedures, vendor specs, regulations, news,
 * geography questions, basically any "what is / how do I / who is" question.
 *
 * Backed by a server-side route (/api/lumina/web-search) that we own — keeps
 * the search provider swappable (DuckDuckGo today; Tavily/Brave/Google CSE
 * trivial later). The route is added in apps/api/src/routes/luminaWebSearch.ts.
 *
 * Lumina is INSTRUCTED in the system prompt to cite the source URL when she
 * uses this tool's results. The truth doctrine ("don't lie") is satisfied by
 * either grounding from this tool OR honest "I don't know" — never fabricate.
 */

import type { LuminaTool, LuminaToolContext, LuminaToolResult } from "./types.js";

interface WebSearchInput {
  query: string;
  /** Optional cap on snippets returned. Default 5, max 10. */
  limit?: number;
}

interface WebSearchHit {
  title: string;
  url: string;
  snippet: string;
}

interface WebSearchData {
  query: string;
  results: WebSearchHit[];
}

async function run(
  input: WebSearchInput,
  _ctx: LuminaToolContext
): Promise<LuminaToolResult<WebSearchData>> {
  if (!input.query || !input.query.trim()) {
    return { ok: false, message: "webSearch requires a non-empty query." };
  }
  const limit = Math.min(Math.max(input.limit ?? 5, 1), 10);
  const res = await fetch(
    `/api/lumina/web-search?q=${encodeURIComponent(input.query)}&limit=${limit}`
  );
  if (!res.ok) {
    return { ok: false, message: `Web search failed (${res.status}).` };
  }
  const body = (await res.json()) as WebSearchData;
  return {
    ok: true,
    message: `Found ${body.results.length} result${body.results.length === 1 ? "" : "s"} for "${input.query}".`,
    data: body,
  };
}

export const webSearchTool: LuminaTool<WebSearchInput, WebSearchData> = {
  name: "webSearch",
  description:
    "Search the open web for general knowledge (anything outside Billy's private NSC data). Use freely for code/standards questions, vendor specs, weather context, news, geography, regulations, math help — anything that isn't a job/markup/photo from our Firestore. Always cite the source URL when you quote a result.",
  kind: "read",
  run,
};
