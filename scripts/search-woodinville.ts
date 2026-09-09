import { db } from "../apps/api/src/lib/firestore.js";
import dotenv from "dotenv";
import path from "path";

dotenv.config();
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.prod" });

async function run() {
  const snap = await db().collection("jobs").get();
  console.log(`Total jobs in database: ${snap.size}`);
  let found = 0;
  snap.forEach((doc) => {
    const data = doc.data();
    const city = String(data.city ?? "").toLowerCase();
    const address = String(data.address ?? "").toLowerCase();
    const workOrder = String(data.workOrder ?? "").toLowerCase();
    const notes = String(data.nscProjectNotes ?? "").toLowerCase();
    if (
      city.includes("woodinville") ||
      address.includes("woodinville") ||
      workOrder.includes("woodinville") ||
      notes.includes("woodinville")
    ) {
      found++;
      console.log(`Found job match:`, {
        jobId: data.jobId,
        workOrder: data.workOrder,
        customerProject: data.customerProject,
        city: data.city,
        address: data.address,
        ziplyPrintLayer: !!data.ziplyPrintLayer,
        ziplyIngestStatus: data.ziplyIngest?.status,
      });
    }
  });
  if (found === 0) {
    console.log("No Woodinville-related jobs found in Firestore.");
  }
}

run().catch(console.error);
