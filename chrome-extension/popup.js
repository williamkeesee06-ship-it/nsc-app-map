// Minimal status readout for the popup: shows the last job captured from the
// NSC app (if any) so the user can confirm the bridge is working.
chrome.storage.local.get(["nsc811Job", "nsc811JobAt"], (res) => {
  const el = document.getElementById("status");
  const job = res && res.nsc811Job;
  if (!job) return;
  const when = res.nsc811JobAt ? new Date(res.nsc811JobAt).toLocaleString() : "";
  el.innerHTML =
    "<b>Job ready:</b> " +
    (job.workOrder ? String(job.workOrder) : "(no WO)") +
    "<br>" +
    (job.address ? String(job.address) : "(no address)") +
    (when ? "<br><span style='color:#8b95a1'>captured " + when + "</span>" : "");
});
