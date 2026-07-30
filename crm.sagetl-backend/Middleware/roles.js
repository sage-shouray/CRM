// Single source of truth for the role hierarchy.
//
// Four tiers, most privileged first. The position in ROLE_ORDER is the rank,
// so comparisons stay ordinal instead of being spelled out as string checks
// scattered across the routes.
const ROLES = {
  SUPER_ADMIN: "superadmin",
  ADMIN: "admin",
  BDM: "bdm",
  BUSINESS_LEAD: "businesslead",
};

const ROLE_ORDER = [
  ROLES.SUPER_ADMIN,
  ROLES.ADMIN,
  ROLES.BDM,
  ROLES.BUSINESS_LEAD,
];

const ALL_ROLES = [...ROLE_ORDER];

const ROLE_LABELS = {
  [ROLES.SUPER_ADMIN]: "Super Admin",
  [ROLES.ADMIN]: "Admin",
  [ROLES.BDM]: "Business Development Manager",
  [ROLES.BUSINESS_LEAD]: "Business Lead",
};

// Roles from the previous three-tier model that no longer exist.
//
// Deliberately does NOT include "admin". That value is still valid today but
// now means the second tier, so translating it at read time would silently
// promote every Admin to Super Admin. The one-time move of the old top tier to
// superadmin happens once in the database migration, never here.
const RETIRED_ROLES = {
  supervisor: ROLES.BDM,
  subuser: ROLES.BUSINESS_LEAD,
};

// Accepts a stored or token role and returns the current equivalent. Tokens
// issued before the migration outlive it (24h expiry), so a stale "subuser"
// has to keep working until the holder logs in again.
const normalizeRole = (role) => {
  const value = (role || "").toString().trim().toLowerCase();
  return RETIRED_ROLES[value] || value;
};

const rankOf = (role) => {
  const index = ROLE_ORDER.indexOf(normalizeRole(role));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

// True when `role` sits strictly above `otherRole` in the hierarchy.
const outranks = (role, otherRole) => rankOf(role) < rankOf(otherRole);

// Super Admin is the only tier with unrestricted visibility; everyone else is
// limited to their own branch of the reporting tree.
const isSuperAdmin = (role) => normalizeRole(role) === ROLES.SUPER_ADMIN;

// Tiers allowed to create and edit users. An Admin may manage the tiers below
// it but never a Super Admin — see the guards in the user routes.
const canManageUsers = (role) =>
  [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(normalizeRole(role));

module.exports = {
  ROLES,
  ROLE_ORDER,
  ALL_ROLES,
  ROLE_LABELS,
  RETIRED_ROLES,
  normalizeRole,
  rankOf,
  outranks,
  isSuperAdmin,
  canManageUsers,
};
