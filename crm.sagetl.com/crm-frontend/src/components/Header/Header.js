import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import axios from "axios";
import { io } from "socket.io-client";
import { ROLES, normalizeRole, roleShortLabel, canManageUsers } from "../../roles";
import { handleSuccess } from "../../utils";
import { ToastContainer, toast } from "react-toastify";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faHouse,
  faRightFromBracket,
  faFileExcel,
  faComments,
  faChevronDown
} from "@fortawesome/free-solid-svg-icons";
import Dropdown from "./Dropdown";
import "./Header.css";
import logo from "./logo.png";

import { API_BASE_URL } from "../../config";

const headerButtonsByRole = {
  // Super Admin and Admin get the same menu; what differs is how much data the
  // server returns behind it (Admin is scoped to its own branch).
  [ROLES.SUPER_ADMIN]: [
    {
      name: "Leads",
      items: ["Company Info", "Companies", "Multiple Assign", "Unassigned Leads"],
    },
    { name: "To-do", items: ["To-do List"] },
    { name: "Team", items: ["Overview"] },
    { name: "Users", items: ["User Management"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
  [ROLES.ADMIN]: [
    {
      name: "Leads",
      items: ["Company Info", "Companies", "Multiple Assign", "Unassigned Leads"],
    },
    { name: "To-do", items: ["To-do List"] },
    { name: "Team", items: ["Overview"] },
    { name: "Users", items: ["User Management"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
  [ROLES.BDM]: [
    { name: "Lead", items: ["Create Leads"] },
    {
      name: "Lead Details",
      items: ["Company Info", "Companies", "Multiple Assign", "Unassigned Leads", "BI"],
    },
    { name: "Team", items: ["Overview"] },
    { name: "To-do", items: ["To-do List"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
  [ROLES.BUSINESS_LEAD]: [
    { name: "Lead", items: ["Create Leads", "Company Info", "Companies"] },
    { name: "To-do", items: ["To-do List"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
};

function Header() {
  const [loggedInUser, setLoggedInUser] = useState("");
  const [userRole, setUserRole] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  const isHomeActive = currentPath === "/home" || currentPath === "/";
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

  const isDropdownActive = (button) => {
    const pathsByItem = {
      "Create Leads": "/create-lead",
      "Company Info": "/leads",
      Companies: "/companies",
      BI: "/bi",
      "Unassigned Leads": "/unassigned-leads",
      Overview: "/team-overview",
      "To-do List": "/todo",
      "User Management": "/user-management",
      "Change Password": "/profile",
      Profile: "/profile",
      "My Profile": "/profile",
      "Multiple Assign": "/multiple-assign",
    };
    return button.items.some(item => {
      const path = pathsByItem[item];
      if (!path) return false;
      return currentPath.startsWith(path);
    });
  };

  useEffect(() => {
    setLoggedInUser(sessionStorage.getItem("loggedInUser") || "User");
    setUserRole(normalizeRole(sessionStorage.getItem("userRole")) || ROLES.BUSINESS_LEAD);
  }, []);

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

  const handleDocumentClick = (event) => {
    if (!event.target.closest(".dropdown")) {
      setOpenDropdown(null);
    }
  };

  useEffect(() => {
    document.addEventListener("click", handleDocumentClick);
    return () => {
      document.removeEventListener("click", handleDocumentClick);
    };
  }, []);

  const toggleDropdown = (index) => {
    setOpenDropdown(openDropdown === index ? null : index);
  };

  const downloadFile = async (type) => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/download/${type}`,
        {
          responseType: "blob",
          headers: { Authorization: `Bearer ${sessionStorage.getItem("token")}` },
        }
      );

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `${type}.xlsx`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Error downloading file:", error);
    }
  };

  const headerButtons = headerButtonsByRole[userRole] || [];
  const roleHeaderClass =
    {
      [ROLES.SUPER_ADMIN]: "superadmin-header",
      [ROLES.ADMIN]: "admin-header",
      [ROLES.BDM]: "bdm-header",
      [ROLES.BUSINESS_LEAD]: "businesslead-header",
    }[userRole] || "";
  const userInitial = (loggedInUser.charAt(0) || "U").toUpperCase();

  return (
    <div className="main-container">
      <div className="brand-logo-area" onClick={() => navigate("/home")} title="Return to Dashboard">
        <img src={logo} alt="Sage CRM Logo" className="top-image" />
        <span className="brand-badge">CRM PORTAL</span>
      </div>

      <div
        className={`main-header ${roleHeaderClass}`}
      >
        <div className="header-buttons">
          <button
            onClick={() => navigate("/home")}
            className={`btn-home-shortcut ${isHomeActive ? "active" : ""}`}
            title="Dashboard Home"
          >
            <FontAwesomeIcon icon={faHouse} />
            <span>Home</span>
          </button>

          <button
            onClick={() => navigate("/chat")}
            className={`btn-home-shortcut chat-nav-btn ${isChatActive ? "active" : ""} ${unreadTotal > 0 ? "has-unread" : ""}`}
            title="In-App Chat & Messages"
          >
            <FontAwesomeIcon icon={faComments} />
            <span>Chat</span>
            {unreadTotal > 0 && (
              <span className="nav-unread-badge">{unreadTotal > 99 ? "99+" : unreadTotal}</span>
            )}
          </button>

          {headerButtons.map((button, index) => (
            <Dropdown
              key={index}
              name={button.name}
              items={button.items}
              isOpen={openDropdown === index}
              toggleDropdown={() => toggleDropdown(index)}
              isActive={isDropdownActive(button)}
            />
          ))}

          {canManageUsers(userRole) && (
            <div className={`dropdown ${openDropdown === "downloads" ? "open" : ""}`}>
              <button
                onClick={() => toggleDropdown("downloads")}
                className="dropdown-trigger-btn"
                title="Export Data"
              >
                <FontAwesomeIcon icon={faFileExcel} className="nav-cat-icon" />
                <span>Downloads</span>
                <FontAwesomeIcon icon={faChevronDown} className="dropdown-arrow" />
              </button>
              {openDropdown === "downloads" && (
                <ul className="dropdown-menu">
                  <li
                    onClick={() => {
                      downloadFile("leads");
                      setOpenDropdown(null);
                    }}
                    className="dropdown-item"
                    title="Export all leads to Excel"
                  >
                    <FontAwesomeIcon icon={faFileExcel} className="dropdown-item-icon" />
                    <span>Leads XLSX</span>
                  </li>
                  <li
                    onClick={() => {
                      downloadFile("users");
                      setOpenDropdown(null);
                    }}
                    className="dropdown-item"
                    title="Export all users to Excel"
                  >
                    <FontAwesomeIcon icon={faFileExcel} className="dropdown-item-icon" />
                    <span>Users XLSX</span>
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="user-info">
          <div
            className="user-profile-trigger"
            onClick={() => navigate("/profile")}
            title="View Profile & Settings"
          >
            <div className="avatar-circle">
              <span>{userInitial}</span>
            </div>
            <div className="user-text-details">
              <span className="user-name">{loggedInUser}</span>
              <span className="user-role-label">{roleShortLabel(userRole).toUpperCase()}</span>
            </div>
          </div>

          <button onClick={handleLogout} className="logout-button" title="Sign out of CRM">
            <FontAwesomeIcon icon={faRightFromBracket} />
            <span>Logout</span>
          </button>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

export default Header;
