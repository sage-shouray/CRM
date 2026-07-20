import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { 
  faEnvelope, 
  faLock, 
  faEye, 
  faEyeSlash, 
  faArrowRight, 
  faSpinner, 
  faChartPie, 
  faDatabase, 
  faUserShield 
} from "@fortawesome/free-solid-svg-icons";
import { handleError } from "../../utils";
import "./Login.css";
import logo from "./logo.png";
import map from "./map.png";

function Login({ setIsAuthenticated, setUserRole }) {
  const [loginInfo, setLoginInfo] = useState({
    email: "",
    password: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const navigate = useNavigate();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setLoginInfo((prevState) => ({
      ...prevState,
      [name]: value,
    }));
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const { email, password } = loginInfo;
    if (!email || !password) {
      return handleError("Email and password are required");
    }
    
    setIsLoading(true);
    try {
      const url = `${process.env.REACT_APP_API_URL || 'http://localhost:4100'}/auth/login`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(loginInfo),
      });
      const result = await response.json();

      const { success, message, jwtToken, firstName, userId, role } = result;
      if (success) {
        // Suppress success toast as requested by user
        localStorage.setItem("token", jwtToken);
        localStorage.setItem("loggedInUser", firstName);
        localStorage.setItem("userId", userId);
        localStorage.setItem("userRole", role);

        setIsAuthenticated(true);
        setUserRole(role);

        navigate("/home", { replace: true });
      } else {
        handleError(message || "Invalid email or password. Please try again.");
      }
    } catch (err) {
      handleError(err.message || "Unable to connect to the authentication server.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-page">
      <header className="top-branding-bar" />

      <main className="main-content">
        <div className="login-container">
          {/* Left Corporate Brand Panel */}
          <div className="image-box">
            <div className="brand-header">
              <img src={logo} alt="Sage Technologies Logo" className="logo" />
            </div>

            <div className="highlights-container">
              <div className="headline-group">
                <h2>Sage Technologies CRM</h2>
                <p className="highlights-sub">
                  Enterprise Lead Intelligence, Workflow Automation & Systems Integration Portal.
                </p>
              </div>

              <div className="feature-list">
                <div className="feature-item">
                  <FontAwesomeIcon icon={faChartPie} className="feature-icon" />
                  <div>
                    <h3>Lead & Pipeline Management</h3>
                    <p>Track leads, assign supervisors, and monitor conversion metrics in real-time.</p>
                  </div>
                </div>

                <div className="feature-item">
                  <FontAwesomeIcon icon={faDatabase} className="feature-icon" />
                  <div>
                    <h3>SAP ERP Data Synchronization</h3>
                    <p>Seamless integration with enterprise databases and business operations.</p>
                  </div>
                </div>

                <div className="feature-item">
                  <FontAwesomeIcon icon={faUserShield} className="feature-icon" />
                  <div>
                    <h3>Role-Based Access Hierarchy</h3>
                    <p>Granular access control for Administrators, Supervisors, and Team Members.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Realistic global network backdrop overlay */}
            <img src={map} alt="Global Network Map" className="map-backdrop" />
          </div>

          {/* Right Login Form Panel */}
          <div className="box">
            <div className="form-header">
              <h1>Sign in to your account</h1>
              <p className="form-subtitle">Enter your corporate credentials to access the CRM portal.</p>
            </div>

            <form onSubmit={handleLogin} className="login-form">
              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <div className="input-with-icon">
                  <FontAwesomeIcon icon={faEnvelope} className="input-icon" />
                  <input
                    onChange={handleChange}
                    type="email"
                    id="email"
                    name="email"
                    placeholder="name@company.com"
                    value={loginInfo.email}
                    required
                    autoComplete="email"
                  />
                </div>
              </div>

              <div className="form-group">
                <div className="label-row">
                  <label htmlFor="password">Password</label>
                  <a href="/forgot-password" className="forgot-password">
                    Forgot password?
                  </a>
                </div>
                <div className="input-with-icon">
                  <FontAwesomeIcon icon={faLock} className="input-icon" />
                  <input
                    onChange={handleChange}
                    type={showPassword ? "text" : "password"}
                    id="password"
                    name="password"
                    placeholder="Enter your password"
                    value={loginInfo.password}
                    required
                    autoComplete="current-password"
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

              <button type="submit" className="btn-login" disabled={isLoading}>
                {isLoading ? (
                  <>
                    <FontAwesomeIcon icon={faSpinner} spin className="btn-spinner" />
                    <span>Authenticating...</span>
                  </>
                ) : (
                  <>
                    <span>Sign In</span>
                    <FontAwesomeIcon icon={faArrowRight} className="btn-icon" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>
      </main>

      <footer className="footer">
        <p>Copyright &copy; {new Date().getFullYear()} Sage Technologies. All rights reserved.</p>
      </footer>

      <ToastContainer />
    </div>
  );
}

export default Login;


