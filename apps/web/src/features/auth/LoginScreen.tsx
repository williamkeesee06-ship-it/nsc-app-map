// Phase 9: simple username login modal (no real auth).
import { useState } from "react";
import { useAuth } from "./authContext.js";

export default function LoginScreen() {
  const { setUsername } = useAuth();
  const [value, setValue] = useState("");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setUsername(value);
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 12, 20, 0.85)",
        display: "grid",
        placeItems: "center",
        zIndex: 5000,
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: "var(--surface, #161e2c)",
          border: "1px solid var(--chrome-trim-mid, rgba(200,208,218,0.22))",
          borderRadius: "var(--panel-radius, 10px)",
          padding: 28,
          width: 360,
          maxWidth: "92vw",
          boxShadow: "var(--panel-elevation, 0 8px 32px rgba(0,0,0,0.55))",
          display: "flex",
          flexDirection: "column",
          gap: 14,
          color: "var(--text, #f4f8ff)",
          fontFamily: "ui-monospace, 'SF Mono', Consolas, monospace",
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: "var(--text-muted, #8a96a3)" }}>
          NSC APP MAP
        </div>
        <h2 style={{ margin: 0, fontSize: 18, color: "var(--text, #f4f8ff)" }}>Who are you?</h2>
        <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted, #8a96a3)", lineHeight: 1.5 }}>
          Enter your supervisor name to filter jobs to just yours. Leave blank to see everything.
        </p>
        <input
          type="text"
          autoFocus
          placeholder="e.g. Billy Keesee"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(200,208,218,0.22)",
            borderRadius: 6,
            padding: "10px 12px",
            fontFamily: "inherit",
            fontSize: 13,
            color: "var(--text, #f4f8ff)",
            outline: "none",
          }}
        />
        <button
          type="submit"
          style={{
            background: "var(--accent-blue, #3aa7ff)",
            color: "#0a1220",
            border: "none",
            borderRadius: 6,
            padding: "10px 14px",
            fontFamily: "inherit",
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
          }}
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => setUsername("")}
          style={{
            background: "transparent",
            color: "var(--text-muted, #8a96a3)",
            border: "1px solid rgba(200,208,218,0.16)",
            borderRadius: 6,
            padding: "8px 12px",
            fontFamily: "inherit",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          Skip — show all jobs
        </button>
      </form>
    </div>
  );
}
