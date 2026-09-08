import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom";
import { ROLES, normalizeRole } from "../../roles";
import axios from "axios";
import {
  companyFormConfig,
  contactFormConfig,
  itLandscapeConfig,
} from "../CreateLeads/formConfigs";
import "./LeadDetails.css";

import { API_BASE_URL } from "../../config";
import { formatDateTime } from "../../dateFormat";

// Must stay in step with the Lead Type list on the Create Lead form, otherwise
// a lead saved with a type missing here opens with an empty dropdown and loses
// that value on the next save.
const LEAD_TYPE_OPTIONS = ["Net New", "SAP Installed Base", "PSU's"];

// A populated relation arrives as a user object; the API only ever wants the id.
const idOf = (value) =>
  value && typeof value === "object" ? value._id ?? value.id ?? null : value;

const LeadDetails = ({ leadNumber, onClose, onUpdate, startInEditMode = false }) => {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  // `error` means the record could not be loaded at all; `actionError` is a
  // recoverable failure (save / add note) and must never unmount the form,
  // otherwise a rejected save would discard everything the user just typed.
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState(startInEditMode);
  const [editedLead, setEditedLead] = useState({});
  const [newDescription, setNewDescription] = useState("");
  const [options, setOptions] = useState({});

  useEffect(() => {
    const fetchLeadDetails = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/leads/${leadNumber}`
        );
        setLead(response.data);
        setEditedLead(JSON.parse(JSON.stringify(response.data)));
        // Opening straight into edit mode is only honoured for someone who is
        // actually allowed to save; otherwise the form would accept changes
        // and then be refused.
        if (!response.data.canEdit) setEditMode(false);
      } catch (err) {
        setError(
          err.message || "An error occurred while fetching lead details"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchLeadDetails();
  }, [leadNumber]);

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [optionsResponse, userNamesResponse, bdmResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/options`),
          axios.get(`${API_BASE_URL}/api/users`),
          // Unscoped by the caller's own place in the reporting tree — an
          // Executive's own BDM sits above them and would never show up
          // through the hierarchy-scoped /api/users call.
          axios.get(`${API_BASE_URL}/api/bdms`),
        ]);
        const allUsers = userNamesResponse.data || [];
        const bdmNames = bdmResponse.data || [];
        setOptions((prevOptions) => ({
          ...prevOptions,
          ...optionsResponse.data,
          leadTypeOptions: LEAD_TYPE_OPTIONS,
          bdmOptions: bdmNames,
          leadAssignedToOptions: allUsers,
        }));
      } catch (error) {
        console.error("Error fetching options", error);
      }
    };

    fetchOptions();
  }, []);

  const handleInputChange = (e, section, subSection) => {
    const { name, value } = e.target;
    setEditedLead((prevLead) => {
      const updatedLead = { ...prevLead };
      if (section === "companyInfo") {
        updatedLead.companyInfo = { ...updatedLead.companyInfo, [name]: value };
      } else if (
        section === "itLandscape" &&
        subSection === "SAPInstalledBase"
      ) {
        updatedLead.itLandscape = {
          ...updatedLead.itLandscape,
          SAPInstalledBase: {
            ...updatedLead.itLandscape?.SAPInstalledBase,
            [name]: value,
          },
        };
      } else if (subSection) {
        updatedLead[section] = {
          ...updatedLead[section],
          [subSection]: { ...updatedLead[section]?.[subSection], [name]: value },
        };
      } else {
        updatedLead[section] = { ...updatedLead[section], [name]: value };
      }
      return updatedLead;
    });
  };

  const handleAddDescription = async () => {
    if (!newDescription.trim()) return;
    try {
      setActionError(null);
      const response = await axios.post(
        `${API_BASE_URL}/api/leads/${leadNumber}/descriptions`,
        { description: newDescription }
      );
      // Only the notes list changes here — keep the user's in-progress edits.
      setLead(response.data);
      setEditedLead((prev) => ({
        ...prev,
        descriptions: response.data.descriptions,
      }));
      setNewDescription("");
      if (onUpdate) onUpdate();
    } catch (err) {
      setActionError(
        err.response?.data?.error ||
          err.message ||
          "An error occurred while adding a description"
      );
    }
  };

  // Send only the three editable sections. Notes are owned by the dedicated
  // add-description endpoint; posting them back here would round-trip populated
  // `addedBy` user objects (password hash included) and any file buffers into
  // the record, overwriting the stored notes with denormalised copies.
  const buildPayload = () => {
    const companyInfo = { ...(editedLead.companyInfo || {}) };
    if (companyInfo.leadAssignedTo !== undefined) {
      companyInfo.leadAssignedTo = Array.isArray(companyInfo.leadAssignedTo)
        ? companyInfo.leadAssignedTo.map(idOf)
        : idOf(companyInfo.leadAssignedTo);
    }

    return {
      companyInfo,
      contactInfo: editedLead.contactInfo || {},
      itLandscape: {
        netNew: editedLead.itLandscape?.netNew || {},
        SAPInstalledBase: editedLead.itLandscape?.SAPInstalledBase || {},
      },
    };
  };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    setActionError(null);
    try {
      const response = await axios.put(
        `${API_BASE_URL}/api/leads/${leadNumber}`,
        buildPayload()
      );
      const saved = response.data;
      setLead(saved);
      setEditedLead(JSON.parse(JSON.stringify(saved)));
      setEditMode(false);
      if (onUpdate) onUpdate();
    } catch (err) {
      setActionError(
        err.response?.data?.error || "An error occurred while saving changes"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    // Discard any unsaved edits instead of keeping them in the form.
    setEditedLead(JSON.parse(JSON.stringify(lead)));
    setActionError(null);
    setEditMode(false);
  };

  // Loading and fatal-error states still render inside the modal shell, so the
  // user always has a way back out of an overlay they opened.
  if (loading || error || !lead) {
    return ReactDOM.createPortal(
      <div className="modal">
        <div className="modal-content">
          <h2>Lead Details{leadNumber ? ` - ${leadNumber}` : ""}</h2>
          <button onClick={onClose}>Close</button>
          <p className="lead-details-status">
            {loading
              ? "Loading…"
              : error
              ? `Error: ${error}`
              : "No lead found"}
          </p>
        </div>
      </div>,
      document.body
    );
  }

  // A field may declare showIf to mirror the conditional logic in CreateLeads,
  // e.g. "If no, why" only applies when Using ERP is "No".
  const isFieldVisible = (field, section, subSection) => {
    if (!field.showIf) return true;
    const current = subSection
      ? editedLead?.[section]?.[subSection]?.[field.showIf.field]
      : editedLead?.[section]?.[field.showIf.field];
    return current === field.showIf.equals;
  };

  const renderFields = (config, section, subSection = null) => {
    return Array.isArray(config)
      ? config.map((row, rowIndex) => {
          const visibleRow = Array.isArray(row)
            ? row.filter((field) => isFieldVisible(field, section, subSection))
            : [];
          if (visibleRow.length === 0) return null;

          return (
          <div className="form-row-ld" key={rowIndex}>
            {visibleRow.map((field) => (
                <div
                  className="form-group-ld"
                  key={field.name}
                  style={{ display: "flex", alignItems: "center" }}
                >
                  <label>{field.label}:</label>

                  {field.type === "multiselect" ? (
                    (() => {
                      // An option, and a value stored against this field, is
                      // either a user object (leadAssignedTo — has an id) or a
                      // bare name string (bdm — nothing but the string itself).
                      const idOfOpt = (v) => String(v && typeof v === "object" ? v._id ?? v.id : v);
                      const labelOfOpt = (v) =>
                        v && typeof v === "object" ? `${v.firstName || ""} ${v.lastName || ""}`.trim() : String(v);

                      const raw = subSection
                        ? editedLead?.[section]?.[subSection]?.[field.name]
                        : editedLead?.[section]?.[field.name];
                      const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
                      const ids = list.map(idOfOpt);
                      const allOptions = options[field.options] || [];

                      if (!editMode) {
                        const names = list
                          .map((v) => {
                            if (v && typeof v === "object") return labelOfOpt(v);
                            const match = allOptions.find((o) => idOfOpt(o) === String(v));
                            return match ? labelOfOpt(match) : String(v);
                          })
                          .filter(Boolean);
                        return <span>{names.length ? names.join(", ") : "—"}</span>;
                      }

                      return (
                        <div className="ld-multiselect-checkboxes">
                          {allOptions.map((u) => {
                            const id = idOfOpt(u);
                            return (
                              <label key={id} className="ld-multiselect-option">
                                <input
                                  type="checkbox"
                                  checked={ids.includes(id)}
                                  onChange={() => {
                                    const next = ids.includes(id)
                                      ? ids.filter((v) => v !== id)
                                      : [...ids, id];
                                    handleInputChange(
                                      { target: { name: field.name, value: next } },
                                      section,
                                      subSection
                                    );
                                  }}
                                />
                                <span>{labelOfOpt(u)}</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : field.type === "select" ? (
                    <>
                      <select
                        name={field.name}
                        value={
                          field.name === "vertical" &&
                          (subSection
                            ? editedLead?.[section]?.[subSection]?.[field.name]
                            : editedLead?.[section]?.[field.name]) &&
                          options[field.options] &&
                          !options[field.options].includes(
                            subSection
                              ? editedLead?.[section]?.[subSection]?.[field.name]
                              : editedLead?.[section]?.[field.name]
                          )
                            ? "Others"
                            : (() => {
                                const rawVal = subSection
                                  ? editedLead?.[section]?.[subSection]?.[field.name]
                                  : editedLead?.[section]?.[field.name];
                                return (rawVal && typeof rawVal === "object") ? (rawVal._id || rawVal.id || "") : (rawVal || "");
                              })()
                        }
                        onChange={(e) => {
                          if (field.name === "vertical" && e.target.value === "Others") {
                            handleInputChange(
                              { target: { name: field.name, value: "Others" } },
                              section,
                              subSection
                            );
                          } else {
                            handleInputChange(e, section, subSection);
                          }
                        }}
                        disabled={!editMode}
                        style={{ marginRight: "10px" }}
                      >
                        <option value="" disabled>Select {field.label}</option>
                        {(options[field.options] || (field.name === "leadType" ? LEAD_TYPE_OPTIONS : []))?.map((option, index) => (
                          <option key={index} value={option._id || option}>
                            {typeof option === "object" &&
                            option.firstName &&
                            option.lastName
                              ? `${option.firstName} ${option.lastName}`
                              : option}
                          </option>
                        ))}
                      </select>
                      {field.name === "vertical" &&
                        ((subSection
                          ? editedLead?.[section]?.[subSection]?.[field.name] === "Others"
                          : editedLead?.[section]?.[field.name] === "Others") ||
                          ((subSection
                            ? editedLead?.[section]?.[subSection]?.[field.name]
                            : editedLead?.[section]?.[field.name]) &&
                            options[field.options] &&
                            !options[field.options].includes(
                              subSection
                                ? editedLead?.[section]?.[subSection]?.[field.name]
                                : editedLead?.[section]?.[field.name]
                            ))) && (
                          <input
                            type="text"
                            name="verticalCustom"
                            placeholder="Specify custom vertical..."
                            value={
                              (subSection
                                ? editedLead?.[section]?.[subSection]?.[field.name]
                                : editedLead?.[section]?.[field.name]) === "Others"
                                  ? ""
                                  : (subSection
                                      ? editedLead?.[section]?.[subSection]?.[field.name]
                                      : editedLead?.[section]?.[field.name])
                            }
                            onChange={(e) => {
                              handleInputChange(
                                { target: { name: field.name, value: e.target.value || "Others" } },
                                section,
                                subSection
                              );
                            }}
                            disabled={!editMode}
                            style={{ padding: "4px 8px", border: "1px solid #ccc", borderRadius: "4px" }}
                          />
                        )}
                    </>
                  ) : (
                    <input
                      type={field.type}
                      name={field.name}
                      value={
                        subSection
                          ? editedLead?.[section]?.[subSection]?.[field.name] || ""
                          : editedLead?.[section]?.[field.name] || ""
                      }
                      onChange={(e) =>
                        handleInputChange(e, section, subSection)
                      }
                      disabled={!editMode}
                      style={{ marginRight: "10px" }}
                    />
                  )}

                  {field.datePicker && (
                    <input
                      type="date"
                      name={field.datePicker.name}
                      value={
                        editedLead?.[section]?.[field.datePicker.name] || ""
                      }
                      onChange={(e) =>
                        handleInputChange(e, section, subSection)
                      }
                      disabled={!editMode}
                    />
                  )}
                </div>
              ))}
          </div>
          );
        })
      : null;
  };

  const renderContactFields = (role) => {
    const contactData = editedLead.contactInfo?.[role] || {};
    const fieldsConfig = contactFormConfig.find((c) => c.role.toLowerCase().replace(/\s+/g, '') === role.toLowerCase() || (role === 'businessHead' && c.role === 'Business Head'))?.fields || [];

    // The config names fields itName / itMobile, but the server stores them as
    // contactInfo.it.name / .mobile — strip the role prefix to read the value.
    const storedKeyFor = (fieldName) =>
      fieldName.slice(role.length).charAt(0).toLowerCase() +
      fieldName.slice(role.length + 1);

    // Undefined means "never explicitly marked" — treated as active so every
    // contact saved before this field existed doesn't suddenly read inactive.
    const isActive = contactData.active !== false;

    return (
      <div className={`contact-role-ld ${!isActive ? "is-inactive-contact" : ""}`}>
        <div className="ld-contact-head-row">
          <h4>{role.toUpperCase()} Contact</h4>
          <label className="ld-active-toggle">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => {
                const checked = e.target.checked;
                setEditedLead((prev) => ({
                  ...prev,
                  contactInfo: {
                    ...prev.contactInfo,
                    [role]: {
                      ...prev.contactInfo?.[role],
                      active: checked,
                    },
                  },
                }));
              }}
              disabled={!editMode}
            />
            {isActive ? "Active" : "No longer with the company"}
          </label>
        </div>
        <div className="form-row-ld">
          {fieldsConfig.map((field) => {
            const storedKey = storedKeyFor(field.name);
            return (
            <div className="form-group-ld" key={field.name}>
              <label>{field.label}:</label>
              <input
                type={field.type}
                name={field.name}
                value={contactData[storedKey] || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditedLead((prev) => ({
                    ...prev,
                    contactInfo: {
                      ...prev.contactInfo,
                      [role]: {
                        ...prev.contactInfo?.[role],
                        [storedKey]: val,
                      },
                    },
                  }));
                }}
                disabled={!editMode}
              />
            </div>
            );
          })}
        </div>
      </div>
    );
  };

  // Contacts beyond the three fixed roles — however many the lead needs.
  // Mirrors CreateLeads' "Other Contact Section" pattern so a lead is never
  // stuck with only the contacts it happened to have at creation time.
  const additionalContacts = editedLead.contactInfo?.additional || [];

  const updateAdditionalContact = (index, key, value) => {
    setEditedLead((prev) => {
      const list = [...(prev.contactInfo?.additional || [])];
      list[index] = { ...list[index], [key]: value };
      return { ...prev, contactInfo: { ...prev.contactInfo, additional: list } };
    });
  };

  const addAdditionalContact = () => {
    setEditedLead((prev) => {
      const list = [...(prev.contactInfo?.additional || [])];
      list.push({ sectionTitle: `Other Contact Section ${list.length + 1}` });
      return { ...prev, contactInfo: { ...prev.contactInfo, additional: list } };
    });
  };

  const removeAdditionalContact = (index) => {
    setEditedLead((prev) => {
      const list = (prev.contactInfo?.additional || []).filter((_, i) => i !== index);
      return { ...prev, contactInfo: { ...prev.contactInfo, additional: list } };
    });
  };

  const renderAdditionalContacts = () => {
    // Same six fields every fixed contact role uses (name, dlExt,
    // designation, mobile, email, personalEmail), with the "it" prefix
    // stripped, matching how they're stored on each section object.
    const baseFields = (contactFormConfig.find((c) => c.role === "IT")?.fields || []).map(
      (f) => ({ ...f, name: f.name.replace(/^it/, "").toLowerCase() })
    );

    return (
      <div className="ld-additional-contacts">
        {additionalContacts.map((section, index) => {
          const isActive = section.active !== false;
          return (
          <div
            className={`contact-role-ld ld-additional-contact-block ${!isActive ? "is-inactive-contact" : ""}`}
            key={index}
          >
            <div className="ld-additional-contact-head">
              {editMode ? (
                <input
                  type="text"
                  className="ld-section-title-input"
                  value={section.sectionTitle || `Other Contact Section ${index + 1}`}
                  onChange={(e) => updateAdditionalContact(index, "sectionTitle", e.target.value)}
                  placeholder="e.g. Procurement Head, CTO, Operations..."
                />
              ) : (
                <h4>{section.sectionTitle || `Other Contact Section ${index + 1}`}</h4>
              )}
              <label className="ld-active-toggle">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => updateAdditionalContact(index, "active", e.target.checked)}
                  disabled={!editMode}
                />
                {isActive ? "Active" : "No longer with the company"}
              </label>
              {editMode && (
                <button
                  type="button"
                  className="ld-remove-contact-btn"
                  onClick={() => removeAdditionalContact(index)}
                  title="Remove this contact section"
                >
                  ✕ Remove
                </button>
              )}
            </div>
            <div className="form-row-ld">
              {baseFields.map((field) => (
                <div className="form-group-ld" key={field.name}>
                  <label>{field.label}:</label>
                  <input
                    type={field.type}
                    value={section[field.name] || ""}
                    onChange={(e) => updateAdditionalContact(index, field.name, e.target.value)}
                    disabled={!editMode}
                  />
                </div>
              ))}
            </div>
          </div>
          );
        })}

        {editMode && (
          <button type="button" className="ld-add-contact-btn" onClick={addAdditionalContact}>
            + Add Other Contact Section
          </button>
        )}
      </div>
    );
  };

  // Only the entry explicitly tagged at creation (CreateLeads' required
  // "Description" field) describes the lead itself — everything else,
  // including every note added later from the lead's own Edit form *and*
  // every note logged when returning a Cold-pulled lead to the pool (they
  // write into this exact same array), is a genuine activity entry and
  // belongs in the log, newest first. A lead with no tagged entry (older
  // data, or one whose pull history was reset) simply has no separate
  // Description section — every note it has is activity.
  const allDescriptions = lead.descriptions || [];
  const leadDescription = allDescriptions.find((d) => d.type === "description") || null;
  const activityEntries = allDescriptions
    .map((desc, index) => ({ ...desc, _index: index }))
    .filter((desc) => desc.type !== "description")
    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  // Rendered via a portal to document.body — this component gets mounted
  // from all over the app (Home's header search, lead lists, Cold Leads,
  // etc.), and some of those ancestors (the Home dashboard in particular)
  // apply a CSS `zoom` for its fluid-scale layout. `zoom` on an ancestor can
  // throw off a plain `position: fixed` overlay's coordinates, which showed
  // up as this modal opening pinned near the top of the page instead of
  // centered. A portal renders straight under <body>, outside any such
  // ancestor, so centering is always relative to the real viewport.
  return ReactDOM.createPortal(
    <div className="modal">
      <div className="modal-content ld-modal-content">
        <header className="ld-header">
          <div className="ld-header-title">
            <h2>{lead.companyInfo?.companyName || `Lead #${lead.leadNumber}`}</h2>
            <span className="ld-header-subtitle">Lead #{lead.leadNumber}</span>
          </div>
          <div className="ld-header-actions">
            {!lead.canEdit && (
              <span className="lead-readonly-note">
                View only — editable by its creator, their manager, whoever
                it's assigned to, or an Admin.
              </span>
            )}
            {editMode && (
              <button
                className="ld-btn ld-btn-save"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save Changes"}
              </button>
            )}
            {lead.canEdit && (
              <button
                className="ld-btn ld-btn-edit"
                onClick={() => (editMode ? handleCancel() : setEditMode(true))}
                disabled={saving}
              >
                {editMode ? "Cancel" : "Edit"}
              </button>
            )}
            <button className="ld-btn ld-btn-close" onClick={onClose} disabled={saving}>
              Close
            </button>
          </div>
        </header>

        {actionError && (
          <p className="lead-details-error" role="alert">
            {actionError}
          </p>
        )}

        {/* Bulk-imported leads land in the Cold Pool with most fields
            deliberately blank — this is the nudge to fill them in once
            someone has actually called the contact. Soft, not blocking. */}
        {lead.companyInfo?.importMeta?.missingFields?.length > 0 && (
          <p className="lead-details-import-banner">
            📥 Bulk-imported from "{lead.companyInfo.importMeta.originalFileName}" —
            please fill in after calling: {lead.companyInfo.importMeta.missingFields.join(", ")}.
          </p>
        )}

        <div className="ld-body">
          {/* Main details — everything but the activity log, independently
              scrollable so a long form never pushes the activity panel out
              of view. */}
          <div className="ld-main">
            {leadDescription && (
              <section className="form-section-ld ld-description-section">
                <h3>Description</h3>
                <p className="ld-description-text">{leadDescription.description}</p>
                <span className="ld-description-meta">
                  Added by{" "}
                  {leadDescription.addedBy?.firstName ||
                    (leadDescription.addedBy ? `User #${idOf(leadDescription.addedBy)}` : "Unknown")}
                  {leadDescription.createdAt
                    ? ` · ${formatDateTime(leadDescription.createdAt)}`
                    : ""}
                </span>
              </section>
            )}

            <section className="form-section-ld">
              <h3>Company Information</h3>
              {renderFields(companyFormConfig, "companyInfo")}
            </section>

            <section className="form-section-ld">
              <h3>Contact Information</h3>
              {renderContactFields("it")}
              {renderContactFields("finance")}
              {renderContactFields("businessHead")}
              {renderAdditionalContacts()}
            </section>

            <section className="form-section-ld">
              <h3>IT Landscape</h3>
              <h4>Net New</h4>
              {renderFields(itLandscapeConfig.netNew, "itLandscape", "netNew")}
              <h4>SAP Installed Base</h4>
              {renderFields(
                itLandscapeConfig.SAPInstalledBase,
                "itLandscape",
                "SAPInstalledBase"
              )}
            </section>
          </div>

          {/* Activity — persistent on the right so who-did-what-and-when is
              always visible while the rest of the lead is being reviewed or
              edited, instead of being buried below a long form. */}
          <aside className="ld-activity">
            <div className="ld-activity-head">
              <h3>Activity</h3>
              <span className="ld-activity-count">
                {activityEntries.length} entr{activityEntries.length === 1 ? "y" : "ies"}
              </span>
            </div>

            <div className="ld-activity-add">
              <textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder={
                  editMode
                    ? "Log what you did — a call, an email, a note for the next person…"
                    : "Enter Edit mode to log an action"
                }
                disabled={!editMode}
              />
              <button
                className="ld-btn ld-btn-add-activity"
                onClick={handleAddDescription}
                disabled={!editMode || !newDescription.trim()}
              >
                Add Action
              </button>
            </div>

            <div className="ld-activity-list">
              {activityEntries.length === 0 ? (
                <p className="ld-activity-empty">
                  No actions logged yet for this lead.
                </p>
              ) : (
                activityEntries.map((desc) => (
                  <div className="ld-activity-item" key={desc._index}>
                    <div className="ld-activity-item-head">
                      <span className="ld-activity-author">
                        {desc.addedBy?.firstName ||
                          (desc.addedBy ? `User #${idOf(desc.addedBy)}` : "Unknown")}
                      </span>
                      <span className="ld-activity-time">
                        {desc.createdAt
                          ? formatDateTime(desc.createdAt)
                          : "—"}
                      </span>
                    </div>
                    <p className="ld-activity-text">{desc.description}</p>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default LeadDetails;
