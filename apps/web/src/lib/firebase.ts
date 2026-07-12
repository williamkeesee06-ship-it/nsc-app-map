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
 * Wait until Firebase has a signed-in user (or timeout), then return an ID token.
 * Fixes "Missing Authorization Bearer token" when /api fires before session restore.
 */
export async function waitForIdToken(timeoutMs = 8000): Promise<string | null> {
  const auth = getFirebaseAuth();
  try {
    await auth.authStateReady();
  } catch {
    /* ignore */
  }

  const fromUser = async (user: User | null): Promise<string | null> => {
    if (!user) return null;
    try {
      return await user.getIdToken(/* forceRefresh */ false);
    } catch {
      try {
        return await user.getIdToken(true);
      } catch {
        return null;
      }
    }
  };

  const immediate = await fromUser(auth.currentUser);
  if (immediate) return immediate;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        unsub();
      } catch {
        /* ignore */
      }
      resolve(token);
    };

    const timer = setTimeout(() => {
      void fromUser(auth.currentUser).then(finish);
    }, timeoutMs);

    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) return;
      void fromUser(user).then(finish);
    });
  });
}

/** Resolve a fresh ID token (waits for session). Prefer waitForIdToken for API. */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  if (!forceRefresh) {
    return waitForIdToken(8000);
  }
  const auth = getFirebaseAuth();
  try {
    await auth.authStateReady();
  } catch {
    /* ignore */
  }
  const user = auth.currentUser;
  if (!user) return waitForIdToken(8000);
  try {
    return await user.getIdToken(true);
  } catch {
    return waitForIdToken(3000);
  }
}

export async function signInWithEmail(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(getFirebaseAuth(), email.trim(), password);
  // Ensure token is mintable before callers hit /api/*
  await cred.user.getIdToken(true);
  return cred.user;
}

export async function signOutFirebase(): Promise<void> {
  await signOut(getFirebaseAuth());
}

export { onAuthStateChanged };
export type { User };
