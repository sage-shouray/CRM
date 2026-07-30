// Single source of truth for roles on the client.
// Must stay in step with crm.sagetl-backend/Middleware/roles.js.

export const ROLES = {
  SUPER_ADMIN: "superadmin",
  ADMIN: "admin",
  BDM: "bdm",
  BUSINESS_LEAD: "businesslead",
};

// Most privileged first.
export const ROLE_ORDER = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.BDM,
  ROLES.BUSINESS_LEAD,
];

export const ALL_ROLES = [...ROLE_ORDER];

export const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.ADMIN]: "Admin",
  [ROLES.BDM]: "Business Development Manager",
  [ROLES.BUSINESS_LEAD]: "Business Lead",
};

// Compact labels for tight spaces such as table cells and the header badge.
export const ROLE_SHORT_LABELS = {
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.ADMIN]: "Admin",
  [ROLES.BDM]: "BDM",
  [ROLES.BUSINESS_LEAD]: "Business Lead",
};

// Retired three-tier names. "admin" is intentionally absent — it is still a
// valid role today with a different meaning, so mapping it here would silently
// promote every Admin to Super Admin.
const RETIRED_ROLES = {
  supervisor: ROLES.BDM,
  subuser: ROLES.BUSINESS_LEAD,
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

export const isSuperAdmin = (role) => normalizeRole(role) === ROLES.SUPER_ADMIN;

// Tiers that can reach the user-management screens.
export const canManageUsers = (role) =>
  [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(normalizeRole(role));

// Tiers that manage other people's leads (team views, reassignment).
export const canManageTeam = (role) =>
  [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.BDM].includes(normalizeRole(role));
