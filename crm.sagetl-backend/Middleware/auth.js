const jwt = require("jsonwebtoken");
const User = require("../Models/User");
const { normalizeRole } = require("./roles");

// Verifies the Bearer token and attaches the decoded user to req.user.
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Token missing" });

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: "Token invalid" });
    }
    req.user = user;
    // Normalize id/_id so downstream code can use either.
    if (req.user) {
      if (req.user._id && !req.user.id) req.user.id = req.user._id;
      if (req.user.id && !req.user._id) req.user._id = req.user.id;
      // Tokens issued before the four-tier roles landed stay valid for 24h,
      // so a retired role name is translated rather than rejected.
      req.user.role = normalizeRole(req.user.role);
    }
    next();
  });
};

// Restricts a route to the given roles. Must run after authenticateToken.
const checkRole = (roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (roles.map(normalizeRole).includes(normalizeRole(req.user.role))) {
    return next();
  }
  return res.status(403).json({ error: "Forbidden" });
};

// Ensures the acting user is not deactivated.
const checkUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.status === "inactive") {
      return res.status(403).json({ message: "Access denied. User is inactive." });
    }
    next();
  } catch (error) {
    console.error("checkUserStatus error:", error);
    res.status(500).json({ message: "Error checking user status" });
  }
};

module.exports = { authenticateToken, checkRole, checkUserStatus };
