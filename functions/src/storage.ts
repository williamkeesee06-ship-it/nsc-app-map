// Upload bot screenshots to the default Firebase Storage bucket and return a
// long-lived download URL for display in the ticket detail view.
import { getStorage } from "firebase-admin/storage";
import { randomUUID } from "crypto";

export async function uploadScreenshot(
  ticketId: string,
  kind: "review" | "confirmation" | "failure",
  png: Buffer
): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `dig-tickets/${ticketId}/${kind}-${Date.now()}.png`;
  const file = bucket.file(path);
  const token = randomUUID();
  await file.save(png, {
    contentType: "image/png",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    path
  )}?alt=media&token=${token}`;
}

// Upload the ITIC confirmation PDF to a stable path and return a download URL.
export async function uploadConfirmationPdf(ticketId: string, pdf: Buffer): Promise<string> {
  const bucket = getStorage().bucket();
  const path = `dig-tickets/${ticketId}/itic-confirmation.pdf`;
  const file = bucket.file(path);
  const token = randomUUID();
  await file.save(pdf, {
    contentType: "application/pdf",
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(
    path
  )}?alt=media&token=${token}`;
}
