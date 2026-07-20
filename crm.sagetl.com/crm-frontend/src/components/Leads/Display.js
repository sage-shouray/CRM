import React, { useState, useEffect } from "react";
import axios from "axios";
import LeadDetails from "./LeadDetails";
import "./Display.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

const Display = () => {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const currentUserId = localStorage.getItem("userId");
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


  const handleLeadClick = (leadNumber) => {
    setSelectedLead(leadNumber);
  };

  const handleCloseDetails = () => {
    setSelectedLead(null);
    setRefreshTrigger((prev) => prev + 1); // Trigger a refresh when closing LeadDetails
  };

  const handleLeadUpdate = () => {
    setRefreshTrigger((prev) => prev + 1); // Trigger a refresh when a lead is updated
  };

    useEffect(() => {
    const token = localStorage.getItem("token");

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
    return assignedUser
      ? `${assignedUser.firstName} ${assignedUser.lastName}`
      : "Not Assigned";
  };

  // Helper function to get the most recent description creation date
  const getLatestDescriptionDate = (lead) => {
    if (lead.descriptions && lead.descriptions.length > 0) {
      const dates = lead.descriptions.map((desc) => new Date(desc.createdAt));
      return new Date(Math.max(...dates)).toLocaleDateString();
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

      <table>
        <thead>
          <tr>
            <th>Lead Number</th>
            <th>Creation Date</th>
            <th>Company Name</th>
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
              <td>{new Date(lead.createdAt).toLocaleDateString()}</td>
              <td>{lead.companyInfo?.companyName || ""}</td>
              <td>{getLatestDescriptionDate(lead)}</td>
              <td>{lead.createdBy?.firstName || ""}</td>
              <td>{getAssignedUser(lead)}</td>
              <td>{getPhoneNumbers(lead)}</td>
              <td>
                {lead.companyInfo?.dateField
                  ? new Date(lead.companyInfo.dateField).toLocaleDateString()
                  : ""}
              </td>
              <td>{lead.companyInfo?.priority || ""}</td>
              <td>{lead.companyInfo?.nextAction || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedLead && (
        <LeadDetails
          leadNumber={selectedLead}
          onClose={handleCloseDetails}
          onUpdate={handleLeadUpdate}
        />
      )}
    </div>
  );
};

export default Display;
