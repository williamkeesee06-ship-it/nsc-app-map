// Phase 6 — notifications. Every alert is written to Firestore (in-app feed the
// web client reads) and, when Pushover secrets are present, also pushed to the
// operator's phone. Pushover is best-effort: a push failure never blocks the
// Firestore write.
import { getFirestore } from "firebase-admin/firestore";

export type NotificationKind =
  | "ticket-filed"
  | "ticket-expiring"
  | "ticket-expired"
  | "utility-responded"
  | "ready-to-dig"
  | "bot-error";

export interface NotifyInput {
  kind: NotificationKind;
  title: string;
  body: string;
  ticketId?: string;
  jobId?: string;
}

async function pushToPhone(title: string, message: string): Promise<void> {
  const token = process.env.PUSHOVER_TOKEN;
  const user = process.env.PUSHOVER_USER;
  if (!token || !user) return; // Pushover not configured — in-app only.
  try {
    await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, user, title, message }).toString(),
    });
  } catch (err) {
    console.warn("[notifications] Pushover failed:", err);
  }
}

export async function notify(input: NotifyInput): Promise<void> {
  const db = getFirestore();
  await db.collection("notifications").add({
    ...input,
    read: false,
    createdAt: Date.now(),
  });
  await pushToPhone(input.title, input.body);
}
