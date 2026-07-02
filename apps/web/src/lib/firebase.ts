// Firebase client app — used only to invoke the 811 Callable Functions
// (ITIC bot etc.) via the Functions SDK. Auth in this app is the lightweight
// localStorage username scheme (see authContext), so there is no Firebase Auth
// user; callables are invoked unauthenticated, which the deployed functions
// permit. Config is supplied per-environment via VITE_FIREBASE_* vars.
import { initializeApp, type FirebaseApp } from "firebase/app";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const app: FirebaseApp = initializeApp(firebaseConfig);
