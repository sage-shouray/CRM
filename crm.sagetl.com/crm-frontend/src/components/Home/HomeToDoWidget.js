import React, { useState, useEffect } from "react";
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
  faChevronUp
} from "@fortawesome/free-solid-svg-icons";
import axios from "axios";
import "./HomeToDoWidget.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

function HomeToDoWidget({ onTaskUpdate }) {
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

  const [tasks, setTasks] = useState(getInitialTasks);
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

  // Fetch created leads from system backend
  useEffect(() => {
    const fetchLeadsForSelection = async () => {
      try {
        const token = localStorage.getItem("token");
        if (!token) return;

        const res = await axios.get(`${API_BASE_URL}/api/leads`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (Array.isArray(res.data) && res.data.length > 0) {
          const mapped = res.data.map((l) => ({
            leadNumber: l.leadNumber,
            companyName: l.companyInfo?.companyName || `Lead #${l.leadNumber}`
          }));
          // Merge with default dummy leads so testing always has options
          setAvailableLeads([...mapped, ...defaultDummyLeads]);
        }
      } catch (err) {
        console.error("Error fetching leads for task creation:", err);
      }
    };

    fetchLeadsForSelection();
  }, []);

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
    localStorage.setItem(`crm_tasks_${userId}`, JSON.stringify(tasks));
    if (onTaskUpdate) {
      onTaskUpdate(tasks);
    }
  }, [tasks, userId]);

  const toggleExpandDescription = (taskId) => {
    setExpandedTaskIds((prev) => ({
      ...prev,
      [taskId]: !prev[taskId]
    }));
  };

  // Status Action 1: Mark Done
  const handleMarkDone = (taskId) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "done" } : t))
    );
  };

  // Status Action 2: Mark Not Done
  const handleMarkNotDone = (taskId) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, status: "not_done" } : t))
    );
  };

  // Status Action 3: Postpone Task
  const handleOpenPostpone = (taskId, currentDate) => {
    setPostponeTaskId(taskId);
    setPostponeDate(currentDate || todayStr);
  };

  const handleConfirmPostpone = (taskId) => {
    if (!postponeDate) return;
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId
          ? {
              ...t,
              dueDate: postponeDate,
              status: "postponed"
            }
          : t
      )
    );
    setPostponeTaskId(null);
    setPostponeDate("");
  };

  // Add new task
  const handleAddTaskSubmit = (e) => {
    e.preventDefault();
    if (!newTask.title.trim()) return;

    const taskObj = {
      id: "task-" + Date.now(),
      title: newTask.title.trim(),
      associatedLead: newTask.associatedLead || "General / None",
      description: newTask.description.trim(),
      originalDueDate: newTask.dueDate || todayStr,
      dueDate: newTask.dueDate || todayStr,
      priority: newTask.priority,
      category: newTask.category,
      status: "pending"
    };

    setTasks((prev) => [taskObj, ...prev]);
    setNewTask({
      title: "",
      associatedLead: "",
      description: "",
      dueDate: todayStr,
      priority: "Medium",
      category: "General"
    });
    setShowAddModal(false);
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
            <h3>Assigned Work & To-Do List</h3>
            <p>Tasks cannot be deleted. Manage status: Done, Postponed, or Not Done.</p>
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

      {/* Pop-up Modal Window for Creating New Task */}
      {showAddModal && (
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
        </div>
      )}

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

      {/* Tasks List */}
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
            const isExpanded = !!expandedTaskIds[task.id];

            return (
              <div
                key={task.id}
                className={`todo-item-card status-${task.status} prio-border-${prioLower}`}
              >
                <div className="task-body-content">
                  {/* Overdue Carry-Forward Warning Banner */}
                  {isOverdueNotDone && !isDone && (
                    <div className="carry-forward-notice">
                      <FontAwesomeIcon icon={faHistory} />
                      <span>Not Done on {task.originalDueDate || task.dueDate} • Carried Forward to Today</span>
                    </div>
                  )}

                  {/* Task Header Line with Title */}
                  <div className="task-header-line">
                    <span className={`task-title ${isDone ? "strike-through" : ""}`}>
                      {task.title}
                    </span>
                  </div>

                  {/* Associated Lead Tag */}
                  {task.associatedLead && (
                    <div className="task-associated-lead">
                      <FontAwesomeIcon icon={faBuilding} className="lead-tag-icon" />
                      <span>Lead: <strong>{task.associatedLead}</strong></span>
                    </div>
                  )}

                  {/* Optional Expandable Description */}
                  {task.description && (
                    <div className="task-description-box">
                      <div className="desc-preview">
                        <FontAwesomeIcon icon={faAlignLeft} className="desc-icon" />
                        <span className="desc-text">{task.description}</span>
                      </div>
                    </div>
                  )}

                  {/* Metadata Row: Status, Priority, Category, Date */}
                  <div className="task-meta-tags">
                    {/* Status Pill */}
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

                    <span className={`priority-tag tag-${prioLower}`}>
                      {task.priority === "High" && <FontAwesomeIcon icon={faExclamationCircle} className="prio-icon" />}
                      {task.priority} Priority
                    </span>
                    <span className="category-tag">{task.category || "General"}</span>
                    <span className="due-date-tag">
                      <FontAwesomeIcon icon={faCalendarDay} className="cal-icon" /> {task.dueDate}
                    </span>
                  </div>

                  {/* 3 Status Action Buttons (Done, Postpone, Not Done) */}
                  <div className="task-status-actions-bar">
                    {!isDone && (
                      <button
                        onClick={() => handleMarkDone(task.id)}
                        className="btn-status-action btn-act-done"
                        title="Mark Done"
                      >
                        <FontAwesomeIcon icon={faCheckCircle} />
                        <span>Done</span>
                      </button>
                    )}

                    {isDone && (
                      <button
                        onClick={() => handleMarkNotDone(task.id)}
                        className="btn-status-action btn-act-not-done"
                        title="Mark Not Done"
                      >
                        <FontAwesomeIcon icon={faTimesCircle} />
                        <span>Reopen</span>
                      </button>
                    )}

                    {!isDone && (
                      <button
                        onClick={() => handleOpenPostpone(task.id, task.dueDate)}
                        className="btn-status-action btn-act-postpone"
                        title="Postpone Task to new date"
                      >
                        <FontAwesomeIcon icon={faClock} />
                        <span>Postpone</span>
                      </button>
                    )}

                    {!isDone && !isOverdueNotDone && (
                      <button
                        onClick={() => handleMarkNotDone(task.id)}
                        className="btn-status-action btn-act-not-done"
                        title="Mark Not Done"
                      >
                        <FontAwesomeIcon icon={faTimesCircle} />
                        <span>Not Done</span>
                      </button>
                    )}
                  </div>

                  {/* Inline Postpone Date Selector Popover */}
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
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

export default HomeToDoWidget;
