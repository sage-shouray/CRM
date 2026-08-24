import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShieldHalved,
  faCircleCheck,
  faCircleXmark,
  faRotate,
} from "@fortawesome/free-solid-svg-icons";
import { roleShortLabel } from "../../roles";
import { API_BASE_URL } from "../../config";
import "./AuditPage.css";

const PAGE_SIZE = 100;

const fmtWhen = (value) => {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

// The full UA string is unreadable in a table; reduce it to the browser and OS.
const shortAgent = (ua) => {
  if (!ua) return "—";
  const browser =
    /Edg\//.test(ua) ? "Edge"
    : /Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox"
    : /curl/i.test(ua) ? "curl"
    : "Other";
  const os =
    /Windows/.test(ua) ? "Windows"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux"
    : "";
  return os ? `${browser} · ${os}` : browser;
};

function AuditPage() {
  const [entries, setEntries] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const [users, setUsers] = useState([]);
  const [filters, setFilters] = useState({
    userId: "",
    outcome: "",
    from: "",
    to: "",
    search: "",
  });

  const load = useCallback(
    async (activeFilters, pageIndex) => {
      setIsLoading(true);
      try {
        const params = { limit: PAGE_SIZE, offset: pageIndex * PAGE_SIZE };
        Object.entries(activeFilters).forEach(([k, v]) => {
          if (v) params[k] = v;
        });
        const res = await axios.get(`${API_BASE_URL}/api/audit`, { params });
        setEntries(res.data?.entries || []);
        setTotal(res.data?.total || 0);
        setError(null);
      } catch (err) {
        setError(
          err.response?.status === 403
            ? "The audit trail is available to Admins only."
            : "Could not load the audit trail."
        );
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    load(filters, page);
  }, [load, filters, page]);

  useEffect(() => {
    axios
      .get(`${API_BASE_URL}/api/users`)
      .then((res) => setUsers(res.data || []))
      .catch(() => setUsers([]));
  }, []);

  const setFilter = (key, value) => {
    setPage(0);
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setPage(0);
    setFilters({ userId: "", outcome: "", from: "", to: "", search: "" });
  };

  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);

  return (
    <div className="audit-page">
      <header className="audit-head">
        <div>
          <h1>
            <FontAwesomeIcon icon={faShieldHalved} /> Audit trail
          </h1>
          <p>
            Every change made in the system: who did it, from which address, and
            whether it succeeded. Read-only.
          </p>
        </div>
        <button
          type="button"
          className="au-btn"
          onClick={() => load(filters, page)}
        >
          <FontAwesomeIcon icon={faRotate} /> Refresh
        </button>
      </header>

      {error && <div className="au-error">{error}</div>}

      {!error && (
        <>
          <div className="au-filters">
            <label>
              Account
              <select
                value={filters.userId}
                onChange={(e) => setFilter("userId", e.target.value)}
              >
                <option value="">All accounts</option>
                {users.map((u) => (
                  <option key={u._id || u.id} value={u._id || u.id}>
                    {u.firstName} {u.lastName}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Outcome
              <select
                value={filters.outcome}
                onChange={(e) => setFilter("outcome", e.target.value)}
              >
                <option value="">Any</option>
                <option value="success">Succeeded</option>
                <option value="failed">Failed</option>
              </select>
            </label>

            <label>
              From
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilter("from", e.target.value)}
              />
            </label>

            <label>
              To
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilter("to", e.target.value)}
              />
            </label>

            <label className="au-search">
              Search
              <input
                type="search"
                placeholder="Action, account or IP"
                value={filters.search}
                onChange={(e) => setFilter("search", e.target.value)}
              />
            </label>

            <button type="button" className="au-btn" onClick={clearFilters}>
              Clear
            </button>
          </div>

          <div className="au-panel">
            <div className="au-count">
              {isLoading
                ? "Loading…"
                : `${total} event${total === 1 ? "" : "s"}`}
            </div>

            <table className="au-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Account</th>
                  <th>Role</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>Result</th>
                  <th>IP address</th>
                  <th>Device</th>
                </tr>
              </thead>
              <tbody>
                {!isLoading && entries.length === 0 && (
                  <tr>
                    <td colSpan={8} className="au-empty">
                      No activity matches these filters.
                    </td>
                  </tr>
                )}
                {entries.map((e) => (
                  <tr key={e.id} className={e.outcome === "failed" ? "is-failed" : ""}>
                    <td className="au-when">{fmtWhen(e.createdAt)}</td>
                    <td>{e.userName}</td>
                    <td>{e.role ? roleShortLabel(e.role) : "—"}</td>
                    <td>{e.action}</td>
                    <td>
                      {e.entity
                        ? `${e.entity}${e.entityId ? ` #${e.entityId}` : ""}`
                        : "—"}
                      {/* Field-level diff, when the route recorded one. */}
                      {Array.isArray(e.changes) && e.changes.length > 0 && (
                        <ul className="au-changes">
                          {e.changes.slice(0, 4).map((c, i) => (
                            <li key={i}>
                              <span className="au-field">{c.field}</span>
                              <span className="au-from">{String(c.from ?? "—")}</span>
                              {" → "}
                              <span className="au-to">{String(c.to ?? "—")}</span>
                            </li>
                          ))}
                          {e.changes.length > 4 && (
                            <li className="au-more">
                              +{e.changes.length - 4} more fields
                            </li>
                          )}
                        </ul>
                      )}
                    </td>
                    <td>
                      <span className={`au-outcome is-${e.outcome}`}>
                        <FontAwesomeIcon
                          icon={
                            e.outcome === "success" ? faCircleCheck : faCircleXmark
                          }
                        />
                        {e.statusCode}
                      </span>
                    </td>
                    <td className="au-ip">{e.ip || "—"}</td>
                    <td title={e.userAgent || ""}>{shortAgent(e.userAgent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {total > PAGE_SIZE && (
              <div className="au-pager">
                <button
                  type="button"
                  className="au-btn"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Previous
                </button>
                <span>
                  Page {page + 1} of {lastPage + 1}
                </span>
                <button
                  type="button"
                  className="au-btn"
                  disabled={page >= lastPage}
                  onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
                >
                  Next
                </button>
              </div>
            )}
          </div>

          <p className="au-note">
            Reads are not recorded — only actions that change data, plus sign-in
            attempts. Request contents are never stored, so passwords and
            personal data cannot leak through this page.
          </p>
        </>
      )}
    </div>
  );
}

export default AuditPage;
