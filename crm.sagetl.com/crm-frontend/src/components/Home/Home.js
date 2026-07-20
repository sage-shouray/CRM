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
  faClock
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
  const [userId, setUserId] = useState("");

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
    const id = localStorage.getItem("userId") || "";

    setUserRole(role);
    setUserName(name);
    setUserId(id);

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

  // Dynamic portal title text based on user role / credentials
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
    if (task.dueDate && !task.completed) {
      calendarEvents.push({
        id: task.id,
        type: 'task',
        date: task.dueDate,
        title: task.title,
        priority: task.priority,
        category: task.category
      });
    }
  });

  const todayStr = getTodayStr();
  const followupsToday = calendarEvents.filter(e => e.date === todayStr && e.type === 'followup');
  const tasksToday = toDoTasks.filter(t => t.dueDate === todayStr && !t.completed);

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
      {/* Top Banner: Greeting + Dynamic Role Badge + Quick Counters + Action Buttons */}
      <div className="compact-top-banner">
        <div className="banner-left-info">
          <span className="dynamic-role-badge">{getPortalTitle()}</span>
          <h1>Welcome, {userName}!</h1>
        </div>

        <div className="banner-center-kpis">
          <div className="kpi-mini-pill kpi-mini-orange" title="Follow-ups scheduled today">
            <FontAwesomeIcon icon={faBell} />
            <span>Follow-ups: <strong>{followupsToday.length}</strong></span>
          </div>
          <div className="kpi-mini-pill kpi-mini-blue" title="Tasks due today">
            <FontAwesomeIcon icon={faTasks} />
            <span>Tasks Due: <strong>{tasksToday.length}</strong></span>
          </div>
          <div className="kpi-mini-pill kpi-mini-emerald" title="Total active assigned leads">
            <FontAwesomeIcon icon={faChartLine} />
            <span>Active Leads: <strong>{leads.length}</strong></span>
          </div>
        </div>

        <div className="banner-right-actions">
          <button onClick={() => navigate("/create-lead")} className="btn-compact-action primary">
            <FontAwesomeIcon icon={faPlus} /> Create Lead
          </button>
          <button onClick={() => navigate("/leads")} className="btn-compact-action secondary">
            <FontAwesomeIcon icon={faList} /> Directory
          </button>
          {(userRole === "admin" || userRole === "supervisor") && (
            <button onClick={() => navigate("/unassigned-leads")} className="btn-compact-action accent">
              <FontAwesomeIcon icon={faLayerGroup} /> Unassigned
            </button>
          )}
        </div>
      </div>

      {/* Single-Screen 3-Column Grid: Calendar | Today's Agenda | To-Do List */}
      <div className="dashboard-three-column-grid">
        {/* Column 1: Compact Interactive Calendar */}
        <div className="grid-col col-calendar">
          <HomeCalendar
            events={calendarEvents}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
          />
        </div>

        {/* Column 2: Today's Agenda & Lead Reminders Panel */}
        <div className="grid-col col-agenda">
          <div className="agenda-card">
            <div className="agenda-header">
              <div className="agenda-title-box">
                <FontAwesomeIcon icon={faBell} className="agenda-header-icon" />
                <div>
                  <h3>Schedule Agenda</h3>
                  <p>{selectedDate === todayStr ? "Today" : selectedDate} • {agendaEventsForSelectedDate.length} item(s)</p>
                </div>
              </div>
              {selectedDate !== todayStr && (
                <button
                  onClick={() => setSelectedDate(todayStr)}
                  className="btn-back-today"
                >
                  Today
                </button>
              )}
            </div>

            {selectedDate === todayStr && followupsToday.length > 0 && (
              <div className="reminder-alert-banner">
                <FontAwesomeIcon icon={faExclamationTriangle} className="alert-icon" />
                <span>
                  <strong>{followupsToday.length} lead follow-up(s)</strong> due today!
                </span>
              </div>
            )}

            <div className="agenda-items-container">
              {isLoadingLeads ? (
                <div className="agenda-loading">
                  <FontAwesomeIcon icon={faSpinner} spin />
                  <span>Loading schedule...</span>
                </div>
              ) : agendaEventsForSelectedDate.length === 0 ? (
                <div className="agenda-empty-state">
                  <FontAwesomeIcon icon={faCalendarCheck} className="empty-cal-icon" />
                  <h4>No follow-ups for {selectedDate}</h4>
                  <p>Select another date on the calendar or add a new task.</p>
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
                              <span className={`priority-badge prio-${item.priority.toLowerCase()}`}>
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
                            title="View Lead Details"
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
                              <span className={`priority-badge prio-${task.priority.toLowerCase()}`}>
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

      {/* Lead Details Modal Drawer */}
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
