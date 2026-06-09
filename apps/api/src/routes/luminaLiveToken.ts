/**
 * LUMINA LIVE — ephemeral auth token issuer for Gemini Live.
 *
 * Adapted from williamkeesee06-ship-it/LUMINA api/lumina-live-token.ts.
 * The system prompt and tool declarations live in ../lumina/promptAndTools.ts
 * so the text-mode chat proxy uses the exact same definitions.
 *
 * The token issuance machinery itself (POST to v1alpha/auth_tokens) is
 * unchanged because it's an upstream contract with Google.
 */

import { Router, type Request, type Response } from "express";
import {
  LUMINA_SYSTEM_INSTRUCTION,
  LUMINA_TOOLS,
} from "../lumina/promptAndTools.js";
import { loadMemoriesForPrompt, type MemoryItem } from "./luminaMemories.js";

const router = Router();

/** Render the same stored-memories block as luminaChat uses. Kept inline
 *  to avoid a tiny shared module just for this string. Any divergence would
 *  cause voice and text to behave differently — watch this if you edit one. */
function formatMemoryBlock(items: MemoryItem[]): string {
  const lines = items.map((m) => {
    const star = m.pinned ? "\u2606 " : "";
    const kind = m.kind && m.kind !== "fact" ? `[${m.kind}] ` : "";
    return `• ${star}${kind}${m.text}`;
  });
  return [
    "=====================================================================",
    "  STORED MEMORIES (durable facts Lumina has saved about Billy)",
    "=====================================================================",
    "These are persistent across sessions. Treat as ground truth about",
    "Billy himself, his preferences, and his shortcuts — NOT as job data.",
    "(Job/markup/photo data still requires a tool call.)",
    "",
    ...lines,
  ].join("\n");
}

router.post("/lumina/live-token", async (req: Request, res: Response) => {
  const username = typeof req.body?.username === "string" ? req.body.username : "";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(503).json({
      error: "intelligence_offline",
      message: "Lumina Live is offline — GEMINI_API_KEY not configured.",
    });
    return;
  }

  const now = Date.now();
  const newSessionExpire = new Date(now + 2 * 60 * 1000).toISOString();
  const expireTime = new Date(now + 30 * 60 * 1000).toISOString();

  // Live API model — Gemini 3.1 Flash Live Preview (newest, lower latency).
  // 3.5 Flash does NOT support Live API yet; revisit when a 3.x Live goes GA.
  const MODEL = "gemini-3.1-flash-live-preview";
  const VOICE = "Aoede"; // composed, warm — fits Lumina

  // Phase 5c — inject saved memories into the Live mode system prompt so
  // voice and text behave identically. Failure is non-fatal.
  let memories: MemoryItem[] = [];
  if (username) {
    try {
      memories = await loadMemoriesForPrompt(username, 100);
    } catch (memErr) {
      // eslint-disable-next-line no-console
      console.warn("[lumina-live-token] memory load failed, continuing:", memErr);
    }
  }
  const sysInstruction = memories.length === 0
    ? LUMINA_SYSTEM_INSTRUCTION
    : `${LUMINA_SYSTEM_INSTRUCTION}\n\n${formatMemoryBlock(memories)}`;

  const body = {
    uses: 1,
    expireTime,
    newSessionExpireTime: newSessionExpire,
    bidiGenerateContentSetup: {
      model: `models/${MODEL}`,
      generationConfig: {
        responseModalities: ["AUDIO"],
        // Low entropy keeps quoted data verbatim (matches truth-lock rules).
        temperature: 0.2,
        topP: 0.7,
        topK: 40,
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
          languageCode: "en-US",
        },
      },
      systemInstruction: { parts: [{ text: sysInstruction }] },
      tools: LUMINA_TOOLS,
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      realtimeInputConfig: { activityHandling: "START_OF_ACTIVITY_INTERRUPTS" },
    },
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1alpha/auth_tokens?key=${apiKey}`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      // eslint-disable-next-line no-console
      console.error("[lumina-live-token] auth_tokens.create failed", response.status, errText);
      res.status(502).json({
        error: "token_provisioning_failed",
        status: response.status,
        message: errText.slice(0, 800),
      });
      return;
    }

    const json = (await response.json()) as { name?: string; expireTime?: string };
    if (!json.name) {
      res.status(502).json({ error: "no_token_returned", message: "Gemini did not return a token name." });
      return;
    }
    res.status(200).json({ name: json.name, expireTime: json.expireTime ?? expireTime, model: MODEL });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[lumina-live-token] error", err);
    res.status(500).json({ error: "server_error", message: (err as Error).message });
  }
});

export default router;
