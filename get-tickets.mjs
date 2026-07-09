import admin from "firebase-admin";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const privateKey = process.env.FIREBASE_PRIVATE_KEY 
  ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
  : undefined;

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  }),
});

const db = admin.firestore();

async function run() {
  console.log("Fetching tickets...");
  const snap = await db.collection("digTickets")
    .where("status", "==", "Filed")
    .limit(10)
    .get();
    
  if (snap.empty) {
    console.log("No filed tickets found!");
    return;
  }
  
  snap.forEach(doc => {
    const data = doc.data();
    console.log(`ID: ${doc.id}, Ticket#: ${data.ticketNumber}, Status: ${data.status}`);
  });
}

run().catch(console.error);
