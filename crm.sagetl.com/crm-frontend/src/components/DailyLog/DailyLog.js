import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faClipboardCheck,
  faCircleCheck,
  faCircleExclamation,
  faLock,
} from "@fortawesome/free-solid-svg-icons";
import { API_BASE_URL } from "../../config";
import "./DailyLog.css";

// "What did you do today" — one entry per person per day.
//
// Only today can be written. Past days are shown read-only and the server
// refuses to change them, so the log is a record rather than something that can
// be tidied up after the fact.
function DailyLog() {
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [body, setBody] = useState("");
  const [hours, setHours] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const load = useCallback(async () => {
    try {
      const [t, h] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/worklogs/today`),
        axios.get(`${API_BASE_URL}/api/worklogs/mine`),
      ]);
      setToday(t.data || null);
      setBody(t.data?.body || "");
      setHours(t.data?.hours == null ? "" : String(t.data.hours));
      setHistory(h.data || []);
      setError(null);
    } catch (err) {
      setError("Could not load your work log.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e) => {
    e.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await axios.post(`${API_BASE_URL}/api/worklogs`, {
        body: body.trim(),
        hours: hours === "" ? null : Number(hours),
      });
      setToday(res.data);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      load();
    } catch (err) {
      setError(
        err.response?.data?.error || "Could not save today's entry. Try again."
      );
    } finally {
      setSaving(false);
    }
  };

  const past = history.filter((h) => h.work_date !== today?.work_date);

  return (
    <div className="daily-log-page">
      <header className="daily-log-header">
        <span className="daily-log-icon">
          <FontAwesomeIcon icon={faClipboardCheck} />
        </span>
        <div>
          <h1>My daily work report</h1>
          <p>
            Record what you worked on today. Entries can only be written for the
            current day — once the day passes, it is locked.
          </p>
        </div>
      </header>

      {error && (
        <div className="daily-log-alert is-error" role="alert">
          <FontAwesomeIcon icon={faCircleExclamation} /> <span>{error}</span>
        </div>
      )}
      {saved && (
        <div className="daily-log-alert is-success" role="status">
          <FontAwesomeIcon icon={faCircleCheck} /> <span>Saved.</span>
        </div>
      )}

      <form className="daily-log-card" onSubmit={submit}>
        <div className="daily-log-card-head">
          <h2>{todayLabel}</h2>
          {today ? (
            <span className="daily-log-pill is-done">Submitted</span>
          ) : (
            <span className="daily-log-pill is-pending">Not submitted</span>
          )}
        </div>

        <label htmlFor="worklog-body">What did you work on today?</label>
        <textarea
          id="worklog-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={7}
          maxLength={5000}
          placeholder={
            "e.g. Called 14 leads from the Net New list, logged notes on 6.\n" +
            "Follow-up meeting with Omaxe. Prepared proposal for Vatika Group."
          }
          disabled={saving}
          required
        />
        <div className="daily-log-row">
          <div className="daily-log-hours">
            <label htmlFor="worklog-hours">Hours worked (optional)</label>
            <input
              id="worklog-hours"
              type="number"
              min="0"
              max="24"
              step="0.5"
              value={hours}
              onChange={(e) => setHours(e.target.value)}
              disabled={saving}
              placeholder="8"
            />
          </div>
          <button type="submit" disabled={saving || !body.trim()}>
            {saving ? "Saving…" : today ? "Update today's entry" : "Submit"}
          </button>
        </div>
        <p className="daily-log-note">
          You can keep editing today's entry until midnight. After that it can
          no longer be changed.
        </p>
      </form>

      <section className="daily-log-history">
        <h2>Previous days</h2>
        {past.length === 0 ? (
          <p className="daily-log-empty">No earlier entries yet.</p>
        ) : (
          past.map((entry) => (
            <article className="daily-log-past" key={entry.id}>
              <header>
                <strong>
                  {new Date(entry.work_date + "T00:00:00").toLocaleDateString(
                    undefined,
                    { weekday: "short", day: "numeric", month: "short" }
                  )}
                </strong>
                <span className="daily-log-locked">
                  <FontAwesomeIcon icon={faLock} /> locked
                  {entry.hours != null ? ` · ${entry.hours}h` : ""}
                </span>
              </header>
              <p>{entry.body}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

export default DailyLog;
