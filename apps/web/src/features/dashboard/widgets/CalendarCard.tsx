// Calendar card — a 7-day week strip (Mon–Sun) with a crew-count badge per
// day. Selecting a day lists the crews scheduled that day as
// `crew name • job ID • address` (deduped by crew in useDashboardData). Today
// is highlighted neon blue; tapping any day jumps to the full Calendar tab.
// The last-selected day is remembered in localStorage (UI preference only).

import { useEffect, useMemo, useState } from "react";
import type { WeekSchedule } from "../hooks/useDashboardData.js";
import Bezel from "../components/Bezel.js";

const MAX_DOTS = 4;

export interface CalendarCardProps {
  weekStart: string; // Monday, YYYY-MM-DD
  weekSchedule: WeekSchedule;
  loading: boolean;
  onOpenCalendar: () => void;
}

const LS_KEY = "nsc.dash.calDay";
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default function CalendarCard({
  weekStart,
  weekSchedule,
  loading,
  onOpenCalendar,
}: CalendarCardProps) {
  const days = useMemo(
    () => DAY_LABELS.map((label, i) => ({ label, iso: addDays(weekStart, i) })),
    [weekStart]
  );
  const today = todayIso();

  const [selected, setSelected] = useState<string>(() => {
    try {
      const stored = localStorage.getItem(LS_KEY);
      if (stored) return stored;
    } catch {
      /* ignore */
    }
    return today;
  });

  // Keep the selected day inside the displayed week.
  useEffect(() => {
    if (!days.some((d) => d.iso === selected)) {
      const fallback = days.some((d) => d.iso === today) ? today : days[0].iso;
      setSelected(fallback);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart]);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, selected);
    } catch {
      /* ignore */
    }
  }, [selected]);

  const selectedCrews = weekSchedule[selected]?.crews ?? [];

  return (
    <Bezel className="card calendar-card">
      <div className="card__header">
        <h2 className="card__title">Calendar</h2>
        <button
          type="button"
          className="calendar-card__open"
          onClick={onOpenCalendar}
        >
          Open
        </button>
      </div>

      <div className="calendar-card__week" role="row">
        {days.map((d) => {
          const count = weekSchedule[d.iso]?.crewCount ?? 0;
          const dayNum = Number(d.iso.slice(8, 10));
          const dots = Math.min(count, MAX_DOTS);
          return (
            <button
              type="button"
              key={d.iso}
              className={`calendar-card__day${d.iso === today ? " calendar-card__day--today" : ""}${
                d.iso === selected ? " calendar-card__day--selected" : ""
              }`}
              aria-label={`${d.label} ${dayNum}, ${count} crews`}
              aria-pressed={d.iso === selected}
              onClick={() => setSelected(d.iso)}
            >
              <span className="calendar-card__dow">{d.label}</span>
              <span className="calendar-card__date">{dayNum}</span>
              <span className="calendar-card__dots" aria-hidden>
                {count === 0 ? (
                  <span className="calendar-card__dots-empty" />
                ) : (
                  <>
                    {Array.from({ length: dots }).map((_, i) => (
                      <span className="calendar-card__dot" key={i} />
                    ))}
                    {count > MAX_DOTS && (
                      <span className="calendar-card__dots-more">
                        +{count - MAX_DOTS}
                      </span>
                    )}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="dash-skel dash-skel--list" aria-hidden />
      ) : selectedCrews.length === 0 ? (
        <p className="calendar-card__empty">No crews scheduled this day.</p>
      ) : (
        <ul className="calendar-card__crews">
          {selectedCrews.map((c) => (
            <li className="calendar-card__crew" key={`${c.name}-${c.jobId}`}>
              <span className="calendar-card__crew-name">{c.name}</span>
              <span className="calendar-card__crew-meta">
                {c.jobId}
                {c.address ? ` • ${c.address}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Bezel>
  );
}
