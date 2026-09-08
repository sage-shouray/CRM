// Audit trail: who did what, from which address.
//
// Deliberately records metadata only — actor, action, target, result, IP,
// browser — and never request bodies. Bodies here would mean writing
// passwords, reset tokens and personal data into a second table that is read
// by a wide audience, which is worse than the visibility it buys.
//
// Reads (GET) are not recorded. They would outnumber changes many times over
// and bury the actions that actually matter.
const { pool } = require("./db");

async function ensureAuditTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id SERIAL PRIMARY KEY,
      user_id INT REFERENCES users(id) ON DELETE SET NULL,
      user_label VARCHAR(255),
      action VARCHAR(120) NOT NULL,
      method VARCHAR(10) NOT NULL,
      path VARCHAR(500) NOT NULL,
      entity VARCHAR(60),
      entity_id VARCHAR(60),
      status_code INT,
      outcome VARCHAR(20),
      ip VARCHAR(64),
      user_agent VARCHAR(400),
      -- Field-level diff for record edits: [{field, from, to}]. Only set by
      -- routes that opt in via req.auditChanges, and only for business fields
      -- (never credentials).
      changes JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_log(created_at DESC);`
  );
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log(user_id);`
  );
  // Existing installs predate the diff column.
  await pool.query(
    `ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS changes JSONB;`
  );
}

// Behind a proxy the socket address is the proxy's. Prefer the first hop in
// X-Forwarded-For, which is the client as the edge saw it.
function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  const raw = req.ip || req.socket?.remoteAddress || "";
  // Normalise IPv4-mapped IPv6 (::ffff:10.0.0.1) down to the v4 form.
  return raw.replace(/^::ffff:/, "");
}

// Turn a method + path into something a human can scan, and pull out what was
// acted on. Falls back to "METHOD /path" for anything unrecognised, so a new
// route is still logged rather than silently skipped.
const ROUTES = [
  [/^\/auth\/login$/, "POST", "Signed in", "session"],
  [/^\/auth\/change-password$/, "POST", "Changed own password", "user"],
  [/^\/auth\/forgot-password$/, "POST", "Requested password reset", "user"],
  [/^\/auth\/reset-password$/, "POST", "Reset password with token", "user"],
  [/^\/api\/leads$/, "POST", "Created lead", "lead"],
  [/^\/api\/leads\/assign-bulk$/, "PUT", "Bulk-assigned leads", "lead"],
  [/^\/api\/leads\/([^/]+)\/descriptions$/, "POST", "Added note to lead", "lead"],
  [/^\/api\/leads\/([^/]+)$/, "PUT", "Updated lead", "lead"],
  [/^\/api\/leads\/([^/]+)$/, "DELETE", "Deleted lead", "lead"],
  [/^\/api\/tasks$/, "POST", "Created task", "task"],
  [/^\/api\/tasks\/([^/]+)$/, "PUT", "Updated task", "task"],
  [/^\/api\/tasks\/([^/]+)$/, "DELETE", "Deleted task", "task"],
  [/^\/api\/users$/, "POST", "Created user", "user"],
  [/^\/api\/users\/([^/]+)$/, "PUT", "Updated user", "user"],
  [/^\/api\/users\/([^/]+)$/, "DELETE", "Deleted user", "user"],
  [/^\/api\/reports\/sap-renewals\/generate$/, "POST", "Generated renewals report", "report"],
  [/^\/api\/chat\/.*$/, "POST", "Sent chat message", "chat"],
  [/^\/api\/options.*$/, "PUT", "Updated dropdown options", "options"],

  // Reads worth recording. Only the handful that represent real work — opening
  // a lead, searching, pulling a report. Logging every GET would bury the
  // useful entries and grow the table by thousands of rows a day, but logging
  // none of them made research time invisible: someone can spend an afternoon
  // reading and following up without writing anything.
  [/^\/api\/leads\/company-search$/, "GET", "Searched companies", "lead"],
  [/^\/api\/leads\/([^/]+)$/, "GET", "Viewed lead", "lead"],
  [/^\/api\/reports\/([^/]+)\/download$/, "GET", "Downloaded report", "report"],
  [/^\/api\/reports$/, "GET", "Opened reports", "report"],
  [/^\/api\/team-overview$/, "GET", "Viewed team overview", "user"],
  [/^\/api\/unassigned-leads$/, "GET", "Viewed unassigned leads", "lead"],
];

// GET paths that count as work. Anything not listed here is not audited, so
// the dashboard's background polling never reaches the table.
const AUDITED_READS = [
  /^\/api\/leads\/company-search$/,
  /^\/api\/leads\/[^/]+$/,
  /^\/api\/reports$/,
  /^\/api\/reports\/[^/]+\/download$/,
  /^\/api\/team-overview$/,
  /^\/api\/unassigned-leads$/,
];

function describe(method, path) {
  for (const [pattern, verb, label, entity] of ROUTES) {
    if (verb !== method) continue;
    const match = path.match(pattern);
    if (match) return { action: label, entity, entityId: match[1] || null };
  }
  return { action: `${method} ${path}`, entity: null, entityId: null };
}

async function record(entry) {
  try {
    await pool.query(
      `INSERT INTO audit_log
         (user_id, user_label, action, method, path, entity, entity_id,
          status_code, outcome, ip, user_agent, changes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        entry.userId ?? null,
        entry.userLabel ?? null,
        entry.action,
        entry.method,
        entry.path,
        entry.entity ?? null,
        entry.entityId ?? null,
        entry.statusCode ?? null,
        entry.outcome ?? null,
        entry.ip ?? null,
        (entry.userAgent || "").slice(0, 400) || null,
        entry.changes ? JSON.stringify(entry.changes) : null,
      ]
    );
  } catch (err) {
    // Auditing must never break the request it is describing.
    console.error("[audit] Could not write entry:", err.message);
  }
}

// Express middleware. Registered globally; it decides per request whether the
// call is worth recording and writes after the response is sent, so it adds
// nothing to response time.
function auditMiddleware(req, res, next) {
  const method = req.method.toUpperCase();
  const isMutation = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
  const path = req.originalUrl.split("?")[0];
  // A read only qualifies if it is one of the few that represents actual work.
  const isAuditedRead =
    method === "GET" && AUDITED_READS.some((re) => re.test(path));
  if (!isMutation && !isAuditedRead) return next();
  const ip = clientIp(req);
  const userAgent = req.headers["user-agent"] || "";
  // Captured before the handler runs; a login has no user yet, and a failed
  // login should still be attributable to the address that tried it.
  const attemptedEmail =
    path === "/auth/login" && req.body?.email ? String(req.body.email) : null;

  res.on("finish", () => {
    const { action, entity, entityId } = describe(method, path);
    const user = req.user || {};
    const userId = Number(user._id ?? user.id) || null;

    record({
      userId,
      userLabel:
        user.email || user.name || attemptedEmail || (userId ? `#${userId}` : "anonymous"),
      action:
        path === "/auth/login" && res.statusCode >= 400
          ? "Failed sign-in attempt"
          : action,
      method,
      path,
      entity,
      entityId,
      statusCode: res.statusCode,
      outcome: res.statusCode < 400 ? "success" : "failed",
      ip,
      userAgent,
      // Set by routes that compute a diff (see the lead update handler).
      changes: req.auditChanges || null,
    });
  });

  next();
}

// Paged query with optional filters, newest first.
async function queryAuditLog({
  userId = null,
  outcome = null,
  from = null,
  to = null,
  search = null,
  limit = 100,
  offset = 0,
} = {}) {
  const where = [];
  const params = [];

  if (userId) {
    params.push(Number(userId));
    where.push(`user_id = $${params.length}`);
  }
  if (outcome) {
    params.push(outcome);
    where.push(`outcome = $${params.length}`);
  }
  if (from) {
    params.push(from);
    where.push(`created_at >= $${params.length}`);
  }
  if (to) {
    // `to` is a date; include the whole day.
    params.push(`${to} 23:59:59`);
    where.push(`created_at <= $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    const i = params.length;
    where.push(`(action ILIKE $${i} OR user_label ILIKE $${i} OR ip ILIKE $${i})`);
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await pool.query(
    `SELECT COUNT(*)::int AS n FROM audit_log ${clause}`,
    params
  );

  params.push(Math.min(Number(limit) || 100, 500), Number(offset) || 0);

  const rows = await pool.query(
    `SELECT a.id, a.user_id, a.user_label, a.action, a.method, a.path,
            a.entity, a.entity_id, a.status_code, a.outcome, a.ip,
            a.user_agent, a.changes, a.created_at,
            u.first_name, u.last_name, u.role
       FROM audit_log a
       LEFT JOIN users u ON a.user_id = u.id
       ${clause}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    total: total.rows[0].n,
    entries: rows.rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      userName:
        [r.first_name, r.last_name].filter(Boolean).join(" ") ||
        r.user_label ||
        "Unknown",
      role: r.role,
      action: r.action,
      method: r.method,
      path: r.path,
      entity: r.entity,
      entityId: r.entity_id,
      statusCode: r.status_code,
      outcome: r.outcome,
      ip: r.ip,
      userAgent: r.user_agent,
      changes: r.changes || null,
      createdAt: r.created_at,
    })),
  };
}

module.exports = {
  ensureAuditTable,
  auditMiddleware,
  queryAuditLog,
  clientIp,
};
