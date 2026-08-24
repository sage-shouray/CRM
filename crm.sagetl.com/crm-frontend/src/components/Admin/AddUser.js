import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ROLES, ROLE_ORDER, ROLE_LABELS, normalizeRole } from "../../roles";
import axios from "axios";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faEye,
  faEyeSlash,
  faUserPlus,
  faCircleExclamation,
  faCircleCheck,
} from "@fortawesome/free-solid-svg-icons";
import "./UserTable.css";
import "./AddUser.css";

import { API_BASE_URL } from "../../config";

const EMPTY_USER = {
  firstName: "",
  lastName: "",
  designation: "",
  email: "",
  mobile: "",
  password: "",
  role: ROLES.EXECUTIVE,
  supervisor: "",
  status: "active",
};

// Rendered two ways: inside the Users table's modal (onClose supplied), and as
// a standalone page at /add-user, which a Manager reaches from the nav. The
// standalone case passes no callbacks at all, so every one of them has to be
// optional — calling an absent onClose() used to throw inside the try block,
// where the catch reported it as "could not add this user" even though the
// account had just been created.
const AddUser = ({ onClose, onSuccess }) => {
  const navigate = useNavigate();
  const isEmbedded = typeof onClose === "function";

  const [userData, setUserData] = useState(EMPTY_USER);
  const [supervisors, setSupervisors] = useState([]);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [saving, setSaving] = useState(false);

  // A Manager may only add Executives, onto its own team — so the role and
  // "reports to" choices are removed rather than shown and then rejected by
  // the server.
  const actorRole = normalizeRole(sessionStorage.getItem("userRole"));
  const isManager = actorRole === ROLES.MANAGER;

  useEffect(() => {
    const fetchSupervisors = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/users/supervisors`
        );
        setSupervisors(response.data);
      } catch (err) {
        console.error("Error fetching supervisors:", err);
      }
    };
    fetchSupervisors();
  }, []);

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setUserData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleCancel = () => {
    if (isEmbedded) {
      onClose();
    } else {
      navigate(-1);
    }
  };

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);

    const fullName = [userData.firstName, userData.lastName]
      .filter(Boolean)
      .join(" ");

    try {
      await axios.post(`${API_BASE_URL}/api/users`, userData);

      if (onSuccess) onSuccess(`${fullName} was added.`);

      if (isEmbedded) {
        // The table owns the confirmation message and the refresh.
        onClose();
      } else {
        // Standalone page: stay put, confirm in place, and clear the form so
        // several people can be added in a row.
        setSuccess(`${fullName} was added.`);
        setUserData(EMPTY_USER);
      }
    } catch (err) {
      console.error("Error adding user:", err);
      // The server explains exactly what it rejected — a duplicate email, a
      // password that misses the policy, a role a Manager may not create. That
      // was being thrown away and replaced with "Error adding user", which
      // left no way to tell those apart.
      const data = err.response?.data;
      setError(
        data?.errors?.join(" ") ||
          data?.error ||
          data?.message ||
          "Could not add this user. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="adduser-form" onSubmit={handleFormSubmit}>
      {!isEmbedded && (
        <header className="adduser-page-header">
          <span className="adduser-header-icon">
            <FontAwesomeIcon icon={faUserPlus} />
          </span>
          <div>
            <h1>{isManager ? "Add Executive" : "Add New User"}</h1>
            <p>
              {isManager
                ? "New Executives join your team and report to you."
                : "Create an account and set where it sits in the hierarchy."}
            </p>
          </div>
        </header>
      )}

      {error && (
        <div className="adduser-alert is-error" role="alert">
          <FontAwesomeIcon icon={faCircleExclamation} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="adduser-alert is-success" role="status">
          <FontAwesomeIcon icon={faCircleCheck} />
          <span>{success}</span>
        </div>
      )}

      <fieldset className="adduser-section" disabled={saving}>
        <legend>Personal details</legend>
        <div className="adduser-grid">
          <div className="adduser-field">
            <label htmlFor="firstName">First name</label>
            <input
              id="firstName"
              name="firstName"
              value={userData.firstName}
              onChange={handleInputChange}
              autoComplete="off"
              required
            />
          </div>
          <div className="adduser-field">
            <label htmlFor="lastName">Last name</label>
            <input
              id="lastName"
              name="lastName"
              value={userData.lastName}
              onChange={handleInputChange}
              autoComplete="off"
              required
            />
          </div>
          <div className="adduser-field">
            <label htmlFor="designation">Designation</label>
            <input
              id="designation"
              name="designation"
              value={userData.designation}
              onChange={handleInputChange}
              placeholder="e.g. Business Development Manager"
              required
            />
          </div>
          <div className="adduser-field">
            <label htmlFor="mobile">Mobile</label>
            <input
              id="mobile"
              name="mobile"
              value={userData.mobile}
              onChange={handleInputChange}
              placeholder="10-digit number"
              required
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="adduser-section" disabled={saving}>
        <legend>Sign-in credentials</legend>
        <div className="adduser-grid">
          <div className="adduser-field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              name="email"
              value={userData.email}
              onChange={handleInputChange}
              placeholder="name@sagetl.com"
              autoComplete="off"
              required
            />
          </div>
          <div className="adduser-field">
            <label htmlFor="password">Initial password</label>
            <div className="adduser-password-wrap">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                name="password"
                value={userData.password}
                onChange={handleInputChange}
                minLength={12}
                autoComplete="new-password"
                required
              />
              <button
                type="button"
                className="toggle-password-btn"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex="-1"
                title={showPassword ? "Hide password" : "Show password"}
              >
                <FontAwesomeIcon icon={showPassword ? faEyeSlash : faEye} />
              </button>
            </div>
          </div>
          <p className="adduser-hint adduser-field-full">
            At least 12 characters, including a letter and a number. Share this
            with the user along with their email — they sign in with it and can
            change it themselves under Account → Profile.
          </p>
        </div>
      </fieldset>

      <fieldset className="adduser-section" disabled={saving}>
        <legend>Role &amp; reporting</legend>
        <div className="adduser-grid">
          <div className="adduser-field">
            <label htmlFor="role">Role</label>
            {isManager ? (
              <>
                <input
                  id="role"
                  type="text"
                  value={ROLE_LABELS[ROLES.EXECUTIVE]}
                  readOnly
                  title="Managers can add Executives only"
                />
                <span className="adduser-hint">
                  Managers can add Executives only.
                </span>
              </>
            ) : (
              <select
                id="role"
                name="role"
                value={userData.role}
                onChange={handleInputChange}
              >
                {ROLE_ORDER.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="adduser-field">
            <label htmlFor="supervisor">Reports to</label>
            {isManager ? (
              <>
                <input id="supervisor" type="text" value="You" readOnly />
                <span className="adduser-hint">
                  New Executives are added to your own team.
                </span>
              </>
            ) : (
              <select
                id="supervisor"
                name="supervisor"
                value={userData.supervisor}
                onChange={handleInputChange}
              >
                <option value="">No manager</option>
                {supervisors.map((supervisor) => (
                  <option key={supervisor._id} value={supervisor._id}>
                    {supervisor.firstName} {supervisor.lastName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="adduser-field">
            <label htmlFor="status">Status</label>
            <select
              id="status"
              name="status"
              value={userData.status}
              onChange={handleInputChange}
            >
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
        </div>
      </fieldset>

      <div className="adduser-actions">
        <button type="button" className="adduser-btn-cancel" onClick={handleCancel}>
          Cancel
        </button>
        <button type="submit" className="adduser-btn-save" disabled={saving}>
          <FontAwesomeIcon icon={faUserPlus} />
          <span>{saving ? "Saving…" : "Save user"}</span>
        </button>
      </div>
    </form>
  );
};

export default AddUser;
