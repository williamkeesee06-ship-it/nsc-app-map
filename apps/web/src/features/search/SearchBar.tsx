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

// Neon-glow magnifying glass icon. Pure SVG, cyan stroke, drop-shadow filter
// gives it the bright "neon sign" look that matches the search-bar styling.
function NeonMagnifier() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{
        filter:
          "drop-shadow(0 0 2px #6ee0ff) drop-shadow(0 0 5px #1fb6ff) drop-shadow(0 0 9px #1fb6ff)",
      }}
    >
      <circle cx="10.5" cy="10.5" r="6.5" stroke="#7fe5ff" strokeWidth="1.8" />
      <line
        x1="15.5"
        y1="15.5"
        x2="21"
        y2="21"
        stroke="#7fe5ff"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

// Google Places Autocomplete prediction — the subset we render.
interface PlacePrediction {
  placeId: string;
  description: string;
  main: string;
  secondary: string;
}

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
  const [placePreds, setPlacePreds] = useState<PlacePrediction[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  // Lazy-initialized Google AutocompleteService + session token.
  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(null);
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  // Click-outside to close suggestion panel.
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Google Places Autocomplete — debounced address predictions biased to WA.
  useEffect(() => {
    const t = term.trim();
    if (t.length < 3) {
      setPlacePreds([]);
      return;
    }
    const handle = window.setTimeout(() => {
      const g = (window as any).google;
      if (!g?.maps?.places) {
        // Places lib not loaded yet — silently skip; user can still press Enter to geocode.
        return;
      }
      if (!sessionTokenRef.current) {
        sessionTokenRef.current = new g.maps.places.AutocompleteSessionToken();
      }
      const bounds = new google.maps.LatLngBounds(
        { lat: 45.5, lng: -124.8 },
        { lat: 49.0, lng: -116.9 },
      );

      function runLegacyAutocomplete(inputVal: string, mapsObj: any, boundary: google.maps.LatLngBounds) {
        if (!autocompleteRef.current) {
          autocompleteRef.current = new mapsObj.maps.places.AutocompleteService();
        }
        autocompleteRef.current!.getPlacePredictions(
          {
            input: inputVal,
            bounds: boundary,
            componentRestrictions: { country: "us" },
            sessionToken: sessionTokenRef.current!,
          },
          (preds, status) => {
            if (status !== google.maps.places.PlacesServiceStatus.OK || !preds) {
              setPlacePreds([]);
              return;
            }
            setPlacePreds(
              preds.slice(0, 5).map((p) => ({
                placeId: p.place_id,
                description: p.description,
                main: p.structured_formatting?.main_text ?? p.description,
                secondary: p.structured_formatting?.secondary_text ?? "",
              })),
            );
          },
        );
      }

      // Check if Places API (New) is available
      if (g.maps.places.AutocompleteSuggestion) {
        g.maps.places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: t,
          locationBias: bounds,
          includedRegionCodes: ["us"],
          sessionToken: sessionTokenRef.current,
        })
          .then((res: any) => {
            const suggestions = res.suggestions || [];
            setPlacePreds(
              suggestions
                .slice(0, 5)
                .map((s: any) => {
                  const p = s.placePrediction;
                  if (!p) return null;
                  const fullText = p.text?.text || "";
                  const mainText = p.mainText?.text || fullText;
                  const secText = p.secondaryText?.text || "";
                  return {
                    placeId: p.placeId,
                    description: fullText,
                    main: mainText,
                    secondary: secText,
                  };
                })
                .filter(Boolean) as PlacePrediction[]
            );
          })
          .catch((err: any) => {
            console.warn("Places API (New) failed, falling back to legacy:", err);
            runLegacyAutocomplete(t, g, bounds);
          });
      } else {
        runLegacyAutocomplete(t, g, bounds);
      }
    }, 200);
    return () => window.clearTimeout(handle);
  }, [term]);

  async function pickPlace(p: PlacePrediction) {
    setOpen(false);
    setError(null);
    setTerm(p.description);
    navigate("/");
    window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "filters" } }));
    // Geocode the place_id to get lat/lng (cheaper than PlacesService.getDetails).
    const g = (window as unknown as { google?: { maps?: { Geocoder?: new () => google.maps.Geocoder } } }).google;
    if (!g?.maps?.Geocoder) return;
    const geocoder = new g.maps.Geocoder();
    geocoder.geocode({ placeId: p.placeId }, (results, status) => {
      if (status === "OK" && results && results[0]) {
        const loc = results[0].geometry.location;
        focusLatLng(loc.lat(), loc.lng(), p.description);
      }
      // Reset session token after a pick — starts a new billing session.
      sessionTokenRef.current = null;
    });
  }

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
    window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "filters" } }));
    focusJob(job.jobId);
  }

  function pickMarkup(m: MarkupSearchEntry) {
    setOpen(false);
    setError(null);
    setTerm(m.label);
    navigate("/");
    window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "filters" } }));
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
      window.dispatchEvent(new CustomEvent("nsc:request-tab", { detail: { tab: "filters" } }));
      focusLatLng(hit.lat, hit.lng, hit.label);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="search-wrap" ref={wrapRef}>
      <form className="search-form search-form--neon" onSubmit={onSubmit} role="search">
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
        <button
          type="submit"
          className="search-form__submit search-form__submit--icon"
          disabled={busy}
          aria-label="Search"
          title="Search"
        >
          {busy ? "…" : <NeonMagnifier />}
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

          {placePreds.length > 0 && (
            <>
              <div className="search-suggest__heading">ADDRESSES</div>
              <ul className="search-suggest__list">
                {placePreds.map((p) => (
                  <li key={p.placeId}>
                    <button
                      type="button"
                      className="search-suggest__row search-suggest__row--place"
                      onClick={() => void pickPlace(p)}
                    >
                      <span className="search-suggest__wo">{p.main}</span>
                      <span className="search-suggest__addr">{p.secondary}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {suggestions.length === 0 && markupSuggestions.length === 0 && placePreds.length === 0 && !error && term.trim().length > 0 && (
            <div className="search-suggest__hint">
              No match yet — press <kbd>Enter</kbd> to search this as an address.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
