import React, { useState, useEffect } from "react";
import axios from "axios";
import LeadDetails from "./LeadDetails";
import "./Display.css";

import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";
import { formatDate } from "../../dateFormat";

const Display = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // A lead created or edited anywhere in the system refreshes this list, so
  // the table is never stale until someone reloads the tab.
  useLiveUpdates(["leads"], () => setRefreshTrigger((n) => n + 1));
  const currentUserId = sessionStorage.getItem("userId");
 const [options, setOptions] = useState({
   verticalOptions: [],
   priorityOptions: [],
   leadAssignedToOptions: [],
   
   partnerOptions: [],
   expiryOptions: [],
   turnOverOptions: [],
   leadTypeOptions: [],
 });
 const [filters, setFilters] = useState({
   companyName: "",
   cityName: "",
   vertical: "",
   priority: "",
   contractExpiry: "",
   supportPartner: "",
   turnOver: "",
   leadType: "",
   team: "",
   allLeads: "all",
 });


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
         leadAssignedToOptions: userNamesResponse.data,
       }));
     } catch (error) {
       console.error("Error fetching options", error);
     }
   };
   fetchOptions();
 }, []);


 const handleFilterChange = (e) => {
   setFilters({
     ...filters,
     [e.target.name]: e.target.value,
   });
 };


  // openForEdit: skip the read-only view and land straight in an editable form
  const handleLeadClick = (leadNumber, openForEdit = false) => {
    setSelectedLead(leadNumber);
    setOpenInEditMode(openForEdit);
  };

  const handleCloseDetails = () => {
    setSelectedLead(null);
    setOpenInEditMode(false);
    setRefreshTrigger((prev) => prev + 1); // Trigger a refresh when closing LeadDetails
  };

  const handleLeadUpdate = () => {
    setRefreshTrigger((prev) => prev + 1); // Trigger a refresh when a lead is updated
  };

    useEffect(() => {
    const token = sessionStorage.getItem("token");

    if (!token) {
      setError("No authentication token found. Please log in again.");
      setLoading(false);
      return;
    }

    const fetchLeads = async () => {
      try {
        const response = await axios.get(`${API_BASE_URL}/api/leads`, {
          headers: { Authorization: `Bearer ${token}` },
          params: {
            userId: currentUserId,
            ...filters,
          },
        });
        setLeads(response.data);
      } catch (err) {
        setError(err.response?.data?.error || err.message || "An unknown error occurred");
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [refreshTrigger, currentUserId, filters]);

  const getAssignedUser = (lead) => {
    const assignedUser = lead.companyInfo?.leadAssignedTo;
    const list = Array.isArray(assignedUser) ? assignedUser : assignedUser ? [assignedUser] : [];
    const names = list
      .filter((u) => u && typeof u === "object")
      .map((u) => `${u.firstName} ${u.lastName}`.trim())
      .filter(Boolean);
    return names.length ? names.join(", ") : "Not Assigned";
  };

  // Helper function to get the most recent description creation date
  const getLatestDescriptionDate = (lead) => {
    if (lead.descriptions && lead.descriptions.length > 0) {
      const dates = lead.descriptions.map((desc) => new Date(desc.createdAt));
      return formatDate(new Date(Math.max(...dates)));
    }
    return "";
  };

  // Helper function to get phone numbers
  const getPhoneNumbers = (lead) => {
    const phone1 = lead.companyInfo?.genericPhone1 || "";
    const phone2 = lead.companyInfo?.genericPhone2 || "";
    return [phone1, phone2].filter(Boolean).join(", ") || "";
  };

  // if (loading) return <div>Loading...</div>;
  // if (error) return <div>Error: {error}</div>;
  // if (leads.length === 0) return <div>No leads found</div>;

  return (
    <div className="leads-display">
      <h2>My Leads </h2>
      <div className="display-filters">
        <input
          className="display-filter-item"
          type="text"
          name="companyName"
          placeholder="Company Name"
          value={filters.companyName}
          onChange={handleFilterChange}
        />
        <input
          className="display-filter-item"
          type="text"
          name="cityName"
          placeholder="City"
          value={filters.cityName}
          onChange={handleFilterChange}
        />
        <select
          className="display-filter-item"
          name="vertical"
          value={filters.vertical}
          onChange={handleFilterChange}
        >
          <option value="">All Verticals</option>
          {options.verticalOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          className="display-filter-item"
          name="priority"
          value={filters.priority}
          onChange={handleFilterChange}
        >
          <option value="">All Priorities</option>
          {options.priorityOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <select
          className="display-filter-item"
          name="contractExpiry"
          value={filters.contractExpiry}
          onChange={handleFilterChange}
        >
          <option value="">All Expiry Dates</option>
          {options.expiryOptions.map((expiry) => (
            <option key={expiry} value={expiry}>
              {expiry}
            </option>
          ))}
        </select>
        <select
          className="display-filter-item"
          name="supportPartner"
          value={filters.supportPartner}
          onChange={handleFilterChange}
        >
          <option value="">All Support Partners</option>
          {options.partnerOptions.map((partner) => (
            <option key={partner} value={partner}>
              {partner}
            </option>
          ))}
        </select>
        <select
          className="display-filter-item"
          name="turnOver"
          value={filters.turnOver}
          onChange={handleFilterChange}
        >
          <option value="">All Turnover Ranges</option>
          {options.turnOverOptions.map((turnOver) => (
            <option key={turnOver} value={turnOver}>
              {turnOver}
            </option>
          ))}
        </select>
        <select
          className="display-filter-item"
          name="leadType"
          value={filters.leadType}
          onChange={handleFilterChange}
        >
          <option value="">All Lead Types</option>
          {options.leadTypeOptions.map((leadType) => (
            <option key={leadType} value={leadType}>
              {leadType}
            </option>
          ))}
        </select>
        <select
          className="display-filter-item"
          name="allLeads"
          value={filters.allLeads}
          onChange={handleFilterChange}
        >
          <option value="all">All Leads</option>
          <option value="createdByMe">Leads Created by Me</option>
          <option value="assignedToMe">Leads Assigned to Me</option>
        </select>
      </div>

      {/* Show message if no leads are found, but keep the filters visible */}
      {error && <div>Error: {error}</div>}
      {leads.length === 0 && !loading && <div>No leads found</div>}

      <div className="table-scroll-wrapper">
      <table>
        <thead>
          <tr>
            <th>Lead Number</th>
            <th>Creation Date</th>
            <th>Company Name</th>
            <th>Country</th>
            <th>State</th>
            <th>City</th>
            <th>Latest Description Date</th>
            <th>Created By</th>
            <th>Assign To</th>
            <th>Phone</th>
            <th>Action Date</th>
            <th>Priority</th>
            <th>Next Action</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead._id || lead.leadNumber}>
              <td>
                <button
                  className="display-button"
                  onClick={() => handleLeadClick(lead.leadNumber)}
                >
                  {lead.leadNumber || ""}
                </button>
              </td>
              <td>{formatDate(lead.createdAt)}</td>
              <td>
                {lead.companyInfo?.companyName ? (
                  <button
                    className="display-button display-company-button"
                    onClick={() => handleLeadClick(lead.leadNumber, true)}
                    title="Open this company's full form and edit its details"
                  >
                    {lead.companyInfo.companyName}
                  </button>
                ) : (
                  ""
                )}
              </td>
              <td>{lead.companyInfo?.country || ""}</td>
              <td>{lead.companyInfo?.state || ""}</td>
              <td>{lead.companyInfo?.city || ""}</td>
              <td>{getLatestDescriptionDate(lead)}</td>
              <td>{lead.createdBy?.firstName || ""}</td>
              <td>{getAssignedUser(lead)}</td>
              <td>{getPhoneNumbers(lead)}</td>
              <td>
                {formatDate(lead.companyInfo?.dateField)}
              </td>
              <td>{lead.companyInfo?.priority || ""}</td>
              <td>{lead.companyInfo?.nextAction || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      {selectedLead && (
        <LeadDetails
          key={`${selectedLead}-${openInEditMode}`}
          leadNumber={selectedLead}
          onClose={handleCloseDetails}
          onUpdate={handleLeadUpdate}
          startInEditMode={openInEditMode}
        />
      )}
    </div>
  );
};

export default Display;
