// Cloud Storage security-rules tests (Firebase emulator).
//
// Run against the Storage emulator, e.g.:
//   npm run test:storage-rules
// which wraps this file in `firebase emulators:exec --only storage`.
//
// Covers the Print Overlay Studio bugfix: uploads to
// jobs/{jobId}/print-overlay/... were denied (403 storage/unauthorized) because
// only ziply-prints/** was allowed. These tests pin the intended access model
// and guard the surrounding rules against regressions.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, uploadBytes, getBytes } from "firebase/storage";

const here = dirname(fileURLToPath(import.meta.url));
const PDF = { contentType: "application/pdf" };
const PNG = { contentType: "image/png" };
const bytes = (n) => new Uint8Array(n);

let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "demo-nsc-app-map",
    storage: {
      rules: readFileSync(resolve(here, "..", "storage.rules"), "utf8"),
    },
  });
});

after(async () => {
  if (testEnv) await testEnv.cleanup();
});

// A signed-in (anonymous is enough) user — the app's Storage auth model.
const authed = () => testEnv.authenticatedContext("operator-1").storage();
const anon = () => testEnv.unauthenticatedContext().storage();

const OVERLAY_PDF = "jobs/wo_6012772/print-overlay/upload-123/source.pdf";
const OVERLAY_PNG = "jobs/wo_6012772/print-overlay/upload-123/p1.png";

test("authenticated user can upload a source PDF to print-overlay", async () => {
  await assertSucceeds(uploadBytes(ref(authed(), OVERLAY_PDF), bytes(1024), PDF));
});

test("authenticated user can upload a page-preview PNG to print-overlay", async () => {
  await assertSucceeds(uploadBytes(ref(authed(), OVERLAY_PNG), bytes(1024), PNG));
});

test("authenticated user can re-upload (update) a page-preview PNG", async () => {
  const r = ref(authed(), OVERLAY_PNG);
  await assertSucceeds(uploadBytes(r, bytes(1024), PNG));
  await assertSucceeds(uploadBytes(r, bytes(2048), PNG));
});

test("authenticated user can read back a print-overlay object", async () => {
  await assertSucceeds(uploadBytes(ref(authed(), OVERLAY_PNG), bytes(1024), PNG));
  await assertSucceeds(getBytes(ref(authed(), OVERLAY_PNG)));
});

test("unauthenticated upload to print-overlay is denied", async () => {
  await assertFails(uploadBytes(ref(anon(), OVERLAY_PDF), bytes(1024), PDF));
});

test("unauthenticated read of print-overlay is denied", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), OVERLAY_PNG), bytes(1024), PNG);
  });
  await assertFails(getBytes(ref(anon(), OVERLAY_PNG)));
});

test("disallowed content type (svg) in print-overlay is denied", async () => {
  await assertFails(
    uploadBytes(ref(authed(), OVERLAY_PNG), bytes(1024), { contentType: "image/svg+xml" })
  );
});

test("oversized print-overlay upload (>100MB) is denied", async () => {
  // Metadata-declared size is validated by the rules; use a large declared blob.
  const big = bytes(100 * 1024 * 1024 + 1);
  await assertFails(uploadBytes(ref(authed(), OVERLAY_PDF), big, PDF));
});

test("print-overlay delete is denied even when authenticated", async () => {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    await uploadBytes(ref(ctx.storage(), OVERLAY_PNG), bytes(1024), PNG);
  });
  const { deleteObject } = await import("firebase/storage");
  await assertFails(deleteObject(ref(authed(), OVERLAY_PNG)));
});

test("unrelated top-level path remains denied for authenticated user", async () => {
  await assertFails(
    uploadBytes(ref(authed(), "secret/other.pdf"), bytes(1024), PDF)
  );
});

test("existing ziply-prints upload still works for authenticated user", async () => {
  await assertSucceeds(
    uploadBytes(ref(authed(), "ziply-prints/wo_6012772/permit.pdf"), bytes(1024), PDF)
  );
});
