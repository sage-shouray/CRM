import React, { useEffect, useState } from "react";
import { ToastContainer } from "react-toastify";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faBell, 
  faCalendarCheck, 
  faChartLine, 
  faTasks, 
  faPlus, 
  faList, 
  faLayerGroup, 
  faExclamationTriangle,
  faArrowRight,
  faSpinner,
  faBuilding,
  faPhone,
  faClock,
  faShieldHalved,
  faUserGear,
  faUserCheck
} from "@fortawesome/free-solid-svg-icons";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import "./Home.css";
import useAuthGuard from "./useAuthGuard";
import HomeCalendar from "./HomeCalendar";
import HomeToDoWidget from "./HomeToDoWidget";
import LeadDetails from "../Leads/LeadDetails";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

function Home() {
  useAuthGuard();

  const navigate = useNavigate();

  const [userRole, setUserRole] = useState("");
  const [userName, setUserName] = useState("");

  const [leads, setLeads] = useState([]);
  const [toDoTasks, setToDoTasks] = useState([]);
  const [isLoadingLeads, setIsLoadingLeads] = useState(true);
  const [selectedLeadNumber, setSelectedLeadNumber] = useState(null);

  // Selected date for calendar filtering (default: Today YYYY-MM-DD)
  const getTodayStr = () => new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(getTodayStr);

  useEffect(() => {
    const role = localStorage.getItem("userRole") || "subuser";
    const name = localStorage.getItem("loggedInUser") || "User";

    setUserRole(role);
    setUserName(name);

    fetchDashboardLeads();
  }, []);

  const fetchDashboardLeads = async () => {
    setIsLoadingLeads(true);
    try {
      const token = localStorage.getItem("token");
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

  const getPortalTitle = () => {
    const r = (userRole || "").toLowerCase();
    if (r === "admin") return "ADMINISTRATOR PORTAL";
    if (r === "supervisor") return "SUPERVISOR PORTAL";
    return "SUBUSER PORTAL";
  };

  // Convert leads nextAction / createdAt into calendar events format
  const calendarEvents = [];

  leads.forEach((lead) => {
    const actionDate = lead.companyInfo?.nextActionDate 
      ? lead.companyInfo.nextActionDate.split("T")[0]
      : lead.createdAt 
      ? lead.createdAt.split("T")[0]
      : null;

    if (actionDate) {
      calendarEvents.push({
        id: `lead-${lead.leadNumber}`,
        type: 'followup',
        date: actionDate,
        title: `Follow-up: ${lead.companyInfo?.companyName || 'Lead #' + lead.leadNumber}`,
        leadNumber: lead.leadNumber,
        nextAction: lead.companyInfo?.nextAction || 'Follow Up',
        priority: lead.companyInfo?.priority || 'Medium',
        companyName: lead.companyInfo?.companyName || 'N/A',
        phone: lead.companyInfo?.genericPhone1 || 'N/A'
      });
    }
  });

  toDoTasks.forEach((task) => {
    if (task.dueDate) {
      calendarEvents.push({
        id: task.id,
        type: 'task',
        date: task.dueDate,
        title: task.title,
        priority: task.priority,
        category: task.category,
        status: task.status || (task.completed ? 'done' : 'pending')
      });
    }
  });

  const todayStr = getTodayStr();
  const followupsToday = calendarEvents.filter(e => e.date === todayStr && e.type === 'followup');
  const tasksToday = toDoTasks.filter(t => (t.dueDate === todayStr || t.status === "pending") && t.status !== "done");

  const agendaEventsForSelectedDate = calendarEvents.filter(e => e.date === selectedDate);
  const selectedDateFollowups = agendaEventsForSelectedDate.filter(e => e.type === 'followup');
  const selectedDateTasks = agendaEventsForSelectedDate.filter(e => e.type === 'task');

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
      {/* Clean Humanized Page Header */}
      <div className="dashboard-page-header">
        <div className="header-text-block">
          <div className="header-subtitle-row">
            <span className="role-badge-text">{getPortalTitle()}</span>
            <span className="bullet-dot">•</span>
            <span className="greeting-subtext">{getGreeting()}</span>
          </div>
          <h1 className="dashboard-welcome-heading">Welcome back, {userName}</h1>
          <p className="dashboard-description-text">Here is your real-time sales pipeline and agenda overview.</p>
        </div>

        <div className="header-action-group">
          <button onClick={() => navigate("/create-lead")} className="btn-header-action btn-primary-action">
            <FontAwesomeIcon icon={faPlus} />
            <span>Create Lead</span>
          </button>
          <button onClick={() => navigate("/leads")} className="btn-header-action btn-secondary-action">
            <FontAwesomeIcon icon={faList} />
            <span>Lead Directory</span>
          </button>
          {(userRole === "admin" || userRole === "supervisor") && (
            <button onClick={() => navigate("/unassigned-leads")} className="btn-header-action btn-secondary-action">
              <FontAwesomeIcon icon={faLayerGroup} />
              <span>Unassigned</span>
            </button>
          )}
        </div>
      </div>

      {/* Modern Clean Stat Cards Row */}
      <div className="dashboard-metrics-row">
        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Follow-ups Today</span>
            <div className="stat-icon-wrapper icon-orange">
              <FontAwesomeIcon icon={faBell} />
            </div>
          </div>
          <div className="stat-card-body">
            <span className="stat-number">{followupsToday.length}</span>
            <span className="stat-subtext">scheduled for {selectedDate === todayStr ? "today" : selectedDate}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Pending Tasks</span>
            <div className="stat-icon-wrapper icon-blue">
              <FontAwesomeIcon icon={faTasks} />
            </div>
          </div>
          <div className="stat-card-body">
            <span className="stat-number">{tasksToday.length}</span>
            <span className="stat-subtext">requiring action</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-header">
            <span className="stat-card-title">Active Pipeline Leads</span>
            <div className="stat-icon-wrapper icon-emerald">
              <FontAwesomeIcon icon={faChartLine} />
            </div>
          </div>
          <div className="stat-card-body">
            <span className="stat-number">{leads.length}</span>
            <span className="stat-subtext">total visible leads</span>
          </div>
        </div>
      </div>

      {/* 3-Column Responsive Grid Layout */}
      <div className="dashboard-three-column-grid">
        {/* Column 1: Interactive Calendar */}
        <div className="grid-col col-calendar">
          <HomeCalendar
            events={calendarEvents}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </div>

        {/* Column 2: Schedule Agenda & Reminders Panel */}
        <div className="grid-col col-agenda">
          <div className="agenda-card">
            <div className="agenda-header">
              <div className="agenda-title-box">
                <FontAwesomeIcon icon={faBell} className="agenda-header-icon" />
                <div>
                  <h3>Schedule Agenda</h3>
                  <p>{selectedDate === todayStr ? "Today's Schedule" : selectedDate} • {agendaEventsForSelectedDate.length} item(s)</p>
                </div>
              </div>
              {selectedDate !== todayStr && (
                <button
                  onClick={() => setSelectedDate(todayStr)}
                  className="btn-back-today"
                  title="Jump to Today's Agenda"
                >
                  Return Today
                </button>
              )}
            </div>

            {selectedDate === todayStr && followupsToday.length > 0 && (
              <div className="reminder-alert-banner">
                <FontAwesomeIcon icon={faExclamationTriangle} className="alert-icon" />
                <span>
                  <strong>{followupsToday.length} lead follow-up(s)</strong> require action today!
                </span>
              </div>
            )}

            <div className="agenda-items-container">
              {isLoadingLeads ? (
                <div className="agenda-loading">
                  <FontAwesomeIcon icon={faSpinner} spin className="spinner-icon" />
                  <span>Fetching schedule items...</span>
                </div>
              ) : agendaEventsForSelectedDate.length === 0 ? (
                <div className="agenda-empty-state">
                  <FontAwesomeIcon icon={faCalendarCheck} className="empty-cal-icon" />
                  <h4>No follow-ups scheduled</h4>
                  <p>No lead follow-ups or work tasks on {selectedDate}. Pick another date on the calendar.</p>
                </div>
              ) : (
                <div className="agenda-scroll-list">
                  {selectedDateFollowups.length > 0 && (
                    <div className="agenda-group">
                      <h4 className="group-title">
                        <FontAwesomeIcon icon={faBell} /> Lead Follow-ups ({selectedDateFollowups.length})
                      </h4>
                      {selectedDateFollowups.map((item) => (
                        <div key={item.id} className="agenda-item-card followup-card">
                          <div className="item-main-details">
                            <div className="lead-name-row">
                              <FontAwesomeIcon icon={faBuilding} className="building-icon" />
                              <span className="lead-company-name">{item.companyName}</span>
                              <span className={`priority-badge prio-${(item.priority || 'medium').toLowerCase()}`}>
                                {item.priority}
                              </span>
                            </div>

                            <div className="lead-sub-info">
                              <span><FontAwesomeIcon icon={faClock} /> {item.nextAction}</span>
                              <span><FontAwesomeIcon icon={faPhone} /> {item.phone}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleOpenLead(item.leadNumber)}
                            className="btn-view-lead"
                            title="View Full Lead Profile"
                          >
                            <span>Details</span>
                            <FontAwesomeIcon icon={faArrowRight} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {selectedDateTasks.length > 0 && (
                    <div className="agenda-group">
                      <h4 className="group-title">
                        <FontAwesomeIcon icon={faTasks} /> Work Tasks ({selectedDateTasks.length})
                      </h4>
                      {selectedDateTasks.map((task) => (
                        <div key={task.id} className="agenda-item-card task-card">
                          <div className="item-main-details">
                            <span className="task-item-title">{task.title}</span>
                            <div className="lead-sub-info">
                              <span className={`priority-badge prio-${(task.priority || 'medium').toLowerCase()}`}>
                                {task.priority} Priority
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Column 3: Integrated To-Do List Widget */}
        <div className="grid-col col-todo">
          <HomeToDoWidget onTaskUpdate={setToDoTasks} />
        </div>
      </div>

      {/* Lead Details Drawer Window */}
      {selectedLeadNumber && (
        <LeadDetails
          leadNumber={selectedLeadNumber}
          onClose={handleCloseLeadDetails}
          onUpdate={handleCloseLeadDetails}
        />
      )}

      <ToastContainer />
    </div>
  );
}

export default Home;
