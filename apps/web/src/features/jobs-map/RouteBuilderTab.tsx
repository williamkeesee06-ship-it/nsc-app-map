// RouteBuilderTab — multi-select jobs from the current visible list and
// generate an optimized Google Maps URL you can open on your phone.
//
// Usage:
//   1. Search/check the jobs you want to visit (uses workOrder + address)
//   2. Pick a starting point ("Current location" or first selected job)
//   3. Click "Build route" → opens Google Maps with optimized stops
//   4. "Send to phone" copies a short URL you can text/email yourself
//
// Billy 6/8 — North Sky Communications.

import { useMemo, useState } from "react";
import type { Job } from "@nsc/types";
import { useJobsContext } from "./jobsContext.js";
import { useSearchFocus } from "../search/searchContext.js";

const MAX_STOPS = 9; // Google Maps URL limit: 1 origin + 1 destination + up to 9 waypoints

interface SelectableJob {
  jobId: string;
  workOrder: string;
  address: string;
  city: string | null;
  lat: number;
  lng: number;
}

function jobToSelectable(j: Job): SelectableJob | null {
  if (!j.geocode || j.geocode.status !== "OK" || j.geocode.lat === 0) return null;
  return {
    jobId: j.jobId,
    workOrder: j.workOrder,
    address: j.address ?? "",
    city: j.city ?? null,
    lat: j.geocode.lat,
    lng: j.geocode.lng,
  };
}

export default function RouteBuilderTab() {
  const { jobs } = useJobsContext();
  const { focusJob } = useSearchFocus();
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [startFromCurrent, setStartFromCurrent] = useState(true);

  const candidates: SelectableJob[] = useMemo(() => {
    return jobs
      .map(jobToSelectable)
      .filter((j): j is SelectableJob => j !== null);
  }, [jobs]);

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase();
    if (!q) return candidates;
    return candidates.filter(
      (j) =>
        j.workOrder.toUpperCase().includes(q) ||
        j.address.toUpperCase().includes(q) ||
        (j.city ?? "").toUpperCase().includes(q)
    );
  }, [candidates, search]);

  const selectedJobs: SelectableJob[] = useMemo(() => {
    return selectedIds
      .map((id) => candidates.find((j) => j.jobId === id))
      .filter((j): j is SelectableJob => !!j);
  }, [selectedIds, candidates]);

  function toggle(jobId: string) {
    setSelectedIds((prev) => {
      if (prev.includes(jobId)) return prev.filter((x) => x !== jobId);
      if (prev.length >= MAX_STOPS + 1) {
        alert(`Max ${MAX_STOPS + 1} stops per route.`);
        return prev;
      }
      return [...prev, jobId];
    });
  }

  function move(jobId: string, dir: -1 | 1) {
    setSelectedIds((prev) => {
      const idx = prev.indexOf(jobId);
      if (idx < 0) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function clearAll() {
    setSelectedIds([]);
  }

  function buildRouteUrl(): string | null {
    if (selectedJobs.length === 0) return null;

    // Origin: "Current+Location" → Google Maps will use the device GPS,
    // OR the first selected job if user chose otherwise.
    const stops = [...selectedJobs];
    let origin: string;
    if (startFromCurrent) {
      origin = "Current+Location";
    } else {
      const first = stops.shift();
      if (!first) return null;
      origin = `${first.lat},${first.lng}`;
    }

    if (stops.length === 0) return null;
    const destination = stops.pop()!;
    const waypoints = stops.map((s) => `${s.lat},${s.lng}`).join("|");

    const params = new URLSearchParams({
      api: "1",
      origin,
      destination: `${destination.lat},${destination.lng}`,
      travelmode: "driving",
    });
    if (waypoints) params.set("waypoints", waypoints);
    // Tell Maps to optimize the order of waypoints.
    params.set("waypoint_place_ids", "");

    return `https://www.google.com/maps/dir/?${params.toString()}`;
  }

  function openRoute() {
    const url = buildRouteUrl();
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  async function copyRoute() {
    const url = buildRouteUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      alert("Route URL copied to clipboard. Paste into text/email for your phone.");
    } catch {
      // Fallback: prompt with the URL
      window.prompt("Copy this URL:", url);
    }
  }

  function shareSms() {
    const url = buildRouteUrl();
    if (!url) return;
    const body = `North Sky route (${selectedJobs.length} stops): ${url}`;
    window.location.href = `sms:?body=${encodeURIComponent(body)}`;
  }

  const totalSelected = selectedJobs.length;
  const canBuild = totalSelected >= (startFromCurrent ? 1 : 2);

  return (
    <div className="route-builder">
      <div className="route-builder__header">
        <strong>ROUTE BUILDER</strong>
        <small style={{ color: "#9aa4b2", display: "block", marginTop: 2 }}>
          {totalSelected} / {MAX_STOPS + 1} stops
        </small>
      </div>

      {/* Selected stops list */}
      {totalSelected > 0 && (
        <div className="route-builder__selected">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <small style={{ color: "#9aa4b2", fontWeight: 600 }}>STOPS (in order)</small>
            <button
              type="button"
              onClick={clearAll}
              style={{
                background: "transparent",
                color: "#ff6b7a",
                border: "none",
                cursor: "pointer",
                fontSize: 11,
                padding: 0,
              }}
            >
              Clear
            </button>
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {selectedJobs.map((j, i) => (
              <li
                key={j.jobId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "4px 6px",
                  marginBottom: 2,
                  background: "#0a0f1c",
                  border: "1px solid #1f2a44",
                  borderRadius: 4,
                  fontSize: 11,
                }}
              >
                <span style={{ color: "#00e5ff", fontWeight: 700, minWidth: 16 }}>{i + 1}.</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.workOrder}
                </span>
                <button
                  type="button"
                  onClick={() => focusJob(j.jobId)}
                  title="Show on map"
                  style={{ background: "transparent", color: "#9aa4b2", border: "none", cursor: "pointer", padding: "0 2px", fontSize: 12 }}
                >
                  ⌖
                </button>
                <button
                  type="button"
                  onClick={() => move(j.jobId, -1)}
                  disabled={i === 0}
                  style={{ background: "transparent", color: i === 0 ? "#3a445a" : "#9aa4b2", border: "none", cursor: i === 0 ? "default" : "pointer", padding: "0 2px" }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(j.jobId, 1)}
                  disabled={i === selectedJobs.length - 1}
                  style={{ background: "transparent", color: i === selectedJobs.length - 1 ? "#3a445a" : "#9aa4b2", border: "none", cursor: i === selectedJobs.length - 1 ? "default" : "pointer", padding: "0 2px" }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => toggle(j.jobId)}
                  title="Remove"
                  style={{ background: "transparent", color: "#ff6b7a", border: "none", cursor: "pointer", padding: "0 2px" }}
                >
                  ×
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {/* Start option */}
      <label style={{ display: "flex", alignItems: "center", gap: 6, margin: "10px 0 6px", fontSize: 11, color: "#cbd5e1" }}>
        <input
          type="checkbox"
          checked={startFromCurrent}
          onChange={(e) => setStartFromCurrent(e.target.checked)}
        />
        Start from current location
      </label>

      {/* Action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 12 }}>
        <button
          type="button"
          onClick={openRoute}
          disabled={!canBuild}
          style={{
            background: canBuild ? "#00e5ff" : "#1f2a44",
            color: canBuild ? "#0a0f1c" : "#5a6478",
            border: "none",
            borderRadius: 6,
            padding: "8px 12px",
            fontWeight: 700,
            cursor: canBuild ? "pointer" : "not-allowed",
            fontSize: 12,
          }}
        >
          OPEN IN GOOGLE MAPS →
        </button>
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={copyRoute}
            disabled={!canBuild}
            style={{
              flex: 1,
              background: "transparent",
              color: canBuild ? "#cbd5e1" : "#5a6478",
              border: `1px solid ${canBuild ? "#1f2a44" : "#1f2a44"}`,
              borderRadius: 6,
              padding: "6px 8px",
              cursor: canBuild ? "pointer" : "not-allowed",
              fontSize: 11,
            }}
          >
            Copy URL
          </button>
          <button
            type="button"
            onClick={shareSms}
            disabled={!canBuild}
            style={{
              flex: 1,
              background: "transparent",
              color: canBuild ? "#cbd5e1" : "#5a6478",
              border: `1px solid ${canBuild ? "#1f2a44" : "#1f2a44"}`,
              borderRadius: 6,
              padding: "6px 8px",
              cursor: canBuild ? "pointer" : "not-allowed",
              fontSize: 11,
            }}
          >
            Text to phone
          </button>
        </div>
      </div>

      {/* Search + add */}
      <input
        type="search"
        placeholder="Find job to add…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{
          width: "100%",
          background: "#0a0f1c",
          color: "#f4f8ff",
          border: "1px solid #1f2a44",
          borderRadius: 6,
          padding: "6px 8px",
          fontSize: 12,
          boxSizing: "border-box",
          marginBottom: 6,
        }}
      />

      <div style={{ maxHeight: 360, overflowY: "auto", border: "1px solid #1f2a44", borderRadius: 4 }}>
        {filtered.length === 0 && (
          <div style={{ padding: 8, color: "#9aa4b2", fontSize: 11, textAlign: "center" }}>
            {candidates.length === 0 ? "No geocoded jobs available." : "No matches."}
          </div>
        )}
        {filtered.slice(0, 100).map((j) => {
          const isSel = selectedIds.includes(j.jobId);
          return (
            <button
              key={j.jobId}
              type="button"
              onClick={() => toggle(j.jobId)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: isSel ? "#003844" : "transparent",
                color: isSel ? "#00e5ff" : "#cbd5e1",
                border: "none",
                borderBottom: "1px solid #0f1626",
                padding: "5px 8px",
                cursor: "pointer",
                fontSize: 11,
                fontFamily: "ui-monospace, monospace",
              }}
            >
              <div style={{ fontWeight: isSel ? 700 : 500 }}>
                {isSel ? "✓ " : ""}
                {j.workOrder}
              </div>
              {j.address && (
                <div style={{ color: "#9aa4b2", fontSize: 10, marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {j.address}
                  {j.city ? `, ${j.city}` : ""}
                </div>
              )}
            </button>
          );
        })}
        {filtered.length > 100 && (
          <div style={{ padding: 6, color: "#9aa4b2", fontSize: 10, textAlign: "center" }}>
            Showing 100 of {filtered.length}. Refine search.
          </div>
        )}
      </div>
    </div>
  );
}
