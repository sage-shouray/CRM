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
  faCalendarAlt
} from "@fortawesome/free-solid-svg-icons";
import "./HomeToDoWidget.css";

function HomeToDoWidget({ onTaskUpdate }) {
  const userId = localStorage.getItem("userId") || "default";
  const todayStr = new Date().toISOString().split("T")[0];

  // Initial default tasks if none exist
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
    
    // Default sample data with past overdue task to showcase carry forward
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const yesterdayStr = yesterdayDate.toISOString().split("T")[0];

    return [
      {
        id: "task-1",
        title: "Follow up with SAP ERP Lead #1002 (Call Back)",
        originalDueDate: yesterdayStr,
        dueDate: yesterdayStr,
        priority: "High",
        status: "not_done",
        category: "Follow-up"
      },
      {
        id: "task-2",
        title: "Review daily unassigned lead queue and assign to team",
        originalDueDate: todayStr,
        dueDate: todayStr,
        priority: "Medium",
        status: "pending",
        category: "Management"
      },
      {
        id: "task-3",
        title: "Prepare weekly CRM pipeline summary report",
        originalDueDate: todayStr,
        dueDate: todayStr,
        priority: "Low",
        status: "done",
        category: "Report"
      }
    ];
  };

  const [tasks, setTasks] = useState(getInitialTasks);
  const [activeFilter, setActiveFilter] = useState("all");
  const [showAddForm, setShowAddForm] = useState(false);
  const [postponeTaskId, setPostponeTaskId] = useState(null);
  const [postponeDate, setPostponeDate] = useState("");

  const [newTask, setNewTask] = useState({
    title: "",
    dueDate: todayStr,
    priority: "Medium",
    category: "General"
  });

  // Automatically compute carried forward & not_done status for past tasks
  useEffect(() => {
    setTasks((prevTasks) =>
      prevTasks.map((t) => {
        // If task is from a past date and not marked done or postponed, set status = not_done
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
      originalDueDate: newTask.dueDate || todayStr,
      dueDate: newTask.dueDate || todayStr,
      priority: newTask.priority,
      category: newTask.category,
      status: "pending"
    };

    setTasks((prev) => [taskObj, ...prev]);
    setNewTask({
      title: "",
      dueDate: todayStr,
      priority: "Medium",
      category: "General"
    });
    setShowAddForm(false);
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
          onClick={() => setShowAddForm(!showAddForm)}
          className="btn-add-task-primary"
        >
          <FontAwesomeIcon icon={faPlus} />
          <span>{showAddForm ? "Cancel" : "Add Task"}</span>
        </button>
      </div>

      {/* Inline Form to Add New Task */}
      {showAddForm && (
        <form onSubmit={handleAddTaskSubmit} className="add-task-inline-form">
          <div className="form-row">
            <input
              type="text"
              placeholder="Enter task title or work description..."
              value={newTask.title}
              onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
              required
              className="task-input-title"
              autoFocus
            />
          </div>

          <div className="form-meta-row">
            <div className="form-meta-field">
              <label>Due Date</label>
              <input
                type="date"
                value={newTask.dueDate}
                onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                required
              />
            </div>

            <div className="form-meta-field">
              <label>Priority</label>
              <select
                value={newTask.priority}
                onChange={(e) => setNewTask({ ...newTask, priority: e.target.value })}
              >
                <option value="High">High Priority</option>
                <option value="Medium">Medium Priority</option>
                <option value="Low">Low Priority</option>
              </select>
            </div>

            <div className="form-meta-field">
              <label>Category</label>
              <select
                value={newTask.category}
                onChange={(e) => setNewTask({ ...newTask, category: e.target.value })}
              >
                <option value="Follow-up">Follow-up</option>
                <option value="Management">Management</option>
                <option value="Report">Report</option>
                <option value="Meeting">Meeting</option>
                <option value="General">General</option>
              </select>
            </div>

            <button type="submit" className="btn-save-task">
              Save Task
            </button>
          </div>
        </form>
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

                  <div className="task-header-line">
                    <span className={`task-title ${isDone ? "strike-through" : ""}`}>
                      {task.title}
                    </span>
                  </div>

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
