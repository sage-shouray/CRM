import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faList, faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Home.css";
import useAuthGuard from "./useAuthGuard";
import { ROLES, normalizeRole, roleLabel, canManageTeam } from "../../roles";
import LeadsWorkspace from "./LeadsWorkspace";
import TodaysWorkWidget from "./TodaysWorkWidget";
// The pipeline funnel lives on its own page (/pipeline); the dashboard keeps
// only the headline figures from it.
import { buildPipeline } from "./pipeline";
import { useDashboard, todayStr } from "../../context/DashboardContext";
import LeadDetails from "../Leads/LeadDetails";

import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";

function Home() {
  useAuthGuard();

  const navigate = useNavigate();

  const [userRole, setUserRole] = useState("");
  const [userName, setUserName] = useState("");

  const [leads, setLeads] = useState([]);
  const [isLoadingLeads, setIsLoadingLeads] = useState(true);
  const [selectedLeadNumber, setSelectedLeadNumber] = useState(null);

  // Tasks are owned by the shared dashboard context, so a task created from the
  // rail shows up here as soon as the context refreshes.
  const { tasks, refresh, selectedDate } = useDashboard();

  // Completing or postponing from a card touches both leads and tasks.
  const refreshAll = () => {
    fetchDashboardLeads();
    refresh();
  };

  useEffect(() => {
    const role = normalizeRole(sessionStorage.getItem("userRole")) || ROLES.EXECUTIVE;
    const name = sessionStorage.getItem("loggedInUser") || "User";

    setUserRole(role);
    setUserName(name);

    fetchDashboardLeads();
  }, []);

  // Leads or tasks changing anywhere refresh the dashboard in place.
  useLiveUpdates(["leads", "tasks"], () => fetchDashboardLeads());

  const fetchDashboardLeads = async () => {
    setIsLoadingLeads(true);
    try {
      const token = sessionStorage.getItem("token");
      if (!token) return;

      const response = await axios.get(`${API_BASE_URL}/api/leads`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setLeads(response.data || []);
    } catch (err) {
      console.error("Error fetching leads for home dashboard:", err);
    } finally {
      setIsLoadingLeads(false);
    }
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return "Good Morning";
    if (hour < 17) return "Good Afternoon";
    return "Good Evening";
  };

  const getPortalTitle = () =>
    `${roleLabel(userRole).toUpperCase()} PORTAL`;

  const todayDate = todayStr();
  const pipeline = buildPipeline(leads);
  const userCity = leads.find((l) => l.companyInfo?.city)?.companyInfo?.city || "";
  const longDate = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const handleOpenLead = (leadNum) => {
    if (leadNum) {
      setSelectedLeadNumber(leadNum);
    }
  };

  const handleCloseLeadDetails = () => {
    setSelectedLeadNumber(null);
    fetchDashboardLeads();
  };

  return (
    <div className="home-dashboard-container compact-dashboard">
      {/* Page header */}
      <div className="dashboard-page-header">
        <div className="header-text-block">
          <div className="header-subtitle-row">
            <span className="role-badge-text">{getPortalTitle()}</span>
            <span className="bullet-dot">•</span>
            <span className="greeting-subtext">{getGreeting()}</span>
          </div>
          <h1 className="dashboard-welcome-heading">Welcome back, {userName}</h1>
          <p className="dashboard-description-text">
            {[userCity, longDate].filter(Boolean).join(" | ")}
          </p>
        </div>

        <div className="header-action-group">
          <button onClick={() => navigate("/create-lead")} className="dash-header-btn btn-primary-action">
            <FontAwesomeIcon icon={faPlus} />
            <span>New Lead</span>
          </button>
          <button onClick={() => navigate("/leads")} className="dash-header-btn btn-secondary-action">
            <FontAwesomeIcon icon={faList} />
            <span>Lead Directory</span>
          </button>
          {canManageTeam(userRole) && (
            <button onClick={() => navigate("/unassigned-leads")} className="dash-header-btn btn-secondary-action">
              <FontAwesomeIcon icon={faLayerGroup} />
              <span>Unassigned Leads</span>
            </button>
          )}
        </div>
      </div>

      {/* Headline numbers, all derived from the same lead set below. */}
      <div className="kpi-row">
        <article className="kpi-card">
          <span className="kpi-label">Total Active Leads</span>
          <strong className="kpi-value">{pipeline.openCount}</strong>
        </article>
        <article className={`kpi-card ${pipeline.overdue > 0 ? "is-alert" : ""}`}>
          <span className="kpi-label">Overdue Actions</span>
          <strong className="kpi-value">{pipeline.overdue}</strong>
        </article>
        <article className="kpi-card">
          <span className="kpi-label">Conversion Rate</span>
          <strong className="kpi-value">
            {pipeline.winRate === null ? "—" : `${pipeline.winRate}%`}
          </strong>
        </article>
      </div>

      <TodaysWorkWidget />

      <div className="workspace-grid">
        <LeadsWorkspace
          leads={leads}
          tasks={tasks}
          todayDate={todayDate}
          selectedDate={selectedDate}
          isLoading={isLoadingLeads}
          onOpenLead={handleOpenLead}
          onRefresh={refreshAll}
        />
      </div>

      {/* Lead Details Drawer Window */}
      {selectedLeadNumber && (
        <LeadDetails
          leadNumber={selectedLeadNumber}
          onClose={handleCloseLeadDetails}
          onUpdate={handleCloseLeadDetails}
        />
      )}

    </div>
  );
}

export default Home;
