import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "react-router-dom";
import axios from "axios";
import {
  companyFormConfig,
  contactFormConfig,
  itLandscapeConfig,
} from "../CreateLeads/formConfigs";
import LeadDetails from "../Leads/LeadDetails";
import "./Companies.css";

import { API_BASE_URL } from "../../config";

// Flatten a form config into an ordered [name, label] list so this page renders
// fields in exactly the order they appear on the Create Lead form.
const flattenConfig = (rows) =>
  (rows || []).flat().map((field) => [field.name, field.label]);

const COMPANY_FIELDS = flattenConfig(companyFormConfig);
const NET_NEW_FIELDS = flattenConfig(itLandscapeConfig.netNew);
const SAP_FIELDS = flattenConfig(itLandscapeConfig.SAPInstalledBase);

// The date picker attached to "Next Action" is not a field of its own in the
// config, but it is stored alongside the rest of companyInfo.
const EXTRA_COMPANY_LABELS = {
  dateField: "Next Action Date",
  genericPhone1: "Phone 1",
  genericPhone2: "Phone 2",
  genericEmail1: "Email 1",
  genericEmail2: "Email 2",
  website: "Website",
  turnOverINR: "Turnover (INR)",
  employeeCount: "Employee Count",
  aboutTheCompany: "About the Company",
  totalNoOfOffices: "Total No. of Offices",
  totalNoOfManufUnits: "Total No. of Manufacturing Units",
};

// contactInfo is stored as { it: { name, mobile, ... } }, while the form config
// names the same fields itName / itMobile. Strip the role prefix to line up.
const CONTACT_ROLES = [
  { key: "it", label: "IT", prefix: "it" },
  { key: "finance", label: "Finance", prefix: "finance" },
  { key: "businessHead", label: "Business Head", prefix: "businessHead" },
];

const contactLabelsFor = (prefix) => {
  const roleConfig = contactFormConfig.find(
    (r) => r.role.toLowerCase().replace(/\s+/g, "") === prefix.toLowerCase()
  );
  return (roleConfig?.fields || []).map((field) => {
    const storedKey =
      field.name.slice(prefix.length).charAt(0).toLowerCase() +
      field.name.slice(prefix.length + 1);
    return [storedKey, field.label];
  });
};

// Turn a camelCase key into something readable, for anything stored on the lead
// that no config knows about. Guarantees nothing is silently hidden.
const prettifyKey = (key) =>
  key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();

const isEmpty = (value) =>
  value === null ||
  value === undefined ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const formatValue = (value, userLookup) => {
  if (isEmpty(value)) return "—";

  // leadAssignedTo can be a single populated user / bare id (legacy leads),
  // or an array of either when a lead has several BDMs.
  const nameOf = (v) => {
    if (v && typeof v === "object") return `${v.firstName || ""} ${v.lastName || ""}`.trim();
    if (userLookup && userLookup[v]) return userLookup[v];
    return String(v);
  };

  if (Array.isArray(value)) {
    return value.map(nameOf).filter(Boolean).join(", ") || "—";
  }
  if (typeof value === "object") {
    if (value.firstName) return `${value.firstName} ${value.lastName || ""}`.trim();
    return JSON.stringify(value);
  }
  if (userLookup && userLookup[value]) return userLookup[value];

  // ISO timestamps stored by the date picker.
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleDateString();
  }
  return String(value);
};

const Companies = () => {
  const location = useLocation();
  const [leads, setLeads] = useState([]);
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [selectedLeadNumber, setSelectedLeadNumber] = useState(null);
  const [editingLeadNumber, setEditingLeadNumber] = useState(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  useEffect(() => {
    const fetchData = async () => {
      const token = sessionStorage.getItem("token");
      if (!token) {
        setError("No authentication token found. Please log in again.");
        setLoading(false);
        return;
      }
      try {
        const [leadsRes, usersRes] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/leads`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get(`${API_BASE_URL}/api/users`).catch(() => ({ data: [] })),
        ]);
        setLeads(leadsRes.data || []);
        setUsers(usersRes.data || []);
        setError(null);
      } catch (err) {
        setError(
          err.response?.data?.error || err.message || "Unable to load companies"
        );
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [refreshTrigger]);

  // The top bar's global search hands its term over as ?q=, so arriving from
  // there lands on a pre-filtered list.
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("q");
    if (q !== null) {
      setSearch(q);
      setSelectedLeadNumber(null);
    }
  }, [location.search]);

  // id -> display name, so assigned-user ids render as people.
  const userLookup = useMemo(() => {
    const map = {};
    users.forEach((u) => {
      map[u._id || u.id] = `${u.firstName || ""} ${u.lastName || ""}`.trim();
    });
    return map;
  }, [users]);

  const filteredLeads = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return leads;
    return leads.filter((lead) => {
      const name = lead.companyInfo?.companyName || "";
      return (
        name.toLowerCase().includes(term) ||
        String(lead.leadNumber || "").includes(term)
      );
    });
  }, [leads, search]);

  // Default to the first company once the list arrives.
  useEffect(() => {
    if (selectedLeadNumber === null && filteredLeads.length > 0) {
      setSelectedLeadNumber(filteredLeads[0].leadNumber);
    }
  }, [filteredLeads, selectedLeadNumber]);

  const selectedLead = useMemo(
    () => leads.find((l) => l.leadNumber === selectedLeadNumber) || null,
    [leads, selectedLeadNumber]
  );

  // Render a section from an ordered label list, then append anything stored on
  // the record that the list did not cover.
  const renderSection = (data, orderedFields, extraLabels = {}) => {
    const source = data || {};
    const known = new Set(orderedFields.map(([name]) => name));

    const extras = Object.keys(source)
      .filter((key) => !known.has(key))
      .map((key) => [key, extraLabels[key] || prettifyKey(key)]);

    const all = [...orderedFields, ...extras];
    const visible = showEmpty
      ? all
      : all.filter(([name]) => !isEmpty(source[name]));

    if (visible.length === 0) {
      return <p className="companies-empty-note">No information recorded.</p>;
    }

    return (
      <dl className="companies-field-grid">
        {visible.map(([name, label]) => (
          <div className="companies-field" key={name}>
            <dt>{label}</dt>
            <dd className={isEmpty(source[name]) ? "is-empty" : ""}>
              {formatValue(source[name], name === "leadAssignedTo" ? userLookup : null)}
            </dd>
          </div>
        ))}
      </dl>
    );
  };

  const renderDescriptions = (lead) => {
    const descriptions = (lead.descriptions || []).filter(
      (d) => d && (d.description || d.file || d.selectedOption || d.radioValue)
    );

    if (descriptions.length === 0) {
      return <p className="companies-empty-note">No notes recorded.</p>;
    }

    return (
      <div className="companies-notes">
        {descriptions.map((desc, index) => (
          <article className="companies-note" key={index}>
            <header>
              <span className="companies-note-author">
                {desc.addedBy?.firstName || "Unknown"}
              </span>
              {desc.createdAt && (
                <span className="companies-note-date">
                  {new Date(desc.createdAt).toLocaleString()}
                </span>
              )}
            </header>
            {desc.description && <p>{desc.description}</p>}
            <div className="companies-note-meta">
              {desc.selectedOption && (
                <span>Conversation level: {desc.selectedOption}</span>
              )}
              {desc.radioValue && <span>Mailer shared: {desc.radioValue}</span>}
              {desc.file?.filename && (
                <span>Attachment: {desc.file.filename}</span>
              )}
            </div>
          </article>
        ))}
      </div>
    );
  };

  const leadType = selectedLead?.companyInfo?.leadType;
  const netNewData = selectedLead?.itLandscape?.netNew;
  const sapData = selectedLead?.itLandscape?.SAPInstalledBase;

  // Show the block matching the lead type, but never hide a block that has data
  // in it — that is how a mis-typed lead becomes visible instead of lost.
  const hasData = (obj) =>
    obj && Object.values(obj).some((v) => !isEmpty(v));
  const showNetNew = leadType !== "SAP Installed Base" || hasData(netNewData);
  const showSap = leadType !== "Net New" || hasData(sapData);

  return (
    <div className="companies-page">
      <div className="companies-header">
        <div>
          <h1>Companies</h1>
          <p>
            The complete record for every company, exactly as captured on the
            Create Lead form.
          </p>
        </div>
        <label className="companies-toggle">
          <input
            type="checkbox"
            checked={showEmpty}
            onChange={(e) => setShowEmpty(e.target.checked)}
          />
          Show fields left blank
        </label>
      </div>

      {error && <div className="companies-error">{error}</div>}

      <div className="companies-layout">
        <aside className="companies-list-panel">
          <input
            type="text"
            className="companies-search"
            placeholder="Search company or lead number"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="companies-list">
            {loading && <p className="companies-empty-note">Loading…</p>}
            {!loading && filteredLeads.length === 0 && (
              <p className="companies-empty-note">No companies found.</p>
            )}
            {filteredLeads.map((lead) => (
              <button
                key={lead._id || lead.leadNumber}
                className={`companies-list-item ${
                  lead.leadNumber === selectedLeadNumber ? "is-active" : ""
                }`}
                onClick={() => setSelectedLeadNumber(lead.leadNumber)}
              >
                <span className="companies-list-name">
                  {lead.companyInfo?.companyName || "Unnamed company"}
                </span>
                <span className="companies-list-meta">
                  #{lead.leadNumber}
                  {lead.companyInfo?.leadType
                    ? ` · ${lead.companyInfo.leadType}`
                    : ""}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <main className="companies-detail-panel">
          {!selectedLead && !loading && (
            <p className="companies-empty-note">
              Select a company to see its full record.
            </p>
          )}

          {selectedLead && (
            <>
              <div className="companies-detail-header">
                <div>
                  <h2>
                    {selectedLead.companyInfo?.companyName || "Unnamed company"}
                  </h2>
                  <p>
                    Lead #{selectedLead.leadNumber}
                    {selectedLead.createdAt &&
                      ` · Created ${new Date(
                        selectedLead.createdAt
                      ).toLocaleDateString()}`}
                    {selectedLead.createdBy?.firstName &&
                      ` by ${selectedLead.createdBy.firstName}`}
                  </p>
                </div>
                <button
                  className="companies-edit-btn"
                  onClick={() => setEditingLeadNumber(selectedLead.leadNumber)}
                >
                  Edit this record
                </button>
              </div>

              <section className="companies-section">
                <h3>Company Information</h3>
                {renderSection(
                  selectedLead.companyInfo,
                  COMPANY_FIELDS,
                  EXTRA_COMPANY_LABELS
                )}
              </section>

              <section className="companies-section">
                <h3>Contact Information</h3>
                {CONTACT_ROLES.map((role) => (
                  <div className="companies-subsection" key={role.key}>
                    <h4>{role.label}</h4>
                    {renderSection(
                      selectedLead.contactInfo?.[role.key],
                      contactLabelsFor(role.prefix)
                    )}
                  </div>
                ))}
              </section>

              <section className="companies-section">
                <h3>IT Landscape</h3>
                {showNetNew && (
                  <div className="companies-subsection">
                    <h4>Net New</h4>
                    {renderSection(netNewData, NET_NEW_FIELDS)}
                  </div>
                )}
                {showSap && (
                  <div className="companies-subsection">
                    <h4>SAP Installed Base</h4>
                    {renderSection(sapData, SAP_FIELDS)}
                  </div>
                )}
              </section>

              <section className="companies-section">
                <h3>Notes &amp; Activity</h3>
                {renderDescriptions(selectedLead)}
              </section>
            </>
          )}
        </main>
      </div>

      {editingLeadNumber && (
        <LeadDetails
          leadNumber={editingLeadNumber}
          startInEditMode
          onClose={() => {
            setEditingLeadNumber(null);
            setRefreshTrigger((n) => n + 1);
          }}
          onUpdate={() => setRefreshTrigger((n) => n + 1)}
        />
      )}
    </div>
  );
};

export default Companies;
