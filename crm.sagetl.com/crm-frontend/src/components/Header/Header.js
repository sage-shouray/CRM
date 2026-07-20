import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { handleSuccess } from "../../utils";
import { ToastContainer } from "react-toastify";
import Dropdown from "./Dropdown";
import "./Header.css";
import logo from "./logo.png";
import home from "./home.png";

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
    setLoggedInUser(localStorage.getItem("loggedInUser"));
    setUserRole(localStorage.getItem("userRole"));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("userId");
    localStorage.removeItem("userRole");

    handleSuccess("User Logged out");
    setTimeout(() => {
      navigate("/login", { replace: true });
      window.location.reload();
    }, 1000);
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

  return (
    <div className="main-container">
      <img src={logo} alt="Top " className="top-image" />

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
            <button onClick={() => downloadFile("leads")}>
              Download Leads
            </button>
            <button onClick={() => downloadFile("users")}>
              Download Users
            </button>
          </div>
        )}
        <div className="user-info">
          <span 
            className="user-name" 
            onClick={() => navigate("/profile")}
            style={{ cursor: "pointer" }}
            title="Click to view Profile & Change Password"
          >
            {loggedInUser}
          </span>

          <button onClick={handleLogout} className="logout-button">
            Logout
          </button>
          <button onClick={() => navigate("/home")} className="btn">
            <img src={home} className="interface" alt="Home" />
          </button>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

export default Header;
