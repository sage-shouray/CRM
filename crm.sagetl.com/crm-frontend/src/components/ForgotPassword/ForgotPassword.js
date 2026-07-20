import React, { useState } from "react";
import { ToastContainer } from "react-toastify";
import { handleError, handleSuccess } from "../../utils";
import "./ForgotPassword.css";
import logo from "../Login/logo.png";
import map from "../Login/map.png";

function ForgotPassword() {
  const [email, setEmail] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:4100';
      const response = await fetch(
        `${API_BASE_URL}/auth/forgot-password`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ email }),
        }
      );
      const data = await response.json();
      if (data.success) {
        handleSuccess("Password reset link sent to your email");
      } else {
        handleError(data.message);
      }
    } catch (error) {
      handleError("An error occurred. Please try again.");
    }
  };

  return (
    <div className="forgot-password-page">
      <header className="header" />
      <main className="main-content">
        <div className="forgot-password-container">
          <div className="image-box">
            <img src={logo} alt="Company Logo" className="logo" />
            <img src={map} alt="Map" className="map" />
          </div>
          <div className="box-1">
            <h1>Forgot Password</h1>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label htmlFor="email">Email</label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                />
              </div>
              <div className="form-group">
                <button type="submit" className="btn-submit">
                  Get Password 
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

export default ForgotPassword;
