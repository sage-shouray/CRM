import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faFire,
  faThermometerHalf,
  faSnowflake,
  faCircleExclamation,
  faUndo,
} from "@fortawesome/free-solid-svg-icons";
import LeadDetails from "../Leads/LeadDetails";
import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";
import "./MyColdLeadsPage.css";

const authHeaders = () => ({
  headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
});

const STATE_LABEL = {
  hot: "Converted — Hot",
  warm: "Converted — Warm",
  returnedCold: "Returned (noted)",
  pendingNoNote: "Needs action",
};

function MyColdLeadsPage() {
  const [data, setData] = useState({ batchId: null, leads: [], summary: { total: 0, hot: 0, warm: 0, returnedCold: 0, pendingNoNote: 0 } });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [openLeadNumber, setOpenLeadNumber] = useState(null);
  const [returningLead, setReturningLead] = useState(null);
  const [returnNote, setReturnNote] = useState("");
  const [isSubmittingReturn, setIsSubmittingReturn] = useState(false);

  const fetchMyLeads = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/cold-leads/my-leads`, authHeaders());
      setData(res.data);
    } catch (err) {
      console.error("Error loading my cold leads:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyLeads();
  }, [fetchMyLeads]);

  useLiveUpdates(["cold-leads", "leads"], fetchMyLeads);
  useEffect(() => {
    const onPulled = () => fetchMyLeads();
    window.addEventListener("cold-leads:pulled", onPulled);
    return () => window.removeEventListener("cold-leads:pulled", onPulled);
  }, [fetchMyLeads]);

  const openReturnDialog = (leadNumber) => {
    setReturningLead(leadNumber);
    setReturnNote("");
    setError(null);
  };

  const submitReturn = async () => {
    if (!returnNote.trim()) {
      setError("Describe what action you took before returning this lead.");
      return;
    }
    setIsSubmittingReturn(true);
    setError(null);
    try {
      await axios.post(
        `${API_BASE_URL}/api/cold-leads/${returningLead}/return`,
        { note: returnNote.trim() },
        authHeaders()
      );
      setReturningLead(null);
      setReturnNote("");
      await fetchMyLeads();
    } catch (err) {
      setError(err.response?.data?.error || "Could not return this lead.");
    } finally {
      setIsSubmittingReturn(false);
    }
  };

  const { summary, leads, batchId } = data;

  return (
    <div className="mcl-page">
      <header className="mcl-head">
        <h1>My Leads (from the Cold Pool)</h1>
        <p>
          Every lead you've pulled in your current batch. Convert one to Warm
          or Hot by editing its status, or return it to the pool with a note
          on what action you took. You can't pull a new batch of 100 until
          every lead here is resolved.
        </p>
      </header>

      {error && <p className="mcl-error">{error}</p>}

      {isLoading ? (
        <p className="mcl-empty">Loading&hellip;</p>
      ) : !batchId ? (
        <p className="mcl-empty">
          You haven't pulled any leads from the Cold Pool yet — go to{" "}
          <strong>Leads → Cold Leads</strong> to pull your first batch of 100.
        </p>
      ) : (
        <>
          <div className="mcl-summary-row">
            <div className="mcl-stat mcl-stat-hot">
              <FontAwesomeIcon icon={faFire} />
              <div>
                <strong>{summary.hot}</strong>
                <span>Turned Hot</span>
              </div>
            </div>
            <div className="mcl-stat mcl-stat-warm">
              <FontAwesomeIcon icon={faThermometerHalf} />
              <div>
                <strong>{summary.warm}</strong>
                <span>Turned Warm</span>
              </div>
            </div>
            <div className="mcl-stat mcl-stat-returned">
              <FontAwesomeIcon icon={faUndo} />
              <div>
                <strong>{summary.returnedCold}</strong>
                <span>Returned (noted)</span>
              </div>
            </div>
            <div className={`mcl-stat mcl-stat-pending ${summary.pendingNoNote > 0 ? "is-blocking" : ""}`}>
              <FontAwesomeIcon icon={faCircleExclamation} />
              <div>
                <strong>{summary.pendingNoNote}</strong>
                <span>Still need action</span>
              </div>
            </div>
            <div className="mcl-stat mcl-stat-total">
              <FontAwesomeIcon icon={faSnowflake} />
              <div>
                <strong>{summary.total}</strong>
                <span>Total in batch</span>
              </div>
            </div>
          </div>

          {summary.pendingNoNote > 0 && (
            <p className="mcl-blocking-banner">
              You have {summary.pendingNoNote} lead(s) left to resolve before you can pull another 100 —
              convert them to Warm/Hot, or return them to the pool with a note.
            </p>
          )}

          <table className="mcl-table">
            <thead>
              <tr>
                <th>Company</th>
                <th>Status</th>
                <th>State</th>
                <th>Note</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.pullId} className={`mcl-row-${lead.state}`}>
                  <td>
                    <button
                      type="button"
                      className="mcl-company-link"
                      onClick={() => setOpenLeadNumber(lead.leadNumber)}
                    >
                      {lead.companyName || `Lead #${lead.leadNumber}`}
                    </button>
                  </td>
                  <td>{lead.leadStatus}</td>
                  <td>
                    <span className={`mcl-badge mcl-badge-${lead.state}`}>
                      {STATE_LABEL[lead.state]}
                    </span>
                  </td>
                  <td className="mcl-note-cell">{lead.returnNote || ""}</td>
                  <td>
                    {lead.state === "pendingNoNote" && (
                      <button
                        type="button"
                        className="mcl-return-btn"
                        onClick={() => openReturnDialog(lead.leadNumber)}
                      >
                        Return to Pool
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {returningLead && (
        <div className="mcl-modal-overlay" onClick={() => setReturningLead(null)}>
          <div className="mcl-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Return lead to the pool</h3>
            <p>Describe what action you took — this becomes a note on the lead.</p>
            <textarea
              rows={4}
              value={returnNote}
              onChange={(e) => setReturnNote(e.target.value)}
              placeholder="e.g. Called twice, no response. Emailed a follow-up. Will retry next quarter."
              autoFocus
            />
            <div className="mcl-modal-actions">
              <button type="button" className="mcl-modal-cancel" onClick={() => setReturningLead(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="mcl-modal-submit"
                disabled={isSubmittingReturn}
                onClick={submitReturn}
              >
                {isSubmittingReturn ? "Returning…" : "Return with this note"}
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
            fetchMyLeads();
          }}
          onUpdate={fetchMyLeads}
        />
      )}
    </div>
  );
}

export default MyColdLeadsPage;
