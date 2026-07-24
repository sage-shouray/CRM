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

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

function HomeToDoWidget({ onTaskUpdate, selectedDate, selectedDateFollowups = [], isLoadingLeads, onOpenLead }) {
  const userId = localStorage.getItem("userId") || "default";
  const todayStr = new Date().toISOString().split("T")[0];

  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

  const tomorrowDate = new Date();
  tomorrowDate.setDate(tomorrowDate.getDate() + 3);
  const tomorrowStr = tomorrowDate.toISOString().split("T")[0];

  // Dummy fallback leads for testing if backend leads API is empty
  const defaultDummyLeads = [
    { leadNumber: "1001", companyName: "SAP Enterprise Solutions (TechCorp)" },
    { leadNumber: "1002", companyName: "Global Logistics & Supply Chain" },
    { leadNumber: "1003", companyName: "Cloud Matrix IT Infrastructure" },
    { leadNumber: "1004", companyName: "Nexa Digital Systems" },
    { leadNumber: "1005", companyName: "Acme Apex Industrial Corp" }
  ];

  // Initial default tasks pre-populated with dummy data for testing
  const getInitialTasks = () => {
    const saved = localStorage.getItem(`crm_tasks_${userId}`);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {
        console.error("Error parsing saved tasks", e);
      }
    }
    
    return [
      {
        id: "task-1",
        title: "Follow up with SAP ERP Lead #1002 (Call Back for Proposal)",
        associatedLead: "SAP Enterprise Solutions (TechCorp)",
        description: "Client requested updated SLA uptime guarantees and 256-bit encryption compliance documentation before contract signing.",
        originalDueDate: yesterdayStr,
        dueDate: yesterdayStr,
        priority: "High",
        status: "not_done",
        category: "Follow-up"
      },
      {
        id: "task-2",
        title: "Review daily unassigned lead queue and assign to team subusers",
        associatedLead: "Global Logistics & Supply Chain",
        description: "Verify incoming lead form entries, check phone numbers, and assign high-turnover accounts to Vaidehi and Tejal.",
        originalDueDate: todayStr,
        dueDate: todayStr,
        priority: "Medium",
        status: "pending",
        category: "Management"
      },
      {
        id: "task-3",
        title: "Prepare weekly CRM pipeline summary report for Admin review",
        associatedLead: "General / Management",
        description: "Compile total conversion statistics, supervisor follow-up completion rates, and weekly lead acquisition counts.",
        originalDueDate: todayStr,
        dueDate: todayStr,
        priority: "Low",
        status: "done",
        category: "Report"
      },
      {
        id: "task-4",
        title: "Cloud Matrix Infrastructure SLA demonstration meeting",
        associatedLead: "Cloud Matrix IT Infrastructure",
        description: "Rescheduled live demonstration of CRM features and profile password provisions.",
        originalDueDate: todayStr,
        dueDate: tomorrowStr,
        priority: "High",
        status: "postponed",
        category: "Meeting"
      }
    ];
  };

  const [tasks, setTasks] = useState([]);

  const fetchTasksFromDB = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;
      const res = await axios.get(`${API_BASE_URL}/api/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
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
  }, []);
  const [internalSelectedDate, setInternalSelectedDate] = useState(todayStr);
  const [availableLeads, setAvailableLeads] = useState(defaultDummyLeads);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showAddModal, setShowAddModal] = useState(false);
  const [postponeTaskId, setPostponeTaskId] = useState(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [expandedTaskIds, setExpandedTaskIds] = useState({});

  const [newTask, setNewTask] = useState({
    title: "",
    associatedLead: "",
    description: "",
    dueDate: todayStr,
    priority: "Medium",
    category: "General"
  });

  const [systemLeads, setSystemLeads] = useState([]);
  const [isLoadingSystemLeads, setIsLoadingSystemLeads] = useState(true);
  const [localSelectedLead, setLocalSelectedLead] = useState(null);

  // Fetch created leads from system backend
  const fetchLeadsForSelection = async () => {
    try {
      setIsLoadingSystemLeads(true);
      const token = localStorage.getItem("token");
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
        // Merge with default dummy leads so testing always has options
        setAvailableLeads([...mapped, ...defaultDummyLeads]);
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
  
  // Calculate followups internally if not provided by prop
  const effectiveFollowups = useMemo(() => {
    if (selectedDateFollowups && selectedDateFollowups.length > 0) {
      return selectedDateFollowups;
    }
    const followups = [];
    systemLeads.forEach((lead) => {
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
      const token = localStorage.getItem("token");
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
      const token = localStorage.getItem("token");
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
      const token = localStorage.getItem("token");
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
  const handleAddTaskSubmit = async (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    try {
      const token = localStorage.getItem("token");
      const res = await axios.post(`${API_BASE_URL}/api/tasks`, {
        taskId: "task-" + Date.now(),
        title: newTask.title.trim(),
        associatedLead: newTask.associatedLead || "General / None",
        description: newTask.description.trim(),
        originalDueDate: newTask.dueDate || todayStr,
        dueDate: newTask.dueDate || todayStr,
        priority: newTask.priority,
        category: newTask.category,
        status: "pending"
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });

      setTasks((prev) => [res.data, ...prev]);
      setNewTask({
        title: "",
        associatedLead: "",
        description: "",
        dueDate: todayStr,
        priority: "Medium",
        category: "General"
      });
      setShowAddModal(false);
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
            <h3>Schedule Agenda & To-Do List</h3>
            <p>View follow-ups and manage daily tasks in one unified dashboard.</p>
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
        <div className="add-task-modal-overlay" onClick={() => setShowAddModal(false)}>
          <div className="add-task-modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-bar">
              <div className="modal-title-box">
                <FontAwesomeIcon icon={faListCheck} className="modal-title-icon" />
                <div>
                  <h3>Create New Work Task</h3>
                  <p>Select a lead, enter task description, and assign action schedule</p>
                </div>
              </div>
              <button
                type="button"
                className="btn-modal-close"
                onClick={() => setShowAddModal(false)}
                title="Close"
              >
                <FontAwesomeIcon icon={faTimes} />
              </button>
            </div>

            <form onSubmit={handleAddTaskSubmit} className="add-task-modal-form">
              {/* Select Associated Lead Dropdown */}
              <div className="modal-form-group">
                <label><FontAwesomeIcon icon={faBuilding} className="label-icon" /> Select Associated Lead</label>
                <select
                  value={newTask.associatedLead}
                  onChange={(e) => setNewTask({ ...newTask, associatedLead: e.target.value })}
                  className="modal-input-select"
                >
                  <option value="">-- General Work (No Specific Lead) --</option>
                  {availableLeads.map((l, idx) => (
                    <option key={idx} value={l.companyName}>
                      {l.companyName} (Lead #{l.leadNumber})
                    </option>
                  ))}
                </select>
              </div>

              {/* Task Title Input */}
              <div className="modal-form-group">
                <label>Task Title / Title Name <span className="req-star">*</span></label>
                <input
                  type="text"
                  placeholder="e.g. Follow up with SAP ERP lead for contract signing..."
                  value={newTask.title}
                  onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  required
                  className="modal-input-text"
                  autoFocus
                />
              </div>

              {/* Task Description Textarea */}
              <div className="modal-form-group">
                <label><FontAwesomeIcon icon={faAlignLeft} className="label-icon" /> Task Description & Action Notes</label>
                <textarea
                  placeholder="Enter detailed action plan, call notes, or instructions for this task..."
                  value={newTask.description}
                  onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  rows={3}
                  className="modal-input-textarea"
                />
              </div>

              {/* Form Grid: Due Date, Priority, Category */}
              <div className="modal-form-grid">
                <div className="modal-form-group">
                  <label>Due Date <span className="req-star">*</span></label>
                  <input
                    type="date"
                    value={newTask.dueDate}
                    onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                    required
                    className="modal-input-select"
                  />
                </div>

                <div className="modal-form-group">
                  <label>Priority Level</label>
                  <select
                    value={newTask.priority}
                    onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
                    className="modal-input-select"
                  >
                    <option value="High">High Priority</option>
                    <option value="Medium">Medium Priority</option>
                    <option value="Low">Low Priority</option>
                  </select>
                </div>

                <div className="modal-form-group">
                  <label>Work Category</label>
                  <select
                    value={newTask.category}
                    onChange={(e) => setNewTask({ ...newTask, category: e.target.value })}
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

              <div className="modal-footer-actions">
                <button
                  type="button"
                  className="btn-modal-cancel"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-modal-save">
                  <FontAwesomeIcon icon={faPlus} /> Save Task
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Split Pane Content Container */}
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
                            <span className="status-pill pill-overdue" title={`Original due date was ${task.originalDueDate || task.dueDate}`}>
                              <FontAwesomeIcon icon={faHistory} /> Carried Forward
                            </span>
                          )}

                          <span className={`priority-tag tag-${prioLower}`}>
                            {task.priority === "High" && <FontAwesomeIcon icon={faExclamationCircle} className="prio-icon" />}
                            {task.priority}
                          </span>
                          <span className="category-tag">{task.category || "General"}</span>
                          <span className="due-date-tag">
                            <FontAwesomeIcon icon={faCalendarDay} className="cal-icon" /> {task.dueDate}
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
