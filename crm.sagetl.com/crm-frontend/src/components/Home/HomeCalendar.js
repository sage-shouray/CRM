import React, { useState } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faChevronLeft, 
  faChevronRight, 
  faCalendarAlt, 
  faCalendarDay,
  faBell
} from "@fortawesome/free-solid-svg-icons";
import "./HomeCalendar.css";

function HomeCalendar({ events = [], selectedDate, onSelectDate }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"
  ];

  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Calculate days in month
  const firstDayOfMonth = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const handleTodayClick = () => {
    const today = new Date();
    setCurrentMonth(new Date(today.getFullYear(), today.getMonth(), 1));
    const formattedToday = formatDateString(today);
    onSelectDate(formattedToday);
  };

  const formatDateString = (dateObj) => {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, '0');
    const d = String(dateObj.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Group events by date YYYY-MM-DD
  const eventsByDate = {};
  events.forEach((ev) => {
    if (!ev.date) return;
    let dateStr = ev.date;
    if (dateStr.includes('T')) {
      dateStr = dateStr.split('T')[0];
    }
    if (!eventsByDate[dateStr]) {
      eventsByDate[dateStr] = { followups: 0, tasksDone: 0, tasksNotDone: 0, tasksPending: 0 };
    }
    if (ev.type === 'followup') {
      eventsByDate[dateStr].followups += 1;
    } else if (ev.status === 'done') {
      eventsByDate[dateStr].tasksDone += 1;
    } else if (ev.status === 'not_done' || (dateStr < todayStr && ev.status !== 'postponed')) {
      eventsByDate[dateStr].tasksNotDone += 1;
    } else {
      eventsByDate[dateStr].tasksPending += 1;
    }
  });

  const todayStr = formatDateString(new Date());

  // Generate calendar grid days
  const calendarGrid = [];

  for (let i = firstDayOfMonth - 1; i >= 0; i--) {
    const dayNum = daysInPrevMonth - i;
    const prevDate = new Date(year, month - 1, dayNum);
    calendarGrid.push({
      dayNum,
      dateStr: formatDateString(prevDate),
      isCurrentMonth: false
    });
  }

  for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
    const curDate = new Date(year, month, dayNum);
    calendarGrid.push({
      dayNum,
      dateStr: formatDateString(curDate),
      isCurrentMonth: true
    });
  }

  const remainingCells = (calendarGrid.length > 35 ? 42 : 35) - calendarGrid.length;
  for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
    const nextDate = new Date(year, month + 1, dayNum);
    calendarGrid.push({
      dayNum,
      dateStr: formatDateString(nextDate),
      isCurrentMonth: false
    });
  }

  return (
    <div className="home-calendar-card">
      <div className="calendar-header-bar">
        <div className="calendar-title-group">
          <FontAwesomeIcon icon={faCalendarAlt} className="calendar-header-icon" />
          <h2>{monthNames[month]} {year}</h2>
        </div>
        <div className="calendar-nav-controls">
          <button onClick={handleTodayClick} className="btn-today-shortcut" title="Jump to Today">
            <FontAwesomeIcon icon={faCalendarDay} /> Today
          </button>
          <button onClick={handlePrevMonth} className="btn-cal-nav" title="Previous Month">
            <FontAwesomeIcon icon={faChevronLeft} />
          </button>
          <button onClick={handleNextMonth} className="btn-cal-nav" title="Next Month">
            <FontAwesomeIcon icon={faChevronRight} />
          </button>
        </div>
      </div>

      <div className="calendar-weekdays-row">
        {daysOfWeek.map((day) => (
          <div key={day} className="weekday-cell">
            {day}
          </div>
        ))}
      </div>

      <div className="calendar-days-grid">
        {calendarGrid.map((cell, idx) => {
          const isSelected = cell.dateStr === selectedDate;
          const isToday = cell.dateStr === todayStr;
          const dayEvents = eventsByDate[cell.dateStr] || { followups: 0, tasksDone: 0, tasksNotDone: 0, tasksPending: 0 };
          const hasEvents = dayEvents.followups > 0 || dayEvents.tasksDone > 0 || dayEvents.tasksNotDone > 0 || dayEvents.tasksPending > 0;

          return (
            <div
              key={idx}
              className={`calendar-day-cell ${!cell.isCurrentMonth ? "other-month" : ""} ${
                isSelected ? "selected-day" : ""
              } ${isToday ? "today-day" : ""}`}
              onClick={() => onSelectDate(cell.dateStr)}
            >
              <div className="day-number-header">
                <span className="day-num">{cell.dayNum}</span>
                {isToday && <span className="today-badge">TODAY</span>}
              </div>

              {hasEvents && (
                <div className="day-event-indicators">
                  {dayEvents.followups > 0 && (
                    <span className="event-pill followup-pill" title={`${dayEvents.followups} Lead Follow-up(s)`}>
                      <FontAwesomeIcon icon={faBell} className="pill-icon" />
                      {dayEvents.followups}
                    </span>
                  )}
                  {dayEvents.tasksDone > 0 && (
                    <span className="event-pill done-pill" title={`${dayEvents.tasksDone} Done Task(s)`}>
                      ✓ {dayEvents.tasksDone} Done
                    </span>
                  )}
                  {dayEvents.tasksNotDone > 0 && (
                    <span className="event-pill not-done-pill" title={`${dayEvents.tasksNotDone} Not Done Task(s)`}>
                      ✗ {dayEvents.tasksNotDone} Not Done
                    </span>
                  )}
                  {dayEvents.tasksPending > 0 && (
                    <span className="event-pill pending-pill" title={`${dayEvents.tasksPending} Pending Task(s)`}>
                      {dayEvents.tasksPending} Work
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="calendar-legend-footer">
        <div className="legend-item">
          <span className="legend-dot dot-followup"></span>
          <span>Lead Follow-ups</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-done"></span>
          <span>Done Tasks</span>
        </div>
        <div className="legend-item">
          <span className="legend-dot dot-not-done"></span>
          <span>Not Done Tasks</span>
        </div>
      </div>
    </div>
  );

}

export default HomeCalendar;
