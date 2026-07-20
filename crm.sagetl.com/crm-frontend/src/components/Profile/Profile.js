import React, { useEffect, useState } from "react";
import { ToastContainer } from "react-toastify";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faUser, 
  faEnvelope, 
  faPhone, 
  faUserShield, 
  faBriefcase, 
  faKey, 
  faLock, 
  faEye, 
  faEyeSlash, 
  faCheckCircle, 
  faIdCard, 
  faCalendarAlt, 
  faBuilding, 
  faSpinner,
  faShieldAlt,
  faLayerGroup,
  faTasks,
  faFileDownload,
  faUsers
} from "@fortawesome/free-solid-svg-icons";
import { handleError, handleSuccess } from "../../utils";
import "./Profile.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

function Profile() {
  const [profileData, setProfileData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Password change state
  const [passwordState, setPasswordState] = useState({
    currentPassword: "",
    newPassword: "",
    confirmPassword: "",
  });
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  const userId = localStorage.getItem("userId");
  const storedRole = localStorage.getItem("userRole");

  useEffect(() => {
    fetchUserProfile();
  }, [userId]);

  const fetchUserProfile = async () => {
    setIsLoading(true);
    try {
      if (!userId) {
        handleError("User session not found. Please log in again.");
        setIsLoading(false);
        return;
      }
      const response = await fetch(`${API_BASE_URL}/auth/profile/${userId}`);
      const data = await response.json();
      if (data.success) {
        setProfileData(data.user);
      } else {
        // Fallback to local storage values if fetch returns error
        setProfileData({
          id: userId,
          firstName: localStorage.getItem("loggedInUser") || "User",
          lastName: "",
          email: "Logged in via portal",
          role: storedRole || "subuser",
          designation: storedRole ? storedRole.toUpperCase() : "Member",
          mobile: "N/A",
          status: "active"
        });
      }
    } catch (err) {
      console.error("Error fetching profile:", err);
      setProfileData({
        id: userId,
        firstName: localStorage.getItem("loggedInUser") || "User",
        lastName: "",
        email: "Logged in via portal",
        role: storedRole || "subuser",
        designation: storedRole ? storedRole.toUpperCase() : "Member",
        mobile: "N/A",
        status: "active"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePasswordChange = (e) => {
    const { name, value } = e.target;
    setPasswordState((prev) => ({ ...prev, [name]: value }));
  };

  const submitPasswordChange = async (e) => {
    e.preventDefault();
    const { currentPassword, newPassword, confirmPassword } = passwordState;

    if (!newPassword || !confirmPassword) {
      return handleError("Please fill out all required password fields.");
    }
    if (newPassword !== confirmPassword) {
      return handleError("New password and confirm password do not match.");
    }
    if (newPassword.length < 6) {
      return handleError("New password must be at least 6 characters long.");
    }

    setIsUpdatingPassword(true);
    try {
      const response = await fetch(`${API_BASE_URL}/auth/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: userId,
          currentPassword: currentPassword,
          newPassword: newPassword,
        }),
      });

      const data = await response.json();
      if (data.success) {
        handleSuccess("Password updated successfully!");
        setPasswordState({
          currentPassword: "",
          newPassword: "",
          confirmPassword: "",
        });
      } else {
        handleError(data.message || "Failed to update password.");
      }
    } catch (err) {
      console.error("Password update error:", err);
      handleError("Server error while updating password.");
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const getRoleCapabilities = (role) => {
    const r = (role || "").toLowerCase();
    if (r === "admin") {
      return [
        {
          title: "User Management & Access Control",
          desc: "Provision users, grant supervisor roles, toggle user active/inactive statuses, and manage team credentials.",
          icon: faUsers
        },
        {
          title: "Global Lead Operations",
          desc: "View and edit all system leads, oversee unassigned leads queue, and override assignments.",
          icon: faLayerGroup
        },
        {
          title: "Enterprise Data Exports",
          desc: "Full permissions to export user logs, master lead databases, and system option lists to Excel format.",
          icon: faFileDownload
        },
        {
          title: "System-wide To-Do Tracking",
          desc: "Monitor company-wide follow-up tasks, supervisor workloads, and pending actions.",
          icon: faTasks
        }
      ];
    } else if (r === "supervisor") {
      return [
        {
          title: "Team Overview & Delegation",
          desc: "Track sub-user performance, review assigned leads per team member, and reallocate accounts.",
          icon: faUsers
        },
        {
          title: "Unassigned Leads Queue & Bulk Assign",
          desc: "Access incoming unassigned leads and distribute them across supervisors and team members.",
          icon: faLayerGroup
        },
        {
          title: "Business Intelligence Analytics",
          desc: "Access BI reports, conversion analytics, and team efficiency metrics.",
          icon: faShieldAlt
        },
        {
          title: "Lead Creation & Maintenance",
          desc: "Create new enterprise leads, add detailed descriptions, and log interaction history.",
          icon: faTasks
        }
      ];
    } else {
      return [
        {
          title: "Lead Creation & Data Entry",
          desc: "Create new lead profiles with complete company details, contact information, and IT landscape.",
          icon: faLayerGroup
        },
        {
          title: "Personal Leads List",
          desc: "Access assigned customer pipelines, update lead statuses, and add interaction activity logs.",
          icon: faUsers
        },
        {
          title: "To-Do List & Action Items",
          desc: "Manage personal daily task checklists, mark follow-ups complete, and track upcoming deadlines.",
          icon: faTasks
        },
        {
          title: "Account Security & Credentials",
          desc: "Update personal security password and manage portal session authentication.",
          icon: faKey
        }
      ];
    }
  };

  if (isLoading) {
    return (
      <div className="profile-loading-container">
        <FontAwesomeIcon icon={faSpinner} spin className="loading-spinner" />
        <p>Loading user profile...</p>
      </div>
    );
  }

  const role = profileData?.role || storedRole || "subuser";
  const fullName = `${profileData?.firstName || ''} ${profileData?.lastName || ''}`.trim() || localStorage.getItem("loggedInUser") || "User Profile";
  const initials = (profileData?.firstName?.[0] || '') + (profileData?.lastName?.[0] || profileData?.firstName?.[1] || '');

  return (
    <div className="profile-page-container">
      <div className="profile-page-header">
        <h1>User Profile & Account Settings</h1>
        <p>Manage your login details, post details, system capabilities, and update your password.</p>
      </div>

      <div className="profile-grid-layout">
        {/* Section 1: User Identity Summary Banner */}
        <div className="profile-banner-card">
          <div className="banner-user-info">
            <div className="user-avatar-circle">
              {initials ? initials.toUpperCase() : <FontAwesomeIcon icon={faUser} />}
            </div>
            <div className="user-details-title">
              <h2>{fullName}</h2>
              <p className="user-designation-text">
                <FontAwesomeIcon icon={faBriefcase} className="meta-icon" />
                {profileData?.designation || role.toUpperCase()}
              </p>
              <div className="badge-row">
                <span className={`role-badge badge-${role.toLowerCase()}`}>
                  <FontAwesomeIcon icon={faUserShield} /> {role.toUpperCase()}
                </span>
                <span className={`status-badge status-${(profileData?.status || 'active').toLowerCase()}`}>
                  <FontAwesomeIcon icon={faCheckCircle} /> {(profileData?.status || 'Active').toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 2: Account Details & Post Information Grid */}
        <div className="profile-section-card">
          <div className="section-card-header">
            <FontAwesomeIcon icon={faIdCard} className="section-icon" />
            <div>
              <h3>Account & Login Details</h3>
              <p>Your official credentials and organizational post information</p>
            </div>
          </div>

          <div className="info-fields-grid">
            <div className="info-field">
              <label>Full Name</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faUser} className="field-icon" />
                <span>{fullName}</span>
              </div>
            </div>

            <div className="info-field">
              <label>Email Address / Login ID</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faEnvelope} className="field-icon" />
                <span>{profileData?.email || "N/A"}</span>
              </div>
            </div>

            <div className="info-field">
              <label>Post / Role Level</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faUserShield} className="field-icon" />
                <span>{role.toUpperCase()}</span>
              </div>
            </div>

            <div className="info-field">
              <label>Designation</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faBriefcase} className="field-icon" />
                <span>{profileData?.designation || "N/A"}</span>
              </div>
            </div>

            <div className="info-field">
              <label>Mobile Contact</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faPhone} className="field-icon" />
                <span>{profileData?.mobile || "N/A"}</span>
              </div>
            </div>

            <div className="info-field">
              <label>Assigned Supervisor</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faBuilding} className="field-icon" />
                <span>
                  {profileData?.supervisor 
                    ? `${profileData.supervisor.name} (${profileData.supervisor.email})` 
                    : "No Supervisor Assigned"}
                </span>
              </div>
            </div>

            <div className="info-field">
              <label>Account ID</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faIdCard} className="field-icon" />
                <span>#{profileData?.id || userId || "N/A"}</span>
              </div>
            </div>

            <div className="info-field">
              <label>Member Since</label>
              <div className="field-value-box">
                <FontAwesomeIcon icon={faCalendarAlt} className="field-icon" />
                <span>
                  {profileData?.createdAt 
                    ? new Date(profileData.createdAt).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric"
                      })
                    : "Active Member"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 3: System Capabilities & Rights ("What all things you have") */}
        <div className="profile-section-card">
          <div className="section-card-header">
            <FontAwesomeIcon icon={faShieldAlt} className="section-icon" />
            <div>
              <h3>System Capabilities & Access Rights</h3>
              <p>Summary of privileges granted for your <strong>{role.toUpperCase()}</strong> account post</p>
            </div>
          </div>

          <div className="capabilities-grid">
            {getRoleCapabilities(role).map((cap, idx) => (
              <div key={idx} className="capability-card">
                <div className="cap-icon-box">
                  <FontAwesomeIcon icon={cap.icon} />
                </div>
                <div className="cap-content">
                  <h4>{cap.title}</h4>
                  <p>{cap.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 4: Password Change Provision (Located at the bottom) */}
        <div className="profile-section-card password-section-card">
          <div className="section-card-header">
            <FontAwesomeIcon icon={faKey} className="section-icon password-header-icon" />
            <div>
              <h3>Password Change Provision</h3>
              <p>Update your account security password below</p>
            </div>
          </div>

          <form onSubmit={submitPasswordChange} className="password-change-form">
            <div className="form-group-row">
              <div className="form-group">
                <label htmlFor="currentPassword">Current Password</label>
                <div className="input-with-icon">
                  <FontAwesomeIcon icon={faLock} className="input-icon" />
                  <input
                    type={showCurrentPassword ? "text" : "password"}
                    id="currentPassword"
                    name="currentPassword"
                    placeholder="Enter current password"
                    value={passwordState.currentPassword}
                    onChange={handlePasswordChange}
                    autoComplete="current-password"
                  />
                  <button
                    type="button"
                    className="toggle-password-btn"
                    onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                    tabIndex="-1"
                  >
                    <FontAwesomeIcon icon={showCurrentPassword ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="newPassword">New Password</label>
                <div className="input-with-icon">
                  <FontAwesomeIcon icon={faKey} className="input-icon" />
                  <input
                    type={showNewPassword ? "text" : "password"}
                    id="newPassword"
                    name="newPassword"
                    placeholder="Minimum 6 characters"
                    value={passwordState.newPassword}
                    onChange={handlePasswordChange}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="toggle-password-btn"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    tabIndex="-1"
                  >
                    <FontAwesomeIcon icon={showNewPassword ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm New Password</label>
                <div className="input-with-icon">
                  <FontAwesomeIcon icon={faCheckCircle} className="input-icon" />
                  <input
                    type={showConfirmPassword ? "text" : "password"}
                    id="confirmPassword"
                    name="confirmPassword"
                    placeholder="Re-enter new password"
                    value={passwordState.confirmPassword}
                    onChange={handlePasswordChange}
                    required
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    className="toggle-password-btn"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    tabIndex="-1"
                  >
                    <FontAwesomeIcon icon={showConfirmPassword ? faEyeSlash : faEye} />
                  </button>
                </div>
              </div>
            </div>

            <div className="password-form-actions">
              <button
                type="submit"
                className="btn-update-password"
                disabled={isUpdatingPassword}
              >
                {isUpdatingPassword ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin />
                    <span>Updating Password...</span>
                  </>
                ) : (
                  <>
                    <FontAwesomeIcon icon={faKey} />
                    <span>Update Password</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <ToastContainer />
    </div>
  );
}

export default Profile;
