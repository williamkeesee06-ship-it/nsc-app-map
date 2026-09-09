import { useMemo } from "react";
import { useDrawing } from "./drawingContext.js";
import { Trash2, RotateCcw, X, CheckCircle2 } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function RecycleBinModal({ isOpen, onClose }: Props) {
  const { state, restoreObjects } = useDrawing();

  const deletedObjects = useMemo(() => {
    return state.objects.filter((o) => o.style?.isDeleted);
  }, [state.objects]);

  if (!isOpen) return null;

  const handleRestore = (id: string) => {
    restoreObjects([id]);
  };

  const handleRestoreAll = () => {
    const ids = deletedObjects.map((o) => o.id);
    if (ids.length > 0) {
      restoreObjects(ids);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(6px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(255, 255, 255, 0.15)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 540,
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          color: "#f8fafc",
          overflow: "hidden",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.8)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Trash2 size={16} color="#ef4444" />
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Recycle Bin & Soft-Deleted Features ({deletedObjects.length})
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer" }}
          >
            <X size={18} />
          </button>
        </div>

        {/* List */}
        <div style={{ padding: 16, overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          {deletedObjects.length === 0 ? (
            <div style={{ padding: 32, textAlign: "center", color: "#64748b", fontSize: 12 }}>
              <CheckCircle2 size={28} color="#10b981" style={{ margin: "0 auto 8px auto" }} />
              Recycle bin is empty. No deleted features in current session.
            </div>
          ) : (
            deletedObjects.map((obj) => {
              const label = obj.style?.userLabel || obj.tool || "Object";
              const deletedDate = obj.style?.deletedAt ? new Date(obj.style.deletedAt).toLocaleTimeString() : "Just now";
              const deletedBy = obj.style?.deletedBy || "User";

              return (
                <div
                  key={obj.id}
                  style={{
                    background: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid rgba(255, 255, 255, 0.06)",
                    borderRadius: 8,
                    padding: 12,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 800, color: "#ffffff" }}>{label}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                      Deleted by {deletedBy} at {deletedDate} · ID: {obj.id}
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRestore(obj.id)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                      background: "rgba(6, 182, 212, 0.15)",
                      border: "1px solid rgba(6, 182, 212, 0.4)",
                      color: "#22d3ee",
                      fontSize: 11,
                      fontWeight: 800,
                      padding: "5px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                    }}
                  >
                    <RotateCcw size={12} /> Restore
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        {deletedObjects.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, padding: "12px 20px", borderTop: "1px solid rgba(255, 255, 255, 0.08)", background: "rgba(0, 0, 0, 0.2)" }}>
            <button
              type="button"
              onClick={handleRestoreAll}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                background: "#0284c7",
                border: "none",
                color: "#ffffff",
                fontSize: 11,
                fontWeight: 800,
                padding: "6px 14px",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              <RotateCcw size={13} /> Restore All ({deletedObjects.length})
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
