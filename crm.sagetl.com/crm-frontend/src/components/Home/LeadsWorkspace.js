import React, { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { API_BASE_URL } from "../../config";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPhone,
  faEnvelope,
  faArrowRight,
  faBuilding,
  faLocationDot,
  faClock,
  faListCheck,
  faCheck,
  faCalendarPlus,
} from "@fortawesome/free-solid-svg-icons";
import { isOpen, isOverdue, dealValue, formatINR } from "./pipeline";
import { ROLES, normalizeRole } from "../../roles";
import { formatDate, formatDayMonth } from "../../dateFormat";

// The fixed chips. A fifth one is added at runtime for whichever date is
// picked on the calendar, so the rail and this panel stay in step.
const BASE_FILTERS = [
  { key: "all", label: "All" },
  { key: "today", label: "Today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "overdue", label: "Overdue" },
];

const dayOf = (value) => (value ? String(value).split("T")[0] : null);

// "2026-08-11" -> "11 Aug", read straight off the string so a timezone can
// never shift the label by a day.
const chipDate = (isoDay) => {
  if (!isoDay) return "";
  const [y, m, d] = isoDay.split("-").map(Number);
  if (!y || !m || !d) return isoDay;
  return formatDayMonth(new Date(y, m - 1, d));
};

// Badge tint.
const priorityClass = (p) => {
  const v = (p || "").toLowerCase();
  if (v === "high") return "is-high";
  if (v === "medium") return "is-medium";
  if (v === "low") return "is-low";
  return "";
};

// Card's left stripe. Kept separate from the badge class so the two can never
// collide with the card's own is-* state classes.
const cardPriorityClass = (p) => {
  const v = (p || "").toLowerCase();
  if (v === "high") return "prio-high";
  if (v === "medium") return "prio-medium";
  if (v === "low") return "prio-low";
  return "";
};

// Everything needing attention, in one list: open leads plus the tasks created
// from the rail's Add Task button. Both are normalised to { kind, date, ... } so
// one set of filters covers them.
function LeadsWorkspace({
  leads,
  tasks = [],
  todayDate,
  selectedDate,
  isLoading,
  onOpenLead,
  onRefresh,
}) {
  // Opens on today's work rather than the whole backlog — the dashboard should
  // answer "what do I do now", not "everything that exists".
  const [filter, setFilter] = useState("today");

  // Picking a day on the calendar switches the panel to that day. Skipped on
  // first render, so landing on the dashboard still opens on "Today" rather
  // than on the date chip that happens to hold the same value.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (selectedDate) setFilter("date");
  }, [selectedDate]);

  const FILTERS = useMemo(() => {
    if (!selectedDate) return BASE_FILTERS;
    return [...BASE_FILTERS, { key: "date", label: chipDate(selectedDate) }];
  }, [selectedDate]);
  // Which card has its date picker open, and what date is chosen.
  const [postponeKey, setPostponeKey] = useState(null);
  const [postponeDate, setPostponeDate] = useState("");
  const [busyKey, setBusyKey] = useState(null);

  const authHeaders = () => ({
    headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
  });

  // Admin-only: view someone else's Lead Follow-ups & Tasks instead of your
  // own. Empty string means "myself". The dropdown lists everyone; the
  // server only actually honours the override for an Admin (see GET
  // /api/tasks), so this can never be used to see another role's private list.
  const isAdmin = normalizeRole(sessionStorage.getItem("userRole")) === ROLES.ADMIN;
  const [viewUserId, setViewUserId] = useState("");
  const [viewableUsers, setViewableUsers] = useState([]);
  const [viewedTasks, setViewedTasks] = useState([]);
  const [isLoadingViewedTasks, setIsLoadingViewedTasks] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    axios
      .get(`${API_BASE_URL}/api/users`, authHeaders())
      .then((res) => setViewableUsers(res.data || []))
      .catch((err) => console.error("Error loading users for the view-as dropdown:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    if (!viewUserId) {
      setViewedTasks([]);
      return;
    }
    setIsLoadingViewedTasks(true);
    axios
      .get(`${API_BASE_URL}/api/tasks`, { ...authHeaders(), params: { userId: viewUserId } })
      .then((res) => setViewedTasks(res.data || []))
      .catch((err) => {
        console.error("Error loading that user's tasks:", err);
        setViewedTasks([]);
      })
      .finally(() => setIsLoadingViewedTasks(false));
  }, [viewUserId]);

  // What's actually shown below — the selected person's tasks once one is
  // picked, otherwise the signed-in user's own (already scoped server-side).
  const effectiveTasks = viewUserId ? viewedTasks : tasks;

  const done = () => {
    setPostponeKey(null);
    setPostponeDate("");
    setBusyKey(null);
    if (onRefresh) onRefresh();
  };

  const idOf = (task) => task.taskId || task.id || task._id;

  const markTaskDone = async (task, key) => {
    setBusyKey(key);
    try {
      await axios.put(
        `${API_BASE_URL}/api/tasks/${idOf(task)}`,
        { status: "done" },
        authHeaders()
      );
    } catch (err) {
      console.error("Could not mark task done:", err);
    } finally {
      done();
    }
  };

  const postponeTask = async (task, key) => {
    if (!postponeDate) return;
    setBusyKey(key);
    try {
      await axios.put(
        `${API_BASE_URL}/api/tasks/${idOf(task)}`,
        { dueDate: postponeDate, status: "postponed" },
        authHeaders()
      );
    } catch (err) {
      console.error("Could not postpone task:", err);
    } finally {
      done();
    }
  };

  // A lead follow-up has no status field of its own. Completing one records the
  // action against the lead — so it shows up in the pipeline and the reports —
  // and clears the next-action date so it leaves this queue.
  const markLeadDone = async (lead, key) => {
    setBusyKey(key);
    const action = lead.companyInfo?.nextAction || "Follow-up";
    try {
      await axios.post(
        `${API_BASE_URL}/api/leads/${lead.leadNumber}/descriptions`,
        { description: `${action} completed.` },
        authHeaders()
      );
      await axios.put(
        `${API_BASE_URL}/api/leads/${lead.leadNumber}`,
        { companyInfo: { dateField: "" } },
        authHeaders()
      );
    } catch (err) {
      console.error("Could not complete follow-up:", err);
    } finally {
      done();
    }
  };

  // Postponing a lead just moves its next-action date out.
  const postponeLead = async (lead, key) => {
    if (!postponeDate) return;
    setBusyKey(key);
    try {
      await axios.put(
        `${API_BASE_URL}/api/leads/${lead.leadNumber}`,
        { companyInfo: { dateField: postponeDate } },
        authHeaders()
      );
    } catch (err) {
      console.error("Could not postpone follow-up:", err);
    } finally {
      done();
    }
  };

  const openPostpone = (key, currentDate) => {
    setPostponeKey(key);
    setPostponeDate(currentDate || todayDate);
  };

  // `leads` (from DashboardContext) is every company in the system — needed
  // for the Pipeline board, but a next action on someone else's lead is not
  // this person's work. This queue is "what do I do now" (see below), so it
  // only ever shows leads the *viewed* person (selected user, or self when
  // nobody is selected) created or is assigned to.
  const numericUserId = Number(viewUserId || sessionStorage.getItem("userId"));
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

  const items = useMemo(() => {
    const leadItems = leads.filter(isOpen).filter(isMyLead).map((lead) => ({
      kind: "lead",
      key: `lead-${lead.leadNumber}`,
      date: dayOf(lead.companyInfo?.dateField),
      overdue: isOverdue(lead),
      lead,
    }));

    // A task counts as outstanding until it is marked done.
    const taskItems = (effectiveTasks || [])
      .filter((t) => (t.status || "pending") !== "done")
      .map((task) => {
        const date = dayOf(task.dueDate);
        return {
          kind: "task",
          key: `task-${task.taskId || task.id || task._id}`,
          date,
          overdue: Boolean(date && date < todayDate),
          task,
        };
      });

    // Soonest first; anything without a date sits at the end.
    return [...leadItems, ...taskItems].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date.localeCompare(b.date);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, effectiveTasks, todayDate, numericUserId]);

  const matches = (item, key) => {
    switch (key) {
      case "today":
        return item.date === todayDate;
      case "date":
        return item.date === selectedDate;
      case "upcoming":
        return Boolean(item.date && item.date > todayDate);
      case "overdue":
        return item.overdue;
      default:
        return true;
    }
  };

  const filtered = useMemo(
    () => items.filter((item) => matches(item, filter)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, filter, todayDate, selectedDate]
  );

  const counts = useMemo(
    () =>
      FILTERS.reduce((acc, f) => {
        acc[f.key] = items.filter((item) => matches(item, f.key)).length;
        return acc;
      }, {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, todayDate, selectedDate, FILTERS]
  );

  return (
    <section className="wd-panel wd-leads">
      <header className="wd-panel-head">
        <h2>Lead Follow-ups &amp; Tasks</h2>
        <span className="wd-panel-count">{filtered.length}</span>
      </header>

      {/* Admin only: switch this whole panel to someone else's follow-ups and
          tasks instead of your own. The server still refuses this override
          for anyone who isn't an Admin, whatever the client sends. */}
      {isAdmin && (
        <div className="wd-view-as">
          <label htmlFor="wd-view-as-select">Viewing:</label>
          <select
            id="wd-view-as-select"
            value={viewUserId}
            onChange={(e) => setViewUserId(e.target.value)}
          >
            <option value="">Myself</option>
            {viewableUsers.map((u) => (
              <option key={u._id || u.id} value={u._id || u.id}>
                {u.firstName} {u.lastName}
                {u.designation ? ` — ${u.designation}` : ""}
              </option>
            ))}
          </select>
          {isLoadingViewedTasks && <span className="wd-view-as-loading">Loading…</span>}
        </div>
      )}

      <div className="wd-filters">
        <span className="wd-filters-label">Filter by:</span>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`wd-chip ${filter === f.key ? "is-active" : ""} ${
              f.key === "overdue" && counts.overdue > 0 ? "is-alert" : ""
            } ${f.key === "date" ? "is-date" : ""}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="wd-chip-count">{counts[f.key]}</span>
          </button>
        ))}
      </div>

      <div className="wd-lead-list">
        {isLoading && <p className="wd-empty">Loading leads…</p>}

        {!isLoading && filtered.length === 0 && (
          <p className="wd-empty">
            {filter === "date"
              ? `Nothing scheduled for ${chipDate(selectedDate)}.`
              : "Nothing matches this filter."}
          </p>
        )}

        {!isLoading &&
          filtered.slice(0, 20).map((item) => {
            if (item.kind === "task") {
              const { task } = item;
              return (
                <article
                  className={`wd-lead-card is-task ${cardPriorityClass(
                    task.priority
                  )} ${item.overdue ? "is-overdue" : ""}`}
                  key={item.key}
                >
                  <div className="wd-lead-top">
                    <div className="wd-lead-id">
                      <FontAwesomeIcon icon={faListCheck} />
                      <div>
                        <h3>{task.title}</h3>
                        <p className="wd-lead-sub">
                          {[task.associatedLead, task.category]
                            .filter(
                              (v) => v && v !== "General / None"
                            )
                            .join(" · ") || "Task"}
                        </p>
                      </div>
                    </div>
                    <div className="wd-lead-badges">
                      {task.assignedByName ? (
                        <span
                          className="wd-badge is-assigned"
                          title={`Assigned by ${task.assignedByName}`}
                        >
                          From {task.assignedByName}
                        </span>
                      ) : (
                        <span className="wd-badge is-task-tag">Task</span>
                      )}
                      {task.ownerName && (
                        <span className="wd-badge is-owner">{task.ownerName}</span>
                      )}
                      {task.priority && (
                        <span className={`wd-badge ${priorityClass(task.priority)}`}>
                          {task.priority}
                        </span>
                      )}
                    </div>
                  </div>

                  {task.description && (
                    <p className="wd-task-desc">{task.description}</p>
                  )}

                  <div className="wd-lead-meta">
                    {item.date && (
                      <span className={item.overdue ? "is-alert" : ""}>
                        <FontAwesomeIcon icon={faClock} />{" "}
                        {item.overdue ? "Overdue " : "Due "}
                        {formatDate(item.date)}
                      </span>
                    )}
                    {task.status && task.status !== "pending" && (
                      <span>{task.status.replace(/_/g, " ")}</span>
                    )}
                  </div>

                  {/* Viewing someone else's tasks is read-only — the server
                      only lets a task's own owner or assigner change it, so
                      an Admin just looking in on this list can't act on it. */}
                  {!viewUserId && (
                    <div className="wd-lead-actions">
                      <button
                        type="button"
                        className="wd-lead-btn is-done"
                        disabled={busyKey === item.key}
                        onClick={() => markTaskDone(task, item.key)}
                      >
                        <FontAwesomeIcon icon={faCheck} /> Done
                      </button>
                      <button
                        type="button"
                        className="wd-lead-btn"
                        onClick={() => openPostpone(item.key, item.date)}
                      >
                        <FontAwesomeIcon icon={faCalendarPlus} /> Postpone
                      </button>
                    </div>
                  )}

                  {!viewUserId && postponeKey === item.key && (
                    <div className="wd-postpone">
                      <input
                        type="date"
                        value={postponeDate}
                        min={todayDate}
                        onChange={(e) => setPostponeDate(e.target.value)}
                      />
                      <button
                        type="button"
                        className="wd-lead-btn is-primary"
                        disabled={!postponeDate || busyKey === item.key}
                        onClick={() => postponeTask(task, item.key)}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="wd-lead-btn"
                        onClick={() => setPostponeKey(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </article>
              );
            }

            const lead = item.lead;
            const info = lead.companyInfo || {};
            const value = dealValue(lead);
            const overdue = item.overdue;
            return (
              <article
                className={`wd-lead-card ${cardPriorityClass(info.priority)} ${
                  overdue ? "is-overdue" : ""
                }`}
                key={item.key}
              >
                <div className="wd-lead-top">
                  <div className="wd-lead-id">
                    <FontAwesomeIcon icon={faBuilding} />
                    <div>
                      <h3>{info.companyName || `Lead #${lead.leadNumber}`}</h3>
                      <p className="wd-lead-sub">
                        {[info.vertical, info.city].filter(Boolean).join(" · ") ||
                          "No vertical set"}
                      </p>
                    </div>
                  </div>
                  <div className="wd-lead-badges">
                    {info.priority && (
                      <span className={`wd-badge ${priorityClass(info.priority)}`}>
                        {info.priority}
                      </span>
                    )}
                    {value !== null && (
                      <span className="wd-badge is-value">
                        {formatINR(value)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="wd-lead-meta">
                  {info.nextAction && (
                    <span>
                      <FontAwesomeIcon icon={faClock} /> {info.nextAction}
                    </span>
                  )}
                  {info.dateField && (
                    <span className={overdue ? "is-alert" : ""}>
                      {overdue ? "Overdue " : "Due "}
                      {formatDate(info.dateField)}
                    </span>
                  )}
                  {info.state && (
                    <span>
                      <FontAwesomeIcon icon={faLocationDot} /> {info.state}
                    </span>
                  )}
                </div>

                <div className="wd-lead-actions">
                  {info.genericPhone1 && (
                    <a
                      className="wd-lead-btn"
                      href={`tel:${String(info.genericPhone1).split(",")[0].trim()}`}
                    >
                      <FontAwesomeIcon icon={faPhone} /> Call
                    </a>
                  )}
                  {info.genericEmail1 && (
                    <a
                      className="wd-lead-btn"
                      href={`mailto:${info.genericEmail1}`}
                    >
                      <FontAwesomeIcon icon={faEnvelope} /> Email
                    </a>
                  )}
                  <button
                    type="button"
                    className="wd-lead-btn is-done"
                    disabled={busyKey === item.key}
                    onClick={() => markLeadDone(lead, item.key)}
                    title="Log this follow-up as completed and clear its date"
                  >
                    <FontAwesomeIcon icon={faCheck} /> Done
                  </button>
                  <button
                    type="button"
                    className="wd-lead-btn"
                    onClick={() => openPostpone(item.key, item.date)}
                  >
                    <FontAwesomeIcon icon={faCalendarPlus} /> Postpone
                  </button>
                  <button
                    type="button"
                    className="wd-lead-btn is-primary"
                    onClick={() => onOpenLead(lead.leadNumber)}
                  >
                    Open <FontAwesomeIcon icon={faArrowRight} />
                  </button>
                </div>

                {postponeKey === item.key && (
                  <div className="wd-postpone">
                    <input
                      type="date"
                      value={postponeDate}
                      min={todayDate}
                      onChange={(e) => setPostponeDate(e.target.value)}
                    />
                    <button
                      type="button"
                      className="wd-lead-btn is-primary"
                      disabled={!postponeDate || busyKey === item.key}
                      onClick={() => postponeLead(lead, item.key)}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="wd-lead-btn"
                      onClick={() => setPostponeKey(null)}
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </article>
            );
          })}

        {/* A short list left the rest of the panel blank white — this turns
            that leftover space into an intentional "you're done here"
            message instead of looking like the panel cut off early. */}
        {!isLoading && filtered.length > 0 && filtered.length <= 6 && (
          <div className="wd-list-tail">
            <FontAwesomeIcon icon={faCheck} className="wd-list-tail-icon" />
            <p>
              That's everything for{" "}
              {FILTERS.find((f) => f.key === filter)?.label.toLowerCase() || "this filter"}.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export default LeadsWorkspace;
