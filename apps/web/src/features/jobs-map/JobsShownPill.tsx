// JobsShownPill — Minimal pill (Phase 2 redesign).
//
// Floats above the map, shows "JOBS SHOWN <n>/<total>" with cyan neon accent.
// Replaces the larger "Jobs Shown 59/209" widget Billy wanted minimized.

interface Props {
  shown: number;
  total: number;
  onClick?: () => void;
}

export default function JobsShownPill({ shown, total, onClick }: Props) {
  return (
    <button
      type="button"
      className="jobs-shown-pill"
      onClick={onClick}
      title={`${shown} of ${total} jobs shown`}
      aria-label={`${shown} of ${total} jobs shown`}
    >
      <span className="jsp-dot" aria-hidden="true" />
      <span className="jsp-label">JOBS SHOWN</span>
      <span className="jsp-num">{shown}</span>
      <span className="jsp-divider">/</span>
      <span className="jsp-den">{total}</span>
      <svg
        className="jsp-chevron"
        width="12"
        height="12"
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <polyline points="3 5 6 8 9 5" />
      </svg>
    </button>
  );
}
