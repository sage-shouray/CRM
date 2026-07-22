import React from "react";
import { useNavigate } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faChevronDown, 
  faPlus, 
  faList, 
  faChartPie, 
  faUserSlash, 
  faUsers, 
  faTasks, 
  faUser, 
  faKey, 
  faUserGear,
  faLayerGroup,
  faFolderOpen
} from "@fortawesome/free-solid-svg-icons";

// Mapping dropdown items to paths
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

// Mapping items to icons
const itemIcons = {
  "Create Leads": faPlus,
  "Leads List": faList,
  BI: faChartPie,
  "Unassigned Leads": faUserSlash,
  Overview: faUsers,
  "To-do List": faTasks,
  "User Management": faUserGear,
  "Change Password": faKey,
  Profile: faUser,
  "My Profile": faUser,
  "Multiple Assign": faLayerGroup,
};

// Mapping top category names to icons
const categoryIcons = {
  Lead: faFolderOpen,
  Leads: faFolderOpen,
  "Lead Details": faList,
  Team: faUsers,
  "To-do": faTasks,
  Users: faUserGear,
  Account: faUser,
};

function Dropdown({ name, items, isOpen, toggleDropdown }) {
  const navigate = useNavigate();

  const handleClick = (item) => {
    const path = pathsByItem[item] || "/";
    navigate(path);
    toggleDropdown(null);
  };

  const catIcon = categoryIcons[name] || faFolderOpen;

  return (
    <div className={`dropdown ${isOpen ? "open" : ""}`}>
      <button onClick={toggleDropdown} className="dropdown-trigger-btn">
        <FontAwesomeIcon icon={catIcon} className="nav-cat-icon" />
        <span>{name}</span>
        <FontAwesomeIcon icon={faChevronDown} className="dropdown-arrow" />
      </button>
      {isOpen && (
        <ul className="dropdown-menu">
          {items.map((item, index) => {
            const icon = itemIcons[item];
            return (
              <li key={index} onClick={() => handleClick(item)} className="dropdown-item">
                {icon && <FontAwesomeIcon icon={icon} className="dropdown-item-icon" />}
                <span>{item}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default Dropdown;
