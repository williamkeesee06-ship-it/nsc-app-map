import { db } from "../lib/firestore.js";
import admin from "firebase-admin";

async function main() {
  const snapshot = await db().collection("jobs").get();
  let batch = db().batch();
  let count = 0;
  let totalWiped = 0;

  for (const doc of snapshot.docs) {
    const job = doc.data();
    let updated = false;
    let updatePayload: any = {};

    if (job.ziplyIngest) {
      updatePayload["ziplyIngest"] = admin.firestore.FieldValue.delete();
      updated = true;
    }

    if (job.ziplyPrintLayer) {
      // WIPE EVERYTHING completely. No exceptions for poles, handholes, or peds.
      updatePayload["ziplyPrintLayer"] = {
        printMarkups: []
      };
      updated = true;
    }

    if (updated) {
      batch.update(doc.ref, updatePayload);
      count++;
      totalWiped++;
      
      if (count === 400) {
        await batch.commit();
        console.log(`Committed batch of 400...`);
        batch = db().batch();
        count = 0;
      }
    }
  }

  if (count > 0) {
    await batch.commit();
  }

  console.log(`Successfully wiped prints and non-pole markups from ${totalWiped} jobs.`);
}

main().catch(console.error);
