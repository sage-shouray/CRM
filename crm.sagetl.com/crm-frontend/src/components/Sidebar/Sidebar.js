import React from "react";
import HomeCalendar from "../Home/HomeCalendar";
import HomeToDoWidget from "../Home/HomeToDoWidget";
import SidebarNotes from "./SidebarNotes";
import { useDashboard } from "../../context/DashboardContext";
import "./Sidebar.css";

// Persistent right rail: the month calendar on top, the agenda / task list for
// whichever date is selected in the middle, and quick notes at the bottom. The
// rail itself never scrolls — each section scrolls internally. Reports moved to
// their own page in the nav rail; the user and sign-out live in the top bar.
function Sidebar() {
  const { calendarEvents, selectedDate, setSelectedDate, refresh } =
    useDashboard();

  return (
    <aside className="app-sidebar">
      <div className="sidebar-calendar">
        <HomeCalendar
          events={calendarEvents}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
        />
      </div>

      {/* Add Task only. The agenda and task lists that used to sit here are on
          the dashboard now, inside Lead Follow-ups. */}
      <div className="sidebar-addtask">
        <HomeToDoWidget addOnly onTaskCreated={refresh} />
      </div>

      <SidebarNotes />
    </aside>
  );
}

export default Sidebar;
