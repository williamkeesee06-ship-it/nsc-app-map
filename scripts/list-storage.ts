import { storageBucket } from "../apps/api/src/lib/firestore.js";
import dotenv from "dotenv";

dotenv.config();
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.prod" });

async function run() {
  const bucket = storageBucket();
  console.log(`Listing files in storage bucket: ${bucket.name}...`);
  const [files] = await bucket.getFiles();
  console.log(`Total files in bucket: ${files.length}`);
  
  files.forEach((f) => {
    console.log(`- File: ${f.name} (${f.metadata.size} bytes, type: ${f.metadata.contentType})`);
  });
}

run().catch(console.error);
