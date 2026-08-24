import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFileExcel,
  faRotate,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import { ROLES, normalizeRole, roleShortLabel } from "../../roles";
import { API_BASE_URL } from "../../config";
import "./DailyActivityReport.css";

const today = () => new Date().toISOString().slice(0, 10);
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const mins = (n) => {
  const v = Number(n) || 0;
  if (v < 60) return `${v}m`;
  return `${Math.floor(v / 60)}h ${v % 60}m`;
};

// Per-person, per-day activity: when they started and stopped, how much of the
// day showed real activity, what they produced, and their own account of it.
//
// "Active" counts five-minute slices in which something actually happened, so
// it answers a question that login and logout times cannot.
function DailyActivityReport() {
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [expanded, setExpanded] = useState(null);

  const isAdmin = normalizeRole(sessionStorage.getItem("userRole")) === ROLES.ADMIN;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/reports/daily-activity`,
        { params: { from, to } }
      );
      setRows(res.data?.rows || []);
      setError(null);
    } catch (err) {
      setError(
        err.response?.data?.error || "Could not load the activity report."
      );
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    load();
  }, [load]);

  const download = async () => {
    setDownloading(true);
    try {
      const res = await axios.get(
        `${API_BASE_URL}/api/reports/daily-activity.xlsx`,
        { params: { from, to }, responseType: "blob" }
      );
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `daily-activity_${from}_to_${to}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError("Could not download the spreadsheet.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="dar">
      <header className="dar-head">
        <div>
          <h2>Employee daily activity</h2>
          <p>
            Minutes with real activity, what each person produced, and their own
            daily report. Idle time in an open tab is not counted.
          </p>
        </div>
        <div className="dar-controls">
          <label>
            From
            <input
              type="date"
              value={from}
              max={today()}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            To
            <input
              type="date"
              value={to}
              max={today()}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
          <button type="button" className="dar-btn" onClick={load} title="Refresh">
            <FontAwesomeIcon icon={faRotate} />
          </button>
          {isAdmin && (
            <button
              type="button"
              className="dar-btn dar-btn-excel"
              onClick={download}
              disabled={downloading}
            >
              <FontAwesomeIcon icon={faFileExcel} />
              <span>{downloading ? "Preparing…" : "Download Excel"}</span>
            </button>
          )}
        </div>
      </header>

      <div className="dar-quick">
        <button type="button" onClick={() => { setFrom(today()); setTo(today()); }}>
          Today
        </button>
        <button type="button" onClick={() => { setFrom(daysAgo(6)); setTo(today()); }}>
          Last 7 days
        </button>
        <button type="button" onClick={() => { setFrom(daysAgo(29)); setTo(today()); }}>
          Last 30 days
        </button>
      </div>

      {error && (
        <p className="dar-error">
          <FontAwesomeIcon icon={faTriangleExclamation} /> {error}
        </p>
      )}

      {loading ? (
        <p className="dar-empty">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="dar-empty">No activity in this period.</p>
      ) : (
        <div className="dar-table-wrap">
          <table className="dar-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Employee</th>
                <th>First</th>
                <th>Last</th>
                <th>Active</th>
                <th>Actions</th>
                <th>Leads</th>
                <th>Notes</th>
                <th>Daily report</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${r.day}-${r.user_id}`;
                const isOpen = expanded === key;
                return (
                  <tr
                    key={key}
                    className={r.worklog_submitted ? "" : "dar-missing"}
                  >
                    <td>{r.day}</td>
                    <td>
                      <strong>{r.name}</strong>
                      <span className="dar-role">{roleShortLabel(r.role)}</span>
                    </td>
                    <td>{r.first_action || "—"}</td>
                    <td>{r.last_action || "—"}</td>
                    <td>
                      <span className="dar-mins">{mins(r.active_minutes)}</span>
                    </td>
                    <td>{r.actions}</td>
                    <td>
                      {r.leads_created}
                      {r.leads_updated ? ` / ${r.leads_updated}` : ""}
                    </td>
                    <td>{r.notes_added}</td>
                    <td className="dar-worklog">
                      {r.worklog_submitted ? (
                        <button
                          type="button"
                          className="dar-worklog-toggle"
                          onClick={() => setExpanded(isOpen ? null : key)}
                        >
                          {isOpen
                            ? r.worklog
                            : `${String(r.worklog).slice(0, 70)}${
                                String(r.worklog).length > 70 ? "…" : ""
                              }`}
                          {r.worklog_hours != null && (
                            <span className="dar-hours">
                              {r.worklog_hours}h
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="dar-none">Not submitted</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export default DailyActivityReport;
