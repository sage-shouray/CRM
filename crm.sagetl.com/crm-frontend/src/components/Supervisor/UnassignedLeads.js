import React, { useState, useEffect } from "react";
import axios from "axios";
import LeadDetails from "../Leads/LeadDetails";
import "./UnassignedLeads.css"; // Add a dedicated CSS file for this component

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

const UnassignedLeads = () => {
  const [leads, setLeads] = useState([]);
  const [activeUsers, setActiveUsers] = useState([]);
  const [selectedLeads, setSelectedLeads] = useState([]); // State for selected lead IDs
  const [selectedUserId, setSelectedUserId] = useState(""); // State for selected user ID
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showLeadDetails, setShowLeadDetails] = useState(null); // For showing lead details
  const [options, setOptions] = useState({
    verticalOptions: [],
    priorityOptions: [],
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
    allLeads: "all",
  });

  useEffect(() => {
    const fetchOptions = async () => {
      try {
        const [optionsResponse, userNamesResponse] = await Promise.all([
          axios.get(`${API_BASE_URL}/api/options`),
          axios.get(`${API_BASE_URL}/api/users`),
        ]);
        setOptions((prev) => ({
          ...prev,
          ...optionsResponse.data,
          leadAssignedToOptions: userNamesResponse.data,
        }));
      } catch (err) {
        console.error("Error fetching options", err);
      }
    };
    fetchOptions();
  }, []);

  useEffect(() => {
    const fetchLeads = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/unassigned-leads`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
            params: filters,
          }
        );
        setLeads(response.data);
      } catch (err) {
        setError("Error fetching leads");
      } finally {
        setLoading(false);
      }
    };
    fetchLeads();
  }, [filters]);

  // Fetch active users
  useEffect(() => {
    const fetchActiveUsers = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/active-users`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );
        setActiveUsers(response.data);
      } catch (err) {
        setError("Error fetching active users");
      }
    };

    fetchActiveUsers();
  }, []);

  // Handle lead selection for bulk assignment
  const handleLeadSelection = (leadId) => {
    setSelectedLeads(
      (prevSelectedLeads) =>
        prevSelectedLeads.includes(leadId)
          ? prevSelectedLeads.filter((id) => id !== leadId) // Deselect if already selected
          : [...prevSelectedLeads, leadId] // Add to selection otherwise
    );
  };

  // Handle bulk assignment of selected leads
  const handleAssignLead = async () => {
    if (selectedLeads.length === 0 || !selectedUserId) {
      setError("Please select leads and a user before assigning.");
      return;
    }

    try {
      await axios.put(
        `${API_BASE_URL}/api/leads/assign-bulk`,
        { leadIds: selectedLeads, assignedUserId: selectedUserId },
        {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
        }
      );

      // Refresh leads list to remove reassigned leads
      const response = await axios.get(
        `${API_BASE_URL}/api/unassigned-leads`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem("token")}`,
          },
        }
      );
      setLeads(response.data);

      // Reset selection and user after successful assignment
      setSelectedLeads([]);
      setSelectedUserId("");
    } catch (err) {
      setError("Error assigning leads");
    }
  };

   const handleFilterChange = (e) => {
     setFilters({ ...filters, [e.target.name]: e.target.value });
   };

  const handleReassignClick = (leadId) => {
    setSelectedLeads([leadId]); // Select a single lead for reassignment
  };

  const handleLeadClick = (leadId) => {
    setShowLeadDetails(leadId); // Show details for the selected lead
  };

  const handleCloseDetails = () => {
    setShowLeadDetails(null); // Close the lead details modal
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (leads.length === 0) return <div>No unassigned leads found</div>;

  return (
    <div className="unassigned">
      <h2>Unassigned Leads</h2>
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
      <div>
        <select
          onChange={(e) => setSelectedUserId(e.target.value)}
          value={selectedUserId}
        >
          <option value="">Select a user</option>
          {activeUsers.map((user) => (
            <option key={user._id} value={user._id}>
              {user.firstName} {user.lastName}
            </option>
          ))}
        </select>
        <button
          onClick={handleAssignLead}
          disabled={selectedLeads.length === 0 || !selectedUserId}
          className="bulk-assign-button"
        >
          Bulk Assign
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Select</th>
            <th>Lead Number</th>
            <th>Company Name</th>
            <th>Assigned To (Inactive)</th>
            <th>Priority</th>
            <th>Created By</th>
            <th>Reassign Lead</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((lead) => (
            <tr key={lead._id}>
              <td>
                <input
                  type="checkbox"
                  checked={selectedLeads.includes(lead._id)}
                  onChange={() => handleLeadSelection(lead._id)}
                  className="lead-checkbox"
                />
              </td>
              <td>
                <button
                  onClick={() => handleLeadClick(lead.leadNumber)}
                  className="lead-number-button"
                >
                  {lead.leadNumber || ""}
                </button>
              </td>
              <td>{lead.companyInfo?.companyName || ""}</td>
              <td>{`${lead.companyInfo.leadAssignedTo?.firstName || ""} ${
                lead.companyInfo.leadAssignedTo?.lastName || ""
              }`}</td>
              <td>{lead.companyInfo?.priority}</td>
              <td>
                {lead.createdBy?.firstName || ""}{" "}
                {lead.createdBy?.lastName || ""}
              </td>
              <td>
                {selectedLeads.includes(lead._id) &&
                selectedLeads.length === 1 ? (
                  <>
                    <select
                      onChange={(e) => setSelectedUserId(e.target.value)}
                      value={selectedUserId}
                    >
                      <option value="">Select a user</option>
                      {activeUsers.map((user) => (
                        <option key={user._id} value={user._id}>
                          {user.firstName} {user.lastName}
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={handleAssignLead}
                      className="confirm-button"
                    >
                      Confirm
                    </button>
                    <button
                      onClick={() => setSelectedLeads([])}
                      className="cancel-button"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    className="reassign-btn"
                    onClick={() => handleReassignClick(lead._id)}
                  >
                    Reassign
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* Show LeadDetails component when a lead is selected */}
      {showLeadDetails && (
        <LeadDetails
          leadNumber={showLeadDetails}
          onClose={handleCloseDetails}
        />
      )}
    </div>
  );
};

export default UnassignedLeads;
