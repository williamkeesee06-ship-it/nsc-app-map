// Phase 6 — As-Built Workspace.
// Mounts the ported NSC As-Built tool (vanilla JS + Fabric.js) inside a full-bleed
// iframe so 4222 lines of imperative canvas logic, billing, and Smartsheet wiring
// stay verbatim with zero rewrite. URL ?jobId=... is forwarded into the iframe
// so its job-lookup flow auto-fires on load.
import { useSearchParams, Link } from "react-router-dom";

export default function AsbuiltWorkspace() {
  const [params] = useSearchParams();
  const jobId = params.get("jobId") ?? "";
  const src = jobId
    ? `/asbuilt/index.html?jobId=${encodeURIComponent(jobId)}`
    : `/asbuilt/index.html`;

  return (
    <div className="asbuilt-workspace">
      <div className="asbuilt-workspace__topbar">
        <Link to="/" className="asbuilt-workspace__back">← Jobs Map</Link>
        <span className="asbuilt-workspace__title">
          As-Built{jobId ? ` · Job ${jobId}` : ""}
        </span>
      </div>
      <iframe
        title="NSC As-Built Editor"
        src={src}
        className="asbuilt-workspace__frame"
        allow="geolocation; clipboard-read; clipboard-write"
      />
    </div>
  );
}
