import React from "react";
import { Outlet } from "react-router-dom";
import Header from "../Header/Header";
import Sidebar from "../Sidebar/Sidebar";
import SideNav from "../Nav/SideNav";
import { DashboardProvider } from "../../context/DashboardContext";

// Top bar spans the full width. Below it: the navigation rail on the left, the
// routed page in the middle, and the calendar / agenda rail on the right. The
// provider wraps all three so the rail and the page share one selected date and
// one set of events.
function LayoutWithHeader() {
  return (
    <DashboardProvider>
      <div className="app-layout">
        <Header />
        <div className="app-body">
          <SideNav />
          <main className="app-content">
            <Outlet />
          </main>
          <Sidebar />
        </div>
      </div>
    </DashboardProvider>
  );
}

export default LayoutWithHeader;
