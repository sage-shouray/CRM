import React, { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { handleError, handleSuccess } from "../../utils";
import "./ResetPassword.css";
import logo from "../Login/logo.png";
import map from "../Login/map.png";

function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const { token } = useParams(); // Extract token if available
  const navigate = useNavigate();

const handleSubmit = async (e) => {
  e.preventDefault();

  if (password !== confirmPassword) {
    return handleError("Passwords do not match");
  }

  setIsLoading(true);

  try {
    const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';
    const url = token
      ? `${API_BASE_URL}/auth/reset-password`
      : `${API_BASE_URL}/auth/change-password`; // Use new route for logged-in users

    const userId = localStorage.getItem("userId"); // Get the logged-in user's ID from local storage

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        token
          ? { token, password }
          : { userId, newPassword: password }
      ), // Conditionally include userId
    });

    const data = await response.json();

    if (data.success) {
      handleSuccess("Password reset successfully");
      setTimeout(() => navigate("/login"), 2000);
    } else {
      handleError(data.message);
    }
  } catch (error) {
    handleError("An error occurred. Please try again.");
  } finally {
    setIsLoading(false);
  }
};


  return (
    <div className="reset-password-page">
      <header className="header" />
      <main className="main-content">
        <div className="reset-password-container">
          <div className="image-box">
            <img src={logo} alt="Company Logo" className="logo" />
            <img src={map} alt="Map" className="map" />
          </div>
          <div className="box-2">
            <h1>Reset Password</h1>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="password">New Password</label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="confirmPassword">Confirm Password</label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm new password"
                  required
                />
              </div>
              <div className="form-group">
                <button
                  type="submit"
                  className="btn-submit"
                  disabled={isLoading || password !== confirmPassword}
                >
                  {isLoading ? "Resetting..." : "Reset Password"}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
      <footer className="footer">
        <p>Copyright &copy; Sage Technologies. All rights reserved.</p>
      </footer>

      <ToastContainer />
    </div>
  );
}

export default ResetPassword;
