import React, { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isAuthenticated as isAuthValid, getUserRole, clearSession } from "./authStorage";

function RefreshHandler({ setIsAuthenticated, setUserRole }) {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const publicPaths = ["/", "/login", "/forgot-password", "/reset-password"];
    const isPublicPath = publicPaths.some((path) =>
      location.pathname.startsWith(path)
    );

    if (isAuthValid()) {
      setIsAuthenticated(true);
      setUserRole(getUserRole());
    } else {
      // Ensure any stale/expired token is wiped, then bounce off protected pages.
      clearSession();
      setIsAuthenticated(false);
      setUserRole(null);

      if (!isPublicPath) {
        navigate("/login", { replace: true });
      }
    }
  }, [location.pathname, navigate, setIsAuthenticated, setUserRole]);

  return null;
}

export default RefreshHandler;
