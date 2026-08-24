import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFolderOpen,
  faPenToSquare,
  faListCheck,
  faCircleCheck,
  faBuilding,
  faDownload,
  faRotate,
  faTriangleExclamation,
} from "@fortawesome/free-solid-svg-icons";
import SidebarReports from "../Sidebar/SidebarReports";
import { roleShortLabel } from "../../roles";
import { API_BASE_URL } from "../../config";
import DailyActivityReport from "./DailyActivityReport";
import "./ReportsPage.css";

const TABS = [
  { key: "leads", label: "Leads created" },
  { key: "actions", label: "Actions on leads" },
  { key: "tasks", label: "Tasks" },
];

const fmtDate = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
};

const statusLabel = (status) => (status || "pending").replace(/_/g, " ");

// Current month as YYYY-MM, in local time.
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Streams a blob response to disk under the filename the server suggests.
const saveBlob = (data, fileName) => {
  const url = window.URL.createObjectURL(new Blob([data]));
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

function ReportsPage() {
  const [summary, setSummary] = useState([]);
  const [detail, setDetail] = useState(null);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [tab, setTab] = useState("leads");
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [error, setError] = useState(null);

  const [month, setMonth] = useState(thisMonth);
  const [isDownloading, setIsDownloading] = useState(false);
  const [renewals, setRenewals] = useState([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = useCallback(async (userId) => {
    const isDetail = Boolean(userId);
    if (isDetail) setIsLoadingDetail(true);
    else setIsLoading(true);

    try {
      const res = await axios.get(`${API_BASE_URL}/api/reports/activity`, {
        params: userId ? { userId } : {},
      });
      setSummary(res.data?.users || []);
      setDetail(res.data?.detail || null);
      setError(null);
    } catch (err) {
      setError(
        err.response?.status === 403
          ? "This report is available to Admins only."
          : err.response?.data?.error || "Could not load the activity report."
      );
    } finally {
      setIsLoading(false);
      setIsLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    load(selectedUserId || null);
  }, [load, selectedUserId]);

  // Contracts expiring in the next three months — the same set the scheduled
  // report covers, shown live so the page is not just a file list.
  const loadRenewals = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/reports/sap-renewals`);
      setRenewals(res.data || []);
    } catch (err) {
      /* the panel simply stays empty */
    }
  }, []);

  useEffect(() => {
    loadRenewals();
  }, [loadRenewals]);

  const downloadMonthlyWork = async () => {
    setIsDownloading(true);
    setNotice(null);
    try {
      const res = await axios.get(`${API_BASE_URL}/api/reports/monthly-work`, {
        params: { month },
        responseType: "blob",
      });
      saveBlob(res.data, `work-done-${month}.csv`);
    } catch (err) {
      setNotice({ kind: "error", text: "Could not download that month." });
    } finally {
      setIsDownloading(false);
    }
  };

  const generateRenewals = async () => {
    setIsGenerating(true);
    setNotice(null);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/reports/sap-renewals/generate`
      );
      setNotice({
        kind: "ok",
        text: `Generated ${res.data.fileName} — ${res.data.contracts} contract${
          res.data.contracts === 1 ? "" : "s"
        }. It is in Generated files below.`,
      });
      // The file list listens for this.
      window.dispatchEvent(new Event("reports:changed"));
    } catch (err) {
      setNotice({ kind: "error", text: "Could not generate the report." });
    } finally {
      setIsGenerating(false);
    }
  };

  // Team-wide roll-up across whoever is in scope.
  const totals = useMemo(
    () =>
      summary.reduce(
        (acc, u) => ({
          leadsCreated: acc.leadsCreated + u.leadsCreated,
          actionsLogged: acc.actionsLogged + u.actionsLogged,
          tasksDone: acc.tasksDone + u.tasksDone,
          tasksOpen: acc.tasksOpen + u.tasksOpen,
        }),
        { leadsCreated: 0, actionsLogged: 0, tasksDone: 0, tasksOpen: 0 }
      ),
    [summary]
  );

  const selectedUser = summary.find(
    (u) => String(u.id) === String(selectedUserId)
  );

  const renderDetail = () => {
    if (isLoadingDetail) return <p className="rp-empty">Loading…</p>;
    if (!detail) return null;

    if (tab === "leads") {
      return detail.leadsCreated.length === 0 ? (
        <p className="rp-empty">No leads created by this user.</p>
      ) : (
        <table className="rp-table">
          <thead>
            <tr>
              <th>Lead</th>
              <th>Company</th>
              <th>Status</th>
              <th>Priority</th>
              <th>Next action</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {detail.leadsCreated.map((l) => (
              <tr key={l.leadNumber}>
                <td>#{l.leadNumber}</td>
                <td>{l.companyName || "—"}</td>
                <td>{l.leadStatus || "—"}</td>
                <td>{l.priority || "—"}</td>
                <td>{l.nextAction || "—"}</td>
                <td>{fmtDate(l.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }

    if (tab === "actions") {
      return detail.actions.length === 0 ? (
        <p className="rp-empty">No actions logged by this user.</p>
      ) : (
        <div className="rp-feed">
          {detail.actions.map((a, i) => (
            <article className="rp-feed-item" key={i}>
              <FontAwesomeIcon icon={faBuilding} className="rp-feed-icon" />
              <div>
                <p className="rp-feed-lead">
                  {a.companyName || `Lead #${a.leadNumber}`}
                  <span className="rp-feed-num"> · #{a.leadNumber}</span>
                </p>
                <p className="rp-feed-text">{a.description}</p>
                <span className="rp-feed-date">{fmtDate(a.createdAt)}</span>
              </div>
            </article>
          ))}
        </div>
      );
    }

    return detail.tasks.length === 0 ? (
      <p className="rp-empty">No tasks for this user.</p>
    ) : (
      <table className="rp-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Lead</th>
            <th>Category</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Due</th>
          </tr>
        </thead>
        <tbody>
          {detail.tasks.map((t) => (
            <tr key={t.taskId}>
              <td>{t.title}</td>
              <td>{t.associatedLead || "—"}</td>
              <td>{t.category || "—"}</td>
              <td>{t.priority || "—"}</td>
              <td>
                <span className={`rp-status is-${(t.status || "pending")}`}>
                  {statusLabel(t.status)}
                </span>
              </td>
              <td>{fmtDate(t.dueDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  return (
    <div className="reports-page">
      <header className="reports-page-head">
        <h1>Reports</h1>
        <p>
          Work done by each user — leads created, actions logged against those
          leads, and tasks worked. Pick a user to see everything they did.
        </p>
      </header>

      {/* Per-person daily activity and the self-reported work log. Sits above
          the lead/task breakdown because "was everyone working" is the first
          question this page gets asked. */}
      <DailyActivityReport />

      {error && <div className="rp-error">{error}</div>}

      {!error && (
        <>
          <div className="rp-totals">
            <article className="rp-total">
              <FontAwesomeIcon icon={faFolderOpen} />
              <div>
                <strong>{totals.leadsCreated}</strong>
                <span>Leads created</span>
              </div>
            </article>
            <article className="rp-total">
              <FontAwesomeIcon icon={faPenToSquare} />
              <div>
                <strong>{totals.actionsLogged}</strong>
                <span>Actions logged</span>
              </div>
            </article>
            <article className="rp-total">
              <FontAwesomeIcon icon={faCircleCheck} />
              <div>
                <strong>{totals.tasksDone}</strong>
                <span>Tasks completed</span>
              </div>
            </article>
            <article className="rp-total">
              <FontAwesomeIcon icon={faListCheck} />
              <div>
                <strong>{totals.tasksOpen}</strong>
                <span>Tasks open</span>
              </div>
            </article>
          </div>

          {notice && (
            <div className={`rp-notice is-${notice.kind}`}>{notice.text}</div>
          )}

          {/* SAP renewals — built automatically on the 1st of each month. */}
          <section className="rp-panel">
            <header className="rp-panel-head">
              <h2>SAP contracts expiring in the next 3 months</h2>
              <div className="rp-head-actions">
                <span className="rp-schedule-note">
                  Generated automatically on the 1st of every month
                </span>
                <button
                  type="button"
                  className="rp-btn"
                  onClick={generateRenewals}
                  disabled={isGenerating}
                >
                  <FontAwesomeIcon icon={faRotate} />
                  {isGenerating ? "Generating…" : "Generate now"}
                </button>
              </div>
            </header>

            {renewals.length === 0 ? (
              <p className="rp-empty">
                No SAP Installed Base contracts expire in the next three months.
              </p>
            ) : (
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>Company</th>
                    <th>Lead</th>
                    <th>Expiry</th>
                    <th>Days left</th>
                    <th>Support partner</th>
                    <th>Location</th>
                    <th>Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {renewals.map((r) => (
                    <tr key={r.leadNumber}>
                      <td>{r.companyName || "—"}</td>
                      <td>#{r.leadNumber}</td>
                      <td>
                        {r.expiry}
                        {!r.exact && (
                          <span
                            className="rp-approx"
                            title="Only a year was recorded for this contract; 31 December is assumed."
                          >
                            <FontAwesomeIcon icon={faTriangleExclamation} />{" "}
                            approx
                          </span>
                        )}
                      </td>
                      <td>{r.daysLeft}</td>
                      <td>{r.supportPartner || "—"}</td>
                      <td>
                        {[r.city, r.state].filter(Boolean).join(", ") || "—"}
                      </td>
                      <td>{r.owner || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Monthly per-user work, downloadable. */}
          <section className="rp-panel">
            <header className="rp-panel-head">
              <h2>Download monthly work</h2>
              <div className="rp-head-actions">
                <label className="rp-filter">
                  Month:
                  <input
                    type="month"
                    value={month}
                    onChange={(e) => setMonth(e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="rp-btn is-primary"
                  onClick={downloadMonthlyWork}
                  disabled={isDownloading || !month}
                >
                  <FontAwesomeIcon icon={faDownload} />
                  {isDownloading ? "Preparing…" : "Download CSV"}
                </button>
              </div>
            </header>
            <p className="rp-empty">
              One row per user for the chosen month: leads created, actions
              logged, and tasks created, completed and still open.
            </p>
          </section>

          <section className="rp-panel">
            <header className="rp-panel-head">
              <h2>Work by user</h2>
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

            {isLoading ? (
              <p className="rp-empty">Loading…</p>
            ) : summary.length === 0 ? (
              <p className="rp-empty">No users in scope.</p>
            ) : (
              <table className="rp-table">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Leads created</th>
                    <th>Leads assigned</th>
                    <th>Actions logged</th>
                    <th>Tasks done</th>
                    <th>Tasks open</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  {summary
                    .filter(
                      (u) =>
                        !selectedUserId ||
                        String(u.id) === String(selectedUserId)
                    )
                    .map((u) => (
                      <tr
                        key={u.id}
                        className={
                          String(u.id) === String(selectedUserId)
                            ? "is-selected"
                            : ""
                        }
                        onClick={() => setSelectedUserId(String(u.id))}
                      >
                        <td>{u.name}</td>
                        <td>{roleShortLabel(u.role)}</td>
                        <td>{u.leadsCreated}</td>
                        <td>{u.leadsAssigned}</td>
                        <td>{u.actionsLogged}</td>
                        <td>{u.tasksDone}</td>
                        <td>{u.tasksOpen}</td>
                        <td>{fmtDate(u.lastActivityAt)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </section>

          {selectedUserId && (
            <section className="rp-panel">
              <header className="rp-panel-head">
                <h2>{selectedUser ? selectedUser.name : "Selected user"}</h2>
                <div className="rp-tabs">
                  {TABS.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      className={`rp-tab ${tab === t.key ? "is-active" : ""}`}
                      onClick={() => setTab(t.key)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </header>
              {renderDetail()}
            </section>
          )}

          <section className="rp-panel">
            <header className="rp-panel-head">
              <h2>Generated files</h2>
            </header>
            <SidebarReports />
          </section>
        </>
      )}
    </div>
  );
}

export default ReportsPage;
