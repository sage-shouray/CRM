// Single source of truth for the backend API base URL.
//
// With no override, the API host is derived from whatever host the page was
// loaded from: open the app on localhost and it calls localhost, open it on
// the LAN IP from another device and it calls that same IP. Hardcoding one or
// the other always breaks the other case — a fixed "localhost" is unreachable
// for a visitor on the Wi-Fi, and a fixed LAN IP has to cross the firewall
// even when you are sitting at the machine itself.
//
// Set REACT_APP_API_URL in the frontend .env to point somewhere else entirely
// (a staging or production API). Requires a dev-server restart to take effect.
const API_PORT = process.env.REACT_APP_API_PORT || "4100";

const derivedBaseUrl = () => {
  if (typeof window === "undefined") return `http://localhost:${API_PORT}`;
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${API_PORT}`;
};

export const API_BASE_URL = process.env.REACT_APP_API_URL || derivedBaseUrl();

export default API_BASE_URL;
