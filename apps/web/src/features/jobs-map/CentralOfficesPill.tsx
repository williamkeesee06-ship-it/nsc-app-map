// CentralOfficesPill — topbar pill toggle for Lumen Central Offices overlay.
// Sits next to StatusFilterPills, themed in gold to match the marker style.
import { useShowCOs, setShowCOs } from "./centralOfficesStore.js";
import centralOffices from "../../data/centralOffices.json";

const GOLD = "#FFC107";
const GOLD_GLOW = "rgba(255,193,7,0.55)";

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
                background: `${GOLD}22`,
                borderColor: GOLD,
                boxShadow: `0 0 6px ${GOLD_GLOW}`,
              }
            : undefined
        }
      >
        <span
          className="sf-pill__dot"
          style={{
            background: GOLD,
            boxShadow: `0 0 4px ${GOLD_GLOW}`,
          }}
          aria-hidden
        />
        <span className="sf-pill__label">CO's</span>
        <span className="sf-pill__count">{count}</span>
      </button>
    </div>
  );
}
