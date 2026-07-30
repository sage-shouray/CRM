// Central auth-session helper. Backed by sessionStorage so each browser window
// has its OWN independent session (logging in on one window does not log in
// another), and a freshly opened window has no session until the user logs in.

import { normalizeRole } from "./roles";

const KEYS = ["token", "userRole", "userId", "loggedInUser"];

export const getToken = () => sessionStorage.getItem("token");
// Normalised so a session stored under the old three-tier names keeps working
// until the token expires and the user logs in again.
export const getUserRole = () => normalizeRole(sessionStorage.getItem("userRole"));
export const getUserId = () => sessionStorage.getItem("userId");
export const getUserName = () => sessionStorage.getItem("loggedInUser");

export const clearSession = () => {
  KEYS.forEach((k) => sessionStorage.removeItem(k));
};

// Decode a JWT payload without a library. Returns null if malformed.
const decodeJwt = (token) => {
  try {
    const payload = token.split(".")[1];
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json);
  } catch {
    return null;
  }
};

// True only when a token exists AND has not expired. Expired/invalid tokens
// are cleared so the user is treated as logged out.
export const isAuthenticated = () => {
  const token = getToken();
  if (!token) return false;
  const payload = decodeJwt(token);
  if (!payload) {
    clearSession();
    return false;
  }
  if (payload.exp && Date.now() >= payload.exp * 1000) {
    clearSession();
    return false;
  }
  return true;
};
