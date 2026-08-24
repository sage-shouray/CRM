const express = require("express");
const ExcelJS = require("exceljs");
const router = express.Router();

const { authenticateToken, checkRole } = require("../Middleware/auth");
const { ROLES, isSuperAdmin } = require("../Middleware/roles");
const { pool, getDescendantUserIds } = require("../Models/db");

// How wide an activity bucket is. A person counts as having worked a 5-minute
// slice if they did anything at all inside it; summing the distinct slices
// gives "minutes with activity" rather than "minutes logged in", which is the
// whole point — a tab left open overnight scores zero.
const BUCKET_MINUTES = 5;

// Which users the caller may see reports for: everyone for an Admin, own
// branch of the reporting tree for a Manager.
async function reportScope(user) {
  if (isSuperAdmin(user?.role)) return null; // unrestricted
  const ids = await getDescendantUserIds(Number(user?.id));
  return ids.length ? ids : [Number(user?.id)];
}

// ---------------------------------------------------------------------------
// Presence heartbeat
// ---------------------------------------------------------------------------

// The client posts one of these every minute while the tab is open, marking
// itself "active" only when it saw real mouse/keyboard input recently. Samples
// are throttled server-side too, so a misbehaving client cannot flood the
// table.
router.post("/activity/heartbeat", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const state = ["active", "idle"].includes(req.body?.state)
      ? req.body.state
      : "active";
    const page = String(req.body?.page || "").slice(0, 160);

    const recent = await pool.query(
      `SELECT 1 FROM user_activity
        WHERE user_id = $1 AND at > NOW() - INTERVAL '30 seconds' LIMIT 1`,
      [userId]
    );
    if (recent.rowCount > 0) return res.json({ ok: true, throttled: true });

    await pool.query(
      `INSERT INTO user_activity (user_id, state, page) VALUES ($1, $2, $3)`,
      [userId, state, page || null]
    );
    res.json({ ok: true });
  } catch (error) {
    console.error("heartbeat failed:", error.message);
    res.status(500).json({ error: "Could not record activity" });
  }
});

// ---------------------------------------------------------------------------
// Daily worklog — "what did you do today"
// ---------------------------------------------------------------------------

// Today's entry for the signed-in user (null when not yet written).
router.get("/worklogs/today", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const r = await pool.query(
      `SELECT id, work_date::text AS work_date, body, hours, created_at, updated_at
         FROM daily_worklog WHERE user_id = $1 AND work_date = CURRENT_DATE`,
      [userId]
    );
    res.json(r.rows[0] || null);
  } catch (error) {
    console.error("worklog read failed:", error.message);
    res.status(500).json({ error: "Could not load today's work log" });
  }
});

// The signed-in user's own recent entries, newest first. Read-only history —
// no route edits anything but today.
router.get("/worklogs/mine", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const r = await pool.query(
      `SELECT id, work_date::text AS work_date, body, hours, updated_at
         FROM daily_worklog WHERE user_id = $1
        ORDER BY work_date DESC LIMIT 60`,
      [userId]
    );
    res.json(r.rows);
  } catch (error) {
    console.error("worklog history failed:", error.message);
    res.status(500).json({ error: "Could not load work log history" });
  }
});

// Create or replace TODAY's entry. Never any other day.
//
// The date comes from the database's CURRENT_DATE and never from the request,
// so a client cannot backdate an entry by sending its own date. The
// UNIQUE (user_id, work_date) constraint makes the upsert safe, and the WHERE
// on the update half means a row for an earlier day can never be rewritten.
router.post("/worklogs", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const body = String(req.body?.body || "").trim();
    if (!body) {
      return res.status(400).json({ error: "Describe what you worked on." });
    }
    if (body.length > 5000) {
      return res
        .status(400)
        .json({ error: "Entry is too long (max 5000 characters)." });
    }

    let hours = req.body?.hours;
    hours =
      hours === "" || hours === undefined || hours === null ? null : Number(hours);
    if (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) {
      return res.status(400).json({ error: "Hours must be between 0 and 24." });
    }

    const r = await pool.query(
      `INSERT INTO daily_worklog (user_id, work_date, body, hours)
       VALUES ($1, CURRENT_DATE, $2, $3)
       ON CONFLICT (user_id, work_date)
       DO UPDATE SET body = EXCLUDED.body,
                     hours = EXCLUDED.hours,
                     updated_at = CURRENT_TIMESTAMP
         WHERE daily_worklog.work_date = CURRENT_DATE
       RETURNING id, work_date::text AS work_date, body, hours, created_at, updated_at`,
      [userId, body, hours]
    );

    if (r.rowCount === 0) {
      return res.status(403).json({ error: "Only today's entry can be changed." });
    }
    res.status(201).json(r.rows[0]);
  } catch (error) {
    console.error("worklog write failed:", error.message);
    res.status(500).json({ error: "Could not save today's work log" });
  }
});

// Refuse edits to a specific past entry explicitly, so an attempt gets a clear
// answer rather than a 404 from an unmatched route.
router.put("/worklogs/:id", authenticateToken, async (req, res) => {
  res.status(403).json({
    error:
      "Past entries cannot be changed. Only today's work log can be added or edited.",
  });
});

// ---------------------------------------------------------------------------
// Daily activity report
// ---------------------------------------------------------------------------

// One row per person per day: when they started and stopped, how many minutes
// showed real activity, what they produced, and their own account of the day.
async function dailyActivityRows({ from, to, scopeIds, userId }) {
  const params = [from, to];
  let userFilter = "";
  if (Array.isArray(scopeIds)) {
    params.push(scopeIds);
    userFilter += ` AND u.id = ANY($${params.length}::int[])`;
  }
  if (userId) {
    params.push(Number(userId));
    userFilter += ` AND u.id = $${params.length}`;
  }

  const sql = `
    WITH days AS (
      SELECT generate_series($1::date, $2::date, INTERVAL '1 day')::date AS day
    ),
    people AS (
      SELECT u.id, u.first_name || ' ' || u.last_name AS name, u.email,
             u.role, u.status
        FROM users u WHERE 1 = 1 ${userFilter}
    ),
    grid AS (
      SELECT p.id AS user_id, p.name, p.email, p.role, p.status, d.day
        FROM people p CROSS JOIN days d
    ),
    audit AS (
      SELECT user_id, created_at::date AS day,
             MIN(created_at)::time(0) AS first_action,
             MAX(created_at)::time(0) AS last_action,
             COUNT(*)::int AS actions,
             COUNT(DISTINCT FLOOR(EXTRACT(EPOCH FROM created_at) / (${BUCKET_MINUTES} * 60)))::int
               * ${BUCKET_MINUTES} AS active_minutes,
             COUNT(*) FILTER (WHERE action = 'Created lead')::int AS leads_created,
             COUNT(*) FILTER (WHERE action = 'Updated lead')::int AS leads_updated,
             COUNT(*) FILTER (WHERE action = 'Viewed lead')::int AS leads_viewed,
             COUNT(*) FILTER (WHERE action = 'Added note to lead')::int AS notes_added,
             COUNT(*) FILTER (WHERE action ILIKE '%task%')::int AS task_actions,
             COUNT(*) FILTER (WHERE action = 'Sent chat message')::int AS chat_messages,
             COUNT(*) FILTER (WHERE action = 'Signed in')::int AS sign_ins
        FROM audit_log
       WHERE user_id IS NOT NULL AND created_at::date BETWEEN $1 AND $2
       GROUP BY 1, 2
    ),
    presence AS (
      SELECT user_id, at::date AS day,
             COUNT(DISTINCT FLOOR(EXTRACT(EPOCH FROM at) / (${BUCKET_MINUTES} * 60)))
               FILTER (WHERE state = 'active')::int * ${BUCKET_MINUTES} AS present_minutes,
             MIN(at)::time(0) AS first_seen,
             MAX(at)::time(0) AS last_seen
        FROM user_activity
       WHERE at::date BETWEEN $1 AND $2
       GROUP BY 1, 2
    ),
    logs AS (
      SELECT user_id, work_date AS day, id, body, hours, updated_at
        FROM daily_worklog WHERE work_date BETWEEN $1 AND $2
    )
    SELECT g.day::text AS day, g.user_id, g.name, g.email, g.role, g.status,
           COALESCE(a.first_action, p.first_seen) AS first_action,
           COALESCE(a.last_action,  p.last_seen)  AS last_action,
           COALESCE(a.actions, 0)         AS actions,
           COALESCE(a.active_minutes, 0)  AS active_minutes,
           COALESCE(p.present_minutes, 0) AS present_minutes,
           COALESCE(a.leads_created, 0)   AS leads_created,
           COALESCE(a.leads_updated, 0)   AS leads_updated,
           COALESCE(a.leads_viewed, 0)    AS leads_viewed,
           COALESCE(a.notes_added, 0)     AS notes_added,
           COALESCE(a.task_actions, 0)    AS task_actions,
           COALESCE(a.chat_messages, 0)   AS chat_messages,
           COALESCE(a.sign_ins, 0)        AS sign_ins,
           l.body  AS worklog,
           l.hours AS worklog_hours,
           (l.id IS NOT NULL) AS worklog_submitted
      FROM grid g
      LEFT JOIN audit    a ON a.user_id = g.user_id AND a.day = g.day
      LEFT JOIN presence p ON p.user_id = g.user_id AND p.day = g.day
      LEFT JOIN logs     l ON l.user_id = g.user_id AND l.day = g.day
     WHERE g.status = 'active'
     ORDER BY g.day DESC, g.name ASC`;

  const r = await pool.query(sql, params);
  return r.rows;
}

function rangeFromQuery(q) {
  const today = new Date().toISOString().slice(0, 10);
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || "") ? q.from : today;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || "") ? q.to : from;
  return { from, to };
}

// "What did I do today" — every signed-in user, any role, own record only.
// Powers the Home screen widget. Deliberately not scoped by reportScope: a
// user is always allowed to see their own activity regardless of hierarchy.
router.get("/reports/my-activity", authenticateToken, async (req, res) => {
  try {
    const { from, to } = rangeFromQuery(req.query);
    const userId = Number(req.user?._id ?? req.user?.id);
    const rows = await dailyActivityRows({ from, to, userId });
    res.json(rows[0] || null);
  } catch (error) {
    console.error("my-activity report failed:", error);
    res.status(500).json({ error: "Could not load today's activity" });
  }
});

// JSON feed for the report screen. Managers see their own team; Admin sees all.
router.get(
  "/reports/daily-activity",
  authenticateToken,
  checkRole([ROLES.ADMIN, ROLES.MANAGER]),
  async (req, res) => {
    try {
      const { from, to } = rangeFromQuery(req.query);
      const scopeIds = await reportScope(req.user);
      const rows = await dailyActivityRows({
        from,
        to,
        scopeIds,
        userId: req.query.userId,
      });
      res.json({ from, to, rows });
    } catch (error) {
      console.error("daily activity report failed:", error);
      res.status(500).json({ error: "Could not build the activity report" });
    }
  }
);

// The same report as a spreadsheet. Admin only — it spans every employee.
router.get(
  "/reports/daily-activity.xlsx",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      const { from, to } = rangeFromQuery(req.query);
      const rows = await dailyActivityRows({ from, to, scopeIds: null });

      const wb = new ExcelJS.Workbook();
      wb.creator = "Sage CRM";
      wb.created = new Date();

      const ws = wb.addWorksheet("Daily Activity", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      ws.columns = [
        { header: "Date", key: "day", width: 12 },
        { header: "Employee", key: "name", width: 24 },
        { header: "Role", key: "role", width: 12 },
        { header: "First action", key: "first_action", width: 12 },
        { header: "Last action", key: "last_action", width: 12 },
        { header: "Active mins", key: "active_minutes", width: 12 },
        { header: "Present mins", key: "present_minutes", width: 13 },
        { header: "Actions", key: "actions", width: 9 },
        { header: "Leads created", key: "leads_created", width: 13 },
        { header: "Leads updated", key: "leads_updated", width: 13 },
        { header: "Leads viewed", key: "leads_viewed", width: 12 },
        { header: "Notes added", key: "notes_added", width: 12 },
        { header: "Task actions", key: "task_actions", width: 12 },
        { header: "Chat msgs", key: "chat_messages", width: 11 },
        { header: "Work log submitted", key: "submitted", width: 18 },
        { header: "Hours (self-reported)", key: "worklog_hours", width: 20 },
        { header: "What they did", key: "worklog", width: 80 },
      ];

      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: "FFFFFFFF" } };
      head.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF4F46E5" },
      };
      head.alignment = { vertical: "middle" };

      for (const r of rows) {
        const row = ws.addRow({
          day:
            r.day instanceof Date
              ? r.day.toISOString().slice(0, 10)
              : String(r.day).slice(0, 10),
          name: r.name,
          role: r.role,
          first_action: r.first_action || "",
          last_action: r.last_action || "",
          active_minutes: r.active_minutes,
          present_minutes: r.present_minutes,
          actions: r.actions,
          leads_created: r.leads_created,
          leads_updated: r.leads_updated,
          leads_viewed: r.leads_viewed,
          notes_added: r.notes_added,
          task_actions: r.task_actions,
          chat_messages: r.chat_messages,
          submitted: r.worklog_submitted ? "Yes" : "No",
          worklog_hours: r.worklog_hours === null ? "" : Number(r.worklog_hours),
          worklog: r.worklog || "",
        });
        row.getCell("worklog").alignment = { wrapText: true, vertical: "top" };
        // A day with no work log is what a manager is scanning for, so it is
        // marked rather than left to be spotted by eye.
        if (!r.worklog_submitted) {
          row.getCell("submitted").font = {
            color: { argb: "FFB91C1C" },
            bold: true,
          };
        }
      }

      ws.autoFilter = { from: "A1", to: "Q1" };

      const filename = `daily-activity_${from}_to_${to}.xlsx`;
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      await wb.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error("activity export failed:", error);
      res.status(500).json({ error: "Could not build the spreadsheet" });
    }
  }
);

module.exports = router;
