import axios from "axios";

// Attach the JWT to every outgoing request automatically, so all API calls
// are authenticated without each component having to set the header itself.
axios.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem("token");
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// If the token is missing/expired/invalid, send the user back to login.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const serverError = error?.response?.data?.error;
    const path = window.location.pathname;
    const onAuthPage =
      path.startsWith("/login") ||
      path.startsWith("/forgot-password") ||
      path.startsWith("/reset-password");
    // Only bounce to login for auth failures (missing/invalid/expired token),
    // NOT for legitimate permission denials (role Forbidden).
    const isAuthFailure = status === 401 || serverError === "Token invalid";
    if (isAuthFailure && !onAuthPage) {
      sessionStorage.removeItem("token");
      sessionStorage.removeItem("userRole");
      sessionStorage.removeItem("userId");
      window.location.assign("/login");
    }
    return Promise.reject(error);
  }
);

export default axios;
