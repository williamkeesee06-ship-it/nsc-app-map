// Chrome bezel wrapper — the signature container of the Neon Pulse Light
// dashboard. Renders a brushed-steel frame with four corner rivets and an
// inner white panel that holds the widget content. Presentation only.

import type { ReactNode } from "react";

export interface BezelProps {
  children: ReactNode;
  className?: string;
  /** Render an inner white panel around children (default true). */
  inner?: boolean;
  /** Optional accent bar color across the bezel top (e.g. red for At-Risk). */
  accent?: string;
}

export default function Bezel({
  children,
  className,
  inner = true,
  accent,
}: BezelProps) {
  const classes = ["bezel", className].filter(Boolean).join(" ");
  return (
    <div className={classes}>
      {accent && (
        <span
          className="bezel__accent"
          style={{ ["--bezel-accent" as string]: accent }}
          aria-hidden
        />
      )}
      <span className="rivet rivet--tl" aria-hidden />
      <span className="rivet rivet--tr" aria-hidden />
      <span className="rivet rivet--bl" aria-hidden />
      <span className="rivet rivet--br" aria-hidden />
      {inner ? <div className="bezel__inner">{children}</div> : children}
    </div>
  );
}
