import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { ROLES, normalizeRole, roleShortLabel } from "../../roles";
import { handleSuccess } from "../../utils";
import { toast } from "react-toastify";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMagnifyingGlass,
  faPlus,
  faBell,
  faRightFromBracket,
  faBuilding
} from "@fortawesome/free-solid-svg-icons";
import "./Header.css";
import logo from "./logo.png";

import { API_BASE_URL } from "../../config";

// Navigation moved to the left rail (components/Nav/SideNav.js); this bar now
// carries identity, search and the primary action only.

function Header() {
  const [userRole, setUserRole] = useState("");
  const [loggedInUser, setLoggedInUser] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const isChatActive = currentPath === "/chat";

  const currentUserId = Number(sessionStorage.getItem("userId") || "0");

  // Pull the authoritative unread count from the backend.
  const refetchUnread = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE_URL}/api/chat/unread`);
      setUnreadTotal(res.data?.total || 0);
    } catch (err) {
      // Silent — badge simply won't update.
    }
  }, []);

  // Real-time unread tracking: connect a socket, refresh the badge on new
  // messages / read receipts, and toast when a message arrives off the chat page.
  useEffect(() => {
    if (!currentUserId) return;
    refetchUnread();

    const socket = io(API_BASE_URL);
    socket.emit("register", currentUserId);

    socket.on("new_message", (message) => {
      if (message.senderId === currentUserId) return;
      refetchUnread();
      // If the user isn't already looking at the chat page, notify them.
      if (currentPathRef.current !== "/chat") {
        const who = message.senderName || "Someone";
        toast.info(`New message from ${who}`, { position: "top-right" });
      }
    });

    socket.on("messages_read", () => refetchUnread());

    // Work handed to this user by someone above them. The server emits to the
    // user's own room, so this only fires for the assignee.
    socket.on("task_assigned", (task) => {
      toast.info(
        `${task.assignedByName || "Someone"} assigned you: ${task.title}`,
        { position: "top-right", autoClose: 8000 }
      );
      // Nudge any open list to pick the new task up without a reload.
      window.dispatchEvent(new Event("tasks:changed"));
    });

    // Chat page dispatches this after it marks a conversation read.
    const onUnreadChanged = () => refetchUnread();
    window.addEventListener("chat:unread-changed", onUnreadChanged);

    return () => {
      socket.disconnect();
      window.removeEventListener("chat:unread-changed", onUnreadChanged);
    };
  }, [currentUserId, refetchUnread]);

  // Refresh whenever navigation changes (e.g. leaving the chat page).
  useEffect(() => {
    if (currentUserId) refetchUnread();
  }, [currentPath, currentUserId, refetchUnread]);

  useEffect(() => {
    setUserRole(normalizeRole(sessionStorage.getItem("userRole")) || ROLES.EXECUTIVE);
    setLoggedInUser(sessionStorage.getItem("loggedInUser") || "User");
  }, []);

  // Company type-ahead, reusing the same endpoint the Create Lead form uses for
  // duplicate detection — so what the search predicts and what the form treats
  // as an existing company can never disagree.
  useEffect(() => {
    const term = searchTerm.trim();
    if (term.length < 2) {
      setSuggestions([]);
      setSuggestOpen(false);
      return;
    }

    // Debounced, and `cancelled` stops a slow response overwriting a newer one.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_BASE_URL}/api/leads/company-search`, {
          params: { q: term },
        });
        if (cancelled) return;
        const list = Array.isArray(res.data) ? res.data : [];
        setSuggestions(list);
        setHighlight(-1);
        setSuggestOpen(list.length > 0);
      } catch (err) {
        if (!cancelled) {
          setSuggestions([]);
          setSuggestOpen(false);
        }
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [searchTerm]);

  // Any navigation closes the dropdown.
  useEffect(() => {
    setSuggestOpen(false);
  }, [currentPath]);

  const handleLogout = () => {
    sessionStorage.removeItem("token");
    sessionStorage.removeItem("loggedInUser");
    sessionStorage.removeItem("userId");
    sessionStorage.removeItem("userRole");

    handleSuccess("Logged out successfully");
    setTimeout(() => {
      navigate("/login", { replace: true });
      window.location.reload();
    }, 800);
  };

  const userInitial = (loggedInUser.charAt(0) || "U").toUpperCase();
  const roleHeaderClass =
    {
      [ROLES.ADMIN]: "superadmin-header",
      [ROLES.ADMIN]: "admin-header",
      [ROLES.MANAGER]: "bdm-header",
      [ROLES.EXECUTIVE]: "businesslead-header",
    }[userRole] || "";

  // Global search hands off to the Companies page, which already knows how to
  // filter by company name / lead number.
  const handleSearchSubmit = (e) => {
    e.preventDefault();
    // If a suggestion is highlighted, that wins over the raw text.
    if (highlight >= 0 && suggestions[highlight]) {
      return goToCompany(suggestions[highlight]);
    }
    const term = searchTerm.trim();
    setSuggestOpen(false);
    navigate(term ? `/companies?q=${encodeURIComponent(term)}` : "/companies");
  };

  const goToCompany = (match) => {
    setSuggestOpen(false);
    setSearchTerm(match.companyName);
    navigate(`/companies?q=${encodeURIComponent(match.companyName)}`);
  };

  const handleSearchKeyDown = (e) => {
    if (!suggestOpen || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    }
  };

  return (
    <header className={`main-container topbar ${roleHeaderClass}`}>
      <div className="brand-logo-area" onClick={() => navigate("/home")} title="Return to Dashboard">
        <img src={logo} alt="Sage CRM Logo" className="top-image" />
      </div>

      <span className="topbar-title">CRM Portal</span>

      <form className="topbar-search" onSubmit={handleSearchSubmit} role="search">
        <FontAwesomeIcon icon={faMagnifyingGlass} className="topbar-search-icon" />
        <input
          type="search"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => suggestions.length > 0 && setSuggestOpen(true)}
          /* Delayed so a click on a suggestion lands before the list closes. */
          onBlur={() => setTimeout(() => setSuggestOpen(false), 120)}
          placeholder="Search leads, companies…"
          aria-label="Search companies"
          autoComplete="off"
          role="combobox"
          aria-expanded={suggestOpen}
          aria-controls="topbar-suggestions"
        />

        {suggestOpen && suggestions.length > 0 && (
          <ul className="topbar-suggestions" id="topbar-suggestions" role="listbox">
            {suggestions.map((match, i) => (
              <li key={match.leadNumber}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === highlight}
                  className={`topbar-suggestion ${
                    i === highlight ? "is-active" : ""
                  }`}
                  onMouseEnter={() => setHighlight(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => goToCompany(match)}
                >
                  <FontAwesomeIcon icon={faBuilding} />
                  <span className="topbar-suggestion-name">
                    {match.companyName}
                  </span>
                  <span className="topbar-suggestion-meta">
                    #{match.leadNumber}
                    {match.owner ? ` · ${match.owner}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      <div className="topbar-actions">
        <button
          type="button"
          className="topbar-new-lead"
          onClick={() => navigate("/create-lead")}
        >
          <FontAwesomeIcon icon={faPlus} />
          <span>New Lead</span>
        </button>

        <button
          type="button"
          className={`topbar-icon-btn ${isChatActive ? "is-active" : ""}`}
          onClick={() => navigate("/chat")}
          title={
            unreadTotal > 0
              ? `${unreadTotal} unread message${unreadTotal === 1 ? "" : "s"}`
              : "Messages"
          }
        >
          <FontAwesomeIcon icon={faBell} />
          {unreadTotal > 0 && (
            <span className="topbar-dot">{unreadTotal > 9 ? "9+" : unreadTotal}</span>
          )}
        </button>

        <button
          type="button"
          className="topbar-user"
          onClick={() => navigate("/profile")}
          title="My profile and password"
        >
          <span className="topbar-avatar">{userInitial}</span>
          <span className="topbar-user-text">
            <strong>{loggedInUser}</strong>
            <small>{roleShortLabel(userRole)}</small>
          </span>
        </button>

        <button type="button" className="topbar-logout" onClick={handleLogout}>
          <FontAwesomeIcon icon={faRightFromBracket} />
          <span>Logout</span>
        </button>
      </div>

    </header>
  );
}

export default Header;
