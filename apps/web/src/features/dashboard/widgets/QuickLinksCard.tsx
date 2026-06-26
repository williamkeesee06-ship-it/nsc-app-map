// Quick Links — exactly three large neon tiles, all unified electric-blue
// (per spec; not brand colors). Inline SVG glyphs (not brand logos). Each
// opens in a new tab.

import type { ReactNode } from "react";
import Bezel from "../components/Bezel.js";

interface QuickLink {
  key: string;
  label: string;
  href: string;
  glyph: ReactNode;
}

const LINKS: QuickLink[] = [
  {
    key: "gmail",
    label: "Gmail",
    href: "https://mail.google.com",
    glyph: (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
        <rect
          x="2.5"
          y="5"
          width="19"
          height="14"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M3 6l9 7 9-7"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: "drive",
    label: "Drive",
    href: "https://drive.google.com",
    glyph: (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
        <path
          d="M8 3h8l5 9-4 7H7l-4-7zM8 3l-4 9M16 3l4 9M4 12h16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    key: "smartsheet",
    label: "Smartsheet",
    href: "https://app.smartsheet.com",
    glyph: (
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>
        <rect
          x="3"
          y="4"
          width="18"
          height="16"
          rx="2"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
        <path
          d="M3 9h18M9 9v11"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        />
      </svg>
    ),
  },
];

export default function QuickLinksCard() {
  return (
    <Bezel className="card quicklinks-card">
      <div className="card__header">
        <h2 className="card__title">Quick Links</h2>
      </div>
      <div className="quicklinks-card__grid">
        {LINKS.map((l) => (
          <a
            key={l.key}
            className="quicklinks-card__tile"
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open ${l.label} in a new tab`}
          >
            <span className="quicklinks-card__glyph">{l.glyph}</span>
            <span className="quicklinks-card__label">{l.label}</span>
            <span className="quicklinks-card__open" aria-hidden>
              Open
              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden>
                <path
                  d="M5 12h14M13 6l6 6-6 6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </a>
        ))}
      </div>
    </Bezel>
  );
}
