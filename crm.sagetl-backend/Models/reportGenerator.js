// Report generation.
//
// Two reports live here:
//   1. SAP Installed Base contracts expiring in the next three months, built
//      automatically on the 1st of every month.
//   2. Work done per user for a given month, built on demand.
//
// Both are stored as CSV in the `reports` table. CSV rather than PDF because
// this is tabular data people put into Excel, and it needs no new dependency.
// The download route serves whatever mime type the row carries, so nothing
// downstream had to change.
const cron = require("node-cron");
const { pool } = require("./db");

const MIME_CSV = "text/csv";

// --- CSV helpers -----------------------------------------------------------

const csvCell = (value) => {
  if (value === null || value === undefined) return "";
  const s = String(value);
  // Quote anything that would otherwise break the row, and double inner quotes.
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

const toCsv = (headers, rows) =>
  [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n");

// --- date helpers ----------------------------------------------------------

const iso = (d) => d.toISOString().slice(0, 10);

const addMonths = (date, n) => {
  const d = new Date(date.getTime());
  const day = d.getDate();
  d.setMonth(d.getMonth() + n);
  // Clamp e.g. 31 Jan + 1 month to the last day of February rather than
  // letting it roll into March.
  if (d.getDate() < day) d.setDate(0);
  return d;
};

// contractExpiry used to be a year ("2027") and is now a full date
// ("2027-03-31"). Year-only values are treated as 31 December of that year,
// which is the latest the contract could run — it never invents an earlier
// expiry than the data supports.
const parseExpiry = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}$/.test(s)) return { date: new Date(`${s}-12-31`), exact: false };
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : { date: d, exact: true };
};

// --- report 1: SAP Installed Base renewals ---------------------------------

// Leads whose SAP contract expires between today and three months out.
async function collectExpiringContracts(referenceDate = new Date()) {
  const from = new Date(referenceDate.getTime());
  from.setHours(0, 0, 0, 0);
  const to = addMonths(from, 3);

  const result = await pool.query(
    `SELECT l.lead_number,
            l.company_info,
            l.it_landscape->'SAPInstalledBase' AS sap,
            u.first_name, u.last_name
       FROM leads l
       LEFT JOIN users u ON l.created_by = u.id
      WHERE l.it_landscape->'SAPInstalledBase'->>'contractExpiry' IS NOT NULL
        AND l.it_landscape->'SAPInstalledBase'->>'contractExpiry' <> ''`
  );

  return result.rows
    .map((row) => {
      const parsed = parseExpiry(row.sap?.contractExpiry);
      if (!parsed) return null;
      if (parsed.date < from || parsed.date > to) return null;

      const info = row.company_info || {};
      return {
        leadNumber: row.lead_number,
        companyName: info.companyName || "",
        expiry: iso(parsed.date),
        exact: parsed.exact,
        daysLeft: Math.round((parsed.date - from) / 86400000),
        supportPartner: row.sap?.supportPartner || "",
        noOfUsers: row.sap?.noOfUsers || "",
        city: info.city || "",
        state: info.state || "",
        phone: info.genericPhone1 || "",
        owner: [row.first_name, row.last_name].filter(Boolean).join(" "),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.expiry.localeCompare(b.expiry));
}

function expiringContractsCsv(rows, referenceDate) {
  const to = addMonths(referenceDate, 3);
  const headers = [
    "Lead Number",
    "Company",
    "Contract Expiry",
    "Expiry Precision",
    "Days Left",
    "Support Partner",
    "No. of Users",
    "City",
    "State",
    "Phone",
    "Lead Owner",
  ];
  const body = rows.map((r) => [
    r.leadNumber,
    r.companyName,
    r.expiry,
    r.exact ? "exact" : "year only (assumed 31 Dec)",
    r.daysLeft,
    r.supportPartner,
    r.noOfUsers,
    r.city,
    r.state,
    r.phone,
    r.owner,
  ]);

  const preamble = [
    [`SAP Installed Base — contracts expiring within 3 months`],
    [`Window`, `${iso(referenceDate)} to ${iso(to)}`],
    [`Generated`, new Date().toISOString()],
    [`Contracts`, rows.length],
    [],
  ];

  return (
    preamble.map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n" +
    toCsv(headers, body)
  );
}

// Build the renewals report and store it. generatedBy may be null for the
// scheduled run — nobody triggered it.
async function generateExpiringContractsReport({
  generatedBy = null,
  referenceDate = new Date(),
} = {}) {
  const rows = await collectExpiringContracts(referenceDate);
  const csv = expiringContractsCsv(rows, referenceDate);
  const buffer = Buffer.from(csv, "utf8");
  const fileName = `sap-contract-renewals-${iso(referenceDate).slice(0, 7)}.csv`;

  const inserted = await pool.query(
    `INSERT INTO reports (file_name, report_type, mime_type, size_bytes, content, generated_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, file_name, created_at`,
    [
      fileName,
      "sap-contract-renewals",
      MIME_CSV,
      buffer.length,
      buffer,
      generatedBy,
    ]
  );

  return { ...inserted.rows[0], rowCount: rows.length };
}

// --- report 2: work done per user, by month --------------------------------

// Start (inclusive) and end (exclusive) of a YYYY-MM month.
const monthBounds = (month) => {
  const [y, m] = String(month).split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
};

// One row per user: what they did inside the month.
async function collectMonthlyWork(month, scopeIds) {
  const bounds = monthBounds(month);
  if (!bounds) return null;

  const scoped = scopeIds !== null;
  if (scoped && scopeIds.length === 0) return [];

  const startIso = bounds.start.toISOString();
  const endIso = bounds.end.toISOString();

  const params = [startIso, endIso];
  const idList = scoped
    ? `(${scopeIds.map((_, i) => `$${i + 3}`).join(", ")})`
    : null;
  if (scoped) params.push(...scopeIds);

  const users = await pool.query(
    `SELECT id, first_name, last_name, role, designation
       FROM users
       ${scoped ? `WHERE id IN (${scopeIds.map((_, i) => `$${i + 1}`).join(", ")})` : ""}
      ORDER BY first_name, last_name`,
    scoped ? scopeIds : []
  );

  const createdRows = await pool.query(
    `SELECT created_by AS user_id, COUNT(*)::int AS n
       FROM leads
      WHERE created_at >= $1 AND created_at < $2
        AND created_by IS NOT NULL
        ${scoped ? `AND created_by IN ${idList}` : ""}
      GROUP BY created_by`,
    params
  );

  const actionRows = await pool.query(
    `SELECT (d->>'addedBy') AS user_id, COUNT(*)::int AS n
       FROM leads l, jsonb_array_elements(l.descriptions) d
      WHERE d->>'addedBy' IS NOT NULL
        AND d->>'createdAt' >= $1 AND d->>'createdAt' < $2
      GROUP BY d->>'addedBy'`,
    [startIso, endIso]
  );

  const taskRows = await pool.query(
    `SELECT user_id, status, COUNT(*)::int AS n
       FROM tasks
      WHERE created_at >= $1 AND created_at < $2
        AND user_id IS NOT NULL
        ${scoped ? `AND user_id IN ${idList}` : ""}
      GROUP BY user_id, status`,
    params
  );

  const map = (rows) => {
    const out = {};
    rows.forEach((r) => {
      const id = Number(r.user_id);
      if (!Number.isNaN(id)) out[id] = r.n;
    });
    return out;
  };

  const created = map(createdRows.rows);
  const actions = map(actionRows.rows);

  const tasks = {};
  taskRows.rows.forEach((r) => {
    const id = Number(r.user_id);
    if (Number.isNaN(id)) return;
    const t = (tasks[id] = tasks[id] || { total: 0, done: 0, open: 0 });
    t.total += r.n;
    if (r.status === "done") t.done += r.n;
    else t.open += r.n;
  });

  return users.rows.map((u) => {
    const t = tasks[u.id] || { total: 0, done: 0, open: 0 };
    return {
      name: [u.first_name, u.last_name].filter(Boolean).join(" "),
      role: u.role,
      designation: u.designation || "",
      leadsCreated: created[u.id] || 0,
      actionsLogged: actions[u.id] || 0,
      tasksCreated: t.total,
      tasksDone: t.done,
      tasksOpen: t.open,
    };
  });
}

function monthlyWorkCsv(month, rows) {
  const headers = [
    "User",
    "Role",
    "Designation",
    "Leads Created",
    "Actions Logged",
    "Tasks Created",
    "Tasks Completed",
    "Tasks Open",
  ];
  const body = rows.map((r) => [
    r.name,
    r.role,
    r.designation,
    r.leadsCreated,
    r.actionsLogged,
    r.tasksCreated,
    r.tasksDone,
    r.tasksOpen,
  ]);

  const preamble = [
    ["Work done per user"],
    ["Month", month],
    ["Generated", new Date().toISOString()],
    [],
  ];

  return (
    preamble.map((r) => r.map(csvCell).join(",")).join("\r\n") +
    "\r\n" +
    toCsv(headers, body)
  );
}

// --- schedule --------------------------------------------------------------

// 1st of every month at 06:00 server time.
function scheduleMonthlyReports() {
  cron.schedule("0 6 1 * *", async () => {
    try {
      const result = await generateExpiringContractsReport();
      console.log(
        `[reports] SAP renewals report generated: ${result.file_name} (${result.rowCount} contracts)`
      );
    } catch (err) {
      console.error("[reports] Monthly renewals report failed:", err);
    }
  });
  console.log("[reports] Monthly SAP renewals report scheduled (1st, 06:00).");
}

module.exports = {
  MIME_CSV,
  parseExpiry,
  collectExpiringContracts,
  generateExpiringContractsReport,
  collectMonthlyWork,
  monthlyWorkCsv,
  scheduleMonthlyReports,
};
