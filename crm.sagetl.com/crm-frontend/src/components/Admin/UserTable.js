import React, { useState, useEffect } from "react";
import axios from "axios";
import AddUser from "./AddUser";
import EditUserModal from "./EditUserModal";
import "./UserTable.css";

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

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
          <option value="admin">Admin</option>
          <option value="supervisor">Supervisor</option>
          <option value="subuser">Subuser</option>
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
            onClose={() => {
              closeAddModal();
              refreshUsers();
            }}
          />
        </UserModalOverlay>
      )}

      <div >
        <table >
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
                <td>{user.role}</td>
                <td>{user.status}</td>
                <td>
                  <button
                    className="edit-btn"
                    onClick={() => handleEditUser(user._id)}
                  >
                    Edit
                  </button>
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