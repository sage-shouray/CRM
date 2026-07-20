import React, { useState, useEffect } from "react";
import axios from "axios";
import "./UserTable.css"; // Assuming same CSS file for styling

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';

const EditUserModal = ({ userId, onClose }) => {
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

  // Fetch user details for editing
 useEffect(() => {
   const fetchUserDetails = async () => {
     try {
       const response = await axios.get(
         `${API_BASE_URL}/api/users/${userId}`
       );
       // Ensure the supervisor is displayed correctly
       const { supervisor } = response.data;
       setUserData({
         ...response.data,
         supervisor: supervisor ? supervisor._id : "", // Set supervisor ID if present
       });
     } catch (error) {
       console.error("Error fetching user details:", error);
     }
   };

   if (userId) {
     fetchUserDetails();
   }
 }, [userId]);
 useEffect(() => {
    const fetchUserDetails = async () => {
      try {
        const response = await axios.get(
          `${API_BASE_URL}/api/users/${userId}`
        );
        // Ensure the supervisor is displayed correctly
        setUserData({
          ...response.data,
          supervisor: response.data.supervisor || "", // Set to empty string if null
        });
      } catch (error) {
        console.error("Error fetching user details:", error);
      }
    };

    if (userId) {
      fetchUserDetails();
    }
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

    const updatedUserData = {
      ...userData,
      supervisor: userData.supervisor === "" ? null : userData.supervisor,
    };

    try {
      // Update the user
      await axios.put(
        `${API_BASE_URL}/api/users/${userId}`,
        updatedUserData
      );
      alert("User updated successfully!");

      // If the user was deactivated, reassign their leads
      if (updatedUserData.status === "inactive") {
        await axios.put(`/api/leads/reassign/${userId}`);
      }

      onClose();
    } catch (error) {
      console.error("Error updating user:", error);
      alert("Error updating user");
    }
  };


  return (
    <form className="user-form" onSubmit={handleFormSubmit}>
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
          <option value="subuser">Subuser</option>
          <option value="supervisor">Supervisor</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {/* Add Supervisor Field */}
      <div className="user-form-group">
        <label htmlFor="supervisor">Supervisor</label>
        <select
          id="supervisor"
          name="supervisor"
          value={userData.supervisor}
          onChange={handleInputChange}
        >
          <option value="">No Supervisor</option> {/* Null option */}
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
        <button className="edit-btn" type="submit">
          Save Changes
        </button>
        <button className="close-btn" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
};

export default EditUserModal;
