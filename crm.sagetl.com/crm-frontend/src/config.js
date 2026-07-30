// Single source of truth for the backend API base URL.
// Set REACT_APP_API_URL in the frontend .env to override for other environments.
export const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:4100";

export default API_BASE_URL;
