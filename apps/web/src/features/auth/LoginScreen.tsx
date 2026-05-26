// Phase 9.7: supervisor login with Smartsheet name validation.
// Fetches /api/jobs, builds a set of unique constructionSupervisor names,
// and only allows sign-in if the entered name (case-insensitive) is in that set.
import { useState } from "react";
import { useAuth } from "./authContext.js";
import { api } from "../../lib/api.js";

export default function LoginScreen() {
  const { setUsername } = useAuth();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter your name to continue.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { jobs } = await api.listJobs();
      const supervisors = new Set(
        jobs
          .map((j) => (j.constructionSupervisor ?? "").trim().toLowerCase())
          .filter(Boolean)
      );
      const match = trimmed.toLowerCase();
      if (!supervisors.has(match)) {
        setError("Name not found in Smartsheet. Check spelling or contact admin.");
        setBusy(false);
        return;
      }
      // Save the canonical Smartsheet casing.
      const canonical = jobs
        .map((j) => (j.constructionSupervisor ?? "").trim())
        .find((s) => s.toLowerCase() === match) ?? trimmed;
      setUsername(canonical);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify name.");
      setBusy(false);
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
        {/* Electric blue accent bar (matches smooth stainless theme) */}
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
          Supervisor sign-in
        </h2>
        <p style={{ margin: 0, fontSize: 11, color: "#4a5868", lineHeight: 1.5 }}>
          Enter your name exactly as it appears in Smartsheet. Your jobs will load
          automatically.
        </p>
        <input
          type="text"
          autoFocus
          placeholder="e.g. Billy Keesee"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
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
          {busy ? "Verifying…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
