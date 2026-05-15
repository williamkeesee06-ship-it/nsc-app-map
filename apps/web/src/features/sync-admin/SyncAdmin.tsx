// Sync/Admin screen. Shows last sync run + manual "Resync now" trigger.
import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import type { SyncRun } from "@nsc/types";

export default function SyncAdmin() {
  const [last, setLast] = useState<SyncRun | null | "loading">("loading");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const { lastRun } = await api.syncStatus();
      setLast(lastRun);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const onResync = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.triggerSync();
      setLast(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="sync-admin">
      <div className="sync-admin__card">
        <h2>Smartsheet Sync</h2>
        <p className="muted">
          Pulls all rows where Construction Supervisor = Billy Keesee, normalizes
          them, geocodes the address, and stores the result in Firestore. Jobs
          stay in the system even if they later leave your tracker.
        </p>

        <button
          className="btn btn--primary"
          onClick={onResync}
          disabled={running}
        >
          {running ? "Syncing…" : "Resync now"}
        </button>

        {error && <div className="sync-admin__error">Error: {error}</div>}

        <div className="sync-admin__last">
          <h3>Last sync</h3>
          {last === "loading" ? (
            <div>Loading…</div>
          ) : last === null ? (
            <div className="muted">No syncs yet. Click "Resync now".</div>
          ) : (
            <table className="kv-table">
              <tbody>
                <tr>
                  <td>Status</td>
                  <td>
                    <span className={`status-pill status-${last.status}`}>
                      {last.status}
                    </span>
                  </td>
                </tr>
                <tr>
                  <td>Started</td>
                  <td>{new Date(last.startedAt).toLocaleString()}</td>
                </tr>
                <tr>
                  <td>Finished</td>
                  <td>
                    {last.finishedAt
                      ? new Date(last.finishedAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
                <tr>
                  <td>Sheet rows (total)</td>
                  <td>{last.sheetTotalRows}</td>
                </tr>
                <tr>
                  <td>Filtered (Billy)</td>
                  <td>{last.filteredRows}</td>
                </tr>
                <tr>
                  <td>Upserted</td>
                  <td>{last.upserted}</td>
                </tr>
                <tr>
                  <td>Flagged off-tracker</td>
                  <td>{last.flaggedOffTracker}</td>
                </tr>
                <tr>
                  <td>Geocoded (fresh)</td>
                  <td>{last.geocodedFresh}</td>
                </tr>
                <tr>
                  <td>Geocoded (cached)</td>
                  <td>{last.geocodedCached}</td>
                </tr>
                <tr>
                  <td>Geocode failed</td>
                  <td>{last.geocodeFailed}</td>
                </tr>
                {last.error && (
                  <tr>
                    <td>Error</td>
                    <td style={{ color: "var(--danger)" }}>{last.error}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
