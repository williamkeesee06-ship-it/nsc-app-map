import React, { useState, useEffect, useMemo } from "react";
import { FileText, Loader2, CheckCircle, AlertCircle, X, Search, ChevronRight } from "lucide-react";
import type { Job } from "@nsc/types";
import { ingestZiplyPrintForJob, getZiplyPrintAnchor } from "../ziply/ziplyUtils.js";
import { useMap } from "@vis.gl/react-google-maps";

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
  const map = useMap();

  // 1. Auto-match on mount
  useEffect(() => {
    const lowerName = file.name.toLowerCase();
    const matched = allJobs.find(j => j.workOrder && lowerName.includes(j.workOrder.toLowerCase()));
    
    if (matched) {
      setJob(matched);
      startIngestion(matched);
    }
  }, [file, allJobs]);

  const startIngestion = async (targetJob: Job) => {
    setStep('upload');
    setPct(0);
    setErr(null);
    try {
      await ingestZiplyPrintForJob(targetJob.jobId, file, (p) => setPct(p));
      setStep('process');
      // Simulate AI processing time since it happens in background
      let progress = 0;
      const interval = setInterval(() => {
        progress += 5;
        if (progress >= 100) {
          clearInterval(interval);
          setStep('success');
          setTimeout(() => {
            onSuccess(targetJob);
          }, 1500);
        } else {
          setPct(progress);
        }
      }, 100);
    } catch (e: any) {
      setStep('error');
      setErr(e.message || "Failed to ingest print");
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

  return (
    <div 
      className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] w-[400px] overflow-hidden rounded-2xl shadow-2xl transition-all duration-500 ease-out"
      style={{
        background: "rgba(255, 255, 255, 0.95)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        border: "1px solid rgba(0, 0, 0, 0.08)",
        boxShadow: "0 20px 40px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.05)"
      }}
    >
      <div className="p-5 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500 border border-blue-100 shadow-sm">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-slate-800 leading-tight truncate w-64">{file.name}</h3>
              <p className="text-[12px] font-medium text-slate-500 mt-0.5">
                {step === 'match' ? 'Awaiting job selection' : 
                 step === 'upload' ? 'Uploading to secure storage...' : 
                 step === 'process' ? 'AI extracting details...' : 
                 step === 'error' ? 'Ingestion failed' : 'Ready for drawing'}
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
        {step === 'match' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2 items-start text-amber-800 text-[13px] mb-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-500" />
              <p>We couldn't auto-detect the job from the filename. Please search for the job below.</p>
            </div>
            <div className="relative mb-2">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 pr-4 py-2.5 text-[14px] outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all placeholder:text-slate-400 font-medium text-slate-700"
                placeholder="Search Work Order, City..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            {search.trim() && (
              <div className="flex flex-col gap-1 max-h-48 overflow-y-auto pr-1">
                {filteredJobs.length === 0 ? (
                  <p className="text-sm text-slate-500 text-center py-4">No jobs found.</p>
                ) : (
                  filteredJobs.map((j) => (
                    <button
                      key={j.jobId}
                      onClick={() => {
                        setJob(j);
                        startIngestion(j);
                      }}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 border border-transparent hover:border-slate-200 transition-all text-left group"
                    >
                      <div>
                        <div className="font-bold text-slate-700 text-[14px]">{j.workOrder || "No WO"}</div>
                        <div className="text-[12px] text-slate-500 font-medium truncate w-60">{j.address || j.city}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-blue-500 transition-colors" />
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {(step === 'upload' || step === 'process') && (
          <div className="py-2 animate-in fade-in duration-300">
            <div className="flex items-center justify-between text-[13px] font-bold text-slate-700 mb-2">
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                {step === 'upload' ? 'Uploading PDF...' : 'AI Analyzing...'}
              </div>
              <span className="text-blue-600">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${pct}%` }}
              />
            </div>
            {job && (
              <p className="text-[12px] font-medium text-slate-400 mt-3 text-center">
                Processing for <strong className="text-slate-600">{job.workOrder}</strong> in {job.city}
              </p>
            )}
          </div>
        )}

        {step === 'success' && (
          <div className="py-4 animate-in zoom-in duration-300 flex flex-col items-center justify-center text-center">
            <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-500 mb-3 shadow-inner">
              <CheckCircle className="w-6 h-6" />
            </div>
            <h4 className="text-[15px] font-bold text-slate-800">Print Ingested!</h4>
            <p className="text-[13px] font-medium text-slate-500 mt-1">Taking you to the job...</p>
          </div>
        )}

        {step === 'error' && (
          <div className="py-3 animate-in fade-in duration-300">
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-start gap-2 text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <p className="text-[13px] font-medium leading-relaxed">{err}</p>
            </div>
            <button 
              onClick={() => job && startIngestion(job)}
              className="mt-3 w-full py-2 bg-white border border-slate-200 rounded-lg text-slate-600 font-bold text-[13px] hover:bg-slate-50 transition-colors shadow-sm"
            >
              Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
