// Top-of-screen search bar. Always visible in the app shell.
//
// Smart routing on submit / suggestion click:
//   1. If the term matches a known Work Order (job #) — exact or close prefix —
//      focusJob() so the map zooms to that job.
//   2. Otherwise treat as a free-form address: geocode via Google and
//      focusLatLng() to drop the map on the result.
//
// While typing we show up to 6 inline suggestions of matching jobs so the
// user can pick one before hitting Enter.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useJobs } from "../jobs-map/useJobs.js";
import { useSearchFocus } from "./searchContext.js";
import { useMarkupSearchEntries, type MarkupSearchEntry } from "./markupSearchStore.js";
import type { Job } from "@nsc/types";

export default function SearchBar() {
  const jobsState = useJobs();
  const allJobs = jobsState.state === "ready" ? jobsState.jobs : [];
  const navigate = useNavigate();
  const { focusJob, focusLatLng } = useSearchFocus();
  const allMarkups = useMarkupSearchEntries();

  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Click-outside to close suggestion panel.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const suggestions = useMemo<Job[]>(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return allJobs
      .filter((j) => {
        const wo = (j.workOrder || "").toLowerCase();
        const addr = (j.address || "").toLowerCase();
        const city = (j.city || "").toLowerCase();
        return wo.includes(t) || addr.includes(t) || city.includes(t);
      })
      .slice(0, 6);
  }, [term, allJobs]);

  // Markup suggestions — anything the user typed on the map (userLabel,
  // description, or text content). Matches on label substring.
  const markupSuggestions = useMemo<MarkupSearchEntry[]>(() => {
    const t = term.trim().toLowerCase();
    if (!t) return [];
    return allMarkups
      .filter((m) => m.label.toLowerCase().includes(t))
      .slice(0, 6);
  }, [term, allMarkups]);

  function pickJob(job: Job) {
    setOpen(false);
    setError(null);
    setTerm(job.workOrder);
    // Ensure we're on the Jobs Map route so the map exists to receive focus.
    navigate("/");
    focusJob(job.jobId);
  }

  function pickMarkup(m: MarkupSearchEntry) {
    setOpen(false);
    setError(null);
    setTerm(m.label);
    navigate("/");
    // Jump the map to the markup's location. Job card will open via
    // the existing AllJobsMarkupsOverlay click handler the next time the
    // user clicks the markup; we just take them to the spot first.
    focusLatLng(m.lat, m.lng, m.label);
  }

  // Lazy-load the Google geocoder. APIProvider already loaded the maps JS,
  // so the global `google.maps.Geocoder` is available once the map mounted.
  async function geocodeFreeform(query: string): Promise<{ lat: number; lng: number; label: string } | null> {
    if (typeof window === "undefined") return null;
    const g = (window as unknown as { google?: { maps?: { Geocoder?: new () => google.maps.Geocoder } } }).google;
    if (!g?.maps?.Geocoder) return null;
    const geocoder = new g.maps.Geocoder();
    // Bias to Western WA — the only place jobs live in this app.
    const wa = new google.maps.LatLngBounds(
      { lat: 45.5, lng: -124.8 },
      { lat: 49.0, lng: -116.9 }
    );
    return new Promise((resolve) => {
      geocoder.geocode(
        { address: query, bounds: wa, region: "us" },
        (results, status) => {
          if (status === "OK" && results && results[0]) {
            const r = results[0];
            const loc = r.geometry.location;
            resolve({ lat: loc.lat(), lng: loc.lng(), label: r.formatted_address });
          } else {
            resolve(null);
          }
        }
      );
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = term.trim();
    if (!t) return;
    setError(null);

    // Prefer exact work-order match, else first suggestion if it's clearly a job.
    const lower = t.toLowerCase();
    const exact = allJobs.find((j) => (j.workOrder || "").toLowerCase() === lower);
    if (exact) {
      pickJob(exact);
      return;
    }
    if (suggestions.length === 1 && (suggestions[0]!.workOrder || "").toLowerCase().includes(lower)) {
      pickJob(suggestions[0]!);
      return;
    }
    // If the only match is a markup, jump to it.
    if (suggestions.length === 0 && markupSuggestions.length > 0) {
      pickMarkup(markupSuggestions[0]!);
      return;
    }

    // Otherwise — geocode as address.
    setBusy(true);
    try {
      navigate("/"); // ensure map is mounted
      const hit = await geocodeFreeform(t);
      if (!hit) {
        setError("No match. Try a job # or a full street address.");
        setOpen(true);
        return;
      }
      focusLatLng(hit.lat, hit.lng, hit.label);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="search-wrap" ref={wrapRef}>
      <form className="search-form" onSubmit={onSubmit} role="search">
        <span className="search-form__icon" aria-hidden>⌕</span>
        <input
          className="search-form__input"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            setOpen(true);
            if (error) setError(null);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search address or job #"
          autoComplete="off"
          spellCheck={false}
          aria-label="Search address or job number"
        />
        {term && (
          <button
            type="button"
            className="search-form__clear"
            onClick={() => {
              setTerm("");
              setError(null);
              setOpen(false);
            }}
            aria-label="Clear search"
          >
            ×
          </button>
        )}
        <button type="submit" className="search-form__submit" disabled={busy}>
          {busy ? "…" : "Go"}
        </button>
      </form>

      {open && (term.trim().length > 0 || error) && (
        <div className="search-suggest">
          {error && <div className="search-suggest__error">{error}</div>}

          {suggestions.length > 0 && (
            <>
              <div className="search-suggest__heading">JOBS</div>
              <ul className="search-suggest__list">
                {suggestions.map((j) => (
                  <li key={j.jobId}>
                    <button
                      type="button"
                      className="search-suggest__row"
                      onClick={() => pickJob(j)}
                    >
                      <span className="search-suggest__wo">{j.workOrder}</span>
                      <span className="search-suggest__addr">
                        {[j.address, j.city].filter(Boolean).join(", ") || "—"}
                      </span>
                      {j.secondaryJobStatus && (
                        <span className="search-suggest__status">{j.secondaryJobStatus}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {markupSuggestions.length > 0 && (
            <>
              <div className="search-suggest__heading">MAP MARKUPS</div>
              <ul className="search-suggest__list">
                {markupSuggestions.map((m) => (
                  <li key={`${m.jobId}:${m.objId}`}>
                    <button
                      type="button"
                      className="search-suggest__row search-suggest__row--markup"
                      onClick={() => pickMarkup(m)}
                    >
                      <span className="search-suggest__wo">{m.label}</span>
                      <span className="search-suggest__addr">
                        {m.tool} · job {m.jobId}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {suggestions.length === 0 && markupSuggestions.length === 0 && !error && term.trim().length > 0 && (
            <div className="search-suggest__hint">
              No job or markup match — press <kbd>Enter</kbd> to search this as an address.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
