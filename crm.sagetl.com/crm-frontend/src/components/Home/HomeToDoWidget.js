import React, { useState, useEffect, useMemo } from "react";
import ReactDOM from "react-dom";
import LeadDetails from "../Leads/LeadDetails";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faCheckCircle, 
  faClock, 
  faTimesCircle, 
  faPlus, 
  faListCheck, 
  faCalendarDay,
  faExclamationCircle,
  faHistory,
  faCalendarAlt,
  faTimes,
  faUserPlus,
  faBuilding,
  faAlignLeft,
  faChevronDown,
  faChevronUp,
  faSpinner,
  faCalendarCheck,
  faPhone,
  faArrowRight,
  faBell
} from "@fortawesome/free-solid-svg-icons";
import axios from "axios";
import "./HomeToDoWidget.css";

import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";
import { formatDate } from "../../dateFormat";
import { ROLES, normalizeRole } from "../../roles";

// addOnly renders just the "Add Task" button and its modal — used by the right
// rail, where the agenda and task lists were removed and created tasks surface
// in Lead Follow-ups on the dashboard instead.
function HomeToDoWidget({ onTaskUpdate, selectedDate, selectedDateFollowups = [], isLoadingLeads, onOpenLead, addOnly = false, onTaskCreated }) {
  const userId = sessionStorage.getItem("userId") || "default";
  const todayStr = new Date().toISOString().split("T")[0];
  const isAdmin = normalizeRole(sessionStorage.getItem("userRole")) === ROLES.ADMIN;

  const [tasks, setTasks] = useState([]);

  // Admin-only: view another person's Lead Follow-ups & Tasks instead of your
  // own. Empty string means "myself" throughout.
  const [viewUserId, setViewUserId] = useState("");
  const [viewableUsers, setViewableUsers] = useState([]);

  useEffect(() => {
    if (!isAdmin) return;
    const token = sessionStorage.getItem("token");
    if (!token) return;
    axios
      .get(`${API_BASE_URL}/api/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then((res) => setViewableUsers(res.data || []))
      .catch((err) => console.error("Error loading users for the view-as dropdown:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  // Whoever's work is actually being shown right now — the selected person
  // for an Admin who has picked one, otherwise the signed-in user.
  const effectiveUserId = viewUserId || userId;

  const fetchTasksFromDB = async () => {
    try {
      const token = sessionStorage.getItem("token");
      if (!token) return;
      const res = await axios.get(`${API_BASE_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${token}` },
        // Only ever honoured server-side for an Admin; everyone else's
        // request is unaffected by this and still returns just their own.
        params: viewUserId ? { userId: viewUserId } : {},
      });
      const formatted = (res.data || []).map(t => {
        if (t.dueDate < todayStr && t.status !== "done" && t.status !== "postponed") {
          return { ...t, status: "not_done" };
        }
        return t;
      });
      setTasks(formatted);
    } catch (err) {
      console.error("Error fetching tasks from DB:", err);
    }
  };

  useEffect(() => {
    fetchTasksFromDB();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewUserId]);

  // A task assigned to you by someone else, or a lead created elsewhere,
  // appears here immediately rather than on the next page reload.
  useLiveUpdates(["tasks"], () => fetchTasksFromDB());
  useLiveUpdates(["leads"], () => fetchLeadsForSelection());
  const [internalSelectedDate, setInternalSelectedDate] = useState(todayStr);
  const [availableLeads, setAvailableLeads] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [postponeTaskId, setPostponeTaskId] = useState(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [expandedTaskIds, setExpandedTaskIds] = useState({});

  const [newTask, setNewTask] = useState({
    assignedTo: "",
    title: "",
    associatedLead: "",
    description: "",
    dueDate: todayStr,
    priority: "Medium",
    category: "General"
  });

  // People this user may hand work to. Empty for anyone with no reports, in
  // which case the Assign to control is not rendered at all.
  const [assignableUsers, setAssignableUsers] = useState([]);
  const [systemLeads, setSystemLeads] = useState([]);
  const [isLoadingSystemLeads, setIsLoadingSystemLeads] = useState(true);
  const [localSelectedLead, setLocalSelectedLead] = useState(null);

  // Fetch created leads from system backend
  const fetchLeadsForSelection = async () => {
    try {
      setIsLoadingSystemLeads(true);
      const token = sessionStorage.getItem("token");
      if (!token) return;

      const res = await axios.get(`${API_BASE_URL}/api/leads`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (Array.isArray(res.data)) {
        setSystemLeads(res.data);
        const mapped = res.data.map((l) => ({
          leadNumber: l.leadNumber,
          companyName: l.companyInfo?.companyName || `Lead #${l.leadNumber}`
        }));
        // Only real leads. Invented placeholders used to be merged in here,
        // which let people attach work to companies that do not exist.
        setAvailableLeads(mapped);
      }
    } catch (err) {
      console.error("Error fetching leads for task creation:", err);
    } finally {
      setIsLoadingSystemLeads(false);
    }
  };

  useEffect(() => {
    fetchLeadsForSelection();
  }, []);

  // Determine which selected date and followups to use
  const effectiveSelectedDate = selectedDate || internalSelectedDate;
  
  // GET /api/leads deliberately returns every company in the system (so the
  // main Leads table can show them all) — but a next action set on someone
  // else's lead is not this person's work to do, so the agenda has to filter
  // down to leads this user created or is assigned to before matching dates.
  const numericUserId = Number(userId);
  const isMyLead = (lead) => {
    if (!Number.isFinite(numericUserId)) return false;
    const creatorId = Number(lead.createdBy?._id ?? lead.createdBy?.id ?? lead.createdBy);
    if (creatorId === numericUserId) return true;
    const assigned = lead.companyInfo?.leadAssignedTo;
    const idOf = (v) => Number(v?._id ?? v?.id ?? v);
    return Array.isArray(assigned)
      ? assigned.some((a) => idOf(a) === numericUserId)
      : idOf(assigned) === numericUserId;
  };

  // Calculate followups internally if not provided by prop
  const effectiveFollowups = useMemo(() => {
    if (selectedDateFollowups && selectedDateFollowups.length > 0) {
      return selectedDateFollowups;
    }
    const followups = [];
    systemLeads.filter(isMyLead).forEach((lead) => {
      const actionDate = lead.companyInfo?.dateField
        ? lead.companyInfo.dateField.split("T")[0]
        : lead.companyInfo?.nextActionDate
        ? lead.companyInfo.nextActionDate.split("T")[0]
        : lead.createdAt
        ? lead.createdAt.split("T")[0]
        : null;

      if (actionDate === effectiveSelectedDate) {
        followups.push({
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
    return followups;
  }, [selectedDateFollowups, systemLeads, effectiveSelectedDate]);

  const effectiveIsLoadingLeads = isLoadingLeads !== undefined ? isLoadingLeads : isLoadingSystemLeads;

  const handleOpenLeadDetails = (leadNum) => {
    if (onOpenLead) {
      onOpenLead(leadNum);
    } else {
      setLocalSelectedLead(leadNum);
    }
  };

  // Automatically compute carried forward & not_done status for past tasks
  useEffect(() => {
    setTasks((prevTasks) =>
      prevTasks.map((t) => {
        if (t.dueDate < todayStr && t.status !== "done" && t.status !== "postponed") {
          return { ...t, status: "not_done" };
        }
        return t;
      })
    );
  }, [todayStr]);

  useEffect(() => {
    if (onTaskUpdate) {
      onTaskUpdate(tasks);
    }
  }, [tasks]);

  const toggleExpandDescription = (taskId) => {
    setExpandedTaskIds((prev) => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };

  // Status Action 1: Mark Done
  const handleMarkDone = async (taskId) => {
    try {
      const token = sessionStorage.getItem("token");
      const res = await axios.put(`${API_BASE_URL}/api/tasks/${taskId}`, {
        status: "done"
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId || t.taskId === taskId ? res.data : t))
      );
    } catch (err) {
      console.error("Error marking task done:", err);
    }
  };

  // Status Action 2: Mark Not Done
  const handleMarkNotDone = async (taskId) => {
    try {
      const token = sessionStorage.getItem("token");
      const res = await axios.put(`${API_BASE_URL}/api/tasks/${taskId}`, {
        status: "not_done"
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId || t.taskId === taskId ? res.data : t))
      );
    } catch (err) {
      console.error("Error marking task not done:", err);
    }
  };

  // Status Action 3: Postpone Task
  const handleOpenPostpone = (taskId, currentDate) => {
    setPostponeTaskId(taskId);
    setPostponeDate(currentDate || todayStr);
  };

  const handleConfirmPostpone = async (taskId) => {
    if (!postponeDate) return;
    try {
      const token = sessionStorage.getItem("token");
      const res = await axios.put(`${API_BASE_URL}/api/tasks/${taskId}`, {
        dueDate: postponeDate,
        status: "postponed"
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasks((prev) =>
        prev.map((t) => (t.id === taskId || t.taskId === taskId ? res.data : t))
      );
      setPostponeTaskId(null);
      setPostponeDate("");
    } catch (err) {
      console.error("Error postponing task:", err);
    }
  };

  // Add new task
  const loadAssignable = async () => {
    try {
      const token = sessionStorage.getItem("token");
      const res = await axios.get(`${API_BASE_URL}/api/assignable-users`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAssignableUsers(res.data || []);
    } catch (err) {
      setAssignableUsers([]);
    }
  };

  useEffect(() => {
    loadAssignable();
  }, []);

  // Refresh both dropdowns each time the modal opens. They used to load once
  // when the dashboard mounted, so a lead created during the session — or a
  // colleague added to your team — did not appear until a full page reload.
  // Escape closes the dialog, and the page behind it is locked from scrolling
  // while it is open.
  useEffect(() => {
    if (!showAddModal) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setShowAddModal(false);
    };
    window.addEventListener('keydown', onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [showAddModal]);

  useEffect(() => {
    if (!showAddModal) return;
    fetchLeadsForSelection();
    loadAssignable();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAddModal]);

  const handleAddTaskSubmit = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    try {
      const token = sessionStorage.getItem("token");
      const res = await axios.post(`${API_BASE_URL}/api/tasks`, {
        taskId: "task-" + Date.now(),
        title: newTask.title.trim(),
        associatedLead: newTask.associatedLead || "General / None",
        description: newTask.description.trim(),
        originalDueDate: newTask.dueDate || todayStr,
        dueDate: newTask.dueDate || todayStr,
        priority: newTask.priority,
        category: newTask.category,
        status: "pending",
        // Omitted entirely when unset, so the server keeps the task with the
        // creator rather than being handed a null it has to interpret.
        ...(newTask.assignedTo ? { assignedTo: Number(newTask.assignedTo) } : {})
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setTasks((prev) => [res.data, ...prev]);
      setNewTask({
        assignedTo: "",
        title: "",
        associatedLead: "",
        description: "",
        dueDate: todayStr,
        priority: "Medium",
        category: "General"
      });
      setShowAddModal(false);
      // Let the owner refresh shared state so the new task shows up wherever
      // else it is listed (the dashboard's Lead Follow-ups panel).
      if (onTaskCreated) onTaskCreated(res.data);
    } catch (err) {
      console.error("Error adding task:", err);
    }
  };

  // Filter tasks based on status / carry forward
  const filteredTasks = tasks.filter((task) => {
    const isOverdueOrToday = task.dueDate <= todayStr || task.status === "not_done";
    
    if (activeFilter === "today") return isOverdueOrToday && task.status !== "done";
    if (activeFilter === "postponed") return task.status === "postponed";
    if (activeFilter === "done") return task.status === "done";
    if (activeFilter === "not_done") return task.status === "not_done";
    return true; // "all"
  });

  const doneCount = tasks.filter((t) => t.status === "done").length;
  const notDoneCount = tasks.filter((t) => t.status === "not_done" || (t.dueDate < todayStr && t.status !== "done" && t.status !== "postponed")).length;
  const postponedCount = tasks.filter((t) => t.status === "postponed").length;

  return (
    <div className="home-todo-card">
      <div className="todo-widget-header">
        <div className="widget-title-group">
          <FontAwesomeIcon icon={faListCheck} className="widget-header-icon" />
          <div>
            <h3>{addOnly ? "Tasks" : "Schedule Agenda & To-Do List"}</h3>
            <p>
              {addOnly
                ? "New tasks appear in Lead Follow-ups on the dashboard."
                : "View follow-ups and manage daily tasks in one unified dashboard."}
            </p>
          </div>
        </div>

        <button
          onClick={() => setShowAddModal(true)}
          className="btn-add-task-primary"
        >
          <FontAwesomeIcon icon={faPlus} />
          <span>Add Task</span>
        </button>
      </div>

      {/* Pop-up Modal Window for Creating New Task — rendered via Portal to escape overflow:hidden parent */}
      {showAddModal && ReactDOM.createPortal(
        <div
          className="add-task-modal-overlay"
          onClick={() => setShowAddModal(false)}
        >
          <div
            className="add-task-modal-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-task-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header-bar">
              <div className="modal-title-box">
                <span className="modal-title-icon">
                  <FontAwesomeIcon icon={faListCheck} />
                </span>
                <div>
                  <h3 id="add-task-title">New task</h3>
                  <p>Capture what needs doing, and when.</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowAddModal(false)}
                title="Close"
                aria-label="Close"
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>

            <form onSubmit={handleAddTaskSubmit} className="add-task-modal-form">
              <div className="modal-scroll-body">
                {/* The task itself first: the title is what the list shows and
                    what people actually came here to type. */}
                <div className="modal-form-group">
                  <label htmlFor="task-title">
                    Task title <span className="req-star">*</span>
                  </label>
                  <input
                    id="task-title"
                    type="text"
                    placeholder="e.g. Follow up with SAP ERP lead for contract signing"
                    value={newTask.title}
                    onChange={(e) =>
                      setNewTask({ ...newTask, title: e.target.value })
                    }
                    required
                    className="modal-input-text"
                    autoFocus
                  />
                </div>

                <div className="modal-form-group">
                  <label htmlFor="task-desc">
                    <FontAwesomeIcon icon={faAlignLeft} className="label-icon" />
                    Details <span className="modal-optional">optional</span>
                  </label>
                  <textarea
                    id="task-desc"
                    placeholder="Action plan, call notes, or instructions..."
                    value={newTask.description}
                    onChange={(e) =>
                      setNewTask({ ...newTask, description: e.target.value })
                    }
                    rows={3}
                    className="modal-input-textarea"
                  />
                </div>

                <div className="modal-section-divider">
                  <span>Link &amp; assign</span>
                </div>

                <div className="modal-form-group">
                  <label htmlFor="task-lead">
                    <FontAwesomeIcon icon={faBuilding} className="label-icon" />
                    Associated lead
                  </label>
                  <select
                    id="task-lead"
                    value={newTask.associatedLead}
                    onChange={(e) =>
                      setNewTask({ ...newTask, associatedLead: e.target.value })
                    }
                    className="modal-input-select"
                  >
                    <option value="">General work - no specific lead</option>
                    {availableLeads.map((l, idx) => (
                      <option key={idx} value={l.companyName}>
                        {l.companyName} (Lead #{l.leadNumber})
                      </option>
                    ))}
                  </select>
                  {!isLoadingSystemLeads && availableLeads.length === 0 && (
                    <span className="modal-field-note">
                      No leads are visible to you yet. Create one first, or ask
                      for one to be assigned to you.
                    </span>
                  )}
                </div>

                {/* Assign downward. Shown to anyone with people below them; for
                    everyone else it says so rather than disappearing, which
                    read as the control being broken. */}
                <div className="modal-form-group">
                  <label htmlFor="task-assignee">
                    <FontAwesomeIcon icon={faUserPlus} className="label-icon" />
                    Assign to
                  </label>
                  {assignableUsers.length > 0 ? (
                    <select
                      id="task-assignee"
                      value={newTask.assignedTo}
                      onChange={(e) =>
                        setNewTask({ ...newTask, assignedTo: e.target.value })
                      }
                      className="modal-input-select"
                    >
                      <option value="">Myself</option>
                      {assignableUsers.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.firstName} {u.lastName}
                          {u.designation ? " - " + u.designation : ""}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <>
                      <select className="modal-input-select" value="" disabled>
                        <option value="">Myself</option>
                      </select>
                      <span className="modal-field-note">
                        You have no team members to assign work to, so this task
                        will be your own.
                      </span>
                    </>
                  )}
                </div>

                <div className="modal-section-divider">
                  <span>Schedule</span>
                </div>

                <div className="modal-form-grid">
                  <div className="modal-form-group">
                    <label htmlFor="task-due">
                      <FontAwesomeIcon
                        icon={faCalendarDay}
                        className="label-icon"
                      />
                      Due date <span className="req-star">*</span>
                    </label>
                    <input
                      id="task-due"
                      type="date"
                      value={newTask.dueDate}
                      onChange={(e) =>
                        setNewTask({ ...newTask, dueDate: e.target.value })
                      }
                      required
                      className="modal-input-select"
                    />
                  </div>

                  <div className="modal-form-group">
                    <label htmlFor="task-category">Category</label>
                    <select
                      id="task-category"
                      value={newTask.category}
                      onChange={(e) =>
                        setNewTask({ ...newTask, category: e.target.value })
                      }
                      className="modal-input-select"
                    >
                      <option value="Follow-up">Follow-up</option>
                      <option value="Management">Management</option>
                      <option value="Report">Report</option>
                      <option value="Meeting">Meeting</option>
                      <option value="General">General</option>
                    </select>
                  </div>
                </div>

                {/* Priority as three buttons rather than a dropdown: it has
                    only three values and is set on nearly every task, so the
                    extra click a select costs is not worth it. */}
                <div className="modal-form-group">
                  <label>Priority</label>
                  <div
                    className="priority-segmented"
                    role="group"
                    aria-label="Priority"
                  >
                    {["High", "Medium", "Low"].map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={
                          "priority-option prio-" +
                          level.toLowerCase() +
                          (newTask.priority === level ? " is-selected" : "")
                        }
                        aria-pressed={newTask.priority === level}
                        onClick={() =>
                          setNewTask({ ...newTask, priority: level })
                        }
                      >
                        {level === "High" && (
                          <FontAwesomeIcon icon={faExclamationCircle} />
                        )}
                        <span>{level}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="modal-footer-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn-modal-save"
                  disabled={!newTask.title.trim()}
                >
                  <FontAwesomeIcon icon={faPlus} /> Create task
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Split Pane Content Container */}
      {!addOnly && (
      <div className="todo-widget-content-split">
        {/* Left Pane: Selected Date Lead Follow-ups */}
        <div className="agenda-pane">
          <div className="agenda-pane-header">
            <h4>
              <FontAwesomeIcon icon={faBell} className="pane-icon" />
              <span>Lead Follow-ups</span>
              <span className="pane-count-badge">{effectiveFollowups.length}</span>
            </h4>
            {selectedDate ? (
              <span className="agenda-date-label">
                {selectedDate === todayStr ? "Today's Agenda" : selectedDate}
              </span>
            ) : (
              <input
                type="date"
                value={effectiveSelectedDate}
                onChange={(e) => setInternalSelectedDate(e.target.value)}
                className="agenda-date-picker-input"
                title="Select date to filter follow-ups"
              />
            )}
          </div>

          <div className="agenda-scroll-container">
            {effectiveIsLoadingLeads ? (
              <div className="agenda-loading">
                <FontAwesomeIcon icon={faSpinner} spin className="spinner-icon" />
                <span>Loading follow-ups...</span>
              </div>
            ) : effectiveFollowups.length === 0 ? (
              <div className="agenda-empty-state">
                <FontAwesomeIcon icon={faCalendarCheck} className="empty-icon" />
                <p>No follow-ups scheduled for this date.</p>
              </div>
            ) : (
              <div className="agenda-list">
                {effectiveFollowups.map((item) => (
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
                        <span className="info-action"><FontAwesomeIcon icon={faClock} /> {item.nextAction}</span>
                        <span className="info-phone"><FontAwesomeIcon icon={faPhone} /> {item.phone}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleOpenLeadDetails(item.leadNumber)}
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
          </div>
        </div>

        {/* Right Pane: Assigned Work Tasks & To-Do List */}
        <div className="tasks-pane">
          <div className="tasks-pane-header">
            <h4>
              <FontAwesomeIcon icon={faListCheck} className="pane-icon" />
              <span>Work Tasks</span>
              <span className="pane-count-badge">{filteredTasks.length}</span>
            </h4>
          </div>

          {/* Filter Segmented Control Bar */}
          <div className="todo-filter-tabs">
            <div className="tabs-group">
              <button
                className={`filter-tab ${activeFilter === "all" ? "active-tab" : ""}`}
                onClick={() => setActiveFilter("all")}
              >
                All ({tasks.length})
              </button>
              <button
                className={`filter-tab ${activeFilter === "today" ? "active-tab" : ""}`}
                onClick={() => setActiveFilter("today")}
              >
                Today / Action
              </button>
              <button
                className={`filter-tab tab-green ${activeFilter === "done" ? "active-tab-green" : ""}`}
                onClick={() => setActiveFilter("done")}
              >
                Done ({doneCount})
              </button>
              <button
                className={`filter-tab tab-red ${activeFilter === "not_done" ? "active-tab-red" : ""}`}
                onClick={() => setActiveFilter("not_done")}
              >
                Not Done ({notDoneCount})
              </button>
              <button
                className={`filter-tab tab-amber ${activeFilter === "postponed" ? "active-tab-amber" : ""}`}
                onClick={() => setActiveFilter("postponed")}
              >
                Postponed ({postponedCount})
              </button>
            </div>
          </div>

          <div className="todo-items-list">
            {filteredTasks.length === 0 ? (
              <div className="empty-tasks-state">
                <FontAwesomeIcon icon={faCalendarDay} className="empty-icon" />
                <p>No tasks found for this view.</p>
              </div>
            ) : (
              filteredTasks.map((task) => {
                const prioLower = (task.priority || "medium").toLowerCase();
                const isOverdueNotDone = (task.originalDueDate && task.originalDueDate < todayStr && task.status !== "done" && task.status !== "postponed") || task.status === "not_done";
                const isPostponed = task.status === "postponed";
                const isDone = task.status === "done";

                return (
                  <div
                    key={task.id}
                    className={`todo-item-card status-${task.status} prio-border-${prioLower}`}
                  >
                    <div className="todo-item-main-row">
                      <div className="task-body-content">
                        {/* Task Title & Lead Tag Row */}
                        <div className="task-header-line">
                          <span className={`task-title ${isDone ? "strike-through" : ""}`}>
                            {task.title}
                          </span>
                          {task.associatedLead && (
                            <span className="task-associated-lead-inline">
                              <FontAwesomeIcon icon={faBuilding} className="lead-tag-icon" />
                              <span>{task.associatedLead}</span>
                            </span>
                          )}
                        </div>

                        {/* Optional Description (rendered clean and inline) */}
                        {task.description && (
                          <div className="task-description-inline">
                            <span>{task.description}</span>
                          </div>
                        )}

                        {/* Metadata Row: Status, Overdue Warning, Priority, Category, Date */}
                        <div className="task-meta-tags">
                          {isDone ? (
                            <span className="status-pill pill-done">
                              <FontAwesomeIcon icon={faCheckCircle} /> Done
                            </span>
                          ) : isOverdueNotDone ? (
                            <span className="status-pill pill-not-done">
                              <FontAwesomeIcon icon={faTimesCircle} /> Not Done
                            </span>
                          ) : isPostponed ? (
                            <span className="status-pill pill-postponed">
                              <FontAwesomeIcon icon={faClock} /> Postponed
                            </span>
                          ) : (
                            <span className="status-pill pill-pending">Pending</span>
                          )}

                          {isOverdueNotDone && !isDone && (
                            <span className="status-pill pill-overdue" title={`Original due date was ${formatDate(task.originalDueDate || task.dueDate)}`}>
                              <FontAwesomeIcon icon={faHistory} /> Carried Forward
                            </span>
                          )}

                          <span className={`priority-tag tag-${prioLower}`}>
                            {task.priority === "High" && <FontAwesomeIcon icon={faExclamationCircle} className="prio-icon" />}
                            {task.priority}
                          </span>
                          <span className="category-tag">{task.category || "General"}</span>
                          <span className="due-date-tag">
                            <FontAwesomeIcon icon={faCalendarDay} className="cal-icon" /> {formatDate(task.dueDate)}
                          </span>
                        </div>
                      </div>

                      {/* Action Buttons Side Panel (circular icon buttons) */}
                      <div className="task-actions-side">
                        {!isDone && (
                          <button
                            onClick={() => handleMarkDone(task.id)}
                            className="btn-action-round btn-round-done"
                            title="Mark Done"
                            aria-label="Mark Done"
                          >
                            <FontAwesomeIcon icon={faCheckCircle} />
                          </button>
                        )}

                        {isDone && (
                          <button
                            onClick={() => handleMarkNotDone(task.id)}
                            className="btn-action-round btn-round-reopen"
                            title="Reopen Task"
                            aria-label="Reopen Task"
                          >
                            <FontAwesomeIcon icon={faTimesCircle} />
                          </button>
                        )}

                        {!isDone && (
                          <button
                            onClick={() => handleOpenPostpone(task.id, task.dueDate)}
                            className="btn-action-round btn-round-postpone"
                            title="Postpone Task"
                            aria-label="Postpone Task"
                          >
                            <FontAwesomeIcon icon={faClock} />
                          </button>
                        )}

                        {!isDone && !isOverdueNotDone && (
                          <button
                            onClick={() => handleMarkNotDone(task.id)}
                            className="btn-action-round btn-round-not-done"
                            title="Mark Not Done"
                            aria-label="Mark Not Done"
                          >
                            <FontAwesomeIcon icon={faTimesCircle} />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Inline Postpone Date Selector Popover (takes full width below the main row) */}
                    {postponeTaskId === task.id && (
                      <div className="postpone-popover-box">
                        <label>Reschedule To:</label>
                        <input
                          type="date"
                          value={postponeDate}
                          onChange={(e) => setPostponeDate(e.target.value)}
                          min={todayStr}
                        />
                        <button
                          type="button"
                          onClick={() => handleConfirmPostpone(task.id)}
                          className="btn-confirm-postpone"
                        >
                          <FontAwesomeIcon icon={faCalendarAlt} /> Confirm
                        </button>
                        <button
                          type="button"
                          onClick={() => setPostponeTaskId(null)}
                          className="btn-cancel-postpone"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      )}
      {localSelectedLead && (
        <LeadDetails
          leadNumber={localSelectedLead}
          onClose={() => {
            setLocalSelectedLead(null);
            fetchLeadsForSelection();
          }}
          onUpdate={() => {
            setLocalSelectedLead(null);
            fetchLeadsForSelection();
          }}
        />
      )}
    </div>
  );
}

export default HomeToDoWidget;
