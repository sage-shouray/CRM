// Shared origin allow-list logic — used by index.js (CORS itself) and
// AuthController.js (deciding where a password-reset link should point).
// Used to be two separate copies of the same regex; they'd already started
// drifting apart in their comments, which is exactly the kind of silent
// divergence duplicated security logic invites. One copy now.

// Allowed CORS origins: comma-separated CORS_ORIGINS env, or sensible dev
// defaults. A Set, not an array — checked on every single request, and
// .has() is the point of using one instead of Array#includes().
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
);

// Private-network addresses: 10.x, 172.16–31.x, 192.168.x, plus loopback.
//
// The machine's LAN address is handed out by DHCP and changes on its own — it
// moved from .192 to .196 without anyone touching a setting, which silently
// broke every device on the Wi-Fi because the old address was pinned in
// CORS_ORIGINS. Matching the private ranges by shape keeps LAN access working
// across those reassignments instead of failing until someone edits .env.
//
// Only private addresses qualify: a request from a public origin is still
// refused. Set ALLOW_LAN_ORIGINS=false to require the explicit list instead.
//
// Split into "pull the host out" + "check the host" instead of one large
// alternation of \d+ groups — the original regex flagged as having
// super-linear worst-case backtracking (a crafted long non-matching origin
// could hang the process); this form has no ambiguous repetition to
// backtrack over, and each octet is actually range-checked (0-255) instead
// of matched as an unbounded \d+.
const ORIGIN_HOST_RE = /^https?:\/\/([^:/]+)(?::\d+)?$/;
const isPrivateHost = (host) => {
  if (host === "localhost") return true;
  const octets = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!octets) return false;
  const [a, b] = octets.slice(1, 3).map(Number);
  if (![a, b, Number(octets[3]), Number(octets[4])].every((n) => n <= 255)) return false;
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
};
const isPrivateOrigin = (origin) => {
  const match = origin.match(ORIGIN_HOST_RE);
  return Boolean(match) && isPrivateHost(match[1]);
};

const allowLanOrigins = (process.env.ALLOW_LAN_ORIGINS || "true").trim() !== "false";

// Whether `origin` is allowed to receive anything origin-sensitive — used
// both to answer CORS preflights and to decide where a password-reset link
// may point.
const isTrustedOrigin = (origin) =>
  Boolean(origin) && (allowedOrigins.has(origin) || (allowLanOrigins && isPrivateOrigin(origin)));

module.exports = { allowedOrigins, isPrivateOrigin, allowLanOrigins, isTrustedOrigin };
