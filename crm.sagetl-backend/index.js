const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("./Models/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const http = require("http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");


const Lead = require("./Models/createLeads");
const User = require("./Models/User");
const Task = require("./Models/Task");

const { authenticateToken, checkRole, checkUserStatus, invalidateAccountState } = require("./Middleware/auth");
const {
  ROLES,
  ALL_ROLES,
  normalizeRole,
  isSuperAdmin,
  canManageTeam,
} = require("./Middleware/roles");
const { getDescendantUserIds } = require("./Models/db");
const { validate, createUserSchema, updateUserSchema, taskSchema } = require("./Middleware/validation");
const AuthRouter = require("./Routes/AuthRouter");
const OptionsRouter = require("./Routes/OptionsRouter");
const WorkReportRoutes = require("./Routes/WorkReportRoutes");
const { scheduleNotifications } = require('./Models/emailNotification');
const transporter = require('./Models/emailService');
const {
  collectExpiringContracts,
  generateExpiringContractsReport,
  collectMonthlyWork,
  monthlyWorkCsv,
  scheduleMonthlyReports,
} = require('./Models/reportGenerator');
const {
  ensureAuditTable,
  auditMiddleware,
  queryAuditLog,
} = require('./Models/auditLog');


// Add this after your other app configurations
scheduleNotifications();
// Builds the SAP contract-renewals report on the 1st of every month.
scheduleMonthlyReports();
// The audit table is created on boot, alongside the rest of the schema.
ensureAuditTable().catch((err) =>
  console.error("Could not prepare audit_log table:", err)
);


require("dotenv").config();
require("./Models/db");

// Fail fast if the JWT secret is not configured, so tokens are never signed
// or verified with an insecure fallback value.
if (!process.env.JWT_SECRET) {
  console.error("FATAL: JWT_SECRET is not set. Refusing to start with an insecure default.");
  process.exit(1);
}

// Allowed CORS origins: comma-separated CORS_ORIGINS env, or sensible dev defaults.
const allowedOrigins = (process.env.CORS_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

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
const PRIVATE_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/;

const allowLanOrigins = (process.env.ALLOW_LAN_ORIGINS || "true").trim() !== "false";

const corsOrigin = (origin, callback) => {
  // Allow non-browser clients (no Origin header) and any whitelisted origin.
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
  if (allowLanOrigins && PRIVATE_ORIGIN.test(origin)) return callback(null, true);
  return callback(new Error(`Origin ${origin} not allowed by CORS`));
};

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// Track online users: Map(userId -> Set(socket.id))
const onlineUsers = new Map();

// Tell every connected client that a kind of record changed, so open screens
// update without the user reloading the tab.
//
// Deliberately carries no record data — only the resource name and a hint of
// what happened. Clients react by refetching through their own scoped
// endpoints, which means the reporting-tree visibility rules still decide who
// sees what. Pushing the record itself would hand every socket data its owner
// may not be allowed to read.
function broadcastChange(resource, action = "changed", meta = {}) {
  try {
    io.emit("data_changed", { resource, action, ...meta, at: Date.now() });
  } catch (err) {
    // A notification failing must never fail the request that caused it.
    console.error("broadcastChange failed:", err.message);
  }
}

io.on("connection", (socket) => {
  let currentUserId = null;

  socket.on("register", (userId) => {
    if (!userId) return;
    currentUserId = Number(userId);
    
    if (!onlineUsers.has(currentUserId)) {
      onlineUsers.set(currentUserId, new Set());
    }
    onlineUsers.get(currentUserId).add(socket.id);
    
    // Join a user-specific room
    socket.join(`user_${currentUserId}`);
    
    // Broadcast status change to everyone
    io.emit("user_status", { userId: currentUserId, status: "online" });
    
    // Send currently online users to client
    const onlineIds = Array.from(onlineUsers.keys());
    socket.emit("online_users_list", onlineIds);
  });

  socket.on("join_group", (groupId) => {
    socket.join(`group_${groupId}`);
  });

  socket.on("typing", (data) => {
    if (!currentUserId) return;
    if (data.type === "direct" && data.recipientId) {
      socket.to(`user_${data.recipientId}`).emit("user_typing", {
        senderId: currentUserId,
        isTyping: data.isTyping,
        type: "direct"
      });
    } else if (data.type === "group" && data.groupId) {
      socket.to(`group_${data.groupId}`).emit("user_typing", {
        senderId: currentUserId,
        isTyping: data.isTyping,
        groupId: data.groupId,
        type: "group"
      });
    }
  });

  socket.on("disconnect", () => {
    if (currentUserId && onlineUsers.has(currentUserId)) {
      const userSockets = onlineUsers.get(currentUserId);
      userSockets.delete(socket.id);
      if (userSockets.size === 0) {
        onlineUsers.delete(currentUserId);
        io.emit("user_status", { userId: currentUserId, status: "offline" });
      }
    }
  });
});


// Security headers
app.use(
  helmet({
    crossOriginResourcePolicy: false,
    // Tell browsers to only ever reach this origin over HTTPS. Only meaningful
    // once TLS terminates in front of the app, which is why it is disabled in
    // development.
    hsts:
      process.env.NODE_ENV === "production"
        ? { maxAge: 31536000, includeSubDomains: true, preload: true }
        : false,
  })
);

// Every token in the system rests on this key. A short one can be recovered
// offline from a single captured token, and whoever recovers it can mint a
// token for any account, including a Super Admin. Fatal in production; loud in
// development so nobody ships the weak value by accident.
const JWT_SECRET_MIN = 32;
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < JWT_SECRET_MIN) {
  const message =
    `JWT_SECRET is ${process.env.JWT_SECRET ? `only ${process.env.JWT_SECRET.length} characters` : "not set"}. ` +
    `It must be at least ${JWT_SECRET_MIN}. Generate one with:\n` +
    `  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`;

  if (process.env.NODE_ENV === "production") {
    console.error(`FATAL: ${message}`);
    process.exit(1);
  }
  console.warn(`\n*** SECURITY WARNING ***\n${message}\n`);
}

// CORS configuration
const corsOptions = {
  origin: corsOrigin,
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type,Authorization",
};
app.use(cors(corsOptions));

// Behind a reverse proxy (nginx, a load balancer, Render/Heroku) the socket
// address is the proxy's. Trusting one hop makes req.ip the real client, which
// the rate limiter buckets on and the audit log records.
app.set("trust proxy", 1);

// Body-parser configuration.
// 1MB is ample for JSON: the only large payloads are file uploads, and those
// go through multer on their own routes. A 50MB JSON limit let any caller tie
// up memory with a single request.
app.use(bodyParser.json({ limit: "1mb" }));
app.use(bodyParser.urlencoded({ limit: "1mb", extended: true }));

// File upload configuration
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
});

// Rate limiter for authentication endpoints (brute-force / abuse protection)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 30, // limit each IP to 30 auth requests per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many attempts. Please try again later." },
});

// A ceiling on ordinary API traffic. The auth limiter below is much tighter;
// this one only exists so a single client cannot flood the server.
app.use(
  "/api",
  rateLimit({
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please slow down." },
  })
);

// Audit trail. Registered after the body parsers (so a login's email is
// readable) and before every route, so nothing that changes data escapes it.
app.use(auditMiddleware);

// Route handlers
app.use("/auth", authLimiter, AuthRouter);
app.use("/api/options", OptionsRouter);
// Activity heartbeats, the daily work log, and the daily-activity report.
app.use("/api", WorkReportRoutes);

// authenticateToken, checkRole and checkUserStatus are imported from ./Middleware/auth

// The set of user ids whose records the caller may see.
//
// Returns null for Super Admin, meaning "no restriction". Everyone else is
// scoped to their own branch of the reporting tree, so the same helper covers
// all four tiers:
//   Super Admin    -> unrestricted
//   Admin          -> self + its BDMs + those BDMs' Business Leads
//   BDM            -> self + its Business Leads
//   Business Lead  -> self only
async function visibleUserIds(user) {
  // Admin is the top tier: unrestricted.
  if (isSuperAdmin(user?.role)) return null;

  const selfId = Number(user?.id);
  const ids = await getDescendantUserIds(selfId);

  // A Manager also sees any Executive an Admin has explicitly granted them,
  // on top of their own direct reports. Grants are additive — they can widen
  // a Manager's view, never narrow it below their own team.
  if (normalizeRole(user?.role) === ROLES.MANAGER) {
    const granted = await mongoose.pool.query(
      `SELECT executive_id FROM manager_access WHERE manager_id = $1`,
      [selfId]
    );
    granted.rows.forEach((r) => {
      const id = Number(r.executive_id);
      if (Number.isFinite(id) && !ids.includes(id)) ids.push(id);
    });
  }

  return ids;
}

// Leads are readable by every signed-in user: the company list is shared
// knowledge, and being able to see who is already working an account is what
// stops two people cold-calling it. Editing is what stays restricted — see
// userCanEditLead below.

// Whether a user may CHANGE a given lead.
//
// Allowed: an Admin (unrestricted), the person who created the lead, and any
// manager above that creator in the reporting tree. Everyone else may read the
// record but not alter it.
//
// visibleUserIds returns the caller's own branch of the tree — themselves plus
// everyone beneath them — so "is the creator inside my branch?" answers both
// the self case and the manager case at once.
async function userCanEditLead(user, lead) {
  const ids = await visibleUserIds(user);
  if (ids === null) return true; // Admin

  const creatorId = Number(lead.createdBy?._id ?? lead.createdBy);
  if (!Number.isFinite(creatorId)) return false;
  return ids.includes(creatorId);
}

// Let an assignee know work has landed on them: a live socket event for anyone
// with the app open, and an email as the durable fallback. Never throws — a
// notification failing must not fail the assignment.
// Task fields (title, description, associatedLead) and the assigner's own
// name are all set by a signed-in user and land verbatim in an HTML email —
// escape them so one can't plant a link or markup that reads as an official
// CRM notification to whoever receives it.
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));

async function notifyTaskAssigned(task, assigner) {
  const assignee = await User.findById(task.userId);
  if (!assignee) return;

  const from = [assigner?.firstName, assigner?.lastName].filter(Boolean).join(" ")
    || assigner?.email
    || "A colleague";

  io.to(`user_${Number(task.userId)}`).emit("task_assigned", {
    taskId: task.taskId,
    title: task.title,
    dueDate: task.dueDate,
    priority: task.priority,
    assignedByName: from,
  });

  if (!process.env.EMAIL_USER || !assignee.email) return;
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: assignee.email,
      subject: `New task assigned: ${task.title}`,
      html: `
        <h2>A task has been assigned to you</h2>
        <p><strong>${escapeHtml(from)}</strong> assigned you the following task in the CRM:</p>
        <ul>
          <li><strong>Task:</strong> ${escapeHtml(task.title)}</li>
          <li><strong>Due:</strong> ${escapeHtml(task.dueDate) || "no date set"}</li>
          <li><strong>Priority:</strong> ${escapeHtml(task.priority) || "Medium"}</li>
          ${task.associatedLead ? `<li><strong>Lead:</strong> ${escapeHtml(task.associatedLead)}</li>` : ""}
        </ul>
        ${task.description ? `<p>${escapeHtml(task.description)}</p>` : ""}
      `,
    });
  } catch (err) {
    console.error("Could not email task assignment:", err.message);
  }
}

// Whether a user may view/change a given task. Same scope rule as everything
// else: your own, or someone below you in the reporting tree.
async function userCanAccessTask(user, task) {
  const ids = await visibleUserIds(user);
  if (ids === null) return true;
  const ownerId = Number(task?.userId ?? task?.user_id);
  if (!Number.isFinite(ownerId)) return false;
  return ids.includes(ownerId);
}

// Whether a user may see another user's profile. Everyone may read their own.
async function userCanAccessUser(actor, targetUserId) {
  const target = Number(targetUserId);
  const self = Number(actor?._id ?? actor?.id);
  if (Number.isFinite(self) && self === target) return true;
  const ids = await visibleUserIds(actor);
  if (ids === null) return true;
  return ids.includes(target);
}

// Lead query restricted to the caller's scope ({} when unrestricted).
function leadScopeQuery(ids) {
  if (ids === null) return {};
  return {
    $or: [
      { createdBy: { $in: ids } },
      // A lead may be assigned to several BDMs; this matches if any of them
      // fall inside the caller's scope.
      { "companyInfo.leadAssignedTo": { $arrayContains: ids } },
    ],
  };
}

// POST lead data with file upload
app.post("/api/leads", authenticateToken, upload.single("file"), async (req, res) => {
  try {
    const parsedData = JSON.parse(req.body.data);
    // Trust the authenticated user for ownership, not the client payload.
    parsedData.createdBy = req.user.id;


    // The form warns about duplicates as you type, but that is only a hint —
    // uniqueness has to be decided here or it is not enforced at all.
    const companyName = parsedData.company?.companyName;
    if (!normalizeCompanyName(companyName)) {
      return res
        .status(400)
        .json({ success: false, error: "Company name is required" });
    }
    const duplicate = await findLeadByCompanyName(companyName);
    if (duplicate) {
      return res.status(409).json({
        success: false,
        error: `"${duplicate.company_name}" already exists as Lead #${duplicate.lead_number}.`,
        duplicate: {
          leadNumber: duplicate.lead_number,
          companyName: duplicate.company_name,
        },
      });
    }

    const leadData = {
      companyInfo: {
        leadType: parsedData.company?.leadType,
        genericEmail1: parsedData.company?.genericEmail1,
        vertical: parsedData.company?.vertical,
        companyName: parsedData.company?.companyName,
        genericEmail2: parsedData.company?.genericEmail2,
        // Accepts either a single id (legacy clients) or an array — a lead
        // can now be handed to several BDMs at once, each of whom sees it in
        // their own "assigned leads" list.
        leadAssignedTo: (() => {
          const raw = parsedData.company?.leadAssignedTo;
          const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
          const ids = [...new Set(list.map(Number).filter(Number.isFinite))];
          return ids.length ? ids : null;
        })(),
        website: parsedData.company?.website,
        genericPhone1: parsedData.company?.genericPhone1,
        bdm: parsedData.company?.bdm,
        address: parsedData.company?.address,
        genericPhone2: parsedData.company?.genericPhone2,
        leadStatus: parsedData.company?.leadStatus,
        city: parsedData.company?.city,
        leadSource: parsedData.company?.leadSource,
        priority: parsedData.company?.priority,
        state: parsedData.company?.state,
        totalNoOfOffices: parsedData.company?.totalNoOfOffices ? Number(parsedData.company.totalNoOfOffices) : 0,
        nextAction: parsedData.company?.nextAction,
        country: parsedData.company?.country,
        turnOverINR: parsedData.company?.turnOverINR,
        leadUsable: parsedData.company?.leadUsable,
        employeeCount: parsedData.company?.employeeCount,
        totalNoOfManufUnits: parsedData.company?.totalNoOfManufUnits ? Number(parsedData.company.totalNoOfManufUnits) : 0,
        reason: parsedData.company?.reason,
        expectedDealValue: parsedData.company?.expectedDealValue,
        pipelineStage: parsedData.company?.pipelineStage,
        aboutTheCompany: parsedData.company?.aboutTheCompany,
        dateField: parsedData.company?.dateField,
      },
      contactInfo: {
        it: {
          name: parsedData.contact?.itName,
          dlExt: parsedData.contact?.itDlExt,
          designation: parsedData.contact?.itDesignation,
          mobile: parsedData.contact?.itMobile,
          email: parsedData.contact?.itEmail,
          personalEmail: parsedData.contact?.itPersonalEmail,
        },
        finance: {
          name: parsedData.contact?.financeName,
          dlExt: parsedData.contact?.financeDlExt,
          designation: parsedData.contact?.financeDesignation,
          mobile: parsedData.contact?.financeMobile,
          email: parsedData.contact?.financeEmail,
          personalEmail: parsedData.contact?.financePersonalEmail,
        },
        businessHead: {
          name: parsedData.contact?.businessHeadName,
          dlExt: parsedData.contact?.businessHeadDlExt,
          designation: parsedData.contact?.businessHeadDesignation,
          mobile: parsedData.contact?.businessHeadMobile,
          email: parsedData.contact?.businessHeadEmail,
          personalEmail: parsedData.contact?.businessHeadPersonalEmail,
        },
      },
      itLandscape: {
        netNew: parsedData.itLandscape?.netNew || {},
        SAPInstalledBase: parsedData.itLandscape?.SAPInstalledBase || {},
      },
      descriptions: [
        {
          description: parsedData.description,
          selectedOption: parsedData.selectedOption,
          radioValue: parsedData.radioValue,
          addedBy: parsedData.createdBy ? Number(parsedData.createdBy) : null,
          // Every later description carries a timestamp; without one here the
          // first note on a lead is undateable in the activity report.
          createdAt: new Date().toISOString(),
        },
      ],
      createdBy: parsedData.createdBy ? Number(parsedData.createdBy) : null,
    };

    if (req.file) {
      leadData.descriptions[0].file = {
        data: req.file.buffer,
        contentType: req.file.mimetype,
        filename: req.file.originalname,
      };
    }

    const lead = new Lead(leadData);
    const savedLead = await lead.save();

    await savedLead.populate("descriptions.addedBy", "firstName");
    res.status(201).json({
      success: true,
      message: "Lead created successfully",
      leadNumber: savedLead.leadNumber,
    });
    broadcastChange("leads", "created", { leadNumber: savedLead.leadNumber });
  } catch (error) {
    console.error("Error creating lead:", error);
    res.status(500).json({
      success: false,
      error: "Error creating lead",
    });
  }
});


app.get("/api/assigned-leads", authenticateToken, async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const userId = Number(rawUserId);

    // A lead assigned to several BDMs shows up here for each of them.
    const leads = await Lead.find({
      "companyInfo.leadAssignedTo": { $arrayContains: userId },
    })
      .populate("companyInfo.leadAssignedTo", "firstName lastName")
      .populate("createdBy", "firstName lastName")
      .sort({ createdAt: -1 });

    if (!leads || leads.length === 0) {
      return res
        .status(200)
        .json([]);
    }

    res.json(leads);
  } catch (error) {
    console.error("Error fetching assigned leads:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching assigned leads",
    });
  }
});

app.get(
  "/api/leads",
  authenticateToken,
  checkRole(ALL_ROLES),
  async (req, res) => {
    try {
      const rawUserId = req.user?._id || req.user?.id;
      const userRole = normalizeRole(req.user?.role);

      if (!rawUserId || !userRole) {
        return res.status(400).json({ error: "Invalid user data" });
      }

      const userId = Number(rawUserId);
      // Every signed-in user sees every company. Edit rights are enforced
      // per-record on the write endpoints, not by hiding rows here.
      const query = {};

      // Filter parameters from query
      const {
        companyName,
        cityName,
        vertical,
        priority,
        contractExpiry,
        supportPartner,
        turnOver,
        leadType,
        team,
        allLeads,
      } = req.query;

      if (companyName)
        query["companyInfo.companyName"] = {
          $regex: companyName,
          $options: "i",
        };
      if (cityName)
        query["companyInfo.city"] = { $regex: cityName, $options: "i" };
      if (vertical) query["companyInfo.vertical"] = vertical;
      if (priority) query["companyInfo.priority"] = priority;
      if (contractExpiry)
        // The filter offers years, but the field now stores a full date.
        // Match on the year prefix so both old ("2027") and new ("2027-03-31")
        // values are found.
        query["itLandscape.SAPInstalledBase.contractExpiry"] = {
          $regex: `^${String(contractExpiry).slice(0, 4)}`,
        };
      if (supportPartner)
        query["itLandscape.SAPInstalledBase.supportPartner"] = {
          $regex: supportPartner,
          $options: "i",
        };
      if (turnOver)
        query["companyInfo.turnOverINR"] = { $regex: turnOver, $options: "i" };
      if (leadType)
        query["companyInfo.leadType"] = { $regex: leadType, $options: "i" };
      if (team) query["companyInfo.leadAssignedTo"] = { $arrayContains: Number(team) };

      if (allLeads === "createdByMe") {
        query.createdBy = userId;
      } else if (allLeads === "assignedToMe") {
        query["companyInfo.leadAssignedTo"] = { $arrayContains: userId };
      }

      const leads = await Lead.find(query)
        .populate("companyInfo.leadAssignedTo", "firstName lastName")
        .populate("createdBy", "firstName lastName")
        // Note authors, so the dashboard activity feed can name who wrote
        // each note instead of falling back to "Unknown".
        .populate("descriptions.addedBy", "firstName")
        .sort({ createdAt: -1 });

      // Opt-in pagination. Callers that pass ?page= get an envelope with the
      // total; everyone else keeps the plain array they already expect, so
      // this cannot break an existing screen. Worth switching the lead table
      // over before the record count grows.
      if (req.query.page !== undefined) {
        const pageSize = Math.min(Number(req.query.limit) || 50, 200);
        const page = Math.max(0, Number(req.query.page) || 0);
        const start = page * pageSize;
        return res.json({
          total: leads.length,
          page,
          pageSize,
          leads: leads.slice(start, start + pageSize),
        });
      }

      res.json(leads);
    } catch (error) {
      console.error("Error fetching leads:", error);
      res.status(500).json({
        success: false,
        error: "Error fetching leads",
      });
    }
  }
);

// Company names are compared on a normalised form so that "Tata  Steel ",
// "tata steel" and "Tata Steel" all count as the same company.
const normalizeCompanyName = (name) =>
  (name || "").toString().toLowerCase().replace(/\s+/g, " ").trim();

// SQL for the same normalisation, so the index-free comparison matches JS.
const NORMALIZED_NAME_SQL =
  `lower(btrim(regexp_replace(company_info->>'companyName', '\\s+', ' ', 'g')))`;

// Look up an existing lead whose company name matches exactly (normalised).
const findLeadByCompanyName = async (name) => {
  const normalized = normalizeCompanyName(name);
  if (!normalized) return null;
  const result = await mongoose.pool.query(
    `SELECT lead_number, company_info->>'companyName' AS company_name
       FROM leads
      WHERE ${NORMALIZED_NAME_SQL} = $1
      LIMIT 1`,
    [normalized]
  );
  return result.rows[0] || null;
};

// Type-ahead for the Company Name field on the Create Lead form.
//
// Deliberately NOT role-scoped: the point is to stop the same company being
// entered twice, which fails if a user cannot see leads owned by other teams.
// Only the company name, its lead number and the owner's name are returned —
// never the lead itself — so this discloses the minimum needed to say
// "this already exists, talk to X".
//
// Must stay above /api/leads/:leadNumber or that route swallows this path.
app.get("/api/leads/company-search", authenticateToken, async (req, res) => {
  try {
    const target = normalizeCompanyName(req.query.q);
    if (target.length < 2) return res.json([]);

    // Match on the same normalised form the duplicate check uses, so typing
    // "tata  motors" still surfaces "Tata Motors Ltd" instead of silently
    // finding nothing and then being rejected on submit.
    // Escape LIKE metacharacters so a user typing "%" searches for a literal %.
    const escaped = target.replace(/[\\%_]/g, (c) => `\\${c}`);

    const result = await mongoose.pool.query(
      `SELECT l.lead_number,
              l.company_info->>'companyName' AS company_name,
              u.first_name,
              u.last_name
         FROM leads l
         LEFT JOIN users u ON l.created_by = u.id
        WHERE ${NORMALIZED_NAME_SQL} LIKE '%' || $1 || '%' ESCAPE '\\'
        ORDER BY length(l.company_info->>'companyName'), l.lead_number
        LIMIT 8`,
      [escaped]
    );
    res.json(
      result.rows.map((r) => ({
        leadNumber: r.lead_number,
        companyName: r.company_name,
        owner: [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
        exact: normalizeCompanyName(r.company_name) === target,
      }))
    );
  } catch (error) {
    console.error("Error searching company names:", error);
    res.status(500).json({ error: "Error searching company names" });
  }
});

// --- Generated reports -----------------------------------------------------
// Metadata only; the PDF bytes are never included in the list response.
// Scoped to the caller's branch so a Business Lead sees only its own reports.
app.get("/api/reports", authenticateToken, async (req, res) => {
  try {
    const scopeIds = await visibleUserIds(req.user);

    const params = [];
    let where = "";
    if (scopeIds !== null) {
      if (scopeIds.length === 0) return res.json([]);
      where = `WHERE r.generated_by IN (${scopeIds.map((_, i) => `$${i + 1}`).join(", ")})`;
      params.push(...scopeIds);
    }

    const result = await mongoose.pool.query(
      `SELECT r.id, r.file_name, r.report_type, r.mime_type, r.size_bytes,
              r.created_at, u.first_name, u.last_name
         FROM reports r
         LEFT JOIN users u ON r.generated_by = u.id
         ${where}
        ORDER BY r.created_at DESC
        LIMIT 50`,
      params
    );

    res.json(
      result.rows.map((r) => ({
        id: r.id,
        fileName: r.file_name,
        reportType: r.report_type,
        mimeType: r.mime_type,
        sizeBytes: r.size_bytes,
        createdAt: r.created_at,
        generatedBy:
          [r.first_name, r.last_name].filter(Boolean).join(" ") || null,
      }))
    );
  } catch (error) {
    console.error("Error listing reports:", error);
    res.status(500).json({ error: "Error listing reports" });
  }
});

// --- Per-user work report --------------------------------------------------
// Who created which leads, what they logged against them, and what tasks they
// worked. Admin tiers only — enforced here, not just hidden in the UI. Still
// scoped by visibleUserIds, so an Admin sees its own branch and a Super Admin
// sees everyone.
app.get(
  "/api/reports/activity",
  authenticateToken,
  // Managers included: the results are already narrowed to the caller's own
  // branch, so a Manager sees its Executives and nobody else's.
  checkRole([ROLES.ADMIN, ROLES.MANAGER]),
  async (req, res) => {
    try {
      const scopeIds = await visibleUserIds(req.user);
      const scoped = scopeIds !== null;
      if (scoped && scopeIds.length === 0) {
        return res.json({ users: [], detail: null });
      }

      // One placeholder list reused by every query below.
      const idParams = scoped ? scopeIds : [];
      const idList = scoped
        ? `(${scopeIds.map((_, i) => `$${i + 1}`).join(", ")})`
        : null;
      const userFilter = scoped ? `WHERE u.id IN ${idList}` : "";

      const users = await mongoose.pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.role, u.designation
           FROM users u
           ${userFilter}
          ORDER BY u.first_name, u.last_name`,
        idParams
      );

      // Leads created, per user.
      const created = await mongoose.pool.query(
        `SELECT created_by AS user_id, COUNT(*)::int AS n, MAX(created_at) AS last_at
           FROM leads
          WHERE created_by IS NOT NULL
            ${scoped ? `AND created_by IN ${idList}` : ""}
          GROUP BY created_by`,
        idParams
      );

      // Leads currently assigned, per user. leadAssignedTo may be a bare id
      // (legacy, single BDM) or a JSON array (multi-BDM); either shape is
      // unpacked into one row per assignee so a lead with several assignees
      // counts once for each of them.
      const assigned = await mongoose.pool.query(
        `SELECT elem AS user_id, COUNT(*)::int AS n
           FROM leads,
                LATERAL jsonb_array_elements_text(
                  CASE jsonb_typeof(company_info->'leadAssignedTo')
                    WHEN 'array' THEN company_info->'leadAssignedTo'
                    WHEN 'number' THEN jsonb_build_array(company_info->'leadAssignedTo')
                    ELSE '[]'::jsonb
                  END
                ) AS elem
          GROUP BY elem`
      );

      // Actions logged: one row per description entry, attributed to its author.
      const actions = await mongoose.pool.query(
        `SELECT (d->>'addedBy') AS user_id, COUNT(*)::int AS n,
                MAX(d->>'createdAt') AS last_at
           FROM leads l, jsonb_array_elements(l.descriptions) d
          WHERE d->>'addedBy' IS NOT NULL
          GROUP BY d->>'addedBy'`
      );

      // Task counts by status.
      const taskRows = await mongoose.pool.query(
        `SELECT user_id, status, COUNT(*)::int AS n
           FROM tasks
          WHERE user_id IS NOT NULL
            ${scoped ? `AND user_id IN ${idList}` : ""}
          GROUP BY user_id, status`,
        idParams
      );

      const num = (v) => (v === null || v === undefined ? null : Number(v));
      const byId = (rows, key = "n") => {
        const map = {};
        rows.forEach((r) => {
          const id = num(r.user_id);
          if (id !== null && !Number.isNaN(id)) map[id] = r[key];
        });
        return map;
      };

      const createdMap = byId(created.rows);
      const createdLastMap = byId(created.rows, "last_at");
      const assignedMap = byId(assigned.rows);
      const actionsMap = byId(actions.rows);
      const actionsLastMap = byId(actions.rows, "last_at");

      const tasksMap = {};
      taskRows.rows.forEach((r) => {
        const id = num(r.user_id);
        if (id === null) return;
        const entry = (tasksMap[id] = tasksMap[id] || {
          total: 0,
          done: 0,
          open: 0,
        });
        entry.total += r.n;
        if (r.status === "done") entry.done += r.n;
        else entry.open += r.n;
      });

      const latest = (a, b) => {
        if (!a) return b || null;
        if (!b) return a;
        return new Date(a) > new Date(b) ? a : b;
      };

      const summary = users.rows.map((u) => {
        const tasks = tasksMap[u.id] || { total: 0, done: 0, open: 0 };
        return {
          id: u.id,
          name: [u.first_name, u.last_name].filter(Boolean).join(" "),
          role: u.role,
          designation: u.designation,
          leadsCreated: createdMap[u.id] || 0,
          leadsAssigned: assignedMap[u.id] || 0,
          actionsLogged: actionsMap[u.id] || 0,
          tasksTotal: tasks.total,
          tasksDone: tasks.done,
          tasksOpen: tasks.open,
          lastActivityAt: latest(createdLastMap[u.id], actionsLastMap[u.id]),
        };
      });

      // Optional drill-down for one user.
      const wanted = req.query.userId ? Number(req.query.userId) : null;
      let detail = null;

      if (wanted && !Number.isNaN(wanted)) {
        if (scoped && !scopeIds.includes(wanted)) {
          return res.status(403).json({ error: "Forbidden" });
        }

        const [leadsRes, actionsRes, tasksRes] = await Promise.all([
          mongoose.pool.query(
            `SELECT lead_number, company_info, created_at
               FROM leads
              WHERE created_by = $1
              ORDER BY created_at DESC
              LIMIT 200`,
            [wanted]
          ),
          mongoose.pool.query(
            `SELECT l.lead_number,
                    l.company_info->>'companyName' AS company_name,
                    d->>'description' AS description,
                    d->>'createdAt'  AS created_at
               FROM leads l, jsonb_array_elements(l.descriptions) d
              WHERE (d->>'addedBy') = $1
              -- Postgres puts NULLs first on DESC; older notes predate the
              -- timestamp, and they belong at the bottom, not the top.
              ORDER BY (d->>'createdAt') DESC NULLS LAST
              LIMIT 200`,
            [String(wanted)]
          ),
          mongoose.pool.query(
            `SELECT task_id, title, associated_lead, description, due_date,
                    priority, status, category, created_at
               FROM tasks
              WHERE user_id = $1
              ORDER BY created_at DESC
              LIMIT 200`,
            [wanted]
          ),
        ]);

        detail = {
          userId: wanted,
          leadsCreated: leadsRes.rows.map((r) => ({
            leadNumber: r.lead_number,
            companyName: r.company_info?.companyName || null,
            leadStatus: r.company_info?.leadStatus || null,
            priority: r.company_info?.priority || null,
            nextAction: r.company_info?.nextAction || null,
            createdAt: r.created_at,
          })),
          actions: actionsRes.rows.map((r) => ({
            leadNumber: r.lead_number,
            companyName: r.company_name,
            description: r.description,
            createdAt: r.created_at,
          })),
          tasks: tasksRes.rows.map((r) => ({
            taskId: r.task_id,
            title: r.title,
            associatedLead: r.associated_lead,
            description: r.description,
            dueDate: r.due_date,
            priority: r.priority,
            status: r.status,
            category: r.category,
            createdAt: r.created_at,
          })),
        };
      }

      res.json({ users: summary, detail });
    } catch (error) {
      console.error("Error building activity report:", error);
      res.status(500).json({ error: "Error building activity report" });
    }
  }
);

// SAP Installed Base contracts expiring within three months. The same report
// the scheduler builds on the 1st — this is the "run it now" path.
app.post(
  "/api/reports/sap-renewals/generate",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      const result = await generateExpiringContractsReport({
        generatedBy: Number(req.user.id),
      });
      res.status(201).json({
        id: result.id,
        fileName: result.file_name,
        createdAt: result.created_at,
        contracts: result.rowCount,
      });
    } catch (error) {
      console.error("Error generating renewals report:", error);
      res.status(500).json({ error: "Error generating renewals report" });
    }
  }
);

// Preview of the same data, so the page can show it without a download.
app.get(
  "/api/reports/sap-renewals",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      res.json(await collectExpiringContracts());
    } catch (error) {
      console.error("Error listing expiring contracts:", error);
      res.status(500).json({ error: "Error listing expiring contracts" });
    }
  }
);

// Work done per user for one month, as a CSV download. Same scope rules as the
// activity report.
app.get(
  "/api/reports/monthly-work",
  authenticateToken,
  checkRole([ROLES.ADMIN, ROLES.MANAGER]),
  async (req, res) => {
    try {
      const month = String(req.query.month || "").trim();
      if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "month must be YYYY-MM" });
      }

      const scopeIds = await visibleUserIds(req.user);
      const rows = await collectMonthlyWork(month, scopeIds);
      if (rows === null) {
        return res.status(400).json({ error: "Invalid month" });
      }

      // ?format=json powers the on-screen table; the default is the download.
      if (req.query.format === "json") {
        return res.json({ month, users: rows });
      }

      const csv = monthlyWorkCsv(month, rows);
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="work-done-${month}.csv"`
      );
      res.send(csv);
    } catch (error) {
      console.error("Error building monthly work report:", error);
      res.status(500).json({ error: "Error building monthly work report" });
    }
  }
);

// Download one report. Re-checks scope — a report must not be reachable by id
// just because someone guessed the number.
app.get("/api/reports/:reportId/download", authenticateToken, async (req, res) => {
  try {
    const result = await mongoose.pool.query(
      `SELECT file_name, mime_type, content, generated_by FROM reports WHERE id = $1`,
      [Number(req.params.reportId)]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Report not found" });
    }
    const report = result.rows[0];

    const scopeIds = await visibleUserIds(req.user);
    if (scopeIds !== null && !scopeIds.includes(Number(report.generated_by))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    if (!report.content) {
      return res.status(404).json({ error: "Report file is missing" });
    }

    res.setHeader("Content-Type", report.mime_type || "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${report.file_name.replace(/"/g, "")}"`
    );
    res.send(report.content);
  } catch (error) {
    console.error("Error downloading report:", error);
    res.status(500).json({ error: "Error downloading report" });
  }
});

// --- Manager visibility grants ---------------------------------------------
// Which Executives each Manager may see beyond their own direct reports.
// Admin only: this decides who can read whose work, so it is not something a
// Manager may widen for themselves.
app.get(
  "/api/permissions",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      const people = await mongoose.pool.query(
        `SELECT id, first_name, last_name, role, designation, status, supervisor_id
           FROM users
          WHERE role IN ($1, $2)
          ORDER BY role, first_name, last_name`,
        [ROLES.MANAGER, ROLES.EXECUTIVE]
      );

      const grants = await mongoose.pool.query(
        `SELECT manager_id, executive_id FROM manager_access`
      );

      const shape = (r) => ({
        id: r.id,
        name: [r.first_name, r.last_name].filter(Boolean).join(" "),
        role: r.role,
        designation: r.designation,
        status: r.status,
        supervisorId: r.supervisor_id,
      });

      res.json({
        managers: people.rows.filter((r) => r.role === ROLES.MANAGER).map(shape),
        executives: people.rows
          .filter((r) => r.role === ROLES.EXECUTIVE)
          .map(shape),
        // [{managerId, executiveId}] — the extra grants only. Direct reports
        // are implied by supervisorId and are never listed here.
        grants: grants.rows.map((g) => ({
          managerId: g.manager_id,
          executiveId: g.executive_id,
        })),
      });
    } catch (error) {
      console.error("Error loading permissions:", error);
      res.status(500).json({ error: "Error loading permissions" });
    }
  }
);

app.post(
  "/api/permissions",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      const managerId = Number(req.body?.managerId);
      const executiveId = Number(req.body?.executiveId);
      if (!managerId || !executiveId) {
        return res
          .status(400)
          .json({ error: "managerId and executiveId are required" });
      }

      // Both ends must be the tier they claim to be, or a grant could quietly
      // hand one Admin's view to another account.
      const pair = await mongoose.pool.query(
        `SELECT id, role FROM users WHERE id = ANY($1::int[])`,
        [[managerId, executiveId]]
      );
      const roleOf = (id) =>
        normalizeRole(pair.rows.find((r) => r.id === id)?.role);
      if (roleOf(managerId) !== ROLES.MANAGER) {
        return res.status(400).json({ error: "That user is not a Manager" });
      }
      if (roleOf(executiveId) !== ROLES.EXECUTIVE) {
        return res.status(400).json({ error: "That user is not an Executive" });
      }

      await mongoose.pool.query(
        `INSERT INTO manager_access (manager_id, executive_id, granted_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (manager_id, executive_id) DO NOTHING`,
        [managerId, executiveId, Number(req.user.id)]
      );
      res.status(201).json({ success: true });
    } catch (error) {
      console.error("Error granting access:", error);
      res.status(500).json({ error: "Error granting access" });
    }
  }
);

app.delete(
  "/api/permissions/:managerId/:executiveId",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      await mongoose.pool.query(
        `DELETE FROM manager_access WHERE manager_id = $1 AND executive_id = $2`,
        [Number(req.params.managerId), Number(req.params.executiveId)]
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Error revoking access:", error);
      res.status(500).json({ error: "Error revoking access" });
    }
  }
);

// --- Personal notes --------------------------------------------------------
// The sidebar scratchpad. Private to the author: no role, however senior, can
// read someone else's notes through the API.
app.get("/api/notes", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const result = await mongoose.pool.query(
      `SELECT id, body, created_at FROM notes
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [userId]
    );
    res.json(
      result.rows.map((r) => ({
        id: r.id,
        text: r.body,
        createdAt: r.created_at,
      }))
    );
  } catch (error) {
    console.error("Error listing notes:", error);
    res.status(500).json({ error: "Error listing notes" });
  }
});

app.post("/api/notes", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const body = String(req.body?.text || "").trim();
    if (!body) return res.status(400).json({ error: "Note cannot be empty" });
    if (body.length > 5000) {
      return res.status(400).json({ error: "Note is too long" });
    }

    const result = await mongoose.pool.query(
      `INSERT INTO notes (user_id, body) VALUES ($1, $2)
       RETURNING id, body, created_at`,
      [userId, body]
    );
    const row = result.rows[0];
    res.status(201).json({
      id: row.id,
      text: row.body,
      createdAt: row.created_at,
    });
  } catch (error) {
    console.error("Error creating note:", error);
    res.status(500).json({ error: "Error creating note" });
  }
});

app.delete("/api/notes/:noteId", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    // Ownership is part of the WHERE clause, so a guessed id deletes nothing.
    const result = await mongoose.pool.query(
      `DELETE FROM notes WHERE id = $1 AND user_id = $2 RETURNING id`,
      [Number(req.params.noteId), userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Note not found" });
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting note:", error);
    res.status(500).json({ error: "Error deleting note" });
  }
});

// --- Audit trail -----------------------------------------------------------
// Admin tiers only. Unlike the other reports this is NOT narrowed to the
// caller's branch: an audit trail that hides part of the activity is not an
// audit trail. Access is the control, not scope.
app.get(
  "/api/audit",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      const { userId, outcome, from, to, search, limit, offset } = req.query;
      const result = await queryAuditLog({
        userId: userId || null,
        outcome: outcome || null,
        from: from || null,
        to: to || null,
        search: search || null,
        limit: limit || 100,
        offset: offset || 0,
      });
      res.json(result);
    } catch (error) {
      console.error("Error reading audit log:", error);
      res.status(500).json({ error: "Error reading audit log" });
    }
  }
);

// People the caller may hand work to: everyone below them in the reporting
// tree, never themselves and never a peer. Empty for a user with no reports.
app.get("/api/assignable-users", authenticateToken, async (req, res) => {
  try {
    const callerId = Number(req.user?._id || req.user?.id);
    const ids = await visibleUserIds(req.user);

    const query = ids === null ? {} : { id: { $in: ids } };
    const users = await User.find(query, {
      firstName: 1,
      lastName: 1,
      role: 1,
      designation: 1,
      status: 1,
    });

    res.json(
      (users || [])
        .filter((u) => Number(u._id ?? u.id) !== callerId)
        .filter((u) => (u.status || "active") === "active")
        .map((u) => ({
          id: u._id ?? u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          role: u.role,
          designation: u.designation,
        }))
    );
  } catch (error) {
    console.error("Error listing assignable users:", error);
    res.status(500).json({ error: "Error listing assignable users" });
  }
});

// GET all tasks for logged-in user (or subordinates if supervisor/admin)
app.get("/api/tasks", authenticateToken, async (req, res) => {
  try {
    const ids = await visibleUserIds(req.user);
    const query = ids === null ? {} : { user_id: { $in: ids } };

    const tasks = await Task.find(query);

    // Attach owner / assigner names so the client can say who a task belongs to
    // and who handed it over, without a second round trip per task.
    const wanted = new Set();
    (tasks || []).forEach((t) => {
      if (t.userId) wanted.add(Number(t.userId));
      if (t.assignedBy) wanted.add(Number(t.assignedBy));
    });

    let names = {};
    if (wanted.size > 0) {
      const rows = await mongoose.pool.query(
        `SELECT id, first_name, last_name FROM users WHERE id = ANY($1::int[])`,
        [[...wanted]]
      );
      rows.rows.forEach((r) => {
        names[r.id] = [r.first_name, r.last_name].filter(Boolean).join(" ");
      });
    }

    res.json(
      (tasks || []).map((t) => ({
        ...t,
        ownerName: names[Number(t.userId)] || null,
        assignedByName: t.assignedBy ? names[Number(t.assignedBy)] || null : null,
      }))
    );
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Error fetching tasks" });
  }
});

// POST a new task
app.post("/api/tasks", authenticateToken, validate(taskSchema), async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const callerId = Number(rawUserId);
    const { taskId, title, associatedLead, description, originalDueDate, dueDate, priority, category, status, assignedTo } = req.body;

    // Assigning work downward: the target must sit inside the caller's own
    // branch of the reporting tree. visibleUserIds returns null for a Super
    // Admin (no restriction) and the descendant list — which includes the
    // caller — for everyone else. Assigning to yourself is always fine.
    let userId = callerId;
    let assignedBy = null;

    if (assignedTo && Number(assignedTo) !== callerId) {
      const target = Number(assignedTo);
      const allowed = await visibleUserIds(req.user);
      if (allowed !== null && !allowed.includes(target)) {
        return res
          .status(403)
          .json({ error: "You can only assign work to your own team" });
      }
      const targetUser = await User.findById(target);
      if (!targetUser) {
        return res.status(404).json({ error: "Assignee not found" });
      }
      userId = target;
      assignedBy = callerId;
    }

    const newTask = await Task.create({
      taskId: taskId || "task-" + Date.now(),
      title,
      associatedLead,
      description,
      originalDueDate,
      dueDate,
      priority,
      category,
      status: status || "pending",
      userId,
      assignedBy
    });

    // Tell the assignee. Until now work could be handed over silently and only
    // noticed if they happened to look at their dashboard.
    if (assignedBy) {
      notifyTaskAssigned(newTask, req.user).catch((err) =>
        console.error("Assignment notification failed:", err)
      );
    }

    res.status(201).json(newTask);
    broadcastChange("tasks", "created", { userId: Number(userId) });
  } catch (error) {
    console.error("Error creating task:", error);
    res.status(500).json({ error: "Error creating task" });
  }
});

// PUT (update) an existing task by taskId or database id
app.put("/api/tasks/:taskId", authenticateToken, async (req, res) => {
  try {
    const { taskId } = req.params;
    let task;
    if (!isNaN(Number(taskId))) {
      task = await Task.findOne({ id: Number(taskId) });
    }
    if (!task) {
      task = await Task.findOne({ taskId });
    }
    if (!task) {
      return res.status(404).json({ error: "Task not found" });
    }

    // A task id in the URL is not authorisation. You may change your own task,
    // or one belonging to someone in your branch of the reporting tree.
    if (!(await userCanAccessTask(req.user, task))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (req.body.title !== undefined) task.title = req.body.title;
    if (req.body.associatedLead !== undefined) task.associatedLead = req.body.associatedLead;
    if (req.body.description !== undefined) task.description = req.body.description;
    if (req.body.originalDueDate !== undefined) task.originalDueDate = req.body.originalDueDate;
    if (req.body.dueDate !== undefined) task.dueDate = req.body.dueDate;
    if (req.body.priority !== undefined) task.priority = req.body.priority;
    if (req.body.status !== undefined) task.status = req.body.status;
    if (req.body.category !== undefined) task.category = req.body.category;

    const saved = await task.save();
    res.json(saved);
    broadcastChange("tasks", "updated", { taskId: saved.taskId });
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ error: "Error updating task" });
  }
});

app.put("/api/leads/assign-bulk", authenticateToken, async (req, res) => {
  const { leadIds, assignedUserId } = req.body;

  try {
    // Handing leads out is a management action, exactly as it is on the
    // single-lead endpoint. Without this check any signed-in Executive could
    // reassign the whole pipeline.
    if (!canManageTeam(req.user?.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // isValidObjectId is what this shim actually exposes; the old code called
    // mongoose.Types.ObjectId.isValid, which is undefined here and threw a
    // TypeError on the first line of every bulk assignment.
    if (!mongoose.isValidObjectId(assignedUserId)) {
      return res.status(400).json({ error: "Invalid assigned user ID." });
    }

    const ids = (Array.isArray(leadIds) ? leadIds : [])
      .map(Number)
      .filter((n) => Number.isFinite(n));
    if (ids.length === 0) {
      return res.status(400).json({ error: "No leads selected." });
    }

    // The target must sit inside the caller's own team.
    if (!(await userCanAccessUser(req.user, assignedUserId))) {
      return res
        .status(403)
        .json({ error: "You can only assign leads within your own team." });
    }

    const assignedUser = await User.findById(assignedUserId);
    if (!assignedUser || assignedUser.status !== "active") {
      return res.status(400).json({ error: "Assigned user must be active." });
    }

    // Stored as a single-element array so it reads consistently with leads
    // assigned to several BDMs at creation time.
    const result = await Lead.updateMany(
      { _id: { $in: ids } },
      { "companyInfo.leadAssignedTo": [Number(assignedUserId)] }
    );

    res.status(200).json({
      message: `${result.modifiedCount} lead(s) assigned successfully.`,
      modifiedCount: result.modifiedCount,
    });
    broadcastChange("leads", "assigned", { count: result.modifiedCount });
  } catch (error) {
    console.error("Error assigning leads:", error);
    res
      .status(500)
      .json({ error: "Error assigning leads" });
  }
});


// GET lead by lead number
app.get("/api/leads/:leadNumber", authenticateToken, async (req, res) => {
  try {
    const lead = await Lead.findOne({ leadNumber: req.params.leadNumber })
      .populate("descriptions.addedBy", "firstName")
      .populate("createdBy", "firstName");
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    // Readable by everyone; the client uses canEdit to decide whether to
    // offer the edit controls at all.
    const canEdit = await userCanEditLead(req.user, lead);
    res.json({ ...lead, canEdit });
  } catch (error) {
    console.error("Error fetching lead:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/api/leads/:leadNumber", authenticateToken, async (req, res) => {
  try {
    const lead = await Lead.findOne({ leadNumber: req.params.leadNumber });
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    if (!(await userCanEditLead(req.user, lead))) {
      return res.status(403).json({
        error:
          "Only the person who created this lead, their manager, or an " +
          "Admin can edit it.",
      });
    }

    // Record which fields actually changed. The audit log otherwise says only
    // that a lead was updated, and "who moved this to LOST" is the question
    // people actually ask.
    const before = JSON.parse(JSON.stringify(lead.companyInfo || {}));

    // Update `companyInfo`, `contactInfo`, `itLandscape`, and `descriptions` if present in request
    if (req.body.companyInfo) {
      Object.assign(lead.companyInfo, req.body.companyInfo);
      // The client may echo back populated user object(s) — one BDM or
      // several; store id(s) only, never the populated object.
      const idOf = (u) => (u && typeof u === "object" ? u._id ?? u.id ?? null : u);
      const assigned = lead.companyInfo.leadAssignedTo;
      if (Array.isArray(assigned)) {
        const ids = [...new Set(assigned.map(idOf).filter((id) => id !== null && id !== undefined))];
        lead.companyInfo.leadAssignedTo = ids.length ? ids : null;
      } else if (assigned && typeof assigned === "object") {
        lead.companyInfo.leadAssignedTo = idOf(assigned);
      }
    }
    if (req.body.contactInfo) {
      Object.assign(lead.contactInfo, req.body.contactInfo);
    }
    if (req.body.itLandscape) {
      Object.assign(lead.itLandscape, req.body.itLandscape);
    }
    if (Array.isArray(req.body.descriptions)) {
      // Never persist whatever the client sends verbatim: a note read back from
      // GET has `addedBy` populated to a full user row (password hash and all),
      // and writing that straight back would bake it into the record.
      const existing = lead.descriptions || [];
      lead.descriptions = req.body.descriptions.map((d, i) => ({
        ...d,
        addedBy: d.addedBy && typeof d.addedBy === "object"
          ? d.addedBy._id ?? d.addedBy.id ?? null
          : d.addedBy ?? null,
        createdAt: d.createdAt || existing[i]?.createdAt || new Date().toISOString(),
      }));
    }

    // Save updated lead to the database
    await lead.save();

    // Attach a field-level diff to this request so the audit middleware can
    // store it alongside the entry.
    const after = lead.companyInfo || {};
    const changed = Object.keys({ ...before, ...after })
      .filter((k) => String(before[k] ?? "") !== String(after[k] ?? ""))
      .map((k) => ({ field: k, from: before[k] ?? null, to: after[k] ?? null }));
    if (changed.length > 0) req.auditChanges = changed;

    // Return the record the way GET returns it, so the client can render author
    // names instead of bare ids straight after a save.
    await lead.populate("descriptions.addedBy", "firstName");
    res.json(lead);
    broadcastChange("leads", "updated", { leadNumber: lead.leadNumber });
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(400).json({ error: "Internal server error" });
  }
});


// POST new description for a lead
app.post("/api/leads/:leadNumber/descriptions", authenticateToken, async (req, res) => {
  try {
    const { leadNumber } = req.params;
    const { description } = req.body;

    if (!description) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const lead = await Lead.findOne({ leadNumber });
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    if (!(await userCanEditLead(req.user, lead))) {
      return res.status(403).json({
        error:
          "Only the person who created this lead, their manager, or an " +
          "Admin can add notes to it.",
      });
    }

    lead.descriptions.push({
      description,
      addedBy: Number(req.user.id), // Trust the authenticated user, not the client
      createdAt: new Date().toISOString(),
    });

    await lead.save();

    // Populate the user information
    await lead.populate("descriptions.addedBy", "firstName");

    res.json(lead);
  } catch (error) {
    console.error("Error in add description route:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Global error handler for PayloadTooLargeError
app.use((err, req, res, next) => {
  if (err.type === "entity.too.large") {
    return res.status(413).json({
      success: false,
      message: "Payload too large",
    });
  }
  next(err);
});

// Guard: an Admin manages the tiers below it, but must never create, edit or
// promote anyone to Super Admin — otherwise it can escalate its own access.
const rejectSuperAdminChanges = (actorRole, targetRole) =>
  !isSuperAdmin(actorRole) && normalizeRole(targetRole) === ROLES.ADMIN;

app.get("/api/admin/users", authenticateToken, checkRole([ROLES.ADMIN]), async (req, res) => {
  try {
    const users = await User.find({}, "-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/users", authenticateToken, checkRole([ROLES.ADMIN, ROLES.MANAGER]), validate(createUserSchema), async (req, res) => {
  try {
    if (rejectSuperAdminChanges(req.user.role, req.body.role)) {
      return res
        .status(403)
        .json({ error: "Only a Super Admin can create a Super Admin." });
    }

    // A Manager may add Executives, and only onto its own team. Everything
    // else about user administration stays with the Admin tiers: a Manager
    // cannot create another Manager, and cannot place someone under a
    // different Manager. Enforced here, not merely hidden in the form.
    const actorRole = normalizeRole(req.user.role);
    if (actorRole === ROLES.MANAGER) {
      if (normalizeRole(req.body.role) !== ROLES.EXECUTIVE) {
        return res
          .status(403)
          .json({ error: "A Manager may only create Executive accounts." });
      }
      // Ignore any supervisor the client sent; the new Executive reports to
      // the Manager creating them.
      req.body.supervisor = Number(req.user.id);
    }

    const {
      firstName,
      lastName,
      designation,
      email,
      mobile,
      password,
      role,
      supervisor,
      status,
    } = req.body;

    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      firstName,
      lastName,
      designation,
      email,
      mobile,
      password: hashedPassword,
      role,
      supervisor: supervisor || null,
      status: status || "active",
    });

    const savedUser = await newUser.save();
    if (savedUser && savedUser.password) delete savedUser.password;

    res.status(201).json(savedUser);
    broadcastChange("users", "created", { userId: savedUser._id ?? savedUser.id });
  } catch (error) {
    console.error("Error creating user:", error);
    // 23505 is Postgres' unique_violation. This used to test for 11000, which
    // is MongoDB's code and can never fire here — so an email that was already
    // taken surfaced as a bare 500 with nothing to act on.
    if (error.code === "23505") {
      return res.status(409).json({
        error: "An account with this email address already exists.",
      });
    }
    // 23502 is not_null_violation — a required column arrived empty.
    if (error.code === "23502") {
      return res.status(400).json({
        error: `Missing required field: ${error.column || "unknown"}.`,
      });
    }
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/users", authenticateToken, async (req, res) => {
  try {
    const { name, supervisor, role, designation, status } = req.query;

    // Build the query object based on filters
    const query = {};

    if (name) {
      query.$or = [
        { firstName: { $regex: name, $options: "i" } },
        { lastName: { $regex: name, $options: "i" } },
      ];
    }
    if (supervisor) {
      query.supervisor = supervisor;
    }
    if (role) {
      query.role = role;
    }
    if (designation) {
      query.designation = { $regex: designation, $options: "i" };
    }
    if (status) {
      query.status = status;
    }

    const users = await User.find(query, {
      firstName: 1,
      lastName: 1,
      email: 1,
      role: 1,
      status: 1,
      designation: 1,
    }).populate("supervisor", "firstName lastName");

    // The directory is not public to every signed-in account. Managers see
    // their own branch; everyone else sees only themselves. Without this, one
    // stolen credential yields the whole staff list with email addresses.
    const scopeIds = await visibleUserIds(req.user);
    const callerId = Number(req.user?._id ?? req.user?.id);
    const visible =
      scopeIds === null
        ? users
        : (users || []).filter((u) => {
            const id = Number(u._id ?? u.id);
            return id === callerId || scopeIds.includes(id);
          });

    res.json(visible);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user data",
    });
  }
});

app.put("/api/users/:userId", authenticateToken, checkRole([ROLES.ADMIN]), validate(updateUserSchema), async (req, res) => {
  try {
    // An Admin may not touch a Super Admin account, nor promote anyone into
    // that tier. Check the existing role as well as the requested one.
    const target = await User.findById(req.params.userId);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }
    if (
      rejectSuperAdminChanges(req.user.role, target.role) ||
      rejectSuperAdminChanges(req.user.role, req.body.role)
    ) {
      return res
        .status(403)
        .json({ error: "Only a Super Admin can manage a Super Admin." });
    }

    // Whitelist updatable fields to prevent mass assignment.
    const allowed = ["firstName", "lastName", "designation", "email", "mobile", "role", "supervisor", "status"];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }
    // If a new password is supplied, hash it before storing.
    if (req.body.password) {
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(req.body.password, salt);
    }

    const user = await User.findByIdAndUpdate(req.params.userId, update, {
      new: true,
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    // Drop the cached account state so a deactivation or role change applies to
    // the very next request instead of waiting out the cache window.
    invalidateAccountState(req.params.userId);
    if (user.password) delete user.password;
    res.json(user);
    broadcastChange("users", "updated", { userId: Number(req.params.userId) });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Error updating user" });
  }
});

// Delete a user. Admin only.
//
// Refuses rather than cascading when the account still owns records: leads are
// the company's history, and silently deleting or orphaning them to tidy up a
// staff list is the wrong trade. The caller is told what is in the way and
// pointed at deactivation, which removes access without destroying anything.
app.delete(
  "/api/users/:userId",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      const targetId = Number(req.params.userId);
      const actorId = Number(req.user?._id ?? req.user?.id);

      if (!targetId) return res.status(400).json({ error: "Invalid user id" });
      if (targetId === actorId) {
        return res
          .status(400)
          .json({ error: "You cannot delete your own account." });
      }

      const target = await User.findById(targetId);
      if (!target) return res.status(404).json({ error: "User not found" });

      // A Super Admin account can never be deleted, by anyone — not by another
      // Super Admin, and not by itself (blocked above in any case). The top
      // tier is what grants every other account its access, so losing the last
      // one locks the whole organisation out with no way back in. Deactivation
      // is still available and removes access without destroying the account.
      if (isSuperAdmin(target.role)) {
        return res.status(403).json({
          error:
            "A Super Admin account cannot be deleted. Set it to inactive " +
            "instead, or demote it first if it genuinely needs to go.",
        });
      }

      const [leads, assigned, reports] = await Promise.all([
        mongoose.pool.query(
          `SELECT COUNT(*)::int n FROM leads WHERE created_by = $1`,
          [targetId]
        ),
        mongoose.pool.query(
          `SELECT COUNT(*)::int n FROM leads
            WHERE COALESCE(company_info->'leadAssignedTo', 'null'::jsonb) @> to_jsonb($1::int)`,
          [targetId]
        ),
        mongoose.pool.query(
          `SELECT COUNT(*)::int n FROM users WHERE supervisor_id = $1`,
          [targetId]
        ),
      ]);

      const blockers = [];
      if (leads.rows[0].n > 0) blockers.push(`${leads.rows[0].n} lead(s) they created`);
      if (assigned.rows[0].n > 0) blockers.push(`${assigned.rows[0].n} lead(s) assigned to them`);
      if (reports.rows[0].n > 0) blockers.push(`${reports.rows[0].n} user(s) reporting to them`);

      if (blockers.length > 0) {
        return res.status(409).json({
          error:
            `This account still has ${blockers.join(", ")}. ` +
            `Reassign those first, or set the account to inactive to remove ` +
            `access without deleting the history.`,
          blockers,
        });
      }

      await mongoose.pool.query(`DELETE FROM users WHERE id = $1`, [targetId]);
      // Kill any cached "this account is fine" answer immediately.
      invalidateAccountState(targetId);

      res.json({ success: true });
      broadcastChange("users", "deleted", { userId: targetId });
    } catch (error) {
      console.error("Error deleting user:", error);
      // A foreign key we did not anticipate should read as a refusal, not a
      // 500 that leaves the admin guessing.
      if (error.code === "23503") {
        return res.status(409).json({
          error:
            "This account is still referenced by other records. Set it to inactive instead.",
        });
      }
      res.status(500).json({ error: "Error deleting user" });
    }
  }
);

app.get("/api/users/supervisors", authenticateToken, async (req, res) => {
  try {
    // Anyone who can have people reporting to them: every tier above the
    // bottom one. A Business Lead is never somebody else's manager.
    const supervisors = await User.find(
      { role: { $in: [ROLES.ADMIN, ROLES.MANAGER] } },
      { firstName: 1, lastName: 1, _id: 1, role: 1 }
    );
    res.json(supervisors);
  } catch (error) {
    console.error("Error fetching supervisors:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/api/users/:userId", authenticateToken, async (req, res) => {
  try {
    // Reading a profile by id is not open to every signed-in account: it must
    // be your own, or someone inside your branch.
    if (!(await userCanAccessUser(req.user, req.params.userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // No .populate() here: that is a Mongoose call, and findById returns a
    // plain promise from the Postgres model. Calling it threw a TypeError on
    // every request, which surfaced as a 500 and left the edit form blank.
    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // `supervisor` stays the raw id so the "Reports To" <select> can match it
    // against its options; the name rides alongside for display.
    let supervisorName = null;
    if (user.supervisor) {
      const boss = await User.findById(user.supervisor);
      if (boss) {
        supervisorName = [boss.firstName, boss.lastName].filter(Boolean).join(" ");
      }
    }

    res.json({
      _id: user._id,
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      designation: user.designation,
      email: user.email,
      mobile: user.mobile,
      role: user.role,
      supervisor: user.supervisor ?? "",
      supervisorName,
      status: user.status,
    });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user",
    });
  }
});

app.get("/api/team-overview", authenticateToken, async (req, res) => {
  try {
    const role = normalizeRole(req.user.role);
    let users;

    if (role === ROLES.ADMIN) {
      users = await User.find({}, "firstName lastName email role").populate(
        "supervisor",
        "firstName lastName"
      );
    } else if (role === ROLES.ADMIN || role === ROLES.MANAGER) {
      // Everyone below them in the tree, at any depth — for an Admin that is
      // its BDMs and those BDMs' Business Leads.
      const ids = (await visibleUserIds(req.user)).filter(
        (id) => Number(id) !== Number(req.user.id)
      );
      users = ids.length
        ? await User.find({ _id: { $in: ids } }, "firstName lastName email role").populate(
            "supervisor",
            "firstName lastName"
          )
        : [];
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Make sure you send a valid JSON response
    res.json({ users });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error fetching team data" });
  }
});

app.get("/api/users/:userId/leads", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

    // Only within the caller's own branch — otherwise any signed-in user could
    // read another team's leads just by putting their id in the URL.
    const scopeIds = await visibleUserIds(req.user);
    if (scopeIds !== null && !scopeIds.includes(Number(userId))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Fetch the leads associated with the user
    const leads = await Lead.find({ createdBy: userId })
      .populate("createdBy", "firstName lastName") // Populate user details
      .populate("descriptions.addedBy", "firstName") // Populate descriptions
      .exec(); // Make sure to execute the query

    res.json({ leads }); // Return the full leads array
  } catch (error) {
    console.error("Error fetching leads:", error);
    res.status(500).json({ error: "Error fetching leads" });
  }
});

// Get unassigned leads for inactive users with specific priorities
app.get("/api/unassigned-leads", authenticateToken, async (req, res) => {
  try {
    const role = normalizeRole(req.user.role);

    // Business Leads have nobody to reassign work to.
    if (role === ROLES.EXECUTIVE) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Anyone deactivated: their leads need a new owner regardless of whose
    // team they were on. Who the lead may then be handed to is still checked
    // on the assign endpoint, which only accepts a target inside the caller's
    // own team.
    const inactiveUsers = await User.find({ status: "inactive" }, "_id");
    const inactiveUserIds = inactiveUsers
      .map((u) => Number(u._id || u.id))
      .filter((n) => !Number.isNaN(n));

    // A lead needs reassigning when it is assigned to nobody, or assigned to
    // somebody deactivated.
    //
    // An unassigned lead used to be matched through its CREATOR, and only when
    // that creator sat inside the caller's own branch. That hid the entire
    // queue from every Manager whenever leads were created by somebody above
    // them — a bulk import by an Admin left 126 unassigned leads that no
    // Manager could see, let alone pick up. Since leads are readable by
    // everyone now, an unassigned lead is shown to anyone able to assign it.
    const conditions = [];
    if (inactiveUserIds.length > 0) {
      conditions.push({
        "companyInfo.leadAssignedTo": { $arrayContains: inactiveUserIds },
      });
    }
    conditions.push({ "companyInfo.leadAssignedTo": null });

    const leads = await Lead.find({ $or: conditions })
      .populate("companyInfo.leadAssignedTo", "firstName lastName")
      .populate("createdBy", "firstName lastName");

    return res.json(leads);
  } catch (error) {
    console.error("Error fetching unassigned leads:", error);
    res
      .status(500)
      .json({
        error: "Error fetching unassigned leads",
      });
  }
});


// Fetch all active users
app.get("/api/active-users", authenticateToken, async (req, res) => {
  try {
    // Candidates a lead can be assigned to: active users within the caller's
    // own branch of the tree.
    const query = { status: "active" };
    const scopeIds = await visibleUserIds(req.user);
    if (scopeIds !== null) query._id = { $in: scopeIds };
    const activeUsers = await User.find(query, "firstName lastName _id");
    res.json(activeUsers);
  } catch (error) {
    console.error("Error fetching active users:", error);
    res.status(500).json({ error: "Error fetching active users" });
  }
});



// Update lead assignment to an active user
app.put(
  "/api/unassigned-leads/:leadId/assign",
  authenticateToken,
  async (req, res) => {
    const { leadId } = req.params;
    const { newAssignedUserId } = req.body;

    try {
      // Handing a lead to someone is a management action, and the target must
      // be inside the caller's own branch — otherwise any signed-in user could
      // reassign any lead to anyone by editing the id in the URL.
      if (!canManageTeam(req.user?.role)) {
        return res.status(403).json({ error: "Forbidden" });
      }
      if (!(await userCanAccessUser(req.user, newAssignedUserId))) {
        return res
          .status(403)
          .json({ error: "You can only assign leads within your own team" });
      }

      // Confirm that the new assigned user is active
      const newUser = await User.findById(newAssignedUserId);
      if (!newUser) {
        return res.status(404).json({ error: "Assigned user not found." });
      }
      if (newUser.status !== "active") {
        return res.status(400).json({ error: "Assigned user must be active." });
      }

      // Update the lead assignment
      const updatedLead = await Lead.findByIdAndUpdate(
        leadId,
        { "companyInfo.leadAssignedTo": [Number(newAssignedUserId)] },
        { new: true }
      );

      if (!updatedLead) {
        return res.status(404).json({ error: "Lead not found." });
      }

      res.json(updatedLead);
      broadcastChange("leads", "assigned", { leadId });
    } catch (error) {
      console.error("Error assigning lead:", error);
      res
        .status(500)
        .json({ error: "Error assigning lead" });
    }
  }
);



// ==================== IN-APP CHAT & MESSAGING SYSTEM ====================

// Get all users available for chat
app.get("/api/chat/users", authenticateToken, async (req, res) => {
  try {
    const currentUserId = Number(req.user._id || req.user.id);
    const users = await User.find({ status: "active" });
    const formatted = users
      .filter(u => Number(u.id || u._id) !== currentUserId)
      .map(u => ({
        id: Number(u.id || u._id),
        name: `${u.firstName} ${u.lastName}`.trim(),
        email: u.email,
        role: u.role,
        designation: u.designation
      }));
    res.json(formatted);
  } catch (error) {
    console.error("Error fetching chat users:", error);
    res.status(500).json({ error: "Failed to fetch chat users" });
  }
});

// Get direct messages between current user and target user
app.get("/api/chat/messages/direct/:targetUserId", authenticateToken, async (req, res) => {
  try {
    const currentUserId = Number(req.user._id || req.user.id);
    const targetUserId = Number(req.params.targetUserId);

    const query = `
      SELECT m.*, 
        u_sender.first_name as sender_first_name, u_sender.last_name as sender_last_name,
        u_rec.first_name as recipient_first_name, u_rec.last_name as recipient_last_name
      FROM messages m
      JOIN users u_sender ON m.sender_id = u_sender.id
      LEFT JOIN users u_rec ON m.recipient_id = u_rec.id
      WHERE (m.sender_id = $1 AND m.recipient_id = $2)
         OR (m.sender_id = $2 AND m.recipient_id = $1)
      ORDER BY m.created_at ASC
    `;
    const result = await mongoose.pool.query(query, [currentUserId, targetUserId]);
    
    const messages = result.rows.map(r => ({
      id: r.id,
      senderId: r.sender_id,
      senderName: `${r.sender_first_name} ${r.sender_last_name}`.trim(),
      recipientId: r.recipient_id,
      recipientName: `${r.recipient_first_name || ''} ${r.recipient_last_name || ''}`.trim(),
      content: r.content,
      createdAt: r.created_at,
      readBy: Array.isArray(r.read_by) ? r.read_by : (typeof r.read_by === 'string' ? JSON.parse(r.read_by) : [])
    }));

    res.json(messages);
  } catch (error) {
    console.error("Error fetching direct messages:", error);
    res.status(500).json({ error: "Failed to fetch direct messages" });
  }
});

// Send a direct message
app.post("/api/chat/messages/direct", authenticateToken, async (req, res) => {
  try {
    const senderId = Number(req.user._id || req.user.id);
    const { recipientId, content } = req.body;

    if (!recipientId || !content || !content.trim()) {
      return res.status(400).json({ error: "Recipient and content are required" });
    }

    const insertQuery = `
      INSERT INTO messages (sender_id, recipient_id, content, read_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await mongoose.pool.query(insertQuery, [senderId, Number(recipientId), content.trim(), JSON.stringify([senderId])]);
    
    const sender = await User.findById(senderId);
    const newMsg = {
      id: result.rows[0].id,
      senderId: senderId,
      senderName: sender ? `${sender.firstName} ${sender.lastName}` : "User",
      recipientId: Number(recipientId),
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at,
      readBy: [senderId]
    };

    io.to(`user_${senderId}`).to(`user_${recipientId}`).emit("new_message", {
      ...newMsg,
      type: "direct"
    });

    res.status(201).json(newMsg);
  } catch (error) {
    console.error("Error sending direct message:", error);
    res.status(500).json({ error: "Failed to send direct message" });
  }
});

// Get user's chat groups
app.get("/api/chat/groups", authenticateToken, async (req, res) => {
  try {
    const currentUserId = Number(req.user._id || req.user.id);

    const query = `
      SELECT g.*, u.first_name as creator_first_name, u.last_name as creator_last_name
      FROM chat_groups g
      JOIN users u ON g.created_by = u.id
      ORDER BY g.created_at DESC
    `;
    const result = await mongoose.pool.query(query);

    const userGroups = result.rows.filter(g => {
      const members = Array.isArray(g.members) ? g.members : (typeof g.members === 'string' ? JSON.parse(g.members) : []);
      return g.created_by === currentUserId || members.map(Number).includes(currentUserId);
    }).map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      createdBy: g.created_by,
      creatorName: `${g.creator_first_name} ${g.creator_last_name}`.trim(),
      members: Array.isArray(g.members) ? g.members : (typeof g.members === 'string' ? JSON.parse(g.members) : []),
      createdAt: g.created_at
    }));

    res.json(userGroups);
  } catch (error) {
    console.error("Error fetching chat groups:", error);
    res.status(500).json({ error: "Failed to fetch chat groups" });
  }
});

// Create a new chat group
app.post("/api/chat/groups", authenticateToken, async (req, res) => {
  try {
    const creatorId = Number(req.user._id || req.user.id);
    const { name, description, memberIds } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Group name is required" });
    }

    const uniqueMembers = [...new Set([creatorId, ...(memberIds || []).map(Number)])];

    const insertQuery = `
      INSERT INTO chat_groups (name, description, created_by, members)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await mongoose.pool.query(insertQuery, [
      name.trim(),
      description ? description.trim() : "",
      creatorId,
      JSON.stringify(uniqueMembers)
    ]);

    const creator = await User.findById(creatorId);
    const newGroup = {
      id: result.rows[0].id,
      name: result.rows[0].name,
      description: result.rows[0].description,
      createdBy: creatorId,
      creatorName: creator ? `${creator.firstName} ${creator.lastName}` : "User",
      members: uniqueMembers,
      createdAt: result.rows[0].created_at
    };

    res.status(201).json(newGroup);
  } catch (error) {
    console.error("Error creating chat group:", error);
    res.status(500).json({ error: "Failed to create chat group" });
  }
});

// Get group messages
app.get("/api/chat/messages/group/:groupId", authenticateToken, async (req, res) => {
  try {
    const groupId = Number(req.params.groupId);

    // Group conversations are private to their members. Without this, any
    // signed-in user could read any group by incrementing the id in the URL.
    const callerId = Number(req.user?._id ?? req.user?.id);
    const group = await mongoose.pool.query(
      `SELECT members, created_by FROM chat_groups WHERE id = $1`,
      [groupId]
    );
    if (group.rowCount === 0) {
      return res.status(404).json({ error: "Group not found" });
    }
    const members = Array.isArray(group.rows[0].members)
      ? group.rows[0].members.map(Number)
      : [];
    const isMember =
      members.includes(callerId) ||
      Number(group.rows[0].created_by) === callerId;
    if (!isMember) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const query = `
      SELECT m.*, u.first_name as sender_first_name, u.last_name as sender_last_name, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.group_id = $1
      ORDER BY m.created_at ASC
    `;
    const result = await mongoose.pool.query(query, [groupId]);

    const messages = result.rows.map(r => ({
      id: r.id,
      senderId: r.sender_id,
      senderName: `${r.sender_first_name} ${r.sender_last_name}`.trim(),
      senderRole: r.sender_role,
      groupId: r.group_id,
      content: r.content,
      createdAt: r.created_at,
      readBy: Array.isArray(r.read_by) ? r.read_by : (typeof r.read_by === 'string' ? JSON.parse(r.read_by) : [])
    }));

    res.json(messages);
  } catch (error) {
    console.error("Error fetching group messages:", error);
    res.status(500).json({ error: "Failed to fetch group messages" });
  }
});

// Send a group message
app.post("/api/chat/messages/group", authenticateToken, async (req, res) => {
  try {
    const senderId = Number(req.user._id || req.user.id);
    const { groupId, content } = req.body;

    if (!groupId || !content || !content.trim()) {
      return res.status(400).json({ error: "Group ID and content are required" });
    }

    const insertQuery = `
      INSERT INTO messages (sender_id, group_id, content, read_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `;
    const result = await mongoose.pool.query(insertQuery, [senderId, Number(groupId), content.trim(), JSON.stringify([senderId])]);

    const sender = await User.findById(senderId);
    const newMsg = {
      id: result.rows[0].id,
      senderId: senderId,
      senderName: sender ? `${sender.firstName} ${sender.lastName}` : "User",
      senderRole: sender ? sender.role : ROLES.EXECUTIVE,
      groupId: Number(groupId),
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at,
      readBy: [senderId]
    };

    io.to(`group_${groupId}`).emit("new_message", {
      ...newMsg,
      type: "group"
    });

    res.status(201).json(newMsg);
  } catch (error) {
    console.error("Error sending group message:", error);
    res.status(500).json({ error: "Failed to send group message" });
  }
});

// Get global announcement messages
app.get("/api/chat/messages/global", authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT m.*, u.first_name as sender_first_name, u.last_name as sender_last_name, u.role as sender_role
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE m.is_global = TRUE
      ORDER BY m.created_at ASC
    `;
    const result = await mongoose.pool.query(query);

    const messages = result.rows.map(r => ({
      id: r.id,
      senderId: r.sender_id,
      senderName: `${r.sender_first_name} ${r.sender_last_name}`.trim(),
      senderRole: r.sender_role,
      isGlobal: true,
      content: r.content,
      createdAt: r.created_at,
      readBy: Array.isArray(r.read_by) ? r.read_by : (typeof r.read_by === 'string' ? JSON.parse(r.read_by) : [])
    }));

    res.json(messages);
  } catch (error) {
    console.error("Error fetching global messages:", error);
    res.status(500).json({ error: "Failed to fetch global messages" });
  }
});

// Broadcast global announcement (Admin only)
app.post("/api/chat/messages/global", authenticateToken, checkRole([ROLES.ADMIN]), async (req, res) => {
  try {
    const senderId = Number(req.user._id || req.user.id);
    const { content } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: "Announcement content is required" });
    }

    const insertQuery = `
      INSERT INTO messages (sender_id, is_global, content, read_by)
      VALUES ($1, TRUE, $2, $3)
      RETURNING *
    `;
    const result = await mongoose.pool.query(insertQuery, [senderId, content.trim(), JSON.stringify([senderId])]);

    const sender = await User.findById(senderId);
    const newMsg = {
      id: result.rows[0].id,
      senderId: senderId,
      senderName: sender ? `${sender.firstName} ${sender.lastName}` : "Super Admin",
      senderRole: normalizeRole(req.user.role),
      isGlobal: true,
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at,
      readBy: [senderId]
    };

    io.emit("new_message", {
      ...newMsg,
      type: "global"
    });

    res.status(201).json(newMsg);
  } catch (error) {
    console.error("Error posting global announcement:", error);
    res.status(500).json({ error: "Failed to post global announcement" });
  }
});

// Mark messages as read
app.post("/api/chat/messages/read", authenticateToken, async (req, res) => {
  try {
    const currentUserId = Number(req.user._id || req.user.id);
    const { type, targetId } = req.body;

    let updateQuery = "";
    let queryParams = [];
    const userIdJson = JSON.stringify([currentUserId]);

    if (type === "direct") {
      updateQuery = `
        UPDATE messages
        SET read_by = read_by || $1::jsonb
        WHERE recipient_id = $2 AND sender_id = $3 AND NOT (read_by @> $1::jsonb)
      `;
      queryParams = [userIdJson, currentUserId, Number(targetId)];
    } else if (type === "group") {
      updateQuery = `
        UPDATE messages
        SET read_by = read_by || $1::jsonb
        WHERE group_id = $2 AND NOT (read_by @> $1::jsonb)
      `;
      queryParams = [userIdJson, Number(targetId)];
    } else if (type === "global") {
      updateQuery = `
        UPDATE messages
        SET read_by = read_by || $1::jsonb
        WHERE is_global = TRUE AND NOT (read_by @> $1::jsonb)
      `;
      queryParams = [userIdJson];
    }

    if (updateQuery) {
      await mongoose.pool.query(updateQuery, queryParams);
    }

    // Broadcast messages_read receipt over socket
    if (type === "direct") {
      io.to(`user_${targetId}`).emit("messages_read", {
        readerId: currentUserId,
        type,
        targetId: currentUserId
      });
    } else if (type === "group") {
      io.to(`group_${targetId}`).emit("messages_read", {
        readerId: currentUserId,
        type,
        targetId
      });
    } else if (type === "global") {
      io.emit("messages_read", {
        readerId: currentUserId,
        type,
        targetId: "global"
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

// Get unread message counts for the current user (WhatsApp-style badges).
app.get("/api/chat/unread", authenticateToken, async (req, res) => {
  try {
    const me = Number(req.user._id || req.user.id);
    const meJson = JSON.stringify([me]);

    // Direct messages sent TO me that I haven't read, grouped by sender.
    const directRes = await mongoose.pool.query(
      `SELECT sender_id, COUNT(*)::int AS count
         FROM messages
        WHERE recipient_id = $1 AND NOT (read_by @> $2::jsonb)
        GROUP BY sender_id`,
      [me, meJson]
    );

    // Groups I belong to.
    const groupsRes = await mongoose.pool.query(
      `SELECT id, members, created_by FROM chat_groups`
    );
    const myGroupIds = groupsRes.rows
      .filter((g) => {
        const members = Array.isArray(g.members)
          ? g.members
          : typeof g.members === "string"
          ? JSON.parse(g.members)
          : [];
        return g.created_by === me || members.map(Number).includes(me);
      })
      .map((g) => g.id);

    let group = {};
    if (myGroupIds.length > 0) {
      const groupMsgRes = await mongoose.pool.query(
        `SELECT group_id, COUNT(*)::int AS count
           FROM messages
          WHERE group_id = ANY($1) AND sender_id <> $2 AND NOT (read_by @> $3::jsonb)
          GROUP BY group_id`,
        [myGroupIds, me, meJson]
      );
      groupMsgRes.rows.forEach((r) => { group[r.group_id] = r.count; });
    }

    // Global announcements I haven't read (not counting my own).
    const globalRes = await mongoose.pool.query(
      `SELECT COUNT(*)::int AS count
         FROM messages
        WHERE is_global = TRUE AND sender_id <> $1 AND NOT (read_by @> $2::jsonb)`,
      [me, meJson]
    );

    const direct = {};
    directRes.rows.forEach((r) => { direct[r.sender_id] = r.count; });
    const globalCount = globalRes.rows[0]?.count || 0;

    const total =
      Object.values(direct).reduce((a, b) => a + b, 0) +
      Object.values(group).reduce((a, b) => a + b, 0) +
      globalCount;

    res.json({ total, direct, group, global: globalCount });
  } catch (error) {
    console.error("Error fetching unread counts:", error);
    res.status(500).json({ error: "Failed to fetch unread counts" });
  }
});

// 404 for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Final error handler — log details server-side, return a generic message.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err && /not allowed by CORS/.test(err.message || "")) {
    return res.status(403).json({ error: "Origin not allowed" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// Start the server
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));

// Graceful shutdown: stop accepting connections, close sockets and the DB pool.
const shutdown = (signal) => {
  console.log(`${signal} received. Shutting down gracefully...`);
  io.close();
  server.close(async () => {
    try {
      if (mongoose.pool && mongoose.pool.end) await mongoose.pool.end();
    } catch (e) {
      console.error("Error closing DB pool:", e.message);
    }
    process.exit(0);
  });
  // Force-exit if it hangs.
  setTimeout(() => process.exit(1), 10000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

