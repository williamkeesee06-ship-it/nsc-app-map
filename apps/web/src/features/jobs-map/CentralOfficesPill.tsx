// CentralOfficesPill — topbar pill toggle for Lumen Central Offices overlay.
// Sits next to StatusFilterPills, themed in gold to match the marker style.
import { useShowCOs, setShowCOs } from "./centralOfficesStore.js";
import centralOffices from "../../data/centralOffices.json";

const NEON = "#22D3FF";
const NEON_GLOW = "rgba(34,211,255,0.55)";

export default function CentralOfficesPill() {
  const active = useShowCOs();
  const count = (centralOffices as unknown[]).length;
  return (
    <div className="sf-pills sf-pills--single" role="group" aria-label="Lumen Central Offices">
      <button
        type="button"
        className={`sf-pill${active ? " sf-pill--active" : ""}`}
        onClick={() => setShowCOs(!active)}
        title={active ? "Hide Lumen Central Offices" : "Show Lumen Central Offices"}
        style={
          active
            ? {
                background: `${NEON}22`,
                borderColor: NEON,
                boxShadow: `0 0 6px ${NEON_GLOW}`,
              }
            : undefined
        }
      >
        <span
          className="sf-pill__dot"
          style={{
            background: NEON,
            boxShadow: `0 0 4px ${NEON_GLOW}`,
          }}
          aria-hidden
        />
        <span className="sf-pill__label">CO's</span>
        <span className="sf-pill__count">{count}</span>
      </button>
    </div>
  );
}
