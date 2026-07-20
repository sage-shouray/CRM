import React from "react";
import { useNavigate } from "react-router-dom";
import "./ContentSection.css";
import todo from "./to-do-list.png";
import create from "./create.png";
import leadsList from "./list.png";
import teamOverview from "./meeting.png";
import userManagement from "./user.png";
import unassignedLeads from "./unassigned.png";
import bi from "./bi.png";

const ContentSection = ({ userRole }) => {
  const navigate = useNavigate();

  const handleButtonClick = (path) => {
    navigate(path);
  };

  const renderAdminContent = () => (
    <>
      <div className="content-box leads-list">
        <img src={leadsList} alt="Leads List" className="icon" />
        <h2>Leads List</h2>
        <button onClick={() => handleButtonClick("/leads")}>View Leads</button>
      </div>
      <div className="content-box todo">
        <img src={todo} alt="To Do List" className="icon" />
        <h2>To Do List</h2>
        <button onClick={() => handleButtonClick("/todo")}>View To Do</button>
      </div>
      <div className="content-box team-overview">
        <img src={teamOverview} alt="Team Overview" className="icon" />
        <h2>Team Overview</h2>
        <button onClick={() => handleButtonClick("/team-overview")}>
          View Team
        </button>
      </div>
      <div className="content-box user-management">
        <img src={userManagement} alt="User Management" className="icon" />
        <h2>User Management</h2>
        <button onClick={() => handleButtonClick("/user-management")}>
          Manage Users
        </button>
      </div>
    </>
  );

  const renderSupervisorContent = () => (
    <>
      <div className="content-box create-lead">
        <img src={create} alt="Create Leads" className="icon" />
        <h2>Create Leads</h2>
        <button onClick={() => handleButtonClick("/create-lead")}>
          Create Lead
        </button>
      </div>
      <div className="content-box todo">
        <img src={todo} alt="To Do List" className="icon" />
        <h2>To Do</h2>
        <button onClick={() => handleButtonClick("/todo")}>View To Do</button>
      </div>
      <div className="content-box leads-list">
        <img src={leadsList} alt="Leads List" className="icon" />
        <h2>Leads List</h2>
        <button onClick={() => handleButtonClick("/leads")}>View Leads</button>
      </div>
      <div className="content-box unassigned-leads">
        <img src={unassignedLeads} alt="Unassigned Leads" className="icon" />
        <h2>Unassigned Leads</h2>
        <button onClick={() => handleButtonClick("/unassigned-leads")}>
          View Unassigned
        </button>
      </div>
      <div className="content-box bi">
        <img src={bi} alt="bi" className="icon" />
        <h2>BI</h2>
        <button onClick={() => handleButtonClick("/bi")}>
          View BI
        </button>
      </div>
      <div className="content-box team-overview">
        <img src={teamOverview} alt="Team Overview" className="icon" />
        <h2>Team Overview</h2>
        <button onClick={() => handleButtonClick("/team-overview")}>
          View Team
        </button>
      </div>
    </>
  );

  const renderSubuserContent = () => (
    <>
      <div className="content-box create-lead">
        <img src={create} alt="Create Leads" className="icon" />
        <h2>Create Leads</h2>
        <button onClick={() => handleButtonClick("/create-lead")}>
          Create Lead
        </button>
      </div>
      <div className="content-box todo">
        <img src={todo} alt="To Do List" className="icon" />
        <h2>To Do</h2>
        <button onClick={() => handleButtonClick("/todo")}>View To Do</button>
      </div>
      <div className="content-box leads-list">
        <img src={leadsList} alt="Leads List" className="icon" />
        <h2>Leads List</h2>
        <button onClick={() => handleButtonClick("/leads")}>View Leads</button>
      </div>
    </>
  );

  return (
    <div className="content-container">
      {userRole === "admin" && renderAdminContent()}
      {userRole === "supervisor" && renderSupervisorContent()}
      {userRole === "subuser" && renderSubuserContent()}
    </div>
  );
};

export default ContentSection;
