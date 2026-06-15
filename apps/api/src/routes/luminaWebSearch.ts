/**
 * GET /api/lumina/web-search?q=...&limit=5
 *
 * Free DuckDuckGo HTML search proxy. No API key required. We parse the HTML
 * results page server-side so the model gets clean { title, url, snippet }
 * triples. If we ever want a paid provider (Tavily, Brave, Google CSE), swap
 * the implementation below — the contract stays identical.
 *
 * Why server-side: DDG blocks browser CORS, and we want a consistent User
 * Agent + the option to add rate-limiting later.
 */

import { Router, type Request, type Response } from "express";

const router = Router();

interface Hit {
  title: string;
  url: string;
  snippet: string;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Strip HTML tags + decode the few entities DDG actually emits. */
function htmlToText(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Decode DuckDuckGo's /l/?uddg= redirect URLs to the real target. */
function unwrapDdgUrl(href: string): string {
  if (!href) return href;
  if (href.startsWith("//")) href = "https:" + href;
  try {
    const u = new URL(href, "https://duckduckgo.com");
    if (u.pathname === "/l/" || u.pathname.endsWith("/l/")) {
      const real = u.searchParams.get("uddg");
      if (real) return decodeURIComponent(real);
    }
    return u.toString();
  } catch {
    return href;
  }
}

function parseDdgHtml(html: string, limit: number): Hit[] {
  const hits: Hit[] = [];
  // DDG html results: <a class="result__a" href="...">TITLE</a> ...
  //                   <a class="result__snippet" ...>SNIPPET</a>
  const blocks = html.split(/class="result"\b/i).slice(1);
  for (const block of blocks) {
    if (hits.length >= limit) break;
    const titleMatch = block.match(
      /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i
    );
    if (!titleMatch) continue;
    const url = unwrapDdgUrl(titleMatch[1]);
    const title = htmlToText(titleMatch[2]);
    const snippetMatch = block.match(
      /class="result__snippet"[\s\S]*?>([\s\S]*?)<\/a>/i
    );
    const snippet = snippetMatch ? htmlToText(snippetMatch[1]) : "";
    if (url && title) {
      hits.push({ title, url, snippet });
    }
  }
  return hits;
}

router.get("/lumina/web-search", async (req: Request, res: Response) => {
  const q = String(req.query.q ?? "").trim();
  const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? "5"), 10) || 5, 1), 10);
  if (!q) {
    return res.status(400).json({ error: "missing query" });
  }
  try {
    const upstream = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
      {
        headers: {
          "User-Agent": UA,
          Accept: "text/html",
          "Accept-Language": "en-US,en;q=0.9",
        },
      }
    );
    if (!upstream.ok) {
      return res.status(502).json({ error: `upstream ${upstream.status}` });
    }
    const html = await upstream.text();
    const results = parseDdgHtml(html, limit);
    res.json({ query: q, results });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina/web-search] error:", err);
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
