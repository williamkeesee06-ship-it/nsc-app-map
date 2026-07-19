import React, { useState, useMemo } from "react";
import { X, UploadCloud, Search, AlertCircle, Loader2, CheckCircle } from "lucide-react";
import type { Job } from "@nsc/types";
import { ingestZiplyPrintForJob, getZiplyPrintAnchor } from "../ziply/ziplyUtils.js";

interface Props {
  jobs: Job[];
  onClose: () => void;
  preselectedFile?: File | null;
  preselectedJob?: Job | null;
}

export default function GlobalPrintUploadModal({ jobs, onClose, preselectedFile, preselectedJob }: Props) {
  const [search, setSearch] = useState("");
  const [selectedJob, setSelectedJob] = useState<Job | null>(preselectedJob || null);
  
  const [file, setFile] = useState<File | null>(preselectedFile || null);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  // Filter jobs based on search input
  const filteredJobs = useMemo(() => {
    if (!search.trim()) return jobs.slice(0, 50); // Show max 50 by default to avoid huge lists
    const lower = search.toLowerCase();
    return jobs.filter((j) => {
      return (
        j.workOrder?.toLowerCase().includes(lower) ||
        j.address?.toLowerCase().includes(lower) ||
        j.city?.toLowerCase().includes(lower) ||
        j.jobId.toLowerCase().includes(lower)
      );
    }).slice(0, 50);
  }, [jobs, search]);

  const handleUpload = async () => {
    if (!selectedJob || !file) return;
    setBusy(true);
    setErr(null);
    setPct(0);

    try {
      // Ingest the print
      const url = await ingestZiplyPrintForJob(selectedJob.jobId, file, (p) => setPct(Math.round(p)));
      
      // Open the ingested PDF in a new tab
      window.open(url, "_blank");

      // Fly map to location
      const printAnchor = getZiplyPrintAnchor(selectedJob);
      const g = selectedJob.geocode;
      if (printAnchor) {
        window.dispatchEvent(
          new CustomEvent("nsc:pan-to", {
            detail: { lat: printAnchor.lat, lng: printAnchor.lng, zoom: 16 },
          })
        );
      } else if (g?.status === "OK" && g.lat && g.lng) {
        window.dispatchEvent(
          new CustomEvent("nsc:pan-to", {
            detail: { lat: g.lat, lng: g.lng, zoom: 16 },
          })
        );
      }
      
      // Automatically close modal on success
      onClose();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div 
        className="w-full max-w-xl bg-white rounded-xl shadow-2xl overflow-hidden flex flex-col border border-slate-200"
        style={{ animation: "fadeInUp 0.2s ease-out" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
          <div className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-cyan-600" />
            <h2 className="text-lg font-bold text-slate-800">Upload Print & AI Ingestion</h2>
          </div>
          <button 
            onClick={onClose}
            className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-200 rounded-md transition-colors"
            disabled={busy}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 flex flex-col gap-6">
          
          {/* Step 1: Select Job */}
          <div className="flex flex-col gap-2">
            <label className="text-sm font-semibold text-slate-700">1. Select Job (from Smartsheets)</label>
            {!selectedJob ? (
              <div className="relative">
                <div className="relative flex items-center">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3" />
                  <input
                    type="text"
                    placeholder="Search by Work Order, Address, or City..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-cyan-500 transition-all"
                  />
                </div>
                {/* Search Results Dropdown */}
                {filteredJobs.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {filteredJobs.map((j) => (
                      <button
                        key={j.jobId}
                        className="w-full text-left px-4 py-2 hover:bg-cyan-50 focus:bg-cyan-50 transition-colors border-b border-slate-100 last:border-0"
                        onClick={() => setSelectedJob(j)}
                      >
                        <div className="font-semibold text-slate-800">{j.workOrder || "No WO"}</div>
                        <div className="text-xs text-slate-500">{j.city} - {j.address}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-between p-3 border border-cyan-200 bg-cyan-50 rounded-lg">
                <div>
                  <div className="font-bold text-cyan-900">{selectedJob.workOrder || "No WO"}</div>
                  <div className="text-xs text-cyan-700">{selectedJob.city} - {selectedJob.address}</div>
                </div>
                <button 
                  onClick={() => { setSelectedJob(null); setFile(null); }}
                  className="text-xs font-semibold text-cyan-600 hover:text-cyan-800"
                  disabled={busy}
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Step 2: Upload File */}
          <div className={`flex flex-col gap-2 transition-opacity ${!selectedJob ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
            <label className="text-sm font-semibold text-slate-700">2. Upload Print (PDF)</label>
            <div className="relative border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-center bg-slate-50 hover:bg-slate-100 transition-colors">
              <input
                type="file"
                accept="application/pdf"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    setFile(e.target.files[0]);
                  }
                }}
                disabled={busy}
              />
              <UploadCloud className={`w-10 h-10 mb-2 ${file ? 'text-cyan-500' : 'text-slate-400'}`} />
              <div className="text-sm font-semibold text-slate-700">
                {file ? file.name : "Drag & drop PDF here"}
              </div>
              {!file && <div className="text-xs text-slate-500 mt-1">or click to browse files</div>}
            </div>
          </div>

          {/* Error Message */}
          {err && (
            <div className="flex items-center gap-2 p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{err}</span>
            </div>
          )}
          
          {preselectedJob && preselectedFile && !busy && !err && (
            <div className="p-3 bg-cyan-50 border border-cyan-200 text-cyan-800 rounded-lg text-sm font-semibold flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-cyan-500" />
              AI auto-matched this file to Work Order {preselectedJob.workOrder}. Ready to ingest!
            </div>
          )}

          {/* Progress / Submit */}
          <div className="mt-2">
            <button
              onClick={handleUpload}
              disabled={!selectedJob || !file || busy}
              className={`w-full py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${
                (!selectedJob || !file || busy) 
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed' 
                  : 'bg-cyan-500 text-white shadow-[0_0_15px_rgba(6,182,212,0.4)] hover:bg-cyan-400 hover:shadow-[0_0_20px_rgba(6,182,212,0.6)]'
              }`}
            >
              {busy ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Ingesting Print... {pct}%
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  Start AI Ingestion
                </>
              )}
            </button>
            {busy && (
              <div className="w-full bg-slate-200 h-1.5 rounded-full mt-3 overflow-hidden">
                <div 
                  className="bg-cyan-500 h-full transition-all duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
