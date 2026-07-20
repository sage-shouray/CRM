import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import LeadDetails from "../Leads/LeadDetails"; // Ensure you have this component
import "./UserLeads.css";

const UserLeads = () => {
  const { userId } = useParams(); // Get userId from the route params
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedLead, setSelectedLead] = useState(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const currentUserId = localStorage.getItem("userId");

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
        const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';
        const response = await axios.get(
          `${API_BASE_URL}/api/users/${userId}/leads`, // Update this URL to fetch leads for the specific user
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );
        console.log(response.data);
        if (response.data && Array.isArray(response.data.leads)) {
          setLeads(response.data.leads);
        } else {
          console.error(
            "Invalid data format received from server:",
            response.data
          );
          throw new Error("Invalid data format received from server");
        }
      } catch (err) {
        console.error("Error fetching leads:", err);
        setError(
          err.response?.data?.error ||
            err.message ||
            "An unknown error occurred"
        );
      } finally {
        setLoading(false);
      }
    };

    fetchLeads();
  }, [refreshTrigger, userId]);

  // Helper functions for rendering lead details
  const getAssignedUser = (lead) => {
    const assigned = lead.companyInfo?.leadAssignedTo;
    return assigned
      ? `${assigned.firstName} ${assigned.lastName}`
      : "Not Assigned";
  };

  const getLatestDescriptionDate = (lead) => {
    if (lead.descriptions && lead.descriptions.length > 0) {
      const dates = lead.descriptions.map((desc) => new Date(desc.createdAt));
      return new Date(Math.max(...dates)).toLocaleDateString();
    }
    return "";
  };

  const getPhoneNumbers = (lead) => {
    const phone1 = lead.companyInfo?.["Generic Phone 1"] || "";
    const phone2 = lead.companyInfo?.["Generic Phone 2"] || "";
    return [phone1, phone2].filter(Boolean).join(", ") || "";
  };

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;
  if (leads.length === 0) return <div>No leads found for this user.</div>;

  return (
    <div className="user-leads-container">
      <h2 className="user-heading">Leads</h2>
      <div >
        <table>
          <thead>
            <tr>
              <th>Lead Number</th>
              <th>Creation Date</th>
              <th>Company Name</th>
              <th>Latest Description Date</th>
              <th>Created By</th>
              <th>Assigned To</th>
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
                <td>{lead.companyInfo?.["Company Name"] || ""}</td>
                <td>{getLatestDescriptionDate(lead)}</td>
                <td>{lead.createdBy?.firstName || ""}</td>
                <td>{getAssignedUser(lead)}</td>
                <td>{getPhoneNumbers(lead)}</td>
                <td>
                  {lead.companyInfo?.dateField
                    ? new Date(lead.companyInfo.dateField).toLocaleDateString()
                    : ""}
                </td>
                <td>{lead.companyInfo?.Priority || ""}</td>
                <td>{lead.companyInfo?.["Next Action"] || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

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

export default UserLeads;
