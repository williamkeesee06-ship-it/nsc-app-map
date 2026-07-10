import { useState, useEffect } from "react";
import type { Job } from "@nsc/types";
import { Map as MapIcon, Paperclip, FileText, Grid, Filter, Share2 } from "lucide-react";
import "./ziplyJobsTab.css";

interface Props {
  jobs: Job[];
  selected?: Job | null;
  setSelected?: (job: Job | null) => void;
  onClose?: () => void;
}

export default function ZiplyJobsTab({ jobs, selected, setSelected, onClose }: Props) {
  // Ziply jobs only
  const ziplyJobs = jobs.filter((j) => j.customerProject === "Ziply");
  
  const [selectedJobId, setSelectedJobId] = useState<string | null>(selected?.jobId || null);

  useEffect(() => {
    if (selected) {
      setSelectedJobId(selected.jobId);
    }
  }, [selected]);

  return (
    <div className="ziply-jobs-tab-fullscreen">
      <div className="ss-header">
        <h2>
          <Grid size={20} color="#0284c7" />
          Ziply FTTH Construction Tracker
        </h2>
        {onClose && (
          <button className="close-btn" onClick={onClose} title="Close Tracker">
            ✕
          </button>
        )}
      </div>

      <div className="ss-toolbar">
        <button><FileText size={14} /> File</button>
        <button><Filter size={14} /> Filter</button>
        <button><Share2 size={14} /> Share</button>
      </div>

      <div className="ss-table-container">
        <table className="ss-table">
          <thead>
            <tr>
              <th style={{ width: '40px', textAlign: 'center' }}>#</th>
              <th style={{ width: '120px' }}>SAP Sales Order</th>
              <th style={{ width: '100px' }}>Work Order</th>
              <th style={{ width: '120px' }}>City</th>
              <th style={{ width: '100px' }}>Hub Number</th>
              <th style={{ width: '300px' }}>Job Notes</th>
              <th style={{ width: '120px' }}>SAP Contract ID</th>
              <th style={{ width: '100px' }}>Project ID</th>
              <th style={{ width: '120px' }}>Work Type</th>
              <th style={{ width: '100px' }}>Date Received</th>
              <th style={{ width: '100px' }}>Exp Date</th>
              <th style={{ width: '180px' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {ziplyJobs.map((job, index) => {
              const isSelected = job.jobId === selectedJobId;
              const status = (job.jobStatus || "").toLowerCase();
              
              // Apply row coloring similar to screenshot 3 (yellow/orange based on some status or randomly for now)
              let rowClass = isSelected ? "selected" : "";
              if (!isSelected) {
                if (status.includes("pending")) rowClass = "ss-row-active-yellow";
                else if (status.includes("hold")) rowClass = "ss-row-active-orange";
              }

              return (
                <tr 
                  key={job.jobId} 
                  className={rowClass}
                  onClick={() => setSelectedJobId(job.jobId)}
                >
                  <td style={{ textAlign: 'center', color: '#94a3b8' }}>{index + 1}</td>
                  <td>{job.sapSalesOrder || ""}</td>
                  <td style={{ fontWeight: 600 }}>{job.workOrder}</td>
                  <td>{job.city}</td>
                  <td>{job.hubNumber || ""}</td>
                  <td title={job.nscProjectNotes || ""} style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {job.nscProjectNotes || ""}
                  </td>
                  <td>{job.sapContractId || ""}</td>
                  <td>{/* TODO: Add projectId to Job type if needed */ ""}</td>
                  <td>{job.workType || ""}</td>
                  <td>{job.dateReceived || ""}</td>
                  <td>{job.actualCompletionDate || ""}</td>
                  <td style={{ display: 'flex', gap: '8px' }}>
                    <button 
                      className="ss-btn-map"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (setSelected) setSelected(job);
                        if (onClose) onClose();
                      }}
                    >
                      <MapIcon size={12} /> Map
                    </button>
                    <button className="ss-btn-attach">
                      <Paperclip size={12} /> Attach
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
