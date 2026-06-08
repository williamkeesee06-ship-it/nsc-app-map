/**
 * LUMINA — Gemini Live API client.
 *
 * Real-time bidirectional voice with Gemini's native-audio model. Browser opens
 * WSS directly using a short-lived ephemeral token issued by /api/lumina-live-token.
 *
 * Audio I/O:
 *   - Capture mic at 16kHz mono PCM16 (a dedicated AudioContext at sampleRate=16000)
 *   - Stream to Gemini as base64 PCM in `realtimeInput.audio`
 *   - Receive base64 PCM 24kHz from Gemini, queue + play through a 24kHz AudioContext
 *
 * Two AudioContexts are required because the Web Audio API resamples on output;
 * mixing a 24kHz buffer through a 48kHz context plays it ~2x sped up ("chipmunk").
 */

export type LuminaLiveStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "thinking"
  | "error"
  | "closed";

export interface LuminaLiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface LuminaLiveToolResult {
  ok: boolean;
  message?: string;
  data?: Record<string, unknown>;
}

export interface LuminaLiveCallbacks {
  onStatus?: (status: LuminaLiveStatus) => void;
  onUserTranscript?: (text: string, isFinal: boolean) => void;
  onModelTranscript?: (text: string, isFinal: boolean) => void;
  onError?: (message: string) => void;
  onClose?: () => void;
  /** Called when Gemini Live invokes a tool. Return a result object that
   *  will be sent back as a toolResponse. If undefined, a default "not
   *  available" response is returned. */
  onToolCall?: (call: LuminaLiveToolCall) => Promise<LuminaLiveToolResult> | LuminaLiveToolResult;
  /** Called once after setupComplete so the panel can return the current
   *  Smartsheet context. Lumina will receive it as a user-role clientContent
   *  message before any voice input. */
  getInitialContext?: () => Record<string, unknown> | null;
  /** Called once after setupComplete to return Lumina's persistent memory
   *  (facts + summary). Live mode previously had NO access to memory, which
   *  is why she invented PSC numbers in voice. This wires it in. */
  getInitialMemory?: () => { facts?: string[]; summary?: string } | null;
}

interface TokenResponse {
  name: string;
  expireTime: string;
  model: string;
}

const ENDPOINT_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
const FRAME_SIZE = 2048; // ~128ms at 16kHz — good real-time tradeoff

/**
 *  PR #13 — thinking-loop guard. Live previously had no ceiling on the number
 *  of toolCall round-trips per user turn; if the model fell into a "call X,
 *  see result, call X again" pattern we'd spin forever, the user heard nothing
 *  back, and the UI sat on "thinking…". Anything past this many calls in a
 *  single turn is treated as a stall and short-circuited with a fallback line.
 */
const MAX_TOOL_ITERATIONS_PER_TURN = 6;

export class LuminaLiveSession {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private playbackQueue: AudioBufferSourceNode[] = [];
  private nextPlaybackTime = 0;
  private setupSent = false;
  private contextSent = false;
  private cb: LuminaLiveCallbacks;
  private inputTranscriptBuffer = "";
  private outputTranscriptBuffer = "";
  private modelSpeaking = false;
  // Tool-call loop guards (PR #13).
  private toolCallsThisTurn = 0;
  private lastToolSignature: string | null = null;
  private lastToolResultCache: LuminaLiveToolResult | null = null;
  private stallNoticeSent = false;

  constructor(callbacks: LuminaLiveCallbacks = {}) {
    this.cb = callbacks;
  }

  async start(): Promise<void> {
    this.emitStatus("connecting");

    // 1. Get ephemeral token from our backend
    let token: TokenResponse;
    try {
      const res = await fetch("/api/lumina-live-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Token fetch ${res.status}: ${err.slice(0, 200)}`);
      }
      token = (await res.json()) as TokenResponse;
    } catch (err) {
      this.fail(`Token error: ${(err as Error).message}`);
      throw err;
    }

    // 2. Request microphone
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (err) {
      this.fail(`Microphone access denied: ${(err as Error).message}`);
      throw err;
    }

    // 3. Build AudioContexts (separate sample rates)
    const AC: typeof AudioContext =
      (window.AudioContext as typeof AudioContext) ||
      ((window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext as typeof AudioContext);
    if (!AC) {
      this.fail("Web Audio API not supported in this browser.");
      throw new Error("no_audio_context");
    }
    try {
      this.inputCtx = new AC({ sampleRate: INPUT_RATE });
      this.outputCtx = new AC({ sampleRate: OUTPUT_RATE });
    } catch {
      // Some browsers (Safari) ignore sampleRate. Fall back and resample manually below.
      this.inputCtx = new AC();
      this.outputCtx = new AC();
    }
    // Some browsers require resume on a user gesture (toggle is one).
    if (this.inputCtx.state === "suspended") await this.inputCtx.resume();
    if (this.outputCtx.state === "suspended") await this.outputCtx.resume();

    // 4. Open WebSocket
    const tokenName = encodeURIComponent(token.name);
    const wsUrl = `${ENDPOINT_BASE}?access_token=${tokenName}`;
    this.ws = new WebSocket(wsUrl);
    this.ws.binaryType = "arraybuffer";

    this.ws.onopen = () => this.handleOpen(token);
    this.ws.onmessage = (ev) => this.handleMessage(ev);
    this.ws.onerror = () => this.fail("WebSocket error.");
    this.ws.onclose = (ev) => this.handleClose(ev);
  }

  stop(): void {
    this.emitStatus("closed");
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;

    // Stop audio capture
    if (this.processor) {
      try {
        this.processor.disconnect();
      } catch {
        /* noop */
      }
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        /* noop */
      }
    }
    this.processor = null;
    this.sourceNode = null;

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }

    // Cancel queued playback
    for (const node of this.playbackQueue) {
      try {
        node.stop();
      } catch {
        /* noop */
      }
    }
    this.playbackQueue = [];

    if (this.inputCtx) {
      this.inputCtx.close().catch(() => {});
      this.inputCtx = null;
    }
    if (this.outputCtx) {
      this.outputCtx.close().catch(() => {});
      this.outputCtx = null;
    }

    this.cb.onClose?.();
  }

  /** True if currently connected. */
  isActive(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // ---------- internals ----------

  private handleOpen(token: TokenResponse): void {
    if (!this.ws) return;
    // Setup message — must be the first frame
    const setup = {
      setup: {
        model: `models/${token.model}`,
      },
    };
    this.ws.send(JSON.stringify(setup));
    this.setupSent = true;
    this.startCapture();
    this.emitStatus("listening");
  }

  private startCapture(): void {
    if (!this.inputCtx || !this.mediaStream) return;
    this.sourceNode = this.inputCtx.createMediaStreamSource(this.mediaStream);
    // ScriptProcessor is deprecated but universally supported and adequate here.
    // Buffer size 2048 = ~128ms at 16kHz; small enough for low latency.
    this.processor = this.inputCtx.createScriptProcessor(FRAME_SIZE, 1, 1);
    this.processor.onaudioprocess = (e) => this.handleAudioFrame(e);
    this.sourceNode.connect(this.processor);
    // Connect to destination so onaudioprocess actually fires (some browsers need it).
    // We use a gain of 0 to keep it silent.
    const muteNode = this.inputCtx.createGain();
    muteNode.gain.value = 0;
    this.processor.connect(muteNode);
    muteNode.connect(this.inputCtx.destination);
  }

  private handleAudioFrame(e: AudioProcessingEvent): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupSent) return;
    const input = e.inputBuffer.getChannelData(0);

    // If the AudioContext didn't honor our 16kHz request, resample.
    let frame: Float32Array = input;
    const ctxRate = this.inputCtx?.sampleRate ?? INPUT_RATE;
    if (Math.abs(ctxRate - INPUT_RATE) > 1) {
      frame = downsampleFloat32(input, ctxRate, INPUT_RATE);
    }

    const pcm16 = float32ToInt16(frame);
    const b64 = arrayBufferToBase64(pcm16.buffer);
    const msg = {
      realtimeInput: {
        audio: {
          data: b64,
          mimeType: `audio/pcm;rate=${INPUT_RATE}`,
        },
      },
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* socket closed mid-frame */
    }
  }

  private handleMessage(ev: MessageEvent): void {
    let payload: unknown;
    try {
      const text = typeof ev.data === "string" ? ev.data : new TextDecoder().decode(ev.data as ArrayBuffer);
      payload = JSON.parse(text);
    } catch {
      return;
    }
    const data = payload as LiveServerMessage;

    if (data.setupComplete) {
      // Send MEMORY first so Lumina has continuity from prior sessions,
      // THEN the Smartsheet truth payload so she has the universe data.
      // Previously Live got NEITHER memory — root cause of the "she invents
      // PSC numbers in voice" complaint.
      this.sendInitialMemory();
      this.sendInitialContext();
      return;
    }

    const sc = data.serverContent;
    if (sc) {
      // Audio out
      const parts = sc.modelTurn?.parts ?? [];
      for (const part of parts) {
        const inline = part.inlineData;
        if (inline?.data && inline.mimeType?.startsWith("audio/pcm")) {
          this.queuePlayback(inline.data);
          if (!this.modelSpeaking) {
            this.modelSpeaking = true;
            this.emitStatus("speaking");
          }
        }
      }

      // Transcripts
      if (sc.inputTranscription?.text) {
        this.inputTranscriptBuffer += sc.inputTranscription.text;
        this.cb.onUserTranscript?.(this.inputTranscriptBuffer, false);
      }
      if (sc.outputTranscription?.text) {
        this.outputTranscriptBuffer += sc.outputTranscription.text;
        this.cb.onModelTranscript?.(this.outputTranscriptBuffer, false);
      }

      // Turn boundaries
      if (sc.turnComplete) {
        if (this.outputTranscriptBuffer) {
          this.cb.onModelTranscript?.(this.outputTranscriptBuffer, true);
          this.outputTranscriptBuffer = "";
        }
        if (this.inputTranscriptBuffer) {
          this.cb.onUserTranscript?.(this.inputTranscriptBuffer, true);
          this.inputTranscriptBuffer = "";
        }
        this.modelSpeaking = false;
        // PR #13 — reset tool-loop guards every turn so a previously stuck
        // call doesn't haunt the next user prompt.
        this.toolCallsThisTurn = 0;
        this.lastToolSignature = null;
        this.lastToolResultCache = null;
        this.stallNoticeSent = false;
        this.emitStatus("listening");
      }

      // Interruption — model was cut off by user voice
      if (sc.interrupted) {
        this.cancelPlayback();
        this.modelSpeaking = false;
        this.emitStatus("listening");
      }
    }

    if (data.toolCall) {
      this.dispatchToolCalls(data.toolCall.functionCalls ?? []);
    }

    if (data.goAway) {
      // Server is about to close — let onclose handle teardown.
    }
  }

  private queuePlayback(b64: string): void {
    if (!this.outputCtx) return;
    const bytes = base64ToUint8(b64);
    const pcm = new Int16Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 2);
    const float = int16ToFloat32(pcm);

    // The output context might not have honored our 24kHz request. Build a buffer
    // at OUTPUT_RATE and let the context resample, OR resample manually.
    const ctxRate = this.outputCtx.sampleRate;
    let playbackData: Float32Array = float;
    if (Math.abs(ctxRate - OUTPUT_RATE) > 1) {
      playbackData = upsampleFloat32(float, OUTPUT_RATE, ctxRate);
    }

    const buf = this.outputCtx.createBuffer(1, playbackData.length, ctxRate);
    buf.getChannelData(0).set(playbackData);

    const node = this.outputCtx.createBufferSource();
    node.buffer = buf;
    node.connect(this.outputCtx.destination);

    const now = this.outputCtx.currentTime;
    const startAt = Math.max(now, this.nextPlaybackTime);
    node.start(startAt);
    this.nextPlaybackTime = startAt + buf.duration;

    this.playbackQueue.push(node);
    node.onended = () => {
      this.playbackQueue = this.playbackQueue.filter((n) => n !== node);
    };
  }

  private sendInitialContext(): void {
    if (this.contextSent) return;
    this.contextSent = true;
    const ctx = this.cb.getInitialContext?.() ?? null;
    if (!ctx || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text =
      "CURRENT_STATE — this is your only source of work-truth. Read silently, do NOT speak about it unless asked. Stay quiet until I talk.\n\n" +
      JSON.stringify(ctx);
    const msg = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      },
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* socket may have closed */
    }
  }

  /**
   *  Send Lumina's persistent memory at session start so Live mode has
   *  continuity with the chat surface. Without this, voice mode is amnesiac
   *  — root cause of the "she invents PSC numbers" hallucination report.
   *
   *  The block is sent as a user-role clientContent BEFORE the universe
   *  state so the model treats it as preface, not as a turn awaiting reply.
   */
  private sendInitialMemory(): void {
    const mem = this.cb.getInitialMemory?.() ?? null;
    if (!mem || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const factCount = mem.facts?.length ?? 0;
    if (factCount === 0 && !mem.summary) return;

    const lines: string[] = [
      "MEMORY — durable facts you committed to across prior sessions. Treat as ground truth about Billy's situation. Reference naturally. Read silently, do NOT recite this back unless I ask.",
    ];
    if (mem.summary) lines.push(`SUMMARY: ${mem.summary}`);
    if (factCount > 0) {
      lines.push(
        "FACTS:\n" + (mem.facts ?? []).map((f) => `- ${f}`).join("\n"),
      );
    }
    const text = lines.join("\n\n");
    const msg = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      },
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* noop */
    }
  }

  /**
   *  Push a memory delta mid-session — used after a new fact is committed
   *  via rememberFact or the auto-save heuristics so Live stays in lockstep
   *  with the chat surface. Cheap; we send the whole block (it's small).
   */
  pushMemory(mem: { facts?: string[]; summary?: string }): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const factCount = mem.facts?.length ?? 0;
    if (factCount === 0 && !mem.summary) return;
    const lines: string[] = [
      "MEMORY update — replaces any prior memory block. Read silently.",
    ];
    if (mem.summary) lines.push(`SUMMARY: ${mem.summary}`);
    if (factCount > 0) {
      lines.push(
        "FACTS:\n" + (mem.facts ?? []).map((f) => `- ${f}`).join("\n"),
      );
    }
    const msg = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text: lines.join("\n\n") }] }],
        turnComplete: false,
      },
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* noop */
    }
  }

  /** Push a fresh Smartsheet context mid-session (e.g. after data refresh). */
  pushContext(ctx: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text =
      "CURRENT_STATE update — replaces any prior universe context. Read silently.\n\n" +
      JSON.stringify(ctx);
    const msg = {
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: false,
      },
    };
    try {
      this.ws.send(JSON.stringify(msg));
    } catch {
      /* noop */
    }
  }

  private async dispatchToolCalls(calls: LiveFunctionCall[]): Promise<void> {
    if (!this.ws) return;
    // PR #13 — increment AFTER the model emits each toolCall batch. Past
    // MAX_TOOL_ITERATIONS_PER_TURN we short-circuit so the model can't keep
    // round-tripping forever (root cause of the "Lumina stuck thinking" bug).
    this.toolCallsThisTurn += calls.length;

    const overLimit = this.toolCallsThisTurn > MAX_TOOL_ITERATIONS_PER_TURN;

    const responses = await Promise.all(
      calls.map(async (fc) => {
        // Duplicate suppression — if the model calls the SAME tool with the
        // SAME args twice in a row, feed the cached result back instead of
        // re-executing. Prevents idempotent reads (listNorthSkyEmails,
        // lookupJob) from looping.
        const signature = `${fc.name}::${JSON.stringify(fc.args ?? {})}`;
        const isDuplicate =
          this.lastToolSignature === signature && this.lastToolResultCache;

        let result: LuminaLiveToolResult = {
          ok: false,
          message: "Tool not available in live mode.",
        };
        if (overLimit) {
          result = {
            ok: false,
            message:
              "Max tool iterations reached for this turn. Stop calling tools, give the operator a one-line answer, and ask for a rephrase.",
          };
        } else if (isDuplicate) {
          result = this.lastToolResultCache!;
        } else if (this.cb.onToolCall) {
          try {
            result = await this.cb.onToolCall({
              id: fc.id,
              name: fc.name,
              args: fc.args ?? {},
            });
          } catch (err) {
            result = { ok: false, message: (err as Error).message };
          }
        }

        this.lastToolSignature = signature;
        this.lastToolResultCache = result;

        return {
          id: fc.id,
          name: fc.name,
          response: { result },
        };
      }),
    );

    if (this.ws?.readyState !== WebSocket.OPEN) return;

    // Send the tool responses back. Two notes:
    //  1) `toolResponse` is the per-spec field name and was correct already.
    //  2) PR #13 — if we just blew the iteration ceiling, additionally close
    //     the turn from the client side. The model can't keep "thinking" if
    //     there's no further tool result expected, so the audio reply lands.
    this.ws.send(JSON.stringify({ toolResponse: { functionResponses: responses } }));

    if (overLimit && !this.stallNoticeSent) {
      this.stallNoticeSent = true;
      // Surface the stall to whoever is wired up (LuminaPanel shows a chat row).
      this.cb.onError?.(
        "Hit max tool-call iterations — Lumina was looping. Try rephrasing.",
      );
      // Force the model out of tool-call territory: send an empty user turn
      // marker so the server flushes a final audio reply rather than waiting
      // for yet another tool round-trip.
      try {
        this.ws.send(
          JSON.stringify({
            clientContent: {
              turns: [
                {
                  role: "user",
                  parts: [
                    {
                      text: "Stop. You hit the tool-call cap. Speak ONE short sentence acknowledging the loop and ask me to rephrase.",
                    },
                  ],
                },
              ],
              turnComplete: true,
            },
          }),
        );
      } catch {
        /* socket closed mid-flush */
      }
    }
  }

  private cancelPlayback(): void {
    for (const node of this.playbackQueue) {
      try {
        node.stop();
      } catch {
        /* noop */
      }
    }
    this.playbackQueue = [];
    this.nextPlaybackTime = this.outputCtx?.currentTime ?? 0;
  }

  private handleClose(ev: CloseEvent): void {
    if (ev.code !== 1000 && ev.code !== 1005) {
      this.cb.onError?.(`Connection closed (${ev.code}) ${ev.reason || ""}`.trim());
    }
    this.cb.onClose?.();
    this.emitStatus("closed");
  }

  private emitStatus(s: LuminaLiveStatus): void {
    this.cb.onStatus?.(s);
  }

  private fail(msg: string): void {
    this.cb.onError?.(msg);
    this.emitStatus("error");
  }
}

// ---------- Live API message types (subset we use) ----------

interface LiveInlineData {
  mimeType?: string;
  data?: string;
}
interface LivePart {
  text?: string;
  inlineData?: LiveInlineData;
}
interface LiveServerContent {
  modelTurn?: { parts?: LivePart[] };
  inputTranscription?: { text?: string };
  outputTranscription?: { text?: string };
  turnComplete?: boolean;
  interrupted?: boolean;
  generationComplete?: boolean;
}
interface LiveFunctionCall {
  id: string;
  name: string;
  args?: Record<string, unknown>;
}
interface LiveServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: LiveServerContent;
  toolCall?: { functionCalls?: LiveFunctionCall[] };
  goAway?: { timeLeft?: string };
}

// ---------- audio utils ----------

function float32ToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    let s = input[i];
    if (s > 1) s = 1;
    else if (s < -1) s = -1;
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function int16ToFloat32(input: Int16Array): Float32Array {
  const out = new Float32Array(input.length);
  for (let i = 0; i < input.length; i++) {
    out[i] = input[i] / 0x8000;
  }
  return out;
}

function arrayBufferToBase64(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Linear downsampling (e.g. 48000 → 16000). Lossy but acceptable for voice. */
function downsampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate >= fromRate) return input;
  const ratio = fromRate / toRate;
  const newLen = Math.floor(input.length / ratio);
  const out = new Float32Array(newLen);
  let pos = 0;
  for (let i = 0; i < newLen; i++) {
    const next = Math.floor((i + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (let j = pos; j < next && j < input.length; j++) {
      sum += input[j];
      count++;
    }
    out[i] = count > 0 ? sum / count : 0;
    pos = next;
  }
  return out;
}

/** Linear upsampling (e.g. 24000 → 48000). */
function upsampleFloat32(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate <= fromRate) return input;
  const ratio = toRate / fromRate;
  const newLen = Math.floor(input.length * ratio);
  const out = new Float32Array(newLen);
  for (let i = 0; i < newLen; i++) {
    const srcIdx = i / ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, input.length - 1);
    const frac = srcIdx - lo;
    out[i] = input[lo] * (1 - frac) + input[hi] * frac;
  }
  return out;
}
