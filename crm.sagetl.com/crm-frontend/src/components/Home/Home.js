import React, { useEffect, useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faPlus, faList, faLayerGroup } from "@fortawesome/free-solid-svg-icons";
import { useNavigate } from "react-router-dom";
import "./Home.css";
import useAuthGuard from "./useAuthGuard";
import { ROLES, normalizeRole, roleLabel, canManageTeam } from "../../roles";
import LeadsWorkspace from "./LeadsWorkspace";
import TodaysWorkWidget from "./TodaysWorkWidget";
import PeopleSearch from "./PeopleSearch";
// The pipeline funnel lives on its own page (/pipeline); the dashboard keeps
// only the headline figures from it.
import { buildPipeline } from "./pipeline";
import { useDashboard, todayStr } from "../../context/DashboardContext";
import LeadDetails from "../Leads/LeadDetails";
import { formatLongDate } from "../../dateFormat";

function Home() {
  useAuthGuard();

  const navigate = useNavigate();

  const [userRole, setUserRole] = useState("");
  const [userName, setUserName] = useState("");
  const [selectedLeadNumber, setSelectedLeadNumber] = useState(null);

  // Leads and tasks both come from the one shared dashboard fetch — this
  // page used to run its own separate GET /api/leads on top of the context's,
  // doubling the heaviest query in the app (every lead, fully populated) on
  // every single Home visit for no benefit, since both copies held identical
  // data. One fetch, shared, is all this page needs.
  const { leads, tasks, isLoading: isLoadingLeads, refresh, selectedDate } = useDashboard();

  useEffect(() => {
    const role = normalizeRole(sessionStorage.getItem("userRole")) || ROLES.EXECUTIVE;
    const name = sessionStorage.getItem("loggedInUser") || "User";

    setUserRole(role);
    setUserName(name);
  }, []);

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
  // The office location shown in the greeting — not derived from lead data.
  // It used to be whichever lead happened to be first in the list that had a
  // city set, which had nothing to do with the signed-in user or the
  // company; it just showed a different, effectively random city depending
  // on data order.
  const userCity = "Noida";
  const longDate = formatLongDate();

  const handleOpenLead = (leadNum) => {
    if (leadNum) {
      setSelectedLeadNumber(leadNum);
    }
  };

  const handleCloseLeadDetails = () => {
    setSelectedLeadNumber(null);
    refresh();
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

        {/* Find a lead by the contact person's name instead of the company —
            useful when the person is remembered but which account they sit
            under isn't. Lives in the header row (not its own row below) so
            it costs no extra vertical space on a layout that otherwise fits
            in one screen with no page scroll. */}
        <PeopleSearch />

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
          onRefresh={refresh}
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
