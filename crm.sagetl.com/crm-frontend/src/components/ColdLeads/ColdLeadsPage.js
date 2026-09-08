import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faSnowflake, faSearch, faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import LeadDetails from "../Leads/LeadDetails";
import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";
import { formatDateTime } from "../../dateFormat";
import "./ColdLeadsPage.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

const fmtDateTime = (v) => formatDateTime(v);

function ColdLeadsPage() {
  const [pool, setPool] = useState([]);
  const [verticalOptions, setVerticalOptions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openLeadNumber, setOpenLeadNumber] = useState(null);
  const [isPulling, setIsPulling] = useState(false);

  // Pool filters — the same ones used to pick the 100 that get pulled.
  const [search, setSearch] = useState("");
  const [verticalFilter, setVerticalFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [noNoteFrom, setNoNoteFrom] = useState("");
  const [noNoteTo, setNoNoteTo] = useState("");
  const [freshOnly, setFreshOnly] = useState(false);

  // How many leads matching the current filters are short of a full 100 —
  // set only when a pull is confirmed-pending, so the "fewer than 100, pull
  // anyway?" dialog has a real number to show and a real batch to run once
  // the person says yes.
  const [pendingPull, setPendingPull] = useState(null);

  // The filters that actually change which leads the server returns (as
  // opposed to `search`, which is a pure client-side narrowing of what's
  // already loaded). Kept as one object so the fetch effect and the pull
  // action always agree on exactly what's currently applied.
  const serverFilters = useMemo(
    () => ({
      vertical: verticalFilter || undefined,
      city: cityFilter || undefined,
      noNoteFrom: noNoteFrom || undefined,
      noNoteTo: noNoteTo || undefined,
      freshOnly: freshOnly || undefined,
    }),
    [verticalFilter, cityFilter, noNoteFrom, noNoteTo, freshOnly]
  );

  const fetchAll = useCallback(async () => {
    try {
      const [poolRes, optionsRes] = await Promise.all([
        axios.get(`${API_BASE_URL}/api/cold-leads`, { ...authHeaders(), params: serverFilters }),
        axios.get(`${API_BASE_URL}/api/options`, authHeaders()),
      ]);
      setPool(poolRes.data || []);
      setVerticalOptions(optionsRes.data?.verticalOptions || []);
    } catch (err) {
      console.error("Error loading cold leads:", err);
    } finally {
      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(serverFilters)]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useLiveUpdates(["cold-leads", "leads"], fetchAll);

  const cityOptions = useMemo(
    () => [...new Set(pool.map((l) => l.city).filter(Boolean))].sort(),
    [pool]
  );

  // Only `search` is left to apply client-side — every other filter already
  // shaped what the server sent back, so this count is the true count of
  // what a pull would claim (search itself isn't sent to pull-100, matching
  // how it's just a way to eyeball the list, not a claim criterion).
  const filteredPool = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return pool;
    return pool.filter((lead) => (lead.companyName || "").toLowerCase().includes(term));
  }, [pool, search]);

  const runPull100 = async () => {
    setError(null);
    setIsPulling(true);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/api/cold-leads/pull-100`,
        serverFilters,
        authHeaders()
      );
      await fetchAll();
      window.dispatchEvent(new Event("cold-leads:pulled"));
      alert(`Pulled ${res.data.count} lead(s) into your batch. Open "My Leads" to work through them.`);
    } catch (err) {
      setError(err.response?.data?.error || "Could not pull a new batch.");
    } finally {
      setIsPulling(false);
      setPendingPull(null);
    }
  };

  const handlePull100 = () => {
    setError(null);
    if (pool.length === 0) {
      setError("No Cold leads match these filters right now.");
      return;
    }
    if (pool.length < 100) {
      // Ask before claiming a partial batch — matching this to the pool's
      // own live count (not filteredPool's) since search doesn't narrow
      // what actually gets pulled.
      setPendingPull(pool.length);
      return;
    }
    runPull100();
  };

  return (
    <div className="cold-leads-page">
      <header className="clp-head">
        <h1>
          <FontAwesomeIcon icon={faSnowflake} /> Cold Lead Pool
        </h1>
        <p>
          Apply filters below, then pull up to 100 matching leads at once into
          your own batch (under <strong>Leads → My Leads</strong>). You must
          resolve every lead in your current batch — convert it to Warm/Hot,
          or return it to the pool with a note on what you did — before you
          can pull another 100.
        </p>
      </header>

      {error && <p className="clp-error">{error}</p>}

      <section className="clp-section">
        <h2>Available Cold Leads ({filteredPool.length} of {pool.length})</h2>

        <div className="clp-filter-bar">
          <div className="clp-search-box">
            <FontAwesomeIcon icon={faSearch} className="clp-search-icon" />
            <input
              type="text"
              placeholder="Search company name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={verticalFilter} onChange={(e) => setVerticalFilter(e.target.value)}>
            <option value="">All Industries</option>
            {verticalOptions.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)}>
            <option value="">All Cities</option>
            {cityOptions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <label className="clp-fresh-toggle">
            <input
              type="checkbox"
              checked={freshOnly}
              onChange={(e) => setFreshOnly(e.target.checked)}
            />
            Freshly Pulled Leads Only
          </label>
        </div>

        <div className="clp-filter-bar clp-date-filter-bar">
          <label className="clp-date-filter-label">No note added between:</label>
          <input
            type="date"
            value={noNoteFrom}
            onChange={(e) => setNoNoteFrom(e.target.value)}
          />
          <span>and</span>
          <input
            type="date"
            value={noNoteTo}
            onChange={(e) => setNoNoteTo(e.target.value)}
            min={noNoteFrom || undefined}
          />
          <span className="clp-date-filter-hint">
            Finds companies nobody has logged an action against in that window.
          </span>
        </div>

        <div className="clp-pull-bar">
          <button
            type="button"
            className="clp-pull-100-btn"
            disabled={isPulling}
            onClick={handlePull100}
          >
            <FontAwesomeIcon icon={faLayerGroup} />
            {isPulling ? "Pulling…" : "Pull 100 (Applying Current Filters)"}
          </button>
        </div>

        {isLoading ? (
          <p className="clp-empty">Loading&hellip;</p>
        ) : filteredPool.length === 0 ? (
          <p className="clp-empty">No cold leads match this filter.</p>
        ) : (
          <table className="clp-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Vertical</th>
                <th>City</th>
                <th>History</th>
                <th>Last Pulled By</th>
              </tr>
            </thead>
            <tbody>
              {filteredPool.map((lead) => (
                <tr key={lead.leadNumber}>
                  <td>
                    <button
                      type="button"
                      className="clp-company-link"
                      onClick={() => setOpenLeadNumber(lead.leadNumber)}
                    >
                      {lead.companyName || `Lead #${lead.leadNumber}`}
                    </button>
                  </td>
                  <td>{lead.vertical || ""}</td>
                  <td>{lead.city || ""}</td>
                  <td>
                    {lead.neverPulled ? (
                      <span className="clp-badge clp-badge-new">Never Pulled</span>
                    ) : (
                      <span className="clp-badge clp-badge-recycled">
                        Pulled {lead.pullCount}x before
                      </span>
                    )}
                  </td>
                  <td>
                    {lead.lastPulledByName ? (
                      <span className="clp-last-puller-wrap" tabIndex={0}>
                        <span className="clp-last-puller">{lead.lastPulledByName}</span>
                        <span className="clp-note-tooltip" role="tooltip">
                          <span className="clp-note-tooltip-arrow" />
                          {lead.lastNote ? (
                            <>
                              <p className="clp-note-tooltip-text">{lead.lastNote}</p>
                              <span className="clp-note-tooltip-meta">
                                {lead.lastPulledByName} · {fmtDateTime(lead.lastNoteAt)}
                              </span>
                            </>
                          ) : (
                            <span className="clp-note-tooltip-meta">
                              No note left by {lead.lastPulledByName}
                            </span>
                          )}
                        </span>
                      </span>
                    ) : (
                      <span className="clp-last-puller-none">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {pendingPull !== null && (
        <div className="clp-modal-overlay" onClick={() => setPendingPull(null)}>
          <div className="clp-confirm-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Fewer than 100 leads match</h3>
            <p>
              Only <strong>{pendingPull}</strong> Cold lead{pendingPull === 1 ? "" : "s"}{" "}
              match your current filters — short of a full batch of 100.
              Do you want to pull {pendingPull === 1 ? "it" : "them"} anyway?
            </p>
            <div className="clp-confirm-actions">
              <button
                type="button"
                className="clp-confirm-cancel"
                onClick={() => setPendingPull(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="clp-confirm-yes"
                disabled={isPulling}
                onClick={runPull100}
              >
                {isPulling ? "Pulling…" : `Yes, pull ${pendingPull === 1 ? "it" : "them"}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {openLeadNumber && (
        <LeadDetails
          leadNumber={openLeadNumber}
          onClose={() => {
            setOpenLeadNumber(null);
            fetchAll();
          }}
          onUpdate={fetchAll}
        />
      )}
    </div>
  );
}

export default ColdLeadsPage;
