import React from "react";
import { useNavigate } from "react-router-dom";

// Define the mapping of dropdown items to paths
const pathsByItem = {
  "Create Leads": "/create-lead",
  "Leads List": "/leads",
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

function Dropdown({ name, items, isOpen, toggleDropdown }) {
  const navigate = useNavigate();

  const handleClick = (item) => {
    const path = pathsByItem[item] || "/";
    navigate(path); // Navigate to the corresponding path
    toggleDropdown(null); // Close dropdown after navigation
  };

  return (
    <div className={`dropdown ${isOpen ? "open" : ""}`}>
      <button onClick={toggleDropdown}>
        {name} <span className="dropdown-arrow">&#9662;</span>
      </button>
      {isOpen && (
        <ul className="dropdown-menu">
          {items.map((item, index) => (
            <li key={index} onClick={() => handleClick(item)}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Dropdown;
