import { useState } from "react";
import type { Job } from "@nsc/types";
import { api } from "../../lib/api.js";

export default function ZiplyUploadTab({ jobs }: { jobs: Job[] }) {
  const [selectedJobId, setSelectedJobId] = useState("");
  const [fileDataUrls, setFileDataUrls] = useState<string[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [status, setStatus] = useState<"idle" | "uploading" | "parsing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [parsedData, setParsedData] = useState<any>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setFileNames(files.map(f => f.name));
    setStatus("uploading");

    const promises = files.map((file) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });

    Promise.all(promises)
      .then((dataUrls) => {
        setFileDataUrls(dataUrls);
        setStatus("idle");
      })
      .catch(() => {
        setErrorMsg("Failed to read files.");
        setStatus("error");
      });
  };

  const handleIngest = async () => {
    if (!selectedJobId) {
      setErrorMsg("Please select a job first.");
      setStatus("error");
      return;
    }
    if (fileDataUrls.length === 0) {
      setErrorMsg("Please select print file(s).");
      setStatus("error");
      return;
    }

    setStatus("parsing");
    setErrorMsg("");

    try {
      const res = await fetch(`/api/jobs/${selectedJobId}/ziply-ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrls: fileDataUrls }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setParsedData(data.parsed);
      setStatus("success");
      // Notify map to reload
      window.dispatchEvent(new Event("nsc:jobs-reload"));
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to parse print.");
      setStatus("error");
    }
  };

  const ziplyJobs = jobs.filter((j) => j.customerProject === "Ziply");

  return (
    <div style={{ padding: 12, color: "#fff" }}>
      <h3 style={{ margin: "0 0 12px 0", fontSize: 13, letterSpacing: "0.05em", color: "var(--accent)" }}>
        ZIPLY PRINT INTELLIGENCE
      </h3>
      <p style={{ fontSize: 11, color: "#9ca3af", margin: "0 0 16px 0", lineHeight: "1.4" }}>
        Upload engineering cover sheets, drops sheets, or TCP prints. Gemini will parse design metrics and update the job record.
      </p>

      {/* Step 1: Select Job */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
          Target Job
        </label>
        <select
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
          style={{ width: "100%", background: "#0b1118", color: "#fff", border: "1px solid #374151", borderRadius: 4, padding: "6px 8px", fontSize: 11 }}
        >
          <option value="">-- Choose a Ziply Job --</option>
          {ziplyJobs.map((j) => (
            <option key={j.jobId} value={j.jobId}>
              {j.workOrder} · {j.address || j.city || "No Address"}
            </option>
          ))}
        </select>
      </div>

      {/* Step 2: Upload File */}
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, marginBottom: 4, textTransform: "uppercase", color: "#9ca3af" }}>
          Engineering Print (PDF/Image)
        </label>
        <div style={{ border: "2px dashed #374151", borderRadius: 6, padding: "20px 10px", textAlign: "center", background: "rgba(0,0,0,0.2)" }}>
          <input
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleFileChange}
            id="print-upload-input"
            style={{ display: "none" }}
          />
          <label htmlFor="print-upload-input" style={{ cursor: "pointer", fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>
            {fileNames.length > 0 ? `Selected ${fileNames.length} file(s)` : "Click to select print sheet(s)"}
          </label>
          <div style={{ fontSize: 9, color: "#6b7280", marginTop: 4 }}>Accepts PDF cover page, drop/splice details, or photos</div>
        </div>
      </div>

      {/* Actions */}
      <button
        onClick={handleIngest}
        disabled={status === "parsing" || !selectedJobId || fileDataUrls.length === 0}
        style={{
          width: "100%",
          background: status === "parsing" ? "#374151" : "var(--accent, #00E676)",
          color: "#000",
          fontWeight: 700,
          border: "none",
          borderRadius: 4,
          padding: "8px 12px",
          fontSize: 11,
          cursor: (status === "parsing" || !selectedJobId || fileDataUrls.length === 0) ? "not-allowed" : "pointer",
          textAlign: "center",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        {status === "parsing" ? "AI Ingestion Engine Parsing..." : "Analyze with Gemini"}
      </button>

      {/* Status Messages */}
      {status === "parsing" && (
        <div style={{ marginTop: 12, textAlign: "center", fontSize: 11, color: "var(--accent)" }}>
          <span className="pulsing-glow">⚡ Processing multi-modal visual document...</span>
        </div>
      )}

      {status === "error" && (
        <div style={{ marginTop: 12, color: "#ff2d4a", fontSize: 11, background: "rgba(255,45,74,0.1)", padding: 8, borderRadius: 4, border: "1px solid rgba(255,45,74,0.2)" }}>
          ⚠️ {errorMsg}
        </div>
      )}

      {status === "success" && parsedData && (
        <div style={{ marginTop: 16, background: "rgba(0,230,118,0.06)", border: "1px solid rgba(0,230,118,0.2)", borderRadius: 6, padding: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--accent)", marginBottom: 8 }}>✅ Parsing Success!</div>
          <table style={{ width: "100%", fontSize: 10, borderCollapse: "collapse" }}>
            <tbody>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={{ padding: "4px 0", color: "#9ca3af" }}>Hub ID:</td>
                <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>{parsedData.hubId || "N/A"}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={{ padding: "4px 0", color: "#9ca3af" }}>Cabinet Type:</td>
                <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>{parsedData.hubTypeSize || "N/A"}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={{ padding: "4px 0", color: "#9ca3af" }}>Terminal Count:</td>
                <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>{parsedData.terminalCount || "N/A"}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={{ padding: "4px 0", color: "#9ca3af" }}>Total Drops:</td>
                <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>{parsedData.drops?.total || "N/A"}</td>
              </tr>
              <tr style={{ borderBottom: "1px solid #1f2937" }}>
                <td style={{ padding: "4px 0", color: "#9ca3af" }}>Conduit Size:</td>
                <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 700 }}>{parsedData.conduitSize || "N/A"}</td>
              </tr>
            </tbody>
          </table>
          {parsedData.specialNotes && (
            <div style={{ marginTop: 8, borderTop: "1px solid #1f2937", paddingTop: 6 }}>
              <div style={{ fontSize: 9, color: "#9ca3af", fontWeight: 700, textTransform: "uppercase" }}>Special Construction Notes:</div>
              <div style={{ fontSize: 10, color: "#d1d5db", marginTop: 2, fontStyle: "italic", lineHeight: "1.3" }}>
                {parsedData.specialNotes}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
