import { Navigate, Route, Routes } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import useHeartbeat from "./useHeartbeat";
import "./App.css";
import { useState } from "react";
import Login from "./components/Login/Login";
import Home from "./components/Home/Home";
import RefreshHandler from "./RefreshHandler";
import ForgotPassword from "./components/ForgotPassword/ForgotPassword";
import ResetPassword from "./components/ForgotPassword/ResetPassword";
import LayoutWithHeader from "./components/Layouts/LayoutWithHeader";
import LayoutWithoutHeader from "./components/Layouts/LayoutWithoutHeader";
import CreateLeads from "./components/CreateLeads/CreateLeads";
import Display from "./components/Leads/Display";
import Companies from "./components/Companies/Companies";
import ReportsPage from "./components/Reports/ReportsPage";
import AuditPage from "./components/Audit/AuditPage";
import PermissionsPage from "./components/Permissions/PermissionsPage";
import PipelinePage from "./components/Pipeline/PipelinePage";
import ColdLeadsPage from "./components/ColdLeads/ColdLeadsPage";
import MyColdLeadsPage from "./components/ColdLeads/MyColdLeadsPage";
import LeadDetails from "./components/Leads/LeadDetails";
import AdminDashboard from "./components/Admin/AdminDashboard";
import ToDo from './components/ToDo/ToDo';
import Profile from './components/Profile/Profile';

import AddUser from "./components/Admin/AddUser";
import UserTable from "./components/Admin/UserTable";
import ErrorBoundary from "./components/Admin/ErrorBoundary";
import TeamOverview from "./components/Team/TeamOverview";
import UserLeads from "./components/Team/UserLeads";
import UnassignedLeads from "./components/Supervisor/UnassignedLeads";
import MultipleAssign from "./components/Supervisor/MultipleAssign";
import Chat from "./components/Chat/Chat";
import DailyLog from "./components/DailyLog/DailyLog";
import EmailExport from "./components/EmailExport/EmailExport";
import BulkImport from "./components/BulkImport/BulkImport";
import { isAuthenticated as isAuthValid, getUserRole, clearSession } from "./authStorage";
import { ROLES, ALL_ROLES } from "./roles";

function App() {
  // Records presence (active vs idle) while the app is open.
  useHeartbeat();

  const [isAuthenticated, setIsAuthenticated] = useState(isAuthValid());
  const [userRole, setUserRole] = useState(getUserRole());

  // PrivateRoute validates the JWT synchronously at render time (presence +
  // expiry), so a missing/expired token can never flash protected content and
  // a direct URL like /home always redirects to /login when unauthenticated.
  function PrivateRoute({ element, allowedRoles }) {
    if (!isAuthValid()) {
      clearSession();
      return <Navigate to="/login" replace />;
    }

    const role = getUserRole();
    if (!allowedRoles.includes(role)) {
      return <Navigate to="/login" replace />;
    }

    return element;
  }

  return (
    <div className="App">
      <RefreshHandler
        setIsAuthenticated={setIsAuthenticated}
        setUserRole={setUserRole}
      />
      {/* Exactly one ToastContainer for the whole app. react-toastify keys its
          containers by containerId (default 1), so a second one mounted at the
          same time silently replaces the first in that registry — and any toast
          belonging to the displaced container then crashes on render with
          "Cannot set properties of undefined (setting 'toggle')". Header and
          Home each used to render their own, and both are mounted together in
          LayoutWithHeader. toast() is global, so every existing call still
          works with this single container. */}
      <ToastContainer />
      <Routes>
        <Route element={<LayoutWithoutHeader />}>
          <Route path="/" element={<Navigate to="/login" replace />} />
          <Route
            path="/login"
            element={
              <Login
                setIsAuthenticated={setIsAuthenticated}
                setUserRole={setUserRole}
              />
            }
          />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password/:token" element={<ResetPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
        </Route>
        <Route element={<LayoutWithHeader />}>
          <Route
            path="/home"
            element={
              <PrivateRoute
                element={<Home />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/create-lead"
            element={
              <PrivateRoute
                element={<CreateLeads />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/leads"
            element={
              <PrivateRoute
                element={<Display />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/pipeline"
            element={
              <PrivateRoute
                element={<PipelinePage />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/cold-leads"
            element={
              <PrivateRoute
                element={<ColdLeadsPage />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/my-cold-leads"
            element={
              <PrivateRoute
                element={<MyColdLeadsPage />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/permissions"
            element={
              <PrivateRoute
                element={<PermissionsPage />}
                allowedRoles={[ROLES.ADMIN]}
              />
            }
          />
          <Route
            path="/audit"
            element={
              <PrivateRoute
                element={<AuditPage />}
                allowedRoles={[ROLES.ADMIN]}
              />
            }
          />
          <Route
            path="/email-export"
            element={
              <PrivateRoute
                element={<EmailExport />}
                allowedRoles={[ROLES.ADMIN]}
              />
            }
          />
          <Route
            path="/bulk-import"
            element={
              <PrivateRoute
                element={<BulkImport />}
                allowedRoles={[ROLES.ADMIN]}
              />
            }
          />
          <Route
            path="/reports"
            element={
              <PrivateRoute
                element={<ReportsPage />}
                allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}
              />
            }
          />
          <Route
            path="/companies"
            element={
              <PrivateRoute
                element={<Companies />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/details"
            element={
              <PrivateRoute
                element={<LeadDetails />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/ToDo"
            element={
              <PrivateRoute
                element={<ToDo />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/todo"
            element={
              <PrivateRoute
                element={<ToDo />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/to-do"
            element={
              <PrivateRoute
                element={<ToDo />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/add-task"
            element={
              <PrivateRoute
                element={<ToDo />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/admin/dashboard"
            element={
              <PrivateRoute
                element={<AdminDashboard />}
                allowedRoles={[ROLES.ADMIN]}
              />
            }
          />
         

          <Route
            path="/add-user"
            element={
              <PrivateRoute
                element={<AddUser />}
                allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}
              />
            }
          />
          <Route
            path="/user-management"
            element={
              <PrivateRoute
                element={
                  <ErrorBoundary>
                    <UserTable />
                  </ErrorBoundary>
                }
                allowedRoles={[ROLES.ADMIN]}
              />
            }
          />
          <Route
            path="/team-overview"
            element={
              <PrivateRoute
                element={<TeamOverview />}
                allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}
              />
            }
          />
          <Route
            path="/leads/:userId"
            element={
              <PrivateRoute
                element={<UserLeads />}
                allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}
              />
            }
          />
          <Route
            path="/unassigned-leads"
            element={
              <PrivateRoute
                element={<UnassignedLeads />}
                allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}
              />
            }
          />
          <Route
            path="/multiple-assign"
            element={
              <PrivateRoute
                element={<MultipleAssign />}
                allowedRoles={[ROLES.ADMIN, ROLES.MANAGER]}
              />
            }
          /> 
          <Route
            path="/chat"
            element={
              <PrivateRoute
                element={<Chat />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/daily-log"
            element={
              <PrivateRoute
                element={<DailyLog />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
          <Route
            path="/profile"
            element={
              <PrivateRoute
                element={<Profile />}
                allowedRoles={ALL_ROLES}
              />
            }
          />
        </Route>
      </Routes>
    </div>
  );
}

export default App;
