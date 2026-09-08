import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import axios from "axios";
import { API_BASE_URL } from "../config";
import { useLiveUpdates } from "../liveUpdates";

// The calendar now lives in the sidebar, outside the page tree, but the date
// the user picks still drives the agenda on the Home page. That shared state
// (and the events feeding the calendar) lives here so both sides read one
// source instead of fetching and tracking it twice.
const DashboardContext = createContext(null);

export const todayStr = () => {
  // Local date, not UTC — toISOString() would roll over a day for anyone east
  // or west of GMT depending on the hour.
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const dateOnly = (value) =>
  typeof value === "string" && value ? value.split("T")[0] : null;

export function DashboardProvider({ children }) {
  const [leads, setLeads] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const load = useCallback(async () => {
    const token = sessionStorage.getItem("token");
    if (!token) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      // Either call may legitimately fail for a role that lacks access; a
      // failure should empty that half, not blank the whole calendar.
      const [leadsRes, tasksRes] = await Promise.allSettled([
        axios.get(`${API_BASE_URL}/api/leads`),
        axios.get(`${API_BASE_URL}/api/tasks`),
      ]);
      setLeads(leadsRes.status === "fulfilled" ? leadsRes.value.data || [] : []);
      setTasks(tasksRes.status === "fulfilled" ? tasksRes.value.data || [] : []);
    } catch (err) {
      console.error("Dashboard data load failed:", err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    // A task assigned from elsewhere (or created in the rail) should appear
    // without a reload; the header dispatches this when the socket fires.
    const onTasksChanged = () => load();
    window.addEventListener("tasks:changed", onTasksChanged);
    return () => window.removeEventListener("tasks:changed", onTasksChanged);
  }, [load]);

  // The KPI tiles, Pipeline board, and "Lead Follow-ups & Tasks" queue all
  // read from this one shared fetch — without this, a lead someone else
  // created or updated, or a task completed elsewhere, only showed up here
  // after a full page reload. Any leads/tasks change anywhere in the system
  // now refreshes this shared state directly.
  useLiveUpdates(["leads", "tasks"], load);

  // Leads and tasks flattened into the shape HomeCalendar expects. `leads`
  // itself stays unscoped (Pipeline needs every company), but the calendar's
  // day badges are personal — even just a count of someone else's follow-ups
  // is still their activity, not this viewer's, so it's filtered here too.
  const numericSelfId = Number(sessionStorage.getItem("userId"));
  const isMyLeadForCalendar = (lead) => {
    if (!Number.isFinite(numericSelfId)) return false;
    const creatorId = Number(lead.createdBy?._id ?? lead.createdBy?.id ?? lead.createdBy);
    if (creatorId === numericSelfId) return true;
    const assigned = lead.companyInfo?.leadAssignedTo;
    const idOf = (v) => Number(v?._id ?? v?.id ?? v);
    return Array.isArray(assigned)
      ? assigned.some((a) => idOf(a) === numericSelfId)
      : idOf(assigned) === numericSelfId;
  };

  const calendarEvents = useMemo(() => {
    const events = [];

    (leads || []).filter(isMyLeadForCalendar).forEach((lead) => {
      const info = lead.companyInfo || {};
      const date =
        dateOnly(info.dateField) ||
        dateOnly(info.nextActionDate) ||
        dateOnly(lead.createdAt);
      if (!date) return;
      events.push({
        id: `lead-${lead.leadNumber}`,
        type: "followup",
        date,
        title: `Follow-up: ${info.companyName || "Lead #" + lead.leadNumber}`,
        leadNumber: lead.leadNumber,
        nextAction: info.nextAction || "Follow Up",
        priority: info.priority || "Medium",
        companyName: info.companyName || "N/A",
        phone: info.genericPhone1 || "N/A",
      });
    });

    (tasks || []).forEach((task) => {
      const date = dateOnly(task.dueDate);
      if (!date) return;
      events.push({
        id: task.taskId || task._id || task.id,
        type: "task",
        date,
        title: task.title,
        priority: task.priority,
        category: task.category,
        status: task.status || "pending",
      });
    });

    return events;
  }, [leads, tasks]);

  const value = useMemo(
    () => ({
      leads,
      tasks,
      calendarEvents,
      isLoading,
      selectedDate,
      setSelectedDate,
      refresh: load,
    }),
    [leads, tasks, calendarEvents, isLoading, selectedDate, load]
  );

  return (
    <DashboardContext.Provider value={value}>
      {children}
    </DashboardContext.Provider>
  );
}

// Safe outside the provider (e.g. the login screen) — returns inert defaults
// rather than throwing, so an unwrapped route cannot white-screen.
export function useDashboard() {
  const ctx = useContext(DashboardContext);
  if (ctx) return ctx;
  return {
    leads: [],
    tasks: [],
    calendarEvents: [],
    isLoading: false,
    selectedDate: todayStr(),
    setSelectedDate: () => {},
    refresh: () => {},
  };
}

export default DashboardContext;
