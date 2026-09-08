import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHouse,
  faFolderOpen,
  faFilter,
  faListCheck,
  faClipboardCheck,
  faUsers,
  faUserGear,
  faChartPie,
  faDownload,
  faComments,
  faChevronRight,
  faFileExcel,
  faEnvelope,
  faShieldHalved,
  faUserPlus,
  faUserShield,
} from "@fortawesome/free-solid-svg-icons";
import { ROLES, normalizeRole, canManageTeam, canManageUsers } from "../../roles";
import { useDashboard } from "../../context/DashboardContext";
import { API_BASE_URL } from "../../config";
import "./SideNav.css";

// The primary navigation rail. Each entry is either a direct route, a group of
// routes that expands in place, or an action (Downloads). Visibility is decided
// per role using the same helpers the rest of the app uses.
const buildNav = (role) => {
  const items = [
    { key: "home", label: "Home", icon: faHouse, path: "/home" },
    { key: "chat", label: "Chat", icon: faComments, path: "/chat", badge: "chat" },
    {
      key: "leads",
      label: "Leads",
      icon: faFolderOpen,
      children: [
        { label: "Create Lead", path: "/create-lead" },
        { label: "Company Info", path: "/leads" },
        { label: "Companies", path: "/companies" },
        { label: "Cold Leads", path: "/cold-leads" },
        { label: "My Leads", path: "/my-cold-leads" },
        ...(canManageTeam(role)
          ? [
              { label: "Unassigned Leads", path: "/unassigned-leads" },
              { label: "Multiple Assign", path: "/multiple-assign" },
            ]
          : []),
      ],
    },
    { key: "pipeline", label: "Pipeline", icon: faFilter, path: "/pipeline" },
    { key: "todo", label: "To-do", icon: faListCheck, path: "/todo", badge: "todo" },
    // Everyone files a daily report of what they worked on. Admins are exempt
    // from filing but keep the link, since they read the same page.
    {
      key: "dailylog",
      label: "My Day",
      icon: faClipboardCheck,
      path: "/daily-log",
    },
  ];

  if (canManageTeam(role)) {
    items.push({ key: "team", label: "Team", icon: faUsers, path: "/team-overview" });
  }

  if (canManageUsers(role)) {
    // Admin tiers get the full directory.
    items.push({ key: "users", label: "Users", icon: faUserGear, path: "/user-management" });
  } else if (role === ROLES.MANAGER) {
    // A Manager can add Executives to its own team but does not administer the
    // wider directory, so it gets the create form only.
    items.push({
      key: "users",
      label: "Add Executive",
      icon: faUserPlus,
      path: "/add-user",
    });
  }

  // Reports are scoped to the caller's branch on the server, so a Manager sees
  // what its own Executives did and nothing further.
  if (canManageTeam(role)) {
    items.push({ key: "reports", label: "Reports", icon: faChartPie, path: "/reports" });
  }

  // The audit trail spans every account, so it stays with the Admin tiers.
  if (canManageUsers(role)) {
    items.push({
      key: "permissions",
      label: "Permissions",
      icon: faUserShield,
      path: "/permissions",
    });
    items.push({ key: "audit", label: "Audit", icon: faShieldHalved, path: "/audit" });
    items.push({ key: "bulk-import", label: "Bulk Import", icon: faFileExcel, path: "/bulk-import" });
    items.push({ key: "downloads", label: "Downloads", icon: faDownload, action: "downloads" });
  }

  return items;
};

function SideNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { tasks } = useDashboard();

  const [role, setRole] = useState(ROLES.EXECUTIVE);
  const [expanded, setExpanded] = useState(null);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    setRole(normalizeRole(sessionStorage.getItem("userRole")) || ROLES.EXECUTIVE);
  }, []);

  // Same unread source the chat badge uses elsewhere.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/chat/unread`);
        if (!cancelled) setUnread(res.data?.total || 0);
      } catch (err) {
        /* badge simply stays put */
      }
    };
    load();
    const onChanged = () => load();
    window.addEventListener("chat:unread-changed", onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("chat:unread-changed", onChanged);
    };
  }, [pathname]);

  const openTasks = (tasks || []).filter(
    (t) => (t.status || "pending") !== "done"
  ).length;

  const badgeValue = (kind) => {
    if (kind === "chat") return unread;
    if (kind === "todo") return openTasks;
    return 0;
  };

  const nav = buildNav(role);

  const isPathActive = (path) =>
    path === "/home"
      ? pathname === "/home" || pathname === "/"
      : pathname === path || pathname.startsWith(`${path}/`);

  const isItemActive = (item) => {
    if (item.path) return isPathActive(item.path);
    if (item.children) return item.children.some((c) => isPathActive(c.path));
    return false;
  };

  // A group stays open while one of its routes is active, so the current
  // location is always visible without needing a click.
  const isExpanded = (item) =>
    expanded === item.key || (expanded === null && isItemActive(item));

  const downloadFile = async (type) => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/download/${type}`, {
        responseType: "blob",
        headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
      });
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${type}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Error downloading file:", err);
    }
  };

  const handleClick = (item, e) => {
    // The rail stays open on :focus-within as well as :hover, so keyboard
    // users can reach it without a mouse. A click leaves its own button
    // focused, though, which then holds the rail open by itself until focus
    // moves elsewhere. Dropping focus after the click lets a plain mouse
    // click collapse it on mouse-out again, like hover alone would.
    e?.currentTarget?.blur();

    if (item.path) {
      navigate(item.path);
      setExpanded(null);
      return;
    }
    setExpanded(isExpanded(item) ? "none" : item.key);
  };

  return (
    // The <nav> holds a fixed, narrow footprint in the layout; the panel inside
    // it floats and widens on hover, so expanding never reflows the page.
    <nav className="side-nav" aria-label="Primary">
      <div className="side-nav-panel">
      <ul className="side-nav-list">
        {nav.map((item) => {
          const active = isItemActive(item);
          const count = item.badge ? badgeValue(item.badge) : 0;
          const expandedNow = item.children || item.action ? isExpanded(item) : false;

          return (
            <li key={item.key} className="side-nav-entry">
              <button
                type="button"
                className={`side-nav-item ${active ? "is-active" : ""}`}
                onClick={(e) => handleClick(item, e)}
                aria-expanded={item.children ? expandedNow : undefined}
                /* The label is hidden while the rail is collapsed, so the
                   tooltip is the only way to identify an icon. */
                title={item.label}
              >
                <FontAwesomeIcon icon={item.icon} className="side-nav-icon" />
                <span className="side-nav-label">{item.label}</span>
                {count > 0 && (
                  <span className="side-nav-badge">{count > 99 ? "99+" : count}</span>
                )}
                {(item.children || item.action) && (
                  <FontAwesomeIcon
                    icon={faChevronRight}
                    className={`side-nav-caret ${expandedNow ? "is-open" : ""}`}
                  />
                )}
              </button>

              {item.children && expandedNow && (
                <ul className="side-nav-sublist">
                  {item.children.map((child) => (
                    <li key={child.path}>
                      <button
                        type="button"
                        className={`side-nav-subitem ${
                          isPathActive(child.path) ? "is-active" : ""
                        }`}
                        onClick={(e) => {
                          e.currentTarget.blur();
                          navigate(child.path);
                        }}
                      >
                        {child.label}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {item.action === "downloads" && expandedNow && (
                <ul className="side-nav-sublist">
                  <li>
                    <button
                      type="button"
                      className="side-nav-subitem"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        downloadFile("leads");
                      }}
                    >
                      <FontAwesomeIcon icon={faFileExcel} /> Leads XLSX
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="side-nav-subitem"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        downloadFile("users");
                      }}
                    >
                      <FontAwesomeIcon icon={faFileExcel} /> Users XLSX
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      className="side-nav-subitem"
                      onClick={(e) => {
                        e.currentTarget.blur();
                        navigate("/email-export");
                        setExpanded(null);
                      }}
                    >
                      <FontAwesomeIcon icon={faEnvelope} /> Email List
                    </button>
                  </li>
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      </div>
    </nav>
  );
}

export default SideNav;
