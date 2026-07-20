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
        setOptions((prevOptions) => ({
          ...prevOptions,
          ...optionsResponse.data,
          bdmOptions: userNamesResponse.data,
          leadAssignedToOptions: userNamesResponse.data,
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
           ...updatedLead.itLandscape.SAPInstalledBase,
           [name]: value,
         },
       };
     } else if (subSection) {
       updatedLead[section] = {
         ...updatedLead[section],
         [subSection]: { ...updatedLead[section][subSection], [name]: value },
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
      const userId = localStorage.getItem("userId"); // Get userId from localStorage
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
                  <select
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
                  >
                    <option value="">Select {field.label}</option>
                    {options[field.options]?.map((option, index) => (
                      <option key={index} value={option._id || option}>
                        {typeof option === "object" &&
                        option.firstName &&
                        option.lastName
                          ? `${option.firstName} ${option.lastName}`
                          : option}
                      </option>
                    ))}
                  </select>
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

                {/* Render the date picker inline */}
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
                    style={{ flex: "0 0 150px" }}
                  />
                )}
              </div>
            ))}
        </div>
      ))
    : null;
};


  const renderContactFields = (role) => {
    const fields = [
      "name",
      "dlExt",
      "designation",
      "mobile",
      "email",
      "personalEmail",
    ];

    const rows = [];
    for (let i = 0; i < fields.length; i += 3) {
      rows.push(fields.slice(i, i + 3)); // Create rows with 3 fields each
    }

    return (
      <div key={role} className="form-section-ld">
        <h4>{role.charAt(0).toUpperCase() + role.slice(1)}</h4>
        {rows.map((row, rowIndex) => (
          <div className="form-row-ld" key={rowIndex}>
            {row.map((field) => (
              <div className="form-group-ld" key={field}>
                <label>{field.charAt(0).toUpperCase() + field.slice(1)}:</label>
                <input
                  type="text"
                  name={field}
                  value={editedLead?.contactInfo?.[role]?.[field] || ""}
                  onChange={(e) => handleInputChange(e, "contactInfo", role)}
                  disabled={!editMode}
                />
              </div>
            ))}
          </div>
        ))}
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
