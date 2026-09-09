import { useState, useEffect, useCallback } from "react";
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";
import {
  Folder,
  FolderOpen,
  FileText,
  Image,
  UploadCloud,
  ExternalLink,
  RefreshCw,
  FileCode,
  ShieldAlert,
  CheckCircle2,
} from "lucide-react";

interface Props {
  job: Job;
}

interface FolderNode {
  id: string;
  name: string;
  code: string;
  description: string;
  files: Array<{
    id: string;
    name: string;
    sizeKb: number;
    uploadedAt: number;
    type: "pdf" | "image" | "kml" | "doc";
    downloadUrl?: string;
  }>;
}

export default function DriveInventoryExplorer({ job }: Props) {
  const [activeFolderCode, setActiveFolderCode] = useState<string>("02_plans");
  const [provisioning, setProvisioning] = useState(false);
  const [provisionMessage, setProvisionMessage] = useState<string | null>(null);

  const folders: FolderNode[] = [
    {
      id: "f_00",
      code: "00_control",
      name: "00-Job-Control",
      description: "Manifests, Smartsheet linkages, sync ledgers",
      files: [
        {
          id: "doc_manifest",
          name: "job-manifest.json",
          sizeKb: 12,
          uploadedAt: job.lastSyncedAt || Date.now(),
          type: "doc",
        },
      ],
    },
    {
      id: "f_01",
      code: "01_earth",
      name: "01-Earth",
      description: "Network link KML, designs, production exports",
      files: [
        {
          id: "doc_kml",
          name: "network-link.kml",
          sizeKb: 4,
          uploadedAt: Date.now(),
          type: "kml",
        },
      ],
    },
    {
      id: "f_02",
      code: "02_plans",
      name: "02-Plan-Sets",
      description: "Original design sets, revisions, sheet markups",
      files: [
        {
          id: "doc_plan_orig",
          name: `${job.workOrder}-original-plans.pdf`,
          sizeKb: 4820,
          uploadedAt: job.firstSyncedAt || Date.now(),
          type: "pdf",
        },
      ],
    },
    {
      id: "f_03",
      code: "03_field",
      name: "03-Field",
      description: "Daily inspection photos, observations, crew notes",
      files: [],
    },
    {
      id: "f_04",
      code: "04_asbuilt",
      name: "04-As-Built",
      description: "Validated redlines, splice records, closeouts",
      files: [],
    },
    {
      id: "f_99",
      code: "99_archive",
      name: "99-Archive",
      description: "Soft-deleted features, superseded revisions",
      files: [],
    },
  ];

  const activeFolder = folders.find((f) => f.code === activeFolderCode) || folders[0]!;

  const handleProvisionDrive = async () => {
    setProvisioning(true);
    try {
      await api.provisionJobDrive(job.jobId);
      setProvisionMessage("✓ Drive folder hierarchy provisioned successfully");
    } catch (err: any) {
      setProvisionMessage(`Provisioning failed: ${err?.message || "Error"}`);
    } finally {
      setProvisioning(false);
      setTimeout(() => setProvisionMessage(null), 4000);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: 16, background: "rgba(15, 23, 42, 0.7)", border: "1px solid rgba(255, 255, 255, 0.08)", borderRadius: 12, color: "#f8fafc", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <span style={{ fontSize: 10, fontWeight: 900, letterSpacing: "0.1em", color: "#38bdf8", textTransform: "uppercase" }}>
            Google Drive & Document Inventory
          </span>
          <h3 style={{ margin: "2px 0 0 0", fontSize: 15, fontWeight: 800, color: "#ffffff" }}>
            {job.displayName || job.workOrder}
          </h3>
        </div>

        <button
          type="button"
          onClick={handleProvisionDrive}
          disabled={provisioning}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            background: "rgba(255, 255, 255, 0.06)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            color: "#ffffff",
            fontSize: 11,
            fontWeight: 800,
            padding: "6px 12px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <RefreshCw size={13} className={provisioning ? "spin" : ""} />
          {provisioning ? "Provisioning..." : "Re-Sync Drive Hierarchy"}
        </button>
      </div>

      {provisionMessage && (
        <div style={{ background: "rgba(6, 182, 212, 0.15)", border: "1px solid rgba(6, 182, 212, 0.4)", color: "#22d3ee", padding: "8px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700 }}>
          {provisionMessage}
        </div>
      )}

      {/* Main 2-Pane Explorer */}
      <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16, minHeight: 320 }}>
        {/* Left: Folder Tree */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, background: "rgba(0, 0, 0, 0.3)", border: "1px solid rgba(255, 255, 255, 0.06)", borderRadius: 8, padding: 8 }}>
          {folders.map((f) => {
            const isActive = f.code === activeFolderCode;
            return (
              <button
                key={f.id}
                type="button"
                onClick={() => setActiveFolderCode(f.code)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: isActive ? "rgba(2, 132, 199, 0.2)" : "transparent",
                  border: `1px solid ${isActive ? "rgba(56, 189, 248, 0.4)" : "transparent"}`,
                  color: isActive ? "#38bdf8" : "#cbd5e1",
                  borderRadius: 6,
                  padding: "8px 10px",
                  fontSize: 11,
                  fontWeight: 800,
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.15s",
                }}
              >
                {isActive ? <FolderOpen size={14} color="#38bdf8" /> : <Folder size={14} color="#94a3b8" />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.name}
                </span>
              </button>
            );
          })}
        </div>

        {/* Right: File List & Upload Area */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, background: "rgba(0, 0, 0, 0.2)", border: "1px solid rgba(255, 255, 255, 0.06)", borderRadius: 8, padding: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#ffffff" }}>{activeFolder.name}</div>
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{activeFolder.description}</div>
          </div>

          {/* Files */}
          <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1 }}>
            {activeFolder.files.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 11, border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 6 }}>
                Folder is currently empty. Drop files here to upload.
              </div>
            ) : (
              activeFolder.files.map((file) => (
                <div
                  key={file.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "rgba(255, 255, 255, 0.03)",
                    border: "1px solid rgba(255, 255, 255, 0.05)",
                    borderRadius: 6,
                    padding: "8px 12px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {file.type === "pdf" && <FileText size={14} color="#f87171" />}
                    {file.type === "image" && <Image size={14} color="#34d399" />}
                    {file.type === "kml" && <FileCode size={14} color="#38bdf8" />}
                    {file.type === "doc" && <FileText size={14} color="#fbbf24" />}
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "#f8fafc" }}>{file.name}</div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{file.sizeKb} KB · {new Date(file.uploadedAt).toLocaleDateString()}</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    style={{
                      background: "transparent",
                      border: "1px solid rgba(255,255,255,0.15)",
                      color: "#cbd5e1",
                      fontSize: 10,
                      fontWeight: 700,
                      padding: "4px 8px",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    View
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
