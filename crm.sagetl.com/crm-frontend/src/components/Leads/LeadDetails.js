import React, { useState, useEffect } from "react";
import axios from "axios";
import {
  companyFormConfig,
  contactFormConfig,
  itLandscapeConfig,
} from "../CreateLeads/formConfigs";
import "./LeadDetails.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

const LeadDetails = ({ leadNumber, onClose, onUpdate }) => {
  const [lead, setLead] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editMode, setEditMode] = useState(false);
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
          .filter(user => (user.designation || "").toUpperCase() === "BDM")
          .map(user => user.firstName);
        setOptions((prevOptions) => ({
          ...prevOptions,
          ...optionsResponse.data,
          leadTypeOptions: ["Net New", "SAP Installed Base"],
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
      const userId = localStorage.getItem("userId");
      const response = await axios.post(
        `${API_BASE_URL}/api/leads/${leadNumber}/descriptions`,
        { description: newDescription, userId }
      );
      setLead(response.data);
      setEditedLead(response.data);
      setNewDescription("");
    } catch (err) {
      setError(err.message || "An error occurred while adding a description");
    }
  };

  const handleSave = async () => {
    try {
      const leadToSave = {
        ...editedLead,
        itLandscape: {
          ...editedLead.itLandscape,
          SAPInstalledBase: editedLead.itLandscape?.SAPInstalledBase || {},
        },
      };

      const response = await axios.put(
        `${API_BASE_URL}/api/leads/${leadNumber}`,
        leadToSave
      );
      setLead(response.data);
      setEditMode(false);
      onUpdate();
    } catch (err) {
      setError(
        err.response?.data?.error || "An error occurred while saving changes"
      );
    }
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (!lead) return <div>No lead found</div>;

  const renderFields = (config, section, subSection = null) => {
    return Array.isArray(config)
      ? config.map((row, rowIndex) => (
          <div className="form-row-ld" key={rowIndex}>
            {Array.isArray(row) &&
              row.map((field) => (
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
                        {(options[field.options] || (field.name === "leadType" ? ["Net New", "SAP Installed Base"] : []))?.map((option, index) => (
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
        ))
      : null;
  };

  const renderContactFields = (role) => {
    const contactData = editedLead.contactInfo?.[role] || {};
    const fieldsConfig = contactFormConfig.find((c) => c.role.toLowerCase().replace(/\s+/g, '') === role.toLowerCase() || (role === 'businessHead' && c.role === 'Business Head'))?.fields || [];

    return (
      <div className="contact-role-ld">
        <h4>{role.toUpperCase()} Contact</h4>
        <div className="form-row-ld">
          {fieldsConfig.map((field) => (
            <div className="form-group-ld" key={field.name}>
              <label>{field.label}:</label>
              <input
                type={field.type}
                name={field.name}
                value={contactData[field.name] || ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditedLead((prev) => ({
                    ...prev,
                    contactInfo: {
                      ...prev.contactInfo,
                      [role]: {
                        ...prev.contactInfo?.[role],
                        [field.name]: val,
                      },
                    },
                  }));
                }}
                disabled={!editMode}
              />
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="modal">
      <div className="modal-content">
        <h2>Lead Details - {lead.leadNumber}</h2>
        <button onClick={onClose}>Close</button>
        <button onClick={() => setEditMode(!editMode)}>
          {editMode ? "Cancel" : "Edit"}
        </button>
        {editMode && <button onClick={handleSave}>Save Changes</button>}

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
                    <td>{new Date(desc.createdAt).toLocaleString()}</td>
                    <td>{desc.addedBy ? desc.addedBy.firstName : "Unknown"}</td>
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
