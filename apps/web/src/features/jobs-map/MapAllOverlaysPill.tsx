import { Layers } from "lucide-react";
import { useFiltersContext } from "./filtersContext.js";

export default function MapAllOverlaysPill() {
  const { filters, setFilters } = useFiltersContext();
  const isGlobalOn = filters.showPrintOverlays !== false;

  return (
    <button
      type="button"
      onClick={() => {
        setFilters({
          ...filters,
          showPrintOverlays: !isGlobalOn,
        });
      }}
      style={{
        borderRadius: "9999px",
        padding: "5px 12px",
        fontSize: "10px",
        fontWeight: 900,
        letterSpacing: "0.05em",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        transition: "all 0.2s ease-in-out",
        border: isGlobalOn ? "1.5px solid #00d4ff" : "1.5px solid #6a7580",
        boxShadow: isGlobalOn ? "0 0 8px rgba(0, 212, 255, 0.35)" : "none",
        background: isGlobalOn ? "rgba(0, 212, 255, 0.12)" : "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(12px)",
        color: isGlobalOn ? "#00d4ff" : "#8a96a3",
        whiteSpace: "nowrap",
        outline: "none",
      }}
      title={isGlobalOn ? "Hide all background map overlays" : "Show all background map overlays"}
    >
      <Layers size={12} style={{ color: isGlobalOn ? "#00d4ff" : "#8a96a3" }} />
      {isGlobalOn ? "OVERLAYS ON" : "OVERLAYS OFF"}
    </button>
  );
}
