import React from "react";
import HomeToDoWidget from "../Home/HomeToDoWidget";
import "./ToDo.css";

function ToDo() {
  return (
    <div className="todo-dedicated-page">
      <div className="todo-page-header">
        <div className="todo-page-title">
          <h1>Assigned Work & Daily Task Manager</h1>
          <p>Organize action items, manage task statuses (Done, Postponed, Not Done), and schedule upcoming work.</p>
        </div>
      </div>

      <div className="todo-page-content">
        <HomeToDoWidget />
      </div>
    </div>
  );
}

export default ToDo;