import React, { useState, useEffect } from "react";
import { ROLES, ROLE_ORDER, ROLE_LABELS, roleLabel, normalizeRole } from "../../roles";
import axios from "axios";
import "./UserTable.css"; // Assuming same CSS file for styling

import { API_BASE_URL } from "../../config";

const EditUserModal = ({ userId, onClose, onSuccess }) => {
  const [userData, setUserData] = useState({
    firstName: "",
    lastName: "",
    designation: "",
    email: "",
    mobile: "",
    role: "",
    supervisor: "", // Add supervisor field to the state
    status: "",
  });

  const [supervisors, setSupervisors] = useState([]); // Fetch supervisors
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Load the account being edited. There used to be two copies of this effect
  // racing each other, one of which read supervisor as an object — the form is
  // driven by whichever landed last, so the "Reports To" value was unreliable.
  useEffect(() => {
    if (!userId) return;

    const fetchUserDetails = async () => {
      setLoading(true);
      try {
        const response = await axios.get(`${API_BASE_URL}/api/users/${userId}`);
        setUserData({
          ...response.data,
          // The API returns the supervisor's id; "" is the "No Manager" option.
          supervisor: response.data.supervisor ?? "",
        });
        setError(null);
      } catch (err) {
        console.error("Error fetching user details:", err);
        // Without this the form silently stayed on its blank initial state and
        // looked identical to the Create User form.
        setError(
          err.response?.data?.error ||
            "Could not load this user's details. Close and try again."
        );
      } finally {
        setLoading(false);
      }
    };

    fetchUserDetails();
  }, [userId]);

  // Fetch supervisors (users with roles 'supervisor' or 'admin')
  useEffect(() => {
    const fetchSupervisors = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/users/supervisors`
        );
        setSupervisors(response.data);
      } catch (error) {
        console.error("Error fetching supervisors:", error);
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

  const handleFormSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSaving(true);

    // Only the fields the server accepts. Sending the whole object back would
    // include _id/id/supervisorName, which the update schema rejects outright.
    const updatedUserData = {
      firstName: userData.firstName,
      lastName: userData.lastName,
      designation: userData.designation,
      email: userData.email,
      mobile: userData.mobile,
      role: userData.role,
      supervisor: userData.supervisor === "" ? null : Number(userData.supervisor),
      status: userData.status,
    };

    try {
      await axios.put(`${API_BASE_URL}/api/users/${userId}`, updatedUserData);
      if (onSuccess) {
        onSuccess(
          `${[updatedUserData.firstName, updatedUserData.lastName]
            .filter(Boolean)
            .join(" ")} was updated.`
        );
      }
      // Deactivating used to fire a PUT at /api/leads/reassign/:userId — a
      // relative URL to a route that has never existed, so it 404'd and the
      // catch below reported failure on an update that had already succeeded.
      // Leads belonging to deactivated users already surface on the Unassigned
      // Leads screen, which is where reassignment actually happens.
      onClose();
    } catch (err) {
      console.error("Error updating user:", err);
      const data = err.response?.data;
      setError(
        data?.errors?.join(" ") ||
          data?.error ||
          data?.message ||
          "Could not save these changes. Please try again."
      );
    } finally {
      setSaving(false);
    }
  };


  if (loading) {
    return <p className="user-form-loading">Loading user details…</p>;
  }

  return (
    <form className="user-form" onSubmit={handleFormSubmit}>
      {error && (
        <div className="user-form-error" role="alert">
          {error}
        </div>
      )}
      <div className="user-form-group">
        <label htmlFor="firstName">First Name</label>
        <input
          id="firstName"
          type="text"
          name="firstName"
          value={userData.firstName}
          onChange={handleInputChange}
          required
        />
        <label htmlFor="lastName">Last Name</label>
        <input
          id="lastName"
          type="text"
          name="lastName"
          value={userData.lastName}
          onChange={handleInputChange}
          required
        />
      </div>

      <div className="user-form-group">
        <label htmlFor="designation">Designation</label>
        <input
          id="designation"
          type="text"
          name="designation"
          value={userData.designation}
          onChange={handleInputChange}
          required
        />
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          name="email"
          value={userData.email}
          onChange={handleInputChange}
          required
        />
      </div>

      <div className="user-form-group">
        <label htmlFor="mobile">Mobile</label>
        <input
          id="mobile"
          type="text"
          name="mobile"
          value={userData.mobile}
          onChange={handleInputChange}
          required
        />
        <label htmlFor="role">Role</label>
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
      </div>

      {/* Add Supervisor Field */}
      <div className="user-form-group">
        <label htmlFor="supervisor">Reports To</label>
        <select
          id="supervisor"
          name="supervisor"
          value={userData.supervisor}
          onChange={handleInputChange}
        >
          <option value="">No Manager</option> {/* Null option */}
          {supervisors.map((supervisor) => (
            <option key={supervisor._id} value={supervisor._id}>
              {supervisor.firstName} {supervisor.lastName}
            </option>
          ))}
        </select>
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

      <div className="user-form-group full-width">
        <button className="edit-btn" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save Changes"}
        </button>
        <button className="close-btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
};

export default EditUserModal;
