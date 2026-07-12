// Firebase Admin singleton. Safe under serverless cold starts.
import admin from "firebase-admin";
import { getEnv } from "../config/env.js";

let app: admin.app.App | null = null;

function getApp(): admin.app.App {
  if (app) return app;
  if (admin.apps.length > 0) {
    app = admin.apps[0]!;
    return app;
  }
  const env = getEnv();
  const options: admin.AppOptions = {
    credential: admin.credential.cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey: env.FIREBASE_PRIVATE_KEY,
    }),
  };
  const storageBucket = env.FIREBASE_STORAGE_BUCKET ?? env.VITE_FIREBASE_STORAGE_BUCKET;
  if (storageBucket) {
    options.storageBucket = storageBucket;
  }
  app = admin.initializeApp(options);
  return app;
}

export function db() {
  return getApp().firestore();
}

export function adminAuth() {
  return getApp().auth();
}

export function storageBucket(bucketName?: string) {
  return bucketName ? getApp().storage().bucket(bucketName) : getApp().storage().bucket();
}
