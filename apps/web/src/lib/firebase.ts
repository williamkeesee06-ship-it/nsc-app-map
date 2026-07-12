// Firebase client app — used for:
//   • Real app login (Email/Password) — solo lock
//   • 811 Callable Functions
//   • Browser-side Firebase Storage uploads
// Config is supplied per-environment via VITE_FIREBASE_* vars.
import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const app: FirebaseApp = initializeApp(firebaseConfig);

export function getFirebaseAuth(): Auth {
  return getAuth(app);
}

export function getCurrentUser(): User | null {
  return getFirebaseAuth().currentUser;
}

/**
 * Resolve a fresh ID token for API Authorization headers.
 * Waits for Firebase Auth to finish restoring the session first — without this,
 * early /api calls after page load send no Bearer token → 401 → empty maps/HUD.
 */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const auth = getFirebaseAuth();
  try {
    await auth.authStateReady();
  } catch {
    /* ignore */
  }
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export { onAuthStateChanged };
export type { User };
