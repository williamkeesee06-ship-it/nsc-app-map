// Lumina AI briefing card — a pulsing neon orb (not a face), a greeting, and
// three server-computed bullets (jobs ready to submit, permit expirations
// within 7 days, crew conflicts) from /api/lumina/chat in dashboard_briefing
// mode. The "Ask Lumina anything…" input fires a one-shot question at the same
// chat endpoint and shows the reply inline.

import { useEffect, useState } from "react";
import { api, type DashboardBriefing } from "../../../lib/api.js";
import Bezel from "../components/Bezel.js";
import NeonOrb from "../components/NeonOrb.js";

export interface LuminaBriefingCardProps {
  firstName: string;
  username: string | null;
  contract: string;
}

export default function LuminaBriefingCard({
  firstName,
  username,
  contract,
}: LuminaBriefingCardProps) {
  const [briefing, setBriefing] = useState<DashboardBriefing | null>(null);
  const [loading, setLoading] = useState(true);

  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getDashboardBriefing(username ?? "", contract)
      .then((b) => {
        if (!cancelled) setBriefing(b);
      })
      .catch(() => {
        if (!cancelled) setBriefing(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [username, contract]);

  async function ask() {
    const prompt = question.trim();
    if (!prompt || asking) return;
    setAsking(true);
    setAnswer(null);
    try {
      const res = await api.askLumina(prompt, username, contract);
      setAnswer(res.text?.trim() || "Lumina didn't return a reply.");
      setQuestion("");
    } catch {
      setAnswer("Couldn't reach Lumina just now.");
    } finally {
      setAsking(false);
    }
  }

  const greeting = briefing?.greeting || (firstName ? `Good morning, ${firstName}.` : "Good morning.");
  const bullets = briefing?.bullets ?? [];

  return (
    <Bezel className="card lumina-card">
      <div className="lumina-card__brand-row">
        <span className="lumina-card__brand">Lumina AI Briefing</span>
      </div>
      <div className="lumina-card__layout">
        <div className="lumina-card__orb-col">
          <NeonOrb size={110} />
        </div>

        <div className="lumina-card__main">
          <span className="lumina-card__hello">{greeting}</span>

          {loading ? (
            <div className="dash-skel dash-skel--list" aria-hidden />
          ) : (
            <ul className="lumina-card__bullets">
              {bullets.length === 0 ? (
                <li className="lumina-card__bullet">No briefing items right now.</li>
              ) : (
                bullets.map((b, i) => (
                  <li className="lumina-card__bullet" key={i}>
                    {b}
                  </li>
                ))
              )}
            </ul>
          )}

          {answer && <div className="lumina-card__answer">{answer}</div>}

          <div className="lumina-card__ask">
        <input
          className="lumina-card__ask-input"
          type="text"
          value={question}
          placeholder="Ask Lumina anything…"
          disabled={asking}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
          }}
        />
        <button
          type="button"
          className="lumina-card__ask-send"
          aria-label="Ask Lumina"
          disabled={asking || !question.trim()}
          onClick={ask}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden>
            <path
              d="M3 11l17-8-8 17-2-7-7-2z"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
          </svg>
        </button>
          </div>
        </div>
      </div>
    </Bezel>
  );
}
