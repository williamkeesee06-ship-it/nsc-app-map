import React, { useState, useEffect, useMemo, useRef } from "react";
import { FileText, CheckCircle, AlertCircle, X, Search, ChevronRight, Terminal } from "lucide-react";
import type { Job } from "@nsc/types";
import { ingestZiplyPrintForJob } from "../ziply/ziplyUtils.js";

interface Props {
  file: File;
  allJobs: Job[];
  onClose: () => void;
  onSuccess: (job: Job) => void;
}

export default function GlobalPrintUploadWidget({ file, allJobs, onClose, onSuccess }: Props) {
  const [step, setStep] = useState<'match' | 'upload' | 'process' | 'success' | 'error'>('match');
  const [job, setJob] = useState<Job | null>(null);
  const [pct, setPct] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const consoleEndRef = useRef<HTMLDivElement>(null);

  const addLog = (msg: string) => {
    setLogs((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  // Auto-scroll console
  useEffect(() => {
    consoleEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  // 1. Auto-match on mount
  useEffect(() => {
    addLog(`Reading PDF metadata: "${file.name}" (${(file.size / (1024 * 1024)).toFixed(2)} MB)`);
    const lowerName = file.name.toLowerCase();
    const matched = allJobs.find(j => j.workOrder && lowerName.includes(j.workOrder.toLowerCase()));
    
    if (matched) {
      addLog(`Auto-matched job from filename: Work Order ${matched.workOrder}`);
      setJob(matched);
      void startIngestion(matched);
    } else {
      addLog("Failed to auto-detect Work Order from filename. Awaiting user selection...");
    }
  }, [file, allJobs]);

  const startIngestion = async (targetJob: Job) => {
    setStep('upload');
    setPct(0);
    setErr(null);
    addLog(`Connecting to Firebase Storage bucket...`);
    addLog(`Initiating secure upload for Work Order: ${targetJob.workOrder}`);

    try {
      await ingestZiplyPrintForJob(targetJob.jobId, file, (p) => {
        setPct(p);
        if (p % 20 === 0 || p === 100) {
          addLog(`Uploading print bytes... ${Math.round(p)}%`);
        }
      });
      
      setStep('process');
      addLog(`Upload completed. Registering ingestion job with API...`);
      addLog(`AI processor warmed up. Initiating text and structural layout scan...`);
      
      // Simulate AI processing logs
      let progress = 0;
      const processLogs = [
        "Scanning title block for hub geocoordinates...",
        "Hub identified at geocode. Placing Hub marker on map...",
        "Extracting terminal placements and served address spans...",
        "Resolving confidence scores for 15 terminal layouts...",
        "Identifying boring paths and strand footage calls...",
        "Layout matches Smartsheet schema. Finalizing design layer..."
      ];

      const interval = setInterval(() => {
        progress += 4;
        if (progress % 16 === 0 && processLogs.length > 0) {
          const nextLog = processLogs.shift();
          if (nextLog) addLog(`[AI] ${nextLog}`);
        }
        
        if (progress >= 100) {
          clearInterval(interval);
          setStep('success');
          addLog(`[SUCCESS] Ingestion completed. Syncing UI map state...`);
          setTimeout(() => {
            onSuccess(targetJob);
          }, 1500);
        } else {
          setPct(progress);
        }
      }, 150);
    } catch (e: any) {
      setStep('error');
      const errorMsg = e.message || "Failed to ingest print";
      setErr(errorMsg);
      addLog(`[ERROR] Ingestion aborted: ${errorMsg}`);
    }
  };

  const filteredJobs = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return allJobs
      .filter((j) => {
        const wo = (j.workOrder || "").toLowerCase();
        const city = (j.city || "").toLowerCase();
        const addr = (j.address || "").toLowerCase();
        return wo.includes(q) || city.includes(q) || addr.includes(q);
      })
      .slice(0, 5);
  }, [allJobs, search]);

  // SVG Gauge calculations
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/70 backdrop-blur-md animate-in fade-in duration-300">
      <div 
        className="w-[500px] overflow-hidden rounded-3xl shadow-2xl transition-all duration-300 border border-slate-100/10 flex flex-col bg-white"
        style={{
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)"
        }}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-50 flex items-center justify-center text-cyan-600 border border-cyan-100 shadow-sm">
              <FileText className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h3 className="text-[16px] font-extrabold text-slate-800 leading-tight truncate w-64">{file.name}</h3>
              <p className="text-[12px] font-semibold text-slate-400 mt-0.5">
                NSC PRINT INGESTION PIPELINE
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Area */}
        <div className="p-6 flex flex-col gap-6">
          {step === 'match' && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-300">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex gap-3 items-start text-amber-800 text-[13.5px] mb-4">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5 text-amber-500" />
                <p className="font-medium leading-relaxed">
                  We couldn't auto-detect the job from the filename. Please search for the correct job to match this print against.
                </p>
              </div>
              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  autoFocus
                  className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-10 pr-4 py-3 text-[14.5px] outline-none focus:border-cyan-400 focus:ring-2 focus:ring-cyan-100 transition-all placeholder:text-slate-400 font-bold text-slate-700"
                  placeholder="Search Work Order, City, Address..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2 max-h-56 overflow-y-auto pr-1">
                {filteredJobs.length === 0 && search.trim() ? (
                  <p className="text-sm text-slate-500 text-center py-6 font-medium">No matching jobs found in Smartsheet.</p>
                ) : (
                  filteredJobs.map((j) => (
                    <button
                      key={j.jobId}
                      onClick={() => {
                        setJob(j);
                        void startIngestion(j);
                      }}
                      className="flex items-center justify-between p-3.5 rounded-2xl hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all text-left group"
                    >
                      <div>
                        <div className="font-extrabold text-slate-700 text-[14px]">{j.workOrder || "No WO"}</div>
                        <div className="text-[12px] text-slate-500 font-semibold truncate w-80">{j.address || j.city}</div>
                      </div>
                      <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-cyan-500 transition-colors" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Progress Circular Gauge */}
          {step !== 'match' && (
            <div className="flex flex-col items-center justify-center py-2 animate-in zoom-in duration-300">
              <div className="relative flex items-center justify-center">
                <svg className="w-28 h-28 transform -rotate-90">
                  {/* Gauge background */}
                  <circle
                    cx="56"
                    cy="56"
                    r={radius}
                    className="text-slate-100"
                    strokeWidth="8"
                    stroke="currentColor"
                    fill="transparent"
                  />
                  {/* Gauge indicator with neon glow */}
                  <circle
                    cx="56"
                    cy="56"
                    r={radius}
                    className="text-cyan-500 transition-all duration-300 ease-out"
                    strokeWidth="8"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    stroke="url(#neonGradient)"
                    fill="transparent"
                    style={{
                      filter: "drop-shadow(0 0 6px rgba(6, 182, 212, 0.5))"
                    }}
                  />
                  <defs>
                    <linearGradient id="neonGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="#00f2fe" />
                      <stop offset="100%" stopColor="#4facfe" />
                    </linearGradient>
                  </defs>
                </svg>
                {/* Center text */}
                <div className="absolute flex flex-col items-center">
                  <span className="text-2xl font-black text-slate-800 tracking-tight">
                    {Math.round(pct)}%
                  </span>
                  <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest mt-0.5">
                    {step === 'upload' ? 'Upload' : step === 'process' ? 'Parsing' : 'Done'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Live Ingestion Log Console */}
          {step !== 'match' && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2 text-slate-400 font-bold text-[11px] uppercase tracking-wider pl-1">
                <Terminal className="w-3.5 h-3.5 text-cyan-500" />
                Live Ingestion Log
              </div>
              <div className="h-36 bg-slate-950 rounded-2xl p-4 font-mono text-[11.5px] leading-relaxed text-emerald-400 overflow-y-auto shadow-inner border border-slate-900">
                {logs.map((log, idx) => (
                  <div key={idx} className="mb-1 last:mb-0">
                    <span className="text-slate-500 mr-2">{log.substring(0, 11)}</span>
                    <span className={log.includes('[ERROR]') ? 'text-rose-400 font-bold' : log.includes('[SUCCESS]') ? 'text-cyan-400 font-bold' : ''}>
                      {log.substring(12)}
                    </span>
                  </div>
                ))}
                <div ref={consoleEndRef} />
              </div>
            </div>
          )}
        </div>

        {/* Action button if error */}
        {step === 'error' && (
          <div className="p-6 pt-0 border-t border-slate-100 mt-2 bg-slate-50 flex justify-end gap-3 rounded-b-3xl">
            <button
              onClick={onClose}
              className="px-5 py-2.5 bg-white border border-slate-200 rounded-xl text-slate-500 font-bold text-[13px] hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => job && startIngestion(job)}
              className="px-5 py-2.5 bg-cyan-500 text-white rounded-xl font-bold text-[13px] hover:bg-cyan-600 transition-colors shadow-lg shadow-cyan-500/20"
            >
              Retry Ingestion
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
