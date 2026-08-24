// Single source of truth for roles on the client.
// Must stay in step with crm.sagetl-backend/Middleware/roles.js.

export const ROLES = {
  ADMIN: "admin",
  MANAGER: "manager",
  EXECUTIVE: "executive",
};

// Most privileged first.
export const ROLE_ORDER = [
  ROLES.ADMIN,
  ROLES.MANAGER,
  ROLES.EXECUTIVE,
];

export const ALL_ROLES = [...ROLE_ORDER];

export const ROLE_LABELS = {
  [ROLES.ADMIN]: "Admin",
  [ROLES.MANAGER]: "Manager",
  [ROLES.EXECUTIVE]: "Executive",
};

// Compact labels for tight spaces such as table cells and the header badge.
export const ROLE_SHORT_LABELS = {
  [ROLES.ADMIN]: "Admin",
  [ROLES.MANAGER]: "Manager",
  [ROLES.EXECUTIVE]: "Executive",
};

// Retired three-tier names. "admin" is intentionally absent — it is still a
// valid role today with a different meaning, so mapping it here would silently
// promote every Admin to Super Admin.
const RETIRED_ROLES = {
  superadmin: ROLES.ADMIN,
  supervisor: ROLES.MANAGER,
  bdm: ROLES.MANAGER,
  subuser: ROLES.EXECUTIVE,
  businesslead: ROLES.EXECUTIVE,
};

// A session stored before the change keeps working until the token expires.
export const normalizeRole = (role) => {
  const value = (role || "").toString().trim().toLowerCase();
  return RETIRED_ROLES[value] || value;
};

export const roleLabel = (role) =>
  ROLE_LABELS[normalizeRole(role)] || "Unknown";

export const roleShortLabel = (role) =>
  ROLE_SHORT_LABELS[normalizeRole(role)] || "Unknown";

export const rankOf = (role) => {
  const index = ROLE_ORDER.indexOf(normalizeRole(role));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export // The top tier sees everything; kept under the old name so the many call
// sites that ask "is this the unrestricted role?" keep reading naturally.
const isSuperAdmin = (role) => normalizeRole(role) === ROLES.ADMIN;

// Tiers that can reach the user-management screens.
export const canManageUsers = (role) =>
  [ROLES.ADMIN].includes(normalizeRole(role));

// Tiers that manage other people's leads (team views, reassignment).
export const canManageTeam = (role) =>
  [ROLES.ADMIN, ROLES.MANAGER].includes(normalizeRole(role));
