import { useEffect, useState } from "react";
import type { Job } from "@nsc/types";
import { ChevronDown, ChevronRight, FileText, UploadCloud, FilePlus, Zap } from "lucide-react";
import { api } from "../../lib/api.js";
import { uploadZiplyPrint } from "../../lib/ziplyPrintStorage.js";
import "./ziplyJobsTab.css";

interface Props {
  jobs: Job[];
}

export default function ZiplyJobsTab({ jobs }: Props) {
  const [expandedSites, setExpandedSites] = useState<Set<string>>(new Set());
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  // §2 city-level rollup: "" = all cities.
  const [selectedCity, setSelectedCity] = useState<string>("");

  // Ingest Print State
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [ingestStatus, setIngestStatus] = useState<"idle" | "uploading" | "parsing" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const ziplyJobs = jobs.filter((j) => j.customerProject === "Ziply");
  
  // Group by site (city)
  const jobsBySite = new Map<string, Job[]>();
  ziplyJobs.forEach(j => {
    const site = (j.city || "Unknown Site").trim();
    if (!jobsBySite.has(site)) jobsBySite.set(site, []);
    jobsBySite.get(site)!.push(j);
  });
  const allCities = Array.from(jobsBySite.keys()).sort();
  const sites = selectedCity ? allCities.filter((c) => c === selectedCity) : allCities;

  useEffect(() => {
    if (!selectedJob) return;
    const fresh = jobs.find((j) => j.jobId === selectedJob.jobId);
    if (fresh) setSelectedJob(fresh);
  }, [jobs, selectedJob?.jobId]);

  const toggleSite = (site: string) => {
    const next = new Set(expandedSites);
    if (next.has(site)) next.delete(site);
    else next.add(site);
    setExpandedSites(next);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setSelectedFiles(files);
    setFileNames(files.map(f => f.name));
    setUploadProgress(0);
    setErrorMsg("");
    setIngestStatus("idle");
  };

  const handleIngest = async (jobId: string) => {
    if (selectedFiles.length === 0) {
      setErrorMsg("Please select print file(s).");
      setIngestStatus("error");
      return;
    }

    setIngestStatus("uploading");
    setUploadProgress(0);
    setErrorMsg("");

    try {
      const progressByFile = selectedFiles.map(() => 0);
      const storageFiles = await Promise.all(
        selectedFiles.map((file, index) =>
          uploadZiplyPrint(jobId, file, (percent) => {
            progressByFile[index] = percent;
            const total = progressByFile.reduce((sum, value) => sum + value, 0) / progressByFile.length;
            setUploadProgress(total);
          })
        )
      );

      setIngestStatus("parsing");
      await api.ziplyIngest(jobId, storageFiles);
      const updatedJob = await pollZiplyIngestStatus(jobId);

      setIngestStatus("success");
      setSelectedJob(updatedJob);
      // Notify map to reload
      window.dispatchEvent(new Event("nsc:jobs-reload"));
      setSelectedFiles([]);
      setFileNames([]);
      setUploadProgress(0);
    } catch (err: any) {
      console.error("[ziply-print-upload] Upload or ingest failed", err);
      setErrorMsg(err.message || "Failed to upload or parse print.");
      setIngestStatus("error");
    }
  };

  const pollZiplyIngestStatus = async (jobId: string): Promise<Job> => {
    const started = Date.now();
    const timeoutMs = 30 * 60 * 1000;
    while (Date.now() - started < timeoutMs) {
      await new Promise((resolve) => window.setTimeout(resolve, 5000));
      const { job } = await api.getJob(jobId);
      setSelectedJob((current) => current?.jobId === jobId ? job : current);
      const status = job.ziplyIngest?.status;
      if (status === "complete" || (!status && job.ziplyPrintLayer)) {
        return job;
      }
      if (status === "failed") {
        throw new Error(job.ziplyIngest?.errorMessage || "AI parsing failed.");
      }
    }
    throw new Error("AI parsing is still running in the background. Reopen this job in a few minutes to check the result.");
  };

  if (selectedJob) {
    // Determine completed status
    const isCompleted = selectedJob.jobStatus === "Complete" || (selectedJob.secondaryJobStatus || "").toLowerCase().startsWith("complete");
    const ingestIsProcessing = ingestStatus === "parsing" || selectedJob.ziplyIngest?.status === "processing";

    return (
      <div className="ziply-job-tracker">
        <div className="tracker-header">
          <button className="back-btn" onClick={() => setSelectedJob(null)}>
            ← Back to Sites
          </button>
          <h2>{selectedJob.workOrder}</h2>
          <div className="job-meta">
            <span>{selectedJob.city}</span>
            <span className={`status-badge ${isCompleted ? 'completed' : 'active'}`}>
              {isCompleted ? "COMPLETED" : "IN PROGRESS"}
            </span>
          </div>
        </div>

        <div className="tracker-section job-details-grid">
          <div className="detail-field">
            <label>Address / Project Name</label>
            <span>{selectedJob.address || "No Address Provided"}</span>
          </div>
          <div className="detail-field">
            <label>Job Status</label>
            <span>{selectedJob.jobStatus || "N/A"}</span>
          </div>
          <div className="detail-field">
            <label>Hub Number</label>
            <span>{selectedJob.hubNumber || selectedJob.ziplyPrintLayer?.hubId || "N/A"}</span>
          </div>
          <div className="detail-field">
            <label>Ziply Inspector</label>
            <span>{selectedJob.ziplyInspector || "Unassigned"}</span>
          </div>
          <div className="detail-field">
            <label>Locate Ticket</label>
            <span>{selectedJob.locatesCalled || "Not Called"}</span>
          </div>
        </div>

        {selectedJob.nscProjectNotes && (
          <div className="tracker-section job-notes-section">
            <label>NSC Project Notes</label>
            <p className="job-notes-text">{selectedJob.nscProjectNotes}</p>
          </div>
        )}

        <div className="tracker-section">
          <h3><Zap size={14} /> AI Print Ingestion</h3>
          <p className="helper-text">Upload engineering prints to automatically extract scope of work and populate the map.</p>
          
          <input
            type="file"
            multiple
            accept="image/*,application/pdf"
            onChange={handleFileChange}
            id="print-upload"
            className="hidden-file-input"
          />
          <label htmlFor="print-upload" className="upload-dropzone">
            <UploadCloud size={24} />
            <span>Select PDF or Image Prints</span>
          </label>
          
          {fileNames.length > 0 && (
            <div className="selected-files">
              {fileNames.map((f, index) => <div key={`${f}-${index}`} className="file-pill">{f}</div>)}
              <button 
                className="btn-primary" 
                disabled={ingestStatus === "uploading" || ingestIsProcessing}
                onClick={() => handleIngest(selectedJob.jobId)}
              >
                {ingestStatus === "uploading"
                  ? `Uploading ${Math.round(uploadProgress)}%...`
                  : ingestIsProcessing
                    ? "AI Parsing..."
                    : "Extract Digital Scope"}
              </button>
            </div>
          )}
          {ingestIsProcessing && (
            <div className="info-msg">AI Parsing... (this can take a few minutes for large prints)</div>
          )}
          {ingestStatus === "success" && <div className="success-msg">Print ingested successfully! Map updated.</div>}
          {(ingestStatus === "error" || selectedJob.ziplyIngest?.status === "failed") && (
            <div className="error-msg">{errorMsg || selectedJob.ziplyIngest?.errorMessage}</div>
          )}
        </div>

        {selectedJob.ziplyPrintLayer && (
          <div className="tracker-section">
            <h3><FileText size={14} /> Digital Scope (Extracted)</h3>
            <div className="scope-metrics">
              <div className="scope-metric">
                <label>Total FDHs</label>
                <span>{selectedJob.ziplyPrintLayer.hubId ? 1 : 0}</span>
              </div>
              <div className="scope-metric">
                <label>Total MSTs</label>
                <span>{selectedJob.ziplyPrintLayer.terminalCount || 0}</span>
              </div>
            </div>
            <div className="map-objects-list">
              {(selectedJob.ziplyPrintLayer.mapObjects?.terminals?.length || 0) + (selectedJob.ziplyPrintLayer.mapObjects?.cables?.length || 0)} structures mapped.
            </div>
          </div>
        )}

        <div className="tracker-section">
          <h3><FilePlus size={14} /> Documents & Permits</h3>
          <p className="helper-text">Manage attachments for this job. (Integrated with Smartsheet & Permit APIs).</p>
          <div className="permit-list">
            <div className="permit-item">
              <span>ROW Permit</span>
              <button className="btn-secondary btn-small">Upload</button>
            </div>
            <div className="permit-item">
              <span>Splice Matrix</span>
              <button className="btn-secondary btn-small">Upload</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="ziply-jobs-tab">
      <div className="tab-header">
        <h2>ZIPLY SITES</h2>
        <p>Functional tracking and AI ingest.</p>
      </div>

      <div className="city-rollup">
        <label htmlFor="ziply-city-select">City</label>
        <select
          id="ziply-city-select"
          value={selectedCity}
          onChange={(e) => setSelectedCity(e.target.value)}
        >
          <option value="">All Cities ({allCities.length})</option>
          {allCities.map((c) => (
            <option key={c} value={c}>
              {c} ({jobsBySite.get(c)!.length})
            </option>
          ))}
        </select>
      </div>

      <div className="sites-list">
        {sites.map(site => {
          const isExpanded = expandedSites.has(site);
          const siteJobs = jobsBySite.get(site)!;
          
          return (
            <div key={site} className="site-group">
              <button className="site-header" onClick={() => toggleSite(site)}>
                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                <span className="site-name">{site}</span>
                <span className="site-count">{siteJobs.length}</span>
              </button>
              
              {isExpanded && (
                <div className="site-jobs">
                  {siteJobs.map(job => {
                    const isCompleted = job.jobStatus === "Complete" || (job.secondaryJobStatus || "").toLowerCase().startsWith("complete");
                    return (
                      <button 
                        key={job.jobId} 
                        className={`site-job-item ${isCompleted ? 'completed' : ''}`}
                        onClick={() => setSelectedJob(job)}
                      >
                        <div className="job-item-left">
                          <span className="job-number">{job.workOrder}</span>
                          <span className="job-address">{job.address || "No Address"}</span>
                        </div>
                        <span className="job-status">{isCompleted ? "Complete" : "In Progress"}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
