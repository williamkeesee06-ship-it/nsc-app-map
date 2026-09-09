// UploadPrintsPill - Minimal pill (Phase 2 redesign).
//
// Floats above the map, shows "UPLOAD PRINTS & PERMITS" with cyan neon accent.
// Replaces the older "Jobs Shown" widget.

interface Props {
  onClick?: () => void;
}

export default function JobsShownPill({ onClick }: Props) {
  return (
    <button
      type="button"
      className="jobs-shown-pill"
      onClick={onClick}
      title="Upload Prints & Permits"
      aria-label="Upload Prints & Permits"
      style={{ cursor: "pointer", background: "rgba(15, 23, 42, 0.8)", border: "1px solid #3aa7ff" }}
    >
      <span className="jsp-dot" aria-hidden="true" style={{ background: "#3aa7ff" }} />
      <span className="jsp-label" style={{ color: "#e0f2fe", fontWeight: 700 }}>UPLOAD PRINTS & PERMITS</span>
      <svg
        className="jsp-chevron"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="#3aa7ff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        style={{ marginLeft: 8 }}
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    </button>
  );
}
