import React, { useState, useEffect } from "react";
import { ROLES, normalizeRole } from "../../roles";
import axios from "axios";
import {
  companyFormConfig,
  contactFormConfig,
  itLandscapeConfig,
} from "../CreateLeads/formConfigs";
import "./LeadDetails.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

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
        const [optionsResponse, userNamesResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/options`),
          axios.get(`${API_BASE_URL}/api/users`),
        ]);
        const allUsers = userNamesResponse.data || [];
        const bdmNames = allUsers
          // BDM is a role now, not a free-text designation.
          .filter((user) => normalizeRole(user.role) === ROLES.BDM)
          .map(user => user.firstName);
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
      companyInfo.leadAssignedTo = idOf(companyInfo.leadAssignedTo);
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
    return (
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
      </div>
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

                  {field.type === "select" ? (
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

    return (
      <div className="contact-role-ld">
        <h4>{role.toUpperCase()} Contact</h4>
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

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Lead Details - {lead.leadNumber}</h2>
        <button onClick={onClose} disabled={saving}>
          Close
        </button>
        <button
          onClick={() => (editMode ? handleCancel() : setEditMode(true))}
          disabled={saving}
        >
          {editMode ? "Cancel" : "Edit"}
        </button>
        {editMode && (
          <button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Changes"}
          </button>
        )}

        {actionError && (
          <p className="lead-details-error" role="alert">
            {actionError}
          </p>
        )}

        {/* Company Information */}
        <section className="form-section-ld">
          <h3>Company Information</h3>
          {renderFields(companyFormConfig, "companyInfo")}
        </section>

        {/* Contact Information */}
        <section className="form-section-ld">
          <h3>Contact Information</h3>
          {renderContactFields("it")}
          {renderContactFields("finance")}
          {renderContactFields("businessHead")}
        </section>

        {/* IT Landscape */}
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

        {/* Descriptions */}
        <section className="form-section-ld">
          <h3>Descriptions</h3>
          <div className="form-group">
            <label>New Description:</label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Add a new description"
              disabled={!editMode}
            />
          </div>
          <button onClick={handleAddDescription} disabled={!editMode}>
            Add Description
          </button>

          <table className="descriptions-table">
            <thead>
              <tr>
                <th>Description</th>
                <th>Date</th>
                <th>Added by</th>
              </tr>
            </thead>
            <tbody>
              {lead.descriptions &&
                lead.descriptions.map((desc, index) => (
                  <tr key={index}>
                    <td>{desc.description}</td>
                    <td>
                      {desc.createdAt
                        ? new Date(desc.createdAt).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      {desc.addedBy?.firstName ||
                        (desc.addedBy ? `User #${idOf(desc.addedBy)}` : "Unknown")}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
};

export default LeadDetails;
