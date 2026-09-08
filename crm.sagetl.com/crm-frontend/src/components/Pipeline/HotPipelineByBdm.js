import React, { useMemo } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFire, faIndianRupeeSign } from "@fortawesome/free-solid-svg-icons";
import { ROLES, normalizeRole, canManageTeam } from "../../roles";
import "./PipelinePage.css";

const HOT_STATUS = "Hot (0–3 months)";

const formatINR = (value) =>
  `₹${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

// Every Hot lead's Expected Deal Value, totalled per BDM. bdm is stored as an
// array of first names (see CreateLeads' multi-select), so one lead with
// several BDMs on it counts in full toward each of them — the same deal
// being worked by two people is real pipeline for both, not half each.
function hotValueByBdm(leads) {
  const totals = {};
  leads.forEach((lead) => {
    const info = lead.companyInfo || {};
    if (info.leadStatus !== HOT_STATUS) return;
    const value = Number(info.expectedDealValue) || 0;
    if (value <= 0) return;
    const bdms = Array.isArray(info.bdm) ? info.bdm : info.bdm ? [info.bdm] : [];
    bdms.forEach((name) => {
      if (!name) return;
      totals[name] = (totals[name] || 0) + value;
    });
  });
  return totals;
}

// Admin sees every BDM's Hot pipeline value side by side; a BDM (Manager)
// sees only their own total, since this is their number to know, not their
// teammates'. Nothing shown to an Executive — this is BDM-level reporting.
function HotPipelineByBdm({ leads = [] }) {
  const role = normalizeRole(sessionStorage.getItem("userRole"));
  const myName = sessionStorage.getItem("loggedInUser") || "";

  const totals = useMemo(() => hotValueByBdm(leads), [leads]);

  if (role === ROLES.MANAGER) {
    const mine = totals[myName] || 0;
    return (
      <div className="hot-pipeline-widget hot-pipeline-self">
        <div className="hpw-icon">
          <FontAwesomeIcon icon={faFire} />
        </div>
        <div>
          <span className="hpw-label">Your Hot Pipeline Value</span>
          <strong className="hpw-value">{formatINR(mine)}</strong>
        </div>
      </div>
    );
  }

  if (!canManageTeam(role)) return null;

  const rows = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const grandTotal = rows.reduce((sum, [, v]) => sum + v, 0);

  return (
    <div className="hot-pipeline-widget hot-pipeline-admin">
      <header className="hpw-admin-head">
        <div className="hpw-icon">
          <FontAwesomeIcon icon={faFire} />
        </div>
        <div>
          <span className="hpw-label">Hot Pipeline Value by BDM</span>
          <strong className="hpw-value">{formatINR(grandTotal)}</strong>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="hpw-empty">No Hot leads with a deal value yet.</p>
      ) : (
        <ul className="hpw-bdm-list">
          {rows.map(([name, value]) => (
            <li key={name}>
              <span className="hpw-bdm-name">{name}</span>
              <span className="hpw-bdm-bar-track">
                <span
                  className="hpw-bdm-bar-fill"
                  style={{ width: grandTotal ? `${(value / grandTotal) * 100}%` : "0%" }}
                />
              </span>
              <span className="hpw-bdm-value">
                <FontAwesomeIcon icon={faIndianRupeeSign} />
                {formatINR(value).replace("₹", "")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default HotPipelineByBdm;
