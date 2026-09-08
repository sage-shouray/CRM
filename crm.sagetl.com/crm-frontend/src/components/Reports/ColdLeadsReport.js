import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../config";
import { roleShortLabel } from "../../roles";
import { useLiveUpdates } from "../../liveUpdates";
import { formatDateTime } from "../../dateFormat";
import "./ColdLeadsReport.css";

const fmtDateTime = (v) => formatDateTime(v) || "—";

const STATE_LABEL = {
  hot: "Turned Hot",
  warm: "Turned Warm",
  returnedCold: "Returned (noted)",
  pendingNoNote: "Still out, no note",
};

// Who has pulled how many Cold leads, how many they converted, and — per
// person — the full history of what they pulled and what they wrote on each
// one. See GET /api/reports/cold-leads.
function ColdLeadsReport() {
  const [summary, setSummary] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async (userId) => {
    const isDetail = Boolean(userId);
    if (isDetail) setIsLoadingDetail(true);
    else setIsLoading(true);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/reports/cold-leads`, {
        params: userId ? { userId } : {},
      });
      setSummary(res.data?.users || []);
      setDetail(res.data?.detail || null);
      setError(null);
    } catch (err) {
      setError(
        err.response?.status === 403
          ? "This report is available to Admins and Managers only."
          : err.response?.data?.error || "Could not load the Cold Lead Pool report."
      );
    } finally {
      setIsLoading(false);
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    load(selectedUserId || null);
  }, [load, selectedUserId]);

  // Someone pulling, returning, or converting a Cold lead anywhere in the
  // system should show up here without the admin having to re-select a user
  // or reload the page.
  useLiveUpdates(["cold-leads", "leads"], () => load(selectedUserId || null));

  const selectedUser = summary.find((u) => String(u.id) === String(selectedUserId));

  return (
    <section className="rp-panel">
      <header className="rp-panel-head">
        <h2>Cold Lead Pool — who pulled what</h2>
        <label className="rp-filter">
          User:
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
          >
            <option value="">All users</option>
            {summary.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {roleShortLabel(u.role)}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error ? (
        <p className="rp-empty">{error}</p>
      ) : isLoading ? (
        <p className="rp-empty">Loading…</p>
      ) : summary.length === 0 ? (
        <p className="rp-empty">No users in scope.</p>
      ) : (
        <table className="rp-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Total Pulled</th>
              <th>Turned Hot</th>
              <th>Turned Warm</th>
              <th>Returned (noted)</th>
              <th>Pending / No Note</th>
              <th>Last Pull</th>
            </tr>
          </thead>
          <tbody>
            {summary
              .filter((u) => !selectedUserId || String(u.id) === String(selectedUserId))
              .map((u) => (
                <tr
                  key={u.id}
                  className={String(u.id) === String(selectedUserId) ? "is-selected" : ""}
                  onClick={() => setSelectedUserId(String(u.id))}
                >
                  <td>{u.name}</td>
                  <td>{roleShortLabel(u.role)}</td>
                  <td>{u.totalPulled}</td>
                  <td>{u.turnedHot}</td>
                  <td>{u.turnedWarm}</td>
                  <td>{u.returnedCold}</td>
                  <td>{u.pendingNoNote}</td>
                  <td>
                    {u.lastPullAt ? (
                      <>
                        {fmtDateTime(u.lastPullAt)}
                        <span className="clr-last-company">
                          {" "}
                          · {u.lastPullCount} lead{u.lastPullCount === 1 ? "" : "s"} pulled
                        </span>
                      </>
                    ) : (
                      "Never pulled"
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}

      {selectedUserId && (
        <div className="clr-detail">
          <h3>
            Everything {selectedUser ? selectedUser.name : "this user"} has pulled
          </h3>
          {isLoadingDetail ? (
            <p className="rp-empty">Loading…</p>
          ) : !detail || detail.pulls.length === 0 ? (
            <p className="rp-empty">No Cold Lead Pool activity for this user.</p>
          ) : (
            <table className="rp-table">
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Status Now</th>
                  <th>Pulled</th>
                  <th>Returned</th>
                  <th>Outcome</th>
                  <th>Note Left</th>
                </tr>
              </thead>
              <tbody>
                {detail.pulls.map((p) => (
                  <tr key={p.pullId}>
                    <td>{p.companyName || `Lead #${p.leadNumber}`}</td>
                    <td>{p.leadStatus || "—"}</td>
                    <td>{fmtDateTime(p.pulledAt)}</td>
                    <td>{fmtDateTime(p.returnedAt)}</td>
                    <td>
                      <span className={`clr-state is-${p.state}`}>
                        {STATE_LABEL[p.state]}
                      </span>
                    </td>
                    <td className="clr-note-cell">{p.returnNote || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

export default ColdLeadsReport;
