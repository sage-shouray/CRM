// Authorisation tests.
//
// These cover the logic that decides who may see and change what. A silent
// regression here leaks one customer's data to another user, and nothing in
// the UI would show it — which is exactly why it is the first thing tested.
//
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ROLES,
  ROLE_ORDER,
  normalizeRole,
  canManageUsers,
  canManageTeam,
  isSuperAdmin,
  rankOf,
  outranks,
} = require("../Middleware/roles");

const { parseExpiry } = require("../Models/reportGenerator");

// --- role helpers ----------------------------------------------------------

test("retired role names still resolve", () => {
  // Every name the product has ever used must land on one of the three tiers,
  // so a token issued before a rename keeps working until it expires.
  assert.equal(normalizeRole("superadmin"), ROLES.ADMIN);
  assert.equal(normalizeRole("supervisor"), ROLES.MANAGER);
  assert.equal(normalizeRole("bdm"), ROLES.MANAGER);
  assert.equal(normalizeRole("subuser"), ROLES.EXECUTIVE);
  assert.equal(normalizeRole("businesslead"), ROLES.EXECUTIVE);
  assert.equal(normalizeRole("admin"), ROLES.ADMIN);
  assert.equal(normalizeRole("ADMIN"), ROLES.ADMIN);
  assert.equal(normalizeRole(null), "");
});

test("there are exactly three tiers", () => {
  assert.deepEqual(ROLE_ORDER, [ROLES.ADMIN, ROLES.MANAGER, ROLES.EXECUTIVE]);
});

test("only Admin administers users", () => {
  assert.equal(canManageUsers(ROLES.ADMIN), true);
  assert.equal(canManageUsers(ROLES.MANAGER), false);
  assert.equal(canManageUsers(ROLES.EXECUTIVE), false);
  // A retired name must not sneak past the check.
  assert.equal(canManageUsers("subuser"), false);
  assert.equal(canManageUsers("superadmin"), true);
});

test("Executives cannot assign work downward", () => {
  assert.equal(canManageTeam(ROLES.ADMIN), true);
  assert.equal(canManageTeam(ROLES.MANAGER), true);
  assert.equal(canManageTeam(ROLES.EXECUTIVE), false);
});

test("Admin is the unrestricted tier", () => {
  assert.equal(isSuperAdmin(ROLES.ADMIN), true);
  assert.equal(isSuperAdmin(ROLES.MANAGER), false);
  assert.equal(isSuperAdmin(ROLES.EXECUTIVE), false);
  // The retired top-tier name still resolves to it.
  assert.equal(isSuperAdmin("superadmin"), true);
});

test("rank ordering is strict and unknown roles rank last", () => {
  assert.ok(rankOf(ROLES.ADMIN) < rankOf(ROLES.MANAGER));
  assert.ok(rankOf(ROLES.MANAGER) < rankOf(ROLES.EXECUTIVE));
  assert.ok(rankOf("nonsense") > rankOf(ROLES.EXECUTIVE));
  assert.equal(outranks(ROLES.ADMIN, ROLES.MANAGER), true);
  assert.equal(outranks(ROLES.MANAGER, ROLES.ADMIN), false);
  assert.equal(outranks(ROLES.ADMIN, ROLES.ADMIN), false);
});

// Mirror of the guard in DELETE /api/users/:userId. The route is already
// Admin-only, so the actor's own tier is not what decides this: a Super Admin
// account is undeletable full stop, including by another Super Admin.
const canDeleteAccount = (targetRole) => !isSuperAdmin(targetRole);

test("a Super Admin account can never be deleted", () => {
  assert.equal(canDeleteAccount(ROLES.ADMIN), false);
  // The retired name resolves to the same tier and must be refused too.
  assert.equal(canDeleteAccount("superadmin"), false);
  // Every lower tier stays deletable.
  assert.equal(canDeleteAccount(ROLES.MANAGER), true);
  assert.equal(canDeleteAccount(ROLES.EXECUTIVE), true);
});

// --- scope checks ----------------------------------------------------------
// Mirrors of the route guards, exercised without a database. visibleUserIds
// returns null for an Admin and a descendant list for everyone else.

const canAccessTask = (scopeIds, task) => {
  if (scopeIds === null) return true;
  const owner = Number(task?.userId);
  if (!Number.isFinite(owner)) return false;
  return scopeIds.includes(owner);
};

const canAccessUser = (scopeIds, selfId, targetId) => {
  if (Number(selfId) === Number(targetId)) return true;
  if (scopeIds === null) return true;
  return scopeIds.includes(Number(targetId));
};

test("a task id in the URL is not authorisation", () => {
  const myScope = [7, 8, 9];
  assert.equal(canAccessTask(myScope, { userId: 8 }), true);
  // Somebody else's task, reachable only by guessing the id.
  assert.equal(canAccessTask(myScope, { userId: 42 }), false);
  // A task with no owner must fail closed, not open.
  assert.equal(canAccessTask(myScope, { userId: null }), false);
  assert.equal(canAccessTask(myScope, {}), false);
  // Admin is unrestricted.
  assert.equal(canAccessTask(null, { userId: 42 }), true);
});

test("profiles are readable only by self or upward scope", () => {
  const scope = [7, 8];
  assert.equal(canAccessUser(scope, 7, 7), true, "own profile");
  assert.equal(canAccessUser(scope, 7, 8), true, "own report");
  assert.equal(canAccessUser(scope, 7, 99), false, "unrelated account");
  assert.equal(canAccessUser(null, 7, 99), true, "admin");
});

test("an empty scope grants nothing but self", () => {
  assert.equal(canAccessUser([], 5, 5), true);
  assert.equal(canAccessUser([], 5, 6), false);
  assert.equal(canAccessTask([], { userId: 5 }), false);
});

// --- report helpers --------------------------------------------------------

test("contract expiry accepts dates and legacy year-only values", () => {
  const exact = parseExpiry("2027-03-31");
  assert.equal(exact.exact, true);
  assert.equal(exact.date.getFullYear(), 2027);

  // A bare year is treated as 31 December — the latest the contract could run,
  // so the report never claims an earlier expiry than the data supports.
  const loose = parseExpiry("2027");
  assert.equal(loose.exact, false);
  assert.equal(loose.date.getMonth(), 11);
  assert.equal(loose.date.getDate(), 31);

  assert.equal(parseExpiry(""), null);
  assert.equal(parseExpiry(null), null);
  assert.equal(parseExpiry("not a date"), null);
});
