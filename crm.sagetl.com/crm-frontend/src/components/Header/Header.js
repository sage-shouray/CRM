import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { handleSuccess } from "../../utils";
import { ToastContainer } from "react-toastify";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faHouse, 
  faRightFromBracket, 
  faFileExcel,
  faComments
} from "@fortawesome/free-solid-svg-icons";
import Dropdown from "./Dropdown";
import "./Header.css";
import logo from "./logo.png";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

const headerButtonsByRole = {
  supervisor: [
    { name: "Lead", items: ["Create Leads"] },
    {
      name: "Lead Details",
      items: ["Leads List", "Multiple Assign", "Unassigned Leads", "BI"],
    },
    { name: "Team", items: ["Overview"] },
    { name: "To-do", items: ["To-do List"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
  admin: [
    {
      name: "Leads",
      items: ["Leads List", "Unassigned Leads"],
    },
    { name: "To-do", items: ["To-do List"] },
    { name: "Team", items: ["Overview"] },
    { name: "Users", items: ["User Management"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
  subuser: [
    { name: "Lead", items: ["Create Leads", "Leads List"] },
    { name: "To-do", items: ["To-do List"] },
    { name: "Account", items: ["My Profile", "Change Password"] },
  ],
};

function Header() {
  const [loggedInUser, setLoggedInUser] = useState("");
  const [userRole, setUserRole] = useState("");
  const [openDropdown, setOpenDropdown] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    setLoggedInUser(localStorage.getItem("loggedInUser") || "User");
    setUserRole(localStorage.getItem("userRole") || "subuser");
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("userId");
    localStorage.removeItem("userRole");

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
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` },
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
  const userInitial = (loggedInUser.charAt(0) || "U").toUpperCase();

  return (
    <div className="main-container">
      <div className="brand-logo-area" onClick={() => navigate("/home")} title="Return to Dashboard">
        <img src={logo} alt="Sage CRM Logo" className="top-image" />
        <span className="brand-badge">CRM PORTAL</span>
      </div>

      <div
        className={`main-header ${
          userRole === "subuser"
            ? "subuser-header"
            : userRole === "admin"
            ? "admin-header"
            : userRole === "supervisor"
            ? "supervisor-header"
            : ""
        }`}
      >
        <div className="header-buttons">
          <button 
            onClick={() => navigate("/home")} 
            className="btn-home-shortcut"
            title="Dashboard Home"
          >
            <FontAwesomeIcon icon={faHouse} />
            <span>Home</span>
          </button>

          <button 
            onClick={() => navigate("/chat")} 
            className="btn-home-shortcut btn-chat-shortcut"
            title="In-App Chat & Messages"
          >
            <FontAwesomeIcon icon={faComments} />
            <span>Chat</span>
          </button>

          {headerButtons.map((button, index) => (
            <Dropdown
              key={index}
              name={button.name}
              items={button.items}
              isOpen={openDropdown === index}
              toggleDropdown={() => toggleDropdown(index)}
            />
          ))}
        </div>

        {userRole === "admin" && (
          <div className="admin-download-buttons">
            <button onClick={() => downloadFile("leads")} title="Export all leads to Excel">
              <FontAwesomeIcon icon={faFileExcel} className="excel-icon" />
              <span>Leads XLSX</span>
            </button>
            <button onClick={() => downloadFile("users")} title="Export all users to Excel">
              <FontAwesomeIcon icon={faFileExcel} className="excel-icon" />
              <span>Users XLSX</span>
            </button>
          </div>
        )}

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
              <span className="user-role-label">{userRole.toUpperCase()}</span>
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
