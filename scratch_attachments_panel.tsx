// AttachmentsPanel ΓÇö Phase 7: workspace dropdown that hosts
// Engineering Prints + per-job attachments + Quick Reference Layer sync.
// KMZ/GeoJSON uploads are rejected client-side with a friendly message.
import { useEffect, useRef, useState } from "react";
import { useMap } from "@vis.gl/react-google-maps";
import type { EngineeringPrint, JobAttachment, QuickReferenceGist } from "@nsc/types";
import { api } from "../../lib/api.js";

interface Props {
  jobId: string;
  /** Triggers re-renders of the engineering print overlay when corners/opacity change. */
  onActivePrintChange?: (print: EngineeringPrint | null) => void;
  /** When true, panel is in "edit alignment" mode for the active print. */
  alignmentEditing: boolean;
  onSetAlignmentEditing: (v: boolean) => void;
}

const REJECT_EXTENSIONS = [".kmz", ".kml", ".geojson"];

function isRejected(file: File): boolean {
  const lcName = file.name.toLowerCase();
  const lcType = file.type.toLowerCase();
  if (REJECT_EXTENSIONS.some((e) => lcName.endsWith(e))) return true;
  if (lcType === "application/vnd.google-earth.kmz") return true;
  if (lcType === "application/vnd.google-earth.kml+xml") return true;
  if (lcType === "application/geo+json") return true;
  return false;
}

async function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export default function AttachmentsPanel({ jobId, onActivePrintChange, alignmentEditing, onSetAlignmentEditing }: Props) {
  const map = useMap();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"prints" | "files" | "ref">("prints");
  const [prints, setPrints] = useState<EngineeringPrint[]>([]);
  const [attachments, setAttachments] = useState<JobAttachment[]>([]);
  const [gist, setGist] = useState<QuickReferenceGist | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const printInputRef = useRef<HTMLInputElement>(null);

  // Initial load
  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    Promise.all([
      api.listPrints(jobId).catch(() => ({ prints: [], count: 0 })),
      api.listAttachments(jobId).catch(() => ({ attachments: [], count: 0 })),
      api.getGist(jobId).catch(() => ({ gist: null })),
    ]).then(([p, a, g]) => {
      if (cancelled) return;
      setPrints(p.prints);
      setAttachments(a.attachments);
      setGist(g.gist);
      const active = p.prints.find((x) => x.active && x.visible);
      onActivePrintChange?.(active ?? null);
    });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  function refreshActivePrint(next: EngineeringPrint[]) {
    const active = next.find((x) => x.active && x.visible);
    onActivePrintChange?.(active ?? null);
  }

  async function uploadAttachment(file: File) {
    setErr(null);
    if (isRejected(file)) {
      setErr("KMZ, KML, and GeoJSON files are not allowed. Use Quick Mode or draw in As-Built workspace.");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const { attachment } = await api.uploadAttachment(jobId, {
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        dataUrl,
      });
      setAttachments((prev) => [attachment, ...prev]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteAttachment(att: JobAttachment) {
    if (!confirm(`Delete "${att.filename}"?`)) return;
    setBusy(true);
    try {
      await api.deleteAttachment(jobId, att.attachmentId);
      setAttachments((prev) => prev.filter((a) => a.attachmentId !== att.attachmentId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function attachAsPrint(file: File) {
    setErr(null);
    if (isRejected(file)) {
      setErr("KMZ, KML, and GeoJSON files are not allowed.");
      return;
    }
    const lcType = file.type.toLowerCase();
    const lcName = file.name.toLowerCase();
    const isPdf = lcType === "application/pdf" || lcName.endsWith(".pdf");
    const isImage = lcType.startsWith("image/");
    if (!isPdf && !isImage) {
      setErr("Engineering prints must be a PDF or image (PNG/JPG).");
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await readAsDataUrl(file);
      const c = map?.getCenter();
      const bounds = map?.getBounds();
      let corners;
      if (bounds) {
        const ne = bounds.getNorthEast();
        const sw = bounds.getSouthWest();
        // Inset corners 25% so the user sees an overlay smaller than the viewport.
        const dLat = (ne.lat() - sw.lat()) * 0.25;
        const dLng = (ne.lng() - sw.lng()) * 0.25;
        const nw = { lat: ne.lat() - dLat, lng: sw.lng() + dLng };
        const se = { lat: sw.lat() + dLat, lng: ne.lng() - dLng };
        corners = { nw, ne: { lat: nw.lat, lng: se.lng }, se, sw: { lat: se.lat, lng: nw.lng } };
      } else if (c) {
        const center = { lat: c.lat(), lng: c.lng() };
        const off = 0.001;
        corners = {
          nw: { lat: center.lat + off, lng: center.lng - off },
          ne: { lat: center.lat + off, lng: center.lng + off },
          se: { lat: center.lat - off, lng: center.lng + off },
          sw: { lat: center.lat - off, lng: center.lng - off },
        };
      } else {
        corners = {
          nw: { lat: 0.001, lng: -0.001 }, ne: { lat: 0.001, lng: 0.001 },
          se: { lat: -0.001, lng: 0.001 }, sw: { lat: -0.001, lng: -0.001 },
        };
      }
      const source: EngineeringPrint["source"] = isPdf
        ? { kind: "pdf", dataUrl, page: 1 }
        : { kind: "image", dataUrl };
      const { print } = await api.createPrint(jobId, {
        source,
        corners,
        opacity: 0.6,
        active: true,  // Newly attached print becomes the active engineering print
        visible: true,
      });
      // Demote others locally
      const next = [print, ...prints.map((p) => ({ ...p, active: false }))];
      setPrints(next);
      refreshActivePrint(next);
      setTab("prints");
      onSetAlignmentEditing(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function patchPrint(print: EngineeringPrint, patch: Parameters<typeof api.patchPrint>[2]) {
    setBusy(true);
    try {
      const { print: updated } = await api.patchPrint(jobId, print.printId, patch);
      const next = prints.map((p) => {
        if (p.printId === updated.printId) return updated;
        if (patch.active === true) return { ...p, active: false };
        return p;
      });
      setPrints(next);
      refreshActivePrint(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deletePrint(print: EngineeringPrint) {
    if (!confirm("Delete this engineering print?")) return;
    setBusy(true);
    try {
      await api.deletePrint(jobId, print.printId);
      const next = prints.filter((p) => p.printId !== print.printId);
      setPrints(next);
      refreshActivePrint(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function promoteAttachmentToPrint(att: JobAttachment) {
    if (att.kind !== "pdf" && att.kind !== "image") return;
    const c = map?.getCenter();
    if (!c) return;
    const center = { lat: c.lat(), lng: c.lng() };
    const off = 0.001;
    const corners = {
      nw: { lat: center.lat + off, lng: center.lng - off },
      ne: { lat: center.lat + off, lng: center.lng + off },
      se: { lat: center.lat - off, lng: center.lng + off },
      sw: { lat: center.lat - off, lng: center.lng - off },
    };
    const source: EngineeringPrint["source"] =
      att.kind === "pdf"
        ? { kind: "pdf", dataUrl: att.dataUrl, page: 1 }
        : { kind: "image", dataUrl: att.dataUrl };
    setBusy(true);
    try {
      const { print } = await api.createPrint(jobId, { source, corners, opacity: 0.6, active: true });
      const next = [print, ...prints.map((p) => ({ ...p, active: false }))];
      setPrints(next);
      refreshActivePrint(next);
      setTab("prints");
      onSetAlignmentEditing(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncGist() {
    setBusy(true);
    try {
      const { gist: g } = await api.syncGist(jobId);
      setGist(g);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    const activePrint = prints.find((p) => p.active);
    const gistState = gist ? (gist.outOfDate ? "out" : "synced") : "none";
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="phase7-extras-toggle"
        title="Engineering prints, attachments, quick reference sync"
        style={{
          position: "absolute",
          top: 60,
          right: 12,
          zIndex: 30,
          padding: "6px 10px",
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          fontSize: 11,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span>≡ƒôÄ Files</span>
        {activePrint && <span style={{ color: "#3aa7ff" }}>┬╖ Print attached</span>}
        {gistState === "out" && <span style={{ color: "#ff2d4a" }}>┬╖  ref outdated</span>}
        {gistState === "synced" && <span style={{ color: "#39ff7a" }}>┬╖ ref Γ£ô</span>}
      </button>
    );
  }

  return (
    <div
      className="phase7-extras-panel"
      style={{
        position: "absolute",
        top: 60,
        right: 12,
        zIndex: 30,
        width: 340,
        maxHeight: "70vh",
        overflow: "auto",
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
        padding: 0,
      }}
    >
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)" }}>
        <TabButton active={tab === "prints"} onClick={() => setTab("prints")}>Eng Print</TabButton>
        <TabButton active={tab === "files"} onClick={() => setTab("files")}>Files</TabButton>
        <TabButton active={tab === "ref"} onClick={() => setTab("ref")}>Quick Ref</TabButton>
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{ marginLeft: "auto", padding: "6px 10px", background: "transparent", border: 0, cursor: "pointer", color: "var(--text-muted)" }}
          aria-label="Close"
        >├ù</button>
      </div>

      {err && (
        <div style={{ padding: 8, background: "rgba(255,45,74,0.1)", color: "#ff2d4a", fontSize: 11, borderBottom: "1px solid var(--border)" }}>
          {err}
        </div>
      )}

      {tab === "prints" && (
        <div style={{ padding: 10 }}>
          <input
            ref={printInputRef}
            type="file"
            accept="application/pdf,image/*"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) attachAsPrint(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => printInputRef.current?.click()}
            style={{ width: "100%", padding: "8px 10px", marginBottom: 8 }}
          >
            Attach Engineering Print (PDF or Image)
          </button>
          {prints.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>
              No engineering prints attached.
            </div>
          )}
          {prints.map((p) => (
            <PrintRow
              key={p.printId}
              print={p}
              alignmentEditing={alignmentEditing && p.active}
              onToggleAlignment={() => onSetAlignmentEditing(!alignmentEditing)}
              onPatch={(patch) => patchPrint(p, patch)}
              onDelete={() => deletePrint(p)}
            />
          ))}
        </div>
      )}

      {tab === "files" && (
        <div style={{ padding: 10 }}>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadAttachment(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
            style={{ width: "100%", padding: "8px 10px", marginBottom: 8 }}
          >
            Upload File
          </button>
          <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 8 }}>
            KMZ, KML, and GeoJSON uploads are not allowed here.
          </div>
          {attachments.length === 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", textAlign: "center", padding: 12 }}>
              No attachments yet.
            </div>
          )}
          {attachments.map((a) => (
            <div
              key={a.attachmentId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 4px",
                borderBottom: "1px solid var(--border)",
                fontSize: 11,
              }}
            >
              <span>{a.kind === "pdf" ? "≡ƒôä" : a.kind === "image" ? "≡ƒû╝" : "≡ƒôÄ"}</span>
              <a href={a.dataUrl} download={a.filename} style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.filename}
              </a>
              <span style={{ color: "var(--text-muted)", fontSize: 9 }}>{Math.round(a.size / 1024)} KB</span>
              {(a.kind === "pdf" || a.kind === "image") && (
                <button
                  type="button"
                  className="icon-btn"
                  title="Set as Engineering Print"
                  disabled={busy}
                  onClick={() => promoteAttachmentToPrint(a)}
                  style={{ fontSize: 10 }}
                >
                  Γ¼åPrint
                </button>
              )}
              <button
                type="button"
                className="icon-btn"
                disabled={busy}
                onClick={() => deleteAttachment(a)}
                title="Delete"
                style={{ color: "#ff2d4a" }}
              >├ù</button>
            </div>
          ))}
        </div>
      )}

      {tab === "ref" && (
        <div style={{ padding: 10 }}>
          <div style={{ fontSize: 11, marginBottom: 8 }}>
            <strong>Quick Reference Layer.</strong> The simplified gist shown on
            the main map view. Not the source of truth ΓÇö that's the full
            as-built data.
          </div>
          {gist ? (
            <div style={{ fontSize: 11, lineHeight: 1.6 }}>
              <div>Source: <strong>{gist.source}</strong></div>
              <div>Lines: {gist.lines.length} ┬╖ Points: {gist.points.length}</div>
              <div>Status: {gist.outOfDate
                ? <span style={{ color: "#ff2d4a" }}>ΓùÅ Out of date</span>
                : <span style={{ color: "#39ff7a" }}>ΓùÅ Synced</span>}</div>
              <div style={{ color: "var(--text-muted)" }}>
                Generated {new Date(gist.generatedAt).toLocaleString()}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              No gist yet. Save the as-built once to auto-generate it.
            </div>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={syncGist}
            style={{ width: "100%", marginTop: 10, padding: "8px 10px" }}
          >
            Sync Reference Layer Now
          </button>
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "8px 10px",
        background: active ? "var(--surface-2)" : "transparent",
        border: 0,
        borderBottom: active ? "2px solid #39ff7a" : "2px solid transparent",
        cursor: "pointer",
        color: active ? "var(--text)" : "var(--text-muted)",
        fontSize: 11,
        fontWeight: active ? 700 : 400,
      }}
    >
      {children}
    </button>
  );
}

function PrintRow({
  print,
  alignmentEditing,
  onToggleAlignment,
  onPatch,
  onDelete,
}: {
  print: EngineeringPrint;
  alignmentEditing: boolean;
  onToggleAlignment: () => void;
  onPatch: (patch: Partial<Pick<EngineeringPrint, "corners" | "opacity" | "active" | "visible">>) => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--border)", padding: "6px 0", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span>{print.source.kind === "pdf" ? "≡ƒôä" : "≡ƒû╝"}</span>
        <span style={{ flex: 1 }}>
          {print.source.kind === "pdf" ? `PDF (page ${print.source.page})` : "Image overlay"}
        </span>
        {print.active && <span style={{ background: "#3aa7ff", color: "#fff", borderRadius: 4, padding: "1px 6px", fontSize: 9, fontWeight: 700 }}>ACTIVE</span>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
        <label style={{ fontSize: 10 }}>Opacity</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={print.opacity}
          onChange={(e) => onPatch({ opacity: parseFloat(e.target.value) })}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 10, width: 30, textAlign: "right" }}>{Math.round(print.opacity * 100)}%</span>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
        <button type="button" onClick={() => onPatch({ visible: !print.visible })} style={{ fontSize: 10, padding: "3px 6px" }}>
          {print.visible ? "Hide" : "Show"}
        </button>
        {!print.active && (
          <button type="button" onClick={() => onPatch({ active: true })} style={{ fontSize: 10, padding: "3px 6px" }}>
            Set as Engineering Print
          </button>
        )}
        {print.active && (
          <button type="button" onClick={onToggleAlignment} style={{ fontSize: 10, padding: "3px 6px", background: alignmentEditing ? "#3aa7ff" : undefined, color: alignmentEditing ? "#fff" : undefined }}>
            {alignmentEditing ? "Done aligning" : "Align corners"}
          </button>
        )}
        <button type="button" onClick={onDelete} style={{ fontSize: 10, padding: "3px 6px", color: "#ff2d4a", marginLeft: "auto" }}>
          Delete
        </button>
      </div>
    </div>
  );
}
