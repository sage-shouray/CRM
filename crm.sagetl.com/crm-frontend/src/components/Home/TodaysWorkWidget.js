import React, { useEffect, useState } from "react";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBolt,
  faUserPlus,
  faPenToSquare,
  faEye,
  faNoteSticky,
  faListCheck,
  faComments,
  faClock,
} from "@fortawesome/free-solid-svg-icons";
import "./TodaysWorkWidget.css";
import { API_BASE_URL } from "../../config";
import { useLiveUpdates } from "../../liveUpdates";

// "What did I do today" — a self-scoped summary pulled from the audit log,
// visible to every role. Refreshes on the same live-update signals the rest
// of the dashboard reacts to, so an action taken elsewhere shows up here too.
function TodaysWorkWidget() {
  const [activity, setActivity] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMyActivity = async () => {
    try {
      const token = sessionStorage.getItem("token");
      if (!token) return;
      const res = await axios.get(`${API_BASE_URL}/api/reports/my-activity`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setActivity(res.data || null);
    } catch (err) {
      console.error("Error fetching today's activity:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMyActivity();
  }, []);

  useLiveUpdates(["leads", "tasks"], () => fetchMyActivity());

  const stats = [
    { key: "leads_created", label: "Leads Created", icon: faUserPlus },
    { key: "leads_updated", label: "Leads Updated", icon: faPenToSquare },
    { key: "leads_viewed", label: "Leads Viewed", icon: faEye },
    { key: "notes_added", label: "Notes Added", icon: faNoteSticky },
    { key: "task_actions", label: "Task Actions", icon: faListCheck },
    { key: "chat_messages", label: "Chat Messages", icon: faComments },
  ];

  const totalActions = activity?.actions || 0;
  const activeMinutes = activity?.active_minutes || 0;

  return (
    <div className="todays-work-card">
      <div className="todays-work-header">
        <div className="widget-title-group">
          <FontAwesomeIcon icon={faBolt} className="widget-header-icon" />
          <div>
            <h3>Today's Work</h3>
            <p>A live summary of what you've done so far today.</p>
          </div>
        </div>

        <div className="todays-work-summary-pill">
          <FontAwesomeIcon icon={faClock} />
          <span>{activeMinutes} min active</span>
        </div>
      </div>

      {isLoading ? (
        <div className="todays-work-loading">Loading your activity...</div>
      ) : totalActions === 0 ? (
        <div className="todays-work-empty">
          Nothing logged yet today — actions you take will show up here.
        </div>
      ) : (
        <div className="todays-work-stats-row">
          {stats.map((s) => (
            <div key={s.key} className="todays-work-stat">
              <FontAwesomeIcon icon={s.icon} className="stat-icon" />
              <strong>{activity?.[s.key] || 0}</strong>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}

      {activity?.worklog && (
        <div className="todays-work-note">
          <strong>Your note:</strong> {activity.worklog}
        </div>
      )}
    </div>
  );
}

export default TodaysWorkWidget;
