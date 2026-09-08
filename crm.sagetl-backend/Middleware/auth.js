const jwt = require("jsonwebtoken");
const User = require("../Models/User");
const { normalizeRole } = require("./roles");

// A token proves who signed in, not that the account is still allowed in.
// Deactivating a user has to take effect immediately rather than whenever the
// token happens to expire, so the account is re-checked on every request.
//
// The lookup is cached briefly: without it this adds a query to every call,
// and with it a deactivation still lands within seconds.
const STATUS_TTL_MS = 15 * 1000;
const statusCache = new Map();

const accountState = async (userId) => {
  const cached = statusCache.get(userId);
  if (cached?.until > Date.now()) return cached.value;

  const user = await User.findById(userId);
  const value = user
    ? { exists: true, status: user.status || "active", role: user.role }
    : { exists: false };

  statusCache.set(userId, { value, until: Date.now() + STATUS_TTL_MS });
  return value;
};

// Called after a user is edited or deleted so the change is not held up by the
// cache window.
const invalidateAccountState = (userId) => {
  statusCache.delete(Number(userId));
};

// Verifies the Bearer token, confirms the account is still active, and
// attaches the decoded user to req.user.
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Token missing" });

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
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

    try {
      const state = await accountState(Number(req.user.id));
      if (!state.exists) {
        return res.status(403).json({ error: "Account no longer exists" });
      }
      if (state.status === "inactive") {
        return res.status(403).json({ error: "Account is deactivated" });
      }
      // The role in the database wins over the one baked into the token, so a
      // demotion takes effect without waiting for the token to expire.
      if (state.role) req.user.role = normalizeRole(state.role);
    } catch (lookupError) {
      console.error("Account state check failed:", lookupError);
      return res.status(500).json({ error: "Could not verify account" });
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

module.exports = {
  authenticateToken,
  checkRole,
  checkUserStatus,
  invalidateAccountState,
};
