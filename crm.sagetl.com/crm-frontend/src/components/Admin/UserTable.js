import React, { useState, useEffect } from "react";
import { ROLES, ROLE_ORDER, ROLE_LABELS, roleLabel, normalizeRole, isSuperAdmin } from "../../roles";
import axios from "axios";
import AddUser from "./AddUser";
import EditUserModal from "./EditUserModal";
import "./UserTable.css";
import { useLiveUpdates } from "../../liveUpdates";

import { API_BASE_URL } from "../../config";

const UserModalOverlay = ({ children, onClose }) => {
  return (
    <div className="user-modal-overlay" onClick={onClose}>
      <div className="user-modal" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

const UserTable = () => {
  const [users, setUsers] = useState([]);
  const [deletingId, setDeletingId] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [pendingDelete, setPendingDelete] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [filters, setFilters] = useState({
    name: "",
    supervisor: "",
    role: "",
    designation: "",
    status: "",
  });
  const [supervisors, setSupervisors] = useState([]); // To store supervisors for the dropdown

  // Someone else adding, editing or deleting a user updates this table live.
  useLiveUpdates(["users"], () => {
    fetchUsers();
    fetchSupervisors();
  });

  useEffect(() => {
    fetchUsers();
    fetchSupervisors();
  }, [filters]);

  const fetchUsers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/users`, {
        params: filters, // Send filters to the backend
      });
      setUsers(response.data);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  const fetchSupervisors = async () => {
    try {
      const response = await axios.get(
        `${API_BASE_URL}/api/users/supervisors`
      );
      setSupervisors(response.data); // Populate supervisors for the dropdown
    } catch (error) {
      console.error("Error fetching supervisors:", error);
    }
  };

  const handleFilterChange = (e) => {
    setFilters({
      ...filters,
      [e.target.name]: e.target.value,
    });
  };
  // Deleting an account is not reversible, so it still asks first and names
  // who — but in an in-app dialog rather than window.confirm(), which Chrome
  // draws at the top of the window in its own unstyleable chrome.
  const handleDeleteUser = (user) => {
    setError(null);
    setNotice(null);
    setPendingDelete(user);
  };

  const confirmDeleteUser = async () => {
    const user = pendingDelete;
    if (!user) return;
    setPendingDelete(null);

    try {
      setDeletingId(user._id);
      await axios.delete(`${API_BASE_URL}/api/users/${user._id}`);
      setUsers((prev) => prev.filter((u) => u._id !== user._id));
      setError(null);
      setNotice(
        `${[user.firstName, user.lastName].filter(Boolean).join(" ")} was deleted.`
      );
    } catch (err) {
      // The server refuses when the account still owns leads or has reports;
      // show its explanation rather than a generic failure.
      setError(
        err.response?.data?.error || "Could not delete this user."
      );
    } finally {
      setDeletingId(null);
    }
  };

  const handleEditUser = (userId) => {
    setSelectedUserId(userId);
    setShowEditModal(true);
  };

  const closeEditModal = () => {
    setShowEditModal(false);
    setSelectedUserId(null);
  };

  const closeAddModal = () => {
    setShowAddModal(false);
  };


  const refreshUsers = async () => {
    try {
      const response = await axios.get(`${API_BASE_URL}/api/users`);
      setUsers(response.data);
    } catch (error) {
      console.error("Error fetching users:", error);
    }
  };

  return (
    <div className="user-management-container">
      <div className="filters">
        <input
          type="text"
          name="name"
          placeholder="Search by name"
          value={filters.name}
          onChange={handleFilterChange}
        />

        <select
          name="supervisor"
          value={filters.supervisor}
          onChange={handleFilterChange}
        >
          <option value="">All Supervisors</option>
          {supervisors.map((supervisor) => (
            <option key={supervisor._id} value={supervisor._id}>
              {supervisor.firstName} {supervisor.lastName}
            </option>
          ))}
        </select>

        <select name="role" value={filters.role} onChange={handleFilterChange}>
          <option value="">All Roles</option>
          {ROLE_ORDER.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABELS[r]}
            </option>
          ))}
        </select>

        <input
          type="text"
          name="designation"
          placeholder="Search by designation"
          value={filters.designation}
          onChange={handleFilterChange}
        />

        <select
          name="status"
          value={filters.status}
          onChange={handleFilterChange}
        >
          <option value="">All Statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <button
          className="create-user-btn"
          onClick={() => setShowAddModal(true)}
        >
          Create New User
        </button>
      </div>

      {showAddModal && (
        <UserModalOverlay onClose={closeAddModal}>
          <h2 className="user-heading">Add New User</h2>
          <AddUser
            onSuccess={setNotice}
            onClose={() => {
              closeAddModal();
              refreshUsers();
            }}
          />
        </UserModalOverlay>
      )}

      {pendingDelete && (
        <UserModalOverlay onClose={() => setPendingDelete(null)}>
          <h2 className="user-heading">Delete this user?</h2>
          <p className="confirm-dialog-text">
            <strong>
              {[pendingDelete.firstName, pendingDelete.lastName]
                .filter(Boolean)
                .join(" ")}
            </strong>{" "}
            ({pendingDelete.email}) will be removed permanently.
          </p>
          <p className="confirm-dialog-text confirm-dialog-hint">
            This cannot be undone. If they simply need to lose access, set the
            account to inactive instead.
          </p>
          <div className="user-form-group full-width">
            <button
              type="button"
              className="close-btn"
              onClick={() => setPendingDelete(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="delete-btn"
              onClick={confirmDeleteUser}
            >
              Delete User
            </button>
          </div>
        </UserModalOverlay>
      )}

      <div >
        {error && <p className="user-table-error">{error}</p>}
        {notice && <p className="user-table-notice">{notice}</p>}

        <table className="user-table">
          <thead>
            <tr>
              <th>First Name</th>
              <th>Last Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user._id}>
                <td>{user.firstName}</td>
                <td>{user.lastName}</td>
                <td>{user.email}</td>
                <td>{roleLabel(user.role)}</td>
                <td>
                  <span
                    className={`status-cell ${
                      user.status === "active" ? "" : "is-inactive"
                    }`}
                  >
                    {user.status}
                  </span>
                </td>
                <td>
                  <button
                    className="edit-btn"
                    onClick={() => handleEditUser(user._id)}
                  >
                    Edit
                  </button>
                  {/* A Super Admin is undeletable — the server refuses it
                      outright, so the button is not offered rather than
                      failing on click. */}
                  {isSuperAdmin(user.role) ? (
                    <button
                      className="delete-btn"
                      disabled
                      title="A Super Admin account cannot be deleted"
                    >
                      Delete
                    </button>
                  ) : (
                    <button
                      className="delete-btn"
                      onClick={() => handleDeleteUser(user)}
                      disabled={deletingId === user._id}
                      title="Delete this account permanently"
                    >
                      {deletingId === user._id ? "…" : "Delete"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showEditModal && selectedUserId && (
        <UserModalOverlay onClose={closeEditModal}>
          <h2>Edit User</h2>
          <EditUserModal
            userId={selectedUserId}
            onSuccess={setNotice}
            onClose={() => {
              closeEditModal();
              refreshUsers();
            }}
          />
        </UserModalOverlay>
      )}
    </div>
  );
};

export default UserTable;