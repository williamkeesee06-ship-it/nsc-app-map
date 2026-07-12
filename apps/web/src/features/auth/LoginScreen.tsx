// Firebase Email/Password sign-in (solo lock).
// After auth succeeds, AuthProvider maps the session to operator "Billy Keesee"
// and loads Smartsheet jobs. Not a name-whitelist gate.
import { useState } from "react";
import { useAuth } from "./authContext.js";
import { api } from "../../lib/api.js";
import { signInWithEmail } from "../../lib/firebase.js";

export default function LoginScreen() {
  const { setManagers } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Enter email and password.");
      return;
    }
    setBusy(true);
    setError(null);
    setStatus("Signing in…");
    try {
      const allowedRaw =
        (import.meta.env.VITE_AUTH_ALLOWED_EMAILS as string | undefined) ?? "";
      const allowed = allowedRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(trimmedEmail.toLowerCase())) {
        setError("This account is not authorized for the app yet.");
        setBusy(false);
        setStatus("");
        return;
      }

      const user = await signInWithEmail(trimmedEmail, password);
      // Token was forced in signInWithEmail — confirm before any /api call
      const token = await user.getIdToken();
      if (!token) {
        setError("Signed in but Firebase did not return an API token. Refresh and try again.");
        setBusy(false);
        setStatus("");
        return;
      }
      // AuthProvider will set operator name. Prefetch supervisor/manager lists.
      setStatus("Loading workspace…");
      try {
        const { managers } = await api.listSupervisors();
        setManagers(managers ?? []);
      } catch (listErr) {
        console.warn("listSupervisors after login failed:", listErr);
        if (listErr instanceof Error && /403|Access denied/i.test(listErr.message)) {
          setError("Signed in, but API rejected this account. Check AUTH_ALLOWED_EMAILS on Vercel.");
          setBusy(false);
          setStatus("");
          return;
        }
        if (listErr instanceof Error && /401|Bearer|not signed in/i.test(listErr.message)) {
          setError(
            "Signed in, but API still got no token. Hard-refresh (Ctrl+Shift+R) and try once more. " +
              "If it continues, Vercel FIREBASE_* service-account vars may not match the web app project."
          );
          setBusy(false);
          setStatus("");
          return;
        }
      }
      // AuthProvider handles sync on session attach; overlay unmounts when username is set.
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      setBusy(false);
      setStatus("");
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : "";
      // Firebase Auth Email/Password is NOT your Gmail password unless you
      // created this exact user under Firebase Console → Authentication.
      if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found" ||
        code === "auth/invalid-email"
      ) {
        setError(
          "Firebase rejected this email/password. This is NOT your Gmail login — " +
            "you must create this user in Firebase Console → Authentication → Users " +
            "(Email/Password provider ON), then use that app password here."
        );
      } else if (code === "auth/operation-not-allowed") {
        setError(
          "Email/Password sign-in is disabled in Firebase. Enable it under " +
            "Authentication → Sign-in method → Email/Password."
        );
      } else if (code === "auth/configuration-not-found" || code === "auth/api-key-not-valid") {
        setError(
          "Firebase is not configured for this site. Check VITE_FIREBASE_* env vars on Vercel."
        );
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Wait a moment and try again.");
      } else if (code === "auth/network-request-failed") {
        setError("Network error reaching Firebase. Check internet / VPN / firewall.");
      } else if (err instanceof Error && /403|Access denied/i.test(err.message)) {
        setError(
          "Signed in to Firebase, but this email is not on AUTH_ALLOWED_EMAILS / VITE_AUTH_ALLOWED_EMAILS."
        );
      } else {
        const msg = err instanceof Error ? err.message : "Sign-in failed.";
        setError(code ? `${msg} (${code})` : msg);
      }
      setBusy(false);
      setStatus("");
    }
  }

  return (
    <div
      className="login-overlay"
      style={{
        position: "fixed",
        inset: 0,
        display: "grid",
        placeItems: "center",
        zIndex: 5000,
        background: "rgba(20, 26, 36, 0.55)",
        backdropFilter: "blur(12px) saturate(120%)",
        WebkitBackdropFilter: "blur(12px) saturate(120%)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background:
            "linear-gradient(180deg, #f4f7fb 0%, #e1e6ee 35%, #c8cfd9 70%, #b1b8c4 100%)",
          border: "1px solid rgba(120, 130, 145, 0.45)",
          borderRadius: 12,
          padding: 28,
          width: 380,
          maxWidth: "92vw",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.7) inset, 0 -1px 0 rgba(0,0,0,0.08) inset, 0 18px 48px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          color: "#1a2230",
          fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
        }}
      >
        <div
          style={{
            height: 2,
            background:
              "linear-gradient(90deg, transparent, #3aa7ff 30%, #3aa7ff 70%, transparent)",
            marginBottom: 4,
          }}
        />
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.16em",
            color: "#5a6878",
          }}
        >
          NORTH SKY · APP MAP
        </div>
        <h2 style={{ margin: 0, fontSize: 19, color: "#1a2230", fontWeight: 700 }}>
          Private access
        </h2>
        <p style={{ margin: 0, fontSize: 11, color: "#4a5868", lineHeight: 1.5 }}>
          Authorized operators only. Use the <strong>Firebase Auth</strong> email/password
          created in the Firebase Console — not your Google/Gmail account password
          (unless you set them the same when creating the Firebase user). Workspace
          opens as Billy Keesee until multi-user mapping ships.
        </p>
        <input
          type="email"
          autoFocus
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          disabled={busy}
          style={{
            background: "rgba(255,255,255,0.85)",
            border: error
              ? "1px solid #d04848"
              : "1px solid rgba(120, 130, 145, 0.5)",
            borderRadius: 6,
            padding: "11px 12px",
            fontFamily: "inherit",
            fontSize: 13,
            color: "#1a2230",
            outline: "none",
            boxShadow: "0 1px 2px rgba(0,0,0,0.08) inset",
          }}
        />
        <input
          type="password"
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            if (error) setError(null);
          }}
          disabled={busy}
          style={{
            background: "rgba(255,255,255,0.85)",
            border: error
              ? "1px solid #d04848"
              : "1px solid rgba(120, 130, 145, 0.5)",
            borderRadius: 6,
            padding: "11px 12px",
            fontFamily: "inherit",
            fontSize: 13,
            color: "#1a2230",
            outline: "none",
            boxShadow: "0 1px 2px rgba(0,0,0,0.08) inset",
          }}
        />
        {error && (
          <div
            role="alert"
            style={{
              fontSize: 11,
              color: "#a52a2a",
              background: "rgba(208, 72, 72, 0.10)",
              border: "1px solid rgba(208, 72, 72, 0.35)",
              borderRadius: 6,
              padding: "8px 10px",
              lineHeight: 1.4,
            }}
          >
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          style={{
            background: busy
              ? "linear-gradient(180deg, #c8cfd9, #aeb5bf)"
              : "linear-gradient(180deg, #3aa7ff, #1e7fcc)",
            color: "#ffffff",
            border: "1px solid rgba(30, 80, 140, 0.6)",
            borderRadius: 6,
            padding: "11px 14px",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.10em",
            textTransform: "uppercase",
            cursor: busy ? "wait" : "pointer",
            boxShadow:
              "0 1px 0 rgba(255,255,255,0.35) inset, 0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          {busy ? status || "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
