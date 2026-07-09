// CalendarTab — Lumen-style scheduling grid for the left rail.
//
// Visual reference: Lumen Scheduling Calendar PDF + the v4 Space Grotesk
// light/royal-blue mockup we agreed on. Everything renders against the
// app's brushed-steel/royal-blue theme tokens.
//
// Layout:
//   ┌─────────────────────────────────────────────────────────────┐
//   │ CALENDAR · Lumen Scheduling   [MY JOBS|ALL SUPERVISORS] ◀ Wk│
//   ├──────┬─────┬─────┬─────┬─────┬─────┐
//   │ Crew │ Mon │ Tue │ Wed │ Thu │ Fri │
//   ├──────┼─────┴─────┼─────┼─────┼─────┤
//   │ ▓▓▓▓ │  ●─event─bar──────●          │   (multi-day bar)
//   │      │           │ event│           │   (single-day card)
//   └──────┴───────────┴──────┴───────────┘
//
// Multi-day jobs render as a single bar spanning multiple day columns; jobs
// with overlapping spans in the same crew row stack vertically into slots.
//
// Data source: GET /api/lumina/smartsheet/calendar?weekStart=YYYY-MM-DD&scope=
// (mine|all). Returns Schedule Date / End Date driven events with attachment
// counts. Refetches whenever week or scope changes.

import { useEffect, useMemo, useState, useCallback } from "react";
import { api, type CalendarEvent, type CalendarPayload } from "../../lib/api.js";
import { useActiveContract } from "../workspace/contractStore.js";

// ── Theme tokens (mirrored from styles/theme.css for inline use) ──────────
const ROYAL       = "#1565C0";   // crew label + active tab accent
const BORDER      = "#8e96a0";
const BORDER_LITE = "#a8b0ba";
const PAGE_BG     = "#b9c0c8";
const PANEL_BG    = "#d8dde4";
const CELL_BG     = "#e8ecf1";
const CARD_BG     = "#ffffff";
const TEXT_HI     = "#15202c";
const TEXT_MD     = "#3a4654";
const TEXT_LO     = "#5b6776";
const ACCENT_CY   = "#1ea7ff";
const CHIP_BG     = "#1ea7ff";

// ── Helpers ───────────────────────────────────────────────────────────────

/** Return the Monday (in user's local time) of the week containing `d`. */
function mondayOf(d: Date): Date {
  const out = new Date(d);
  // JS: 0=Sun,1=Mon,...,6=Sat. Move back to Monday.
  const dow = out.getDay();
  const delta = dow === 0 ? -6 : 1 - dow;
  out.setDate(out.getDate() + delta);
  out.setHours(0, 0, 0, 0);
  return out;
}

function isoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function fmtDayShort(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "long" });
}

function fmtDayDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function fmtRange(start: Date, end: Date): string {
  const sf = start.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
  const ef = end.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  return `${sf} – ${ef}`;
}

function parseIso(s: string): Date {
  // Treat ISO yyyy-MM-dd as a local date (no tz drift).
  const [y, m, d] = s.split("-").map((n) => parseInt(n, 10));
  return new Date(y, m - 1, d);
}

/** True if hex color is perceptually light (so we should use dark text on it). */
function isLight(hex: string): boolean {
  const h = hex.replace("#", "");
  if (h.length !== 6) return false;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/** Group events by their displayed crew label, preserving first-seen order. */
function groupByCrew(events: CalendarEvent[]): Map<string, CalendarEvent[]> {
  const out = new Map<string, CalendarEvent[]>();
  for (const e of events) {
    const arr = out.get(e.crew) ?? [];
    arr.push(e);
    out.set(e.crew, arr);
  }
  return out;
}

/**
 * Compute the day-column placement of an event clamped to the visible 5-day
 * window. Returns null if the event sits entirely outside the window.
 *
 * Output:
 *   startCol   inclusive 0..4
 *   endCol     inclusive 0..4 (== startCol for single-day jobs)
 *   overflowL  true when the real event started before Monday (draw a left arrow)
 *   overflowR  true when the real event ends after Friday  (draw a right arrow)
 */
function placement(
  e: CalendarEvent,
  weekStart: Date,
  weekEnd: Date
): { startCol: number; endCol: number; overflowL: boolean; overflowR: boolean } | null {
  const evStart = parseIso(e.scheduleDate);
  const evEnd = parseIso(e.endDate);
  if (evEnd < weekStart) return null;
  if (evStart > weekEnd) return null;

  const startCol = evStart < weekStart ? 0 : Math.round((evStart.getTime() - weekStart.getTime()) / 86400000);
  const endCol = evEnd > weekEnd ? 4 : Math.round((evEnd.getTime() - weekStart.getTime()) / 86400000);
  return {
    startCol: Math.max(0, Math.min(4, startCol)),
    endCol: Math.max(0, Math.min(4, endCol)),
    overflowL: evStart < weekStart,
    overflowR: evEnd > weekEnd,
  };
}

/** Slot allocator: stacks overlapping cards vertically per crew row. */
function allocateSlots(
  events: CalendarEvent[],
  weekStart: Date,
  weekEnd: Date
): Array<{ event: CalendarEvent; startCol: number; endCol: number; slot: number; overflowL: boolean; overflowR: boolean }> {
  // Stable order: by start date, then WO.
  const sorted = [...events].sort((a, b) =>
    a.scheduleDate !== b.scheduleDate
      ? a.scheduleDate.localeCompare(b.scheduleDate)
      : a.workOrder.localeCompare(b.workOrder)
  );
  // used[slot][col] = true
  const used: boolean[][] = [];
  const out: Array<{ event: CalendarEvent; startCol: number; endCol: number; slot: number; overflowL: boolean; overflowR: boolean }> = [];
  for (const ev of sorted) {
    const p = placement(ev, weekStart, weekEnd);
    if (!p) continue;
    let slot = 0;
    // find first slot whose cols [startCol..endCol] are free
    while (true) {
      while (used.length <= slot) used.push([false, false, false, false, false]);
      let free = true;
      for (let c = p.startCol; c <= p.endCol; c++) {
        if (used[slot][c]) { free = false; break; }
      }
      if (free) {
        for (let c = p.startCol; c <= p.endCol; c++) used[slot][c] = true;
        break;
      }
      slot++;
    }
    out.push({ event: ev, slot, ...p });
  }
  return out;
}

// ── Component ─────────────────────────────────────────────────────────────

type Scope = "mine" | "all";

export function CalendarTab() {
  const { contract } = useActiveContract();
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(new Date()));
  const [scope, setScope] = useState<Scope>("mine");
  const [payload, setPayload] = useState<CalendarPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<number | null>(null);
  // Bumped by the nsc:calendar-changed event after Lumina applies a
  // reschedule. Increment forces the fetch effect below to re-run.
  const [refreshTick, setRefreshTick] = useState(0);

  const weekEnd = useMemo(() => addDays(weekStart, 4), [weekStart]);
  const weekStartIso = useMemo(() => isoDate(weekStart), [weekStart]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getCalendar(weekStartIso, scope)
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [weekStartIso, scope, refreshTick]);

  // Refetch when Lumina applies a reschedule (or any Smartsheet write that
  // touches schedule columns). Cheap — the server-side cache is shared with
  // /calendar, so a near-immediate refetch is fine.
  useEffect(() => {
    function onChange() {
      setRefreshTick((t) => t + 1);
    }
    window.addEventListener("nsc:calendar-changed", onChange);
    return () => window.removeEventListener("nsc:calendar-changed", onChange);
  }, []);

  const events = payload?.events ?? [];
  const crews = useMemo(() => Array.from(groupByCrew(events).keys()), [events]);
  const eventsByCrew = useMemo(() => groupByCrew(events), [events]);

  const onPrevWeek = useCallback(() => setWeekStart((d) => addDays(d, -7)), []);
  const onNextWeek = useCallback(() => setWeekStart((d) => addDays(d, 7)), []);
  const onToday    = useCallback(() => setWeekStart(mondayOf(new Date())), []);

  const selectedEvent = useMemo(() => {
    if (!selectedRowId) return null;
    return events.find((e) => e.rowId === selectedRowId) ?? null;
  }, [events, selectedRowId]);

  const handleSaveSchedule = useCallback(async (updates: { scheduleDate: string | null; endDate: string | null; constructionCrewForeman: string | null }) => {
    if (!selectedEvent) return;
    // We pass the workOrder as the ID since it is known, and the backend route will handle it.
    await api.updateJobSchedule(selectedEvent.workOrder, updates);
    
    // Optimistic local update or just trigger a refetch
    setRefreshTick((t) => t + 1);
  }, [selectedEvent]);

  return (
    <div className="cal-tab" style={{ "--cal-accent": contract === "Ziply" ? "var(--ziply, #00b248)" : ROYAL } as React.CSSProperties}>
      {/* ── Header: title, scope toggle, week nav ───────────────────────── */}
      <div className="cal-header">
        <div className="cal-title-row">
          <span className="cal-title">CALENDAR</span>
          <span className="cal-subtitle">· {contract === "Ziply" ? "Ziply Crew Schedule" : "Lumen Scheduling"}</span>
        </div>

        <div className="cal-controls">
          <div className="cal-scope-pill">
            <button
              className={`cal-scope-btn ${scope === "mine" ? "active" : ""}`}
              onClick={() => setScope("mine")}
              title="Show only my jobs (Billy Keesee)"
            >
              MY JOBS
            </button>
            <button
              className={`cal-scope-btn ${scope === "all" ? "active" : ""}`}
              onClick={() => setScope("all")}
              title="Show all supervisors color-coded"
            >
              ALL SUPERVISORS
            </button>
          </div>

          <div className="cal-week-nav">
            <button className="cal-nav-btn" onClick={onPrevWeek} title="Previous week">‹</button>
            <button className="cal-today-btn" onClick={onToday} title="Jump to this week">TODAY</button>
            <span className="cal-week-range">{fmtRange(weekStart, weekEnd)}</span>
            <button className="cal-nav-btn" onClick={onNextWeek} title="Next week">›</button>
          </div>
        </div>
      </div>

      {/* ── Loading / error overlay ─────────────────────────────────────── */}
      {loading && <div className="cal-loading">Loading schedule…</div>}
      {error && <div className="cal-error">Couldn’t load calendar: {error}</div>}

      {/* ── The grid ────────────────────────────────────────────────────── */}
      {!loading && !error && (
        <div className="cal-grid-wrap">
          <div className="cal-grid">
            {/* Day-header row */}
            <div className="cal-day-header cal-crew-header">
              <div className="cal-crew-header-line">Construction</div>
              <div className="cal-crew-header-line">Crew / Forman</div>
            </div>
            {[0, 1, 2, 3, 4].map((i) => {
              const d = addDays(weekStart, i);
              return (
                <div key={i} className="cal-day-header">
                  <div className="cal-day-name">{fmtDayShort(d)}</div>
                  <div className="cal-day-date">{fmtDayDate(d)}</div>
                </div>
              );
            })}

            {/* Crew rows */}
            {crews.length === 0 && (
              <div className="cal-empty">
                No jobs scheduled this week
                {scope === "mine" ? " for you." : "."}
              </div>
            )}
            {crews.map((crew) => {
              const crewEvents = eventsByCrew.get(crew) ?? [];
              const placed = allocateSlots(crewEvents, weekStart, weekEnd);
              const maxSlot = placed.reduce((m, p) => Math.max(m, p.slot), 0);
              const rowHeight = Math.max(110, (maxSlot + 1) * 96 + 16);

              return (
                <CrewRow
                  key={crew}
                  crew={crew}
                  height={rowHeight}
                  placed={placed}
                  selectedRowId={selectedRowId}
                  onSelect={setSelectedRowId}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Footer / legend ─────────────────────────────────────────────── */}
      <div className="cal-footer">
        <span>Source: 2023-2028 Western WA Project Tracker</span>
        <span className="cal-dot">·</span>
        <span>Color bar = supervisor</span>
        <span className="cal-dot">·</span>
        <span>
          <span className="cal-chip-inline">{0}</span> = Smartsheet attachments
        </span>
        <span className="cal-dot">·</span>
        <span>Tap card to view details</span>
        {payload && payload.cachedSeconds > 0 && (
          <>
            <span className="cal-dot">·</span>
            <span className="cal-cache">cached {payload.cachedSeconds}s</span>
          </>
        )}
      </div>

      {selectedEvent && (
        <EventPopup
          event={selectedEvent}
          onClose={() => setSelectedRowId(null)}
          onSave={handleSaveSchedule}
        />
      )}
    </div>
  );
}

// ── Crew row sub-component ────────────────────────────────────────────────

interface CrewRowProps {
  crew: string;
  height: number;
  placed: Array<{ event: CalendarEvent; startCol: number; endCol: number; slot: number; overflowL: boolean; overflowR: boolean }>;
  selectedRowId: number | null;
  onSelect: (rowId: number | null) => void;
}

function CrewRow({ crew, height, placed, selectedRowId, onSelect }: CrewRowProps) {
  return (
    <>
      <div className="cal-crew-label" style={{ height }}>
        <span>{crew}</span>
      </div>
      <div className="cal-row-cells" style={{ height }}>
        {[0, 1, 2, 3, 4].map((c) => (
          <div key={c} className="cal-row-cell" />
        ))}
        {placed.map(({ event, startCol, endCol, slot, overflowL, overflowR }) => {
          const left = `calc(${startCol} * (100% / 5) + 4px)`;
          const width = `calc(${(endCol - startCol + 1)} * (100% / 5) - 8px)`;
          const top = 6 + slot * 92;
          return (
            <EventCard
              key={event.rowId}
              event={event}
              left={left}
              width={width}
              top={top}
              overflowL={overflowL}
              overflowR={overflowR}
              selected={selectedRowId === event.rowId}
              onSelect={onSelect}
            />
          );
        })}
      </div>
    </>
  );
}

// ── Event card sub-component ──────────────────────────────────────────────

interface EventCardProps {
  event: CalendarEvent;
  left: string;
  width: string;
  top: number;
  overflowL: boolean;
  overflowR: boolean;
  selected: boolean;
  onSelect: (rowId: number | null) => void;
}

function EventCard({ event, left, width, top, overflowL, overflowR, selected, onSelect }: EventCardProps) {
  const e = event;
  const dateStr = e.scheduleDate === e.endDate
    ? parseIso(e.scheduleDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })
    : `${parseIso(e.scheduleDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit" })} → ${parseIso(e.endDate).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}`;

  const barTextColor = isLight(e.supervisorColor) ? "#000" : "#fff";
  const titleParts: string[] = [];
  if (e.bidMaster) titleParts.push(`BM $${e.bidMaster}`);
  if (e.base) titleParts.push(e.base);
  if (e.city) titleParts.push(e.city);

  return (
    <button
      type="button"
      className={`cal-event ${selected ? "selected" : ""}`}
      style={{ left, width, top: `${top}px` }}
      onClick={() => onSelect(selected ? null : e.rowId)}
      title={`${e.workOrder} — ${e.supervisor}\n${e.address}\nClick for details`}
    >
      <div
        className="cal-event-bar"
        style={{ background: e.supervisorColor, color: barTextColor }}
      >
        <span className="cal-event-wo">{e.workOrder || "(no WO)"}</span>
        {overflowL && <span className="cal-event-overflow" style={{ left: -10 }}>◄</span>}
        {overflowR && <span className="cal-event-overflow" style={{ right: -10 }}>►</span>}
      </div>
      <div className="cal-event-body">
        <div className="cal-event-line1">
          <span className="cal-event-sup">{e.supervisor}</span>
          {e.address && <span> · {e.address}</span>}
        </div>
        {titleParts.length > 0 && (
          <div className="cal-event-meta">{titleParts.join(" · ")}</div>
        )}
        <div className="cal-event-date">{dateStr}</div>
      </div>
      {e.attachmentCount > 0 && (
        <span className="cal-chip" title={`${e.attachmentCount} attachment${e.attachmentCount === 1 ? "" : "s"} in Smartsheet`}>
          {e.attachmentCount}
        </span>
      )}
    </button>
  );
}

// ── Event Popup sub-component ─────────────────────────────────────────────

interface EventPopupProps {
  event: CalendarEvent;
  onClose: () => void;
  onSave: (updates: { scheduleDate: string | null; endDate: string | null; constructionCrewForeman: string | null }) => Promise<void>;
}

function EventPopup({ event, onClose, onSave }: EventPopupProps) {
  const [scheduleDate, setScheduleDate] = useState(event.scheduleDate || "");
  const [endDate, setEndDate] = useState(event.endDate || "");
  const [crew, setCrew] = useState(event.crew || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await onSave({
        scheduleDate: scheduleDate || null,
        endDate: endDate || null,
        constructionCrewForeman: crew || null
      });
      onClose();
    } catch (err: any) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="cal-popup-overlay" onClick={onClose}>
      <div className="cal-popup" onClick={(e) => e.stopPropagation()}>
        <div className="cal-popup-header">
          <h3>Edit Schedule: {event.workOrder}</h3>
          <button type="button" onClick={onClose}>×</button>
        </div>
        <form onSubmit={handleSubmit} className="cal-popup-body">
          {error && <div className="cal-error">{error}</div>}
          
          <label>
            Start Date:
            <input type="date" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
          </label>
          <label>
            End Date:
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label>
            Crew / Foreman:
            <input type="text" value={crew} onChange={(e) => setCrew(e.target.value)} />
          </label>
          
          <div className="cal-popup-footer">
            <button type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" disabled={saving}>{saving ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
// Co-located so the tab is self-contained. Selectors are .cal-* prefixed
// to avoid bleed into LeftRail's global styles.

const _styles = `
.cal-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: ${PAGE_BG};
  color: ${TEXT_HI};
  font-family: "Space Grotesk", system-ui, -apple-system, sans-serif;
  font-weight: 700;
  overflow: hidden;
}
/* Override global body text-transform: uppercase from global.css so addresses,
   names, and dates render in their natural case. */
.cal-tab,
.cal-tab * {
  text-transform: none;
  letter-spacing: normal;
}
.cal-tab .cal-title,
.cal-tab .cal-day-name,
.cal-tab .cal-scope-btn,
.cal-tab .cal-event-wo,
.cal-tab .cal-today-btn,
.cal-tab .cal-crew-label,
.cal-tab .cal-crew-header-line {
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.cal-header {
  padding: 10px 12px 8px;
  background: ${PANEL_BG};
  border-bottom: 1px solid ${BORDER};
  flex: 0 0 auto;
}

.cal-title-row { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.cal-title { font-size: 16px; letter-spacing: 0.04em; color: ${TEXT_HI}; }
.cal-subtitle { font-size: 11px; color: ${TEXT_LO}; font-weight: 500; }

.cal-controls {
  display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: space-between;
}

.cal-scope-pill {
  display: inline-flex; background: ${CARD_BG}; border: 1px solid ${BORDER_LITE};
  border-radius: 999px; padding: 2px; gap: 0; overflow: hidden;
}
.cal-scope-btn {
  border: none; background: transparent; color: ${TEXT_MD};
  font-family: inherit; font-weight: 700; font-size: 10px;
  letter-spacing: 0.05em; padding: 5px 12px; border-radius: 999px;
  cursor: pointer; transition: background 0.15s;
}
.cal-scope-btn.active { background: ${ACCENT_CY}; color: #000; }
.cal-scope-btn:hover:not(.active) { background: ${CELL_BG}; }

.cal-week-nav { display: inline-flex; gap: 4px; align-items: center; }
.cal-nav-btn {
  background: ${CARD_BG}; border: 1px solid ${BORDER_LITE};
  color: ${TEXT_HI}; font-family: inherit; font-weight: 700;
  font-size: 14px; line-height: 1; padding: 4px 10px;
  border-radius: 4px; cursor: pointer;
}
.cal-nav-btn:hover { background: #cfe8ff; }
.cal-today-btn {
  background: ${CARD_BG}; border: 1px solid ${BORDER_LITE};
  color: ${TEXT_HI}; font-family: inherit; font-weight: 700;
  font-size: 10px; letter-spacing: 0.05em; padding: 5px 10px;
  border-radius: 4px; cursor: pointer;
}
.cal-today-btn:hover { background: #cfe8ff; }
.cal-week-range { font-size: 11px; color: ${TEXT_HI}; padding: 0 4px; }

.cal-loading, .cal-error, .cal-empty {
  padding: 18px; text-align: center; color: ${TEXT_LO}; font-size: 12px;
}
.cal-error { color: #b32d2d; }
.cal-empty { grid-column: 1 / -1; padding: 24px; color: ${TEXT_LO}; }

.cal-grid-wrap { flex: 1 1 auto; overflow: auto; padding: 0; }

.cal-grid {
  display: grid;
  grid-template-columns: 110px repeat(5, 1fr);
  background: ${PAGE_BG};
  min-width: 700px;
}

.cal-day-header {
  background: ${PANEL_BG};
  padding: 8px 10px;
  border-right: 1px solid ${BORDER};
  border-bottom: 1px solid ${BORDER};
  position: sticky; top: 0; z-index: 2;
}
.cal-crew-header { background: ${PANEL_BG}; }
.cal-crew-header-line { font-size: 10px; color: ${TEXT_HI}; line-height: 1.3; }
.cal-day-name { font-size: 12px; color: ${TEXT_HI}; letter-spacing: 0.02em; }
.cal-day-date { font-size: 10px; color: ${TEXT_MD}; font-weight: 500; }

.cal-crew-label {
  grid-column: 1;
  background: var(--cal-accent, ${ROYAL});
  color: #f4f8ff;
  display: flex; align-items: flex-start;
  padding: 12px 10px;
  border-right: 1px solid ${BORDER};
  border-bottom: 1px solid ${BORDER};
  font-size: 11px;
  letter-spacing: 0.03em;
  overflow: hidden;
}
.cal-crew-label span {
  word-break: break-word;
  line-height: 1.25;
}

.cal-row-cells {
  grid-column: 2 / -1;
  position: relative;
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  border-bottom: 1px solid ${BORDER};
}
.cal-row-cell {
  background: ${CELL_BG};
  border-right: 1px solid ${BORDER};
}

.cal-event {
  position: absolute;
  background: ${CARD_BG};
  border: 1px solid ${BORDER_LITE};
  border-radius: 6px;
  padding: 0;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  height: 84px;
  overflow: hidden;
  transition: transform 0.1s, box-shadow 0.1s;
  display: flex; flex-direction: column;
}
.cal-event:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 10px rgba(0,0,0,0.12);
  z-index: 3;
}
.cal-event.selected {
  border-color: var(--cal-accent, ${ROYAL});
  box-shadow: 0 0 0 2px ${ACCENT_CY};
  z-index: 4;
}

.cal-event-bar {
  position: relative;
  padding: 4px 8px;
  font-size: 12px;
  letter-spacing: 0.02em;
  flex: 0 0 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.cal-event-wo { font-weight: 700; }
.cal-event-overflow {
  position: absolute; top: 50%; transform: translateY(-50%);
  font-size: 14px; line-height: 1;
}

.cal-event-body {
  padding: 6px 8px 4px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  display: flex; flex-direction: column; gap: 2px;
}
.cal-event-line1 {
  font-size: 10px; color: ${TEXT_HI};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cal-event-sup { color: ${TEXT_HI}; }
.cal-event-meta {
  font-size: 9px; color: ${TEXT_MD}; font-weight: 500;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cal-event-date { font-size: 9px; color: ${TEXT_LO}; font-weight: 500; margin-top: auto; }

.cal-chip, .cal-chip-inline {
  display: inline-flex; align-items: center; justify-content: center;
  background: ${CHIP_BG}; color: #000;
  width: 16px; height: 16px;
  border-radius: 50%;
  font-size: 9px; font-weight: 700;
}
.cal-chip {
  position: absolute; left: 6px; bottom: 6px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.2);
}

.cal-footer {
  background: ${PANEL_BG};
  border-top: 1px solid ${BORDER};
  padding: 6px 12px;
  font-size: 9px; color: ${TEXT_LO}; font-weight: 500;
  display: flex; flex-wrap: wrap; gap: 4px; align-items: center;
  flex: 0 0 auto;
}
.cal-footer .cal-dot { color: ${BORDER}; }
.cal-cache { color: ${TEXT_MD}; }

.cal-popup-overlay {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex; align-items: center; justify-content: center;
  z-index: 100;
}
.cal-popup {
  background: ${CARD_BG}; border: 1px solid ${BORDER};
  border-radius: 8px; width: 320px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
  display: flex; flex-direction: column;
}
.cal-popup-header {
  padding: 12px 16px; border-bottom: 1px solid ${BORDER_LITE};
  display: flex; align-items: center; justify-content: space-between;
}
.cal-popup-header h3 { margin: 0; font-size: 14px; color: ${TEXT_HI}; }
.cal-popup-header button {
  background: none; border: none; font-size: 18px; cursor: pointer; color: ${TEXT_MD};
}
.cal-popup-body {
  padding: 16px; display: flex; flex-direction: column; gap: 12px;
}
.cal-popup-body label {
  display: flex; flex-direction: column; font-size: 12px; color: ${TEXT_MD}; gap: 4px;
}
.cal-popup-body input {
  padding: 6px 8px; border: 1px solid ${BORDER_LITE}; border-radius: 4px;
  font-family: inherit; font-size: 12px;
}
.cal-popup-footer {
  display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px;
}
.cal-popup-footer button {
  padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer;
  border: 1px solid ${BORDER_LITE}; background: ${CELL_BG}; color: ${TEXT_HI};
}
.cal-popup-footer button[type="submit"] {
  background: var(--cal-accent, ${ROYAL}); color: #fff; border: none;
}
.cal-popup-footer button:disabled { opacity: 0.6; pointer-events: none; }
`;

// Inject styles once.
if (typeof document !== "undefined" && !document.getElementById("cal-tab-styles")) {
  const tag = document.createElement("style");
  tag.id = "cal-tab-styles";
  tag.textContent = _styles;
  document.head.appendChild(tag);
}

export default CalendarTab;
