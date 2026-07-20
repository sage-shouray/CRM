import React, { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function RefreshHandler({ setIsAuthenticated, setUserRole }) {
  const location = useLocation();
  const navigate = useNavigate();
  const hasNavigated = useRef(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userRole = localStorage.getItem("userRole");

    const publicPaths = ["/", "/login", "/forgot-password", "/reset-password"];
    const isPublicPath = publicPaths.some((path) =>
      location.pathname.startsWith(path)
    );

    if (token && userRole) {
      setIsAuthenticated(true);
      setUserRole(userRole);

      // Do not force a redirect to a specific path
    } else {
      setIsAuthenticated(false);
      setUserRole(null);

      // Only navigate to login if the user is on a protected path
      if (!isPublicPath && !hasNavigated.current) {
        hasNavigated.current = true;
        navigate("/login", { replace: true });
      }
    }
  }, [location.pathname, navigate, setIsAuthenticated, setUserRole]);

  return null;
}

export default RefreshHandler;
