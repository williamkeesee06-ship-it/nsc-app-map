/**
 * Voice helpers — Web Speech API for both directions.
 *
 *  - SpeechRecognition: speech-to-text. Browser-side, free, fast. Works
 *    great in Chrome/Edge. Safari has partial support; Firefox is limited.
 *  - SpeechSynthesis: text-to-speech for Lumina's reply. We pick the
 *    best-available female English voice with a slight pitch dip so she
 *    sounds composed instead of perky.
 */

// ---- Types for browser speech API (not in default lib.dom in older TS) ----

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: { length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  }
}

export function isSpeechSupported(): boolean {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function createRecognizer(opts: {
  continuous?: boolean;
  interim?: boolean;
  lang?: string;
}): SpeechRecognitionLike | null {
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = opts.lang ?? "en-US";
  r.interimResults = opts.interim ?? true;
  r.continuous = opts.continuous ?? false;
  r.maxAlternatives = 1;
  return r;
}

// ---- Text-to-speech ----

let cachedVoice: SpeechSynthesisVoice | null = null;
let resolveVoices: (() => void) | undefined;
const voicesReady: Promise<void> = new Promise<void>((res) => {
  resolveVoices = res;
});

if (typeof window !== "undefined" && "speechSynthesis" in window) {
  // Voices populate asynchronously in some browsers
  if (window.speechSynthesis.getVoices().length > 0) {
    resolveVoices && resolveVoices();
  } else {
    window.speechSynthesis.addEventListener("voiceschanged", () => {
      resolveVoices && resolveVoices();
    });
  }
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  // Prefer high-quality female English voices in this priority order.
  const preferred = [
    /Google US English/i, // Google Chrome high-quality
    /Samantha/i, // macOS premium
    /Microsoft Aria/i, // Edge premium
    /Microsoft Jenny/i,
    /Google UK English Female/i,
    /Karen/i,
    /Tessa/i,
    /female/i,
  ];
  for (const re of preferred) {
    const match = voices.find((v) => re.test(v.name) && /en[-_]/i.test(v.lang));
    if (match) {
      cachedVoice = match;
      return match;
    }
  }
  // Fallback: any English voice
  cachedVoice = voices.find((v) => /^en/i.test(v.lang)) ?? voices[0];
  return cachedVoice;
}

let currentUtterance: SpeechSynthesisUtterance | null = null;

export async function speak(
  text: string,
  opts: { onEnd?: () => void; onStart?: () => void } = {},
): Promise<void> {
  if (!("speechSynthesis" in window)) return;
  const cleaned = text.replace(/<<TOOL>>[\s\S]*?<<END>>/g, "").trim();
  if (!cleaned) return;
  cancelSpeak();
  await voicesReady;
  const u = new SpeechSynthesisUtterance(cleaned);
  const voice = pickVoice();
  if (voice) u.voice = voice;
  u.rate = 1.02;
  u.pitch = 0.92; // slight dip for composed feel
  u.volume = 1;
  if (opts.onStart) u.onstart = opts.onStart;
  u.onend = () => {
    currentUtterance = null;
    opts.onEnd?.();
  };
  u.onerror = () => {
    currentUtterance = null;
    opts.onEnd?.();
  };
  currentUtterance = u;
  window.speechSynthesis.speak(u);
}

export function cancelSpeak(): void {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  currentUtterance = null;
}

export function isSpeaking(): boolean {
  return !!("speechSynthesis" in window && window.speechSynthesis.speaking);
}
