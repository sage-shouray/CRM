const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("./Models/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const http = require("node:http");
const { Server } = require("socket.io");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");


const Lead = require("./Models/createLeads");
const User = require("./Models/User");
const Task = require("./Models/Task");

const { authenticateToken, checkRole, checkUserStatus, invalidateAccountState } = require("./Middleware/auth");
const { allowedOrigins, isPrivateOrigin, allowLanOrigins } = require("./Middleware/corsOrigins");
const {
  ROLES,
  ALL_ROLES,
  normalizeRole,
  isSuperAdmin,
  canManageTeam,
} = require("./Middleware/roles");
const { getDescendantUserIds } = require("./Models/db");
const {
  readWorkbook,
  sheetToRows,
  detectHeaderRowIndex,
  normalizeText,
} = require("./Models/bulkImportTransform");
const { TEMPLATE_COLUMNS, validateAgainstTemplate, transformTemplateRows } = require("./Models/bulkImportTemplate");
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

const corsOrigin = (origin, callback) => {
  // Allow non-browser clients (no Origin header) and any whitelisted origin.
  if (!origin || allowedOrigins.has(origin)) return callback(null, true);
  if (allowLanOrigins && isPrivateOrigin(origin)) return callback(null, true);
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
  const jwtSecretState = process.env.JWT_SECRET
    ? `only ${process.env.JWT_SECRET.length} characters`
    : "not set";
  const message =
    `JWT_SECRET is ${jwtSecretState}. ` +
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

// File upload configuration.
// Only one attachment endpoint uses this (the optional file on lead
// creation), and multer buffers the whole upload into process memory by
// default (no disk/S3 storage configured) — several concurrent uploads near
// a 50MB cap could spike RAM well past what this server has. 10MB comfortably
// covers a PDF/doc/image attachment while keeping that worst case bounded.
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
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
// "$1, $2, $3..." for a parameterised IN (...) clause — pulled out to one
// place since three different report routes were each building this with
// their own nested template literal.
const placeholderList = (arr) => arr.map((_, i) => `$${i + 1}`).join(", ");

// A jsonb array column (read_by, members) comes back from `pg` already
// parsed most of the time, but occasionally as its raw JSON text — this
// covers both without a nested ternary at every call site.
function asArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") return JSON.parse(value);
  return [];
}

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

// Leads are readable AND editable by every signed-in user, whatever their
// role or place in the reporting tree — an Executive, a Manager, and an
// Admin all get the same edit rights on any company. This used to be
// restricted to the creator, their manager chain, or the assignee, but that
// blocked people from updating a lead they legitimately needed to work on
// (covering for a colleague, correcting a record they spotted was wrong,
// etc.) whenever they didn't happen to fit one of those three roles.
// The only permission that still exists on a lead is *who can see it at
// all* — nobody; every lead is visible to every signed-in user regardless —
// so this function only remains as a named, single place every edit route
// checks, in case a narrower rule is ever wanted again later.
async function userCanEditLead(user, lead) {
  return true;
}

// Let an assignee know work has landed on them: a live socket event for anyone
// with the app open, and an email as the durable fallback. Never throws — a
// notification failing must not fail the assignment.
// Task fields (title, description, associatedLead) and the assigner's own
// name are all set by a signed-in user and land verbatim in an HTML email —
// escape them so one can't plant a link or markup that reads as an official
// CRM notification to whoever receives it.
const escapeHtml = (value) =>
  String(value ?? "").replaceAll(/[&<>"']/g, (c) => (
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
    const leadLine = task.associatedLead
      ? `<li><strong>Lead:</strong> ${escapeHtml(task.associatedLead)}</li>`
      : "";
    const descriptionLine = task.description ? `<p>${escapeHtml(task.description)}</p>` : "";
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
          ${leadLine}
        </ul>
        ${descriptionLine}
      `,
    });
  } catch (err) {
    console.error("Could not email task assignment:", err.message);
  }
}

// Whether a user may view/change a given task. Deliberately narrower than the
// reporting-tree scope used elsewhere: a to-do is private between whoever it
// belongs to and whoever assigned it, not visible to a manager's whole team
// or to every Admin by default just because they outrank the owner.
async function userCanAccessTask(user, task) {
  const callerId = Number(user?._id ?? user?.id);
  const ownerId = Number(task?.userId ?? task?.user_id);
  const assignerId = Number(task?.assignedBy ?? task?.assigned_by);
  return callerId === ownerId || (Number.isFinite(assignerId) && callerId === assignerId);
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
          let list = [];
          if (Array.isArray(raw)) list = raw;
          else if (raw) list = [raw];
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
        // Extra contacts beyond the three fixed roles (IT / Finance / Business
        // Head) — "Procurement Head", "CTO", however many the form added. Kept
        // as-is; each entry is already { sectionTitle, name, dlExt,
        // designation, mobile, email, personalEmail } from the client.
        additional: Array.isArray(parsedData.additionalSections)
          ? parsedData.additionalSections
          : [],
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
          // Marks this one entry as the lead's own description (written at
          // creation), so the UI can keep it separate from every later
          // activity note — everything pushed after this always defaults to
          // no `type`, i.e. a plain activity entry.
          type: "description",
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
  (name || "").toString().toLowerCase().replaceAll(/\s+/g, " ").trim();

// SQL for the same normalisation, so the index-free comparison matches JS.
const NORMALIZED_NAME_SQL =
  String.raw`lower(btrim(regexp_replace(company_info->>'companyName', '\s+', ' ', 'g')))`;

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
    const escaped = target.replaceAll(/[\\%_]/g, (c) => `\\${c}`);

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

// Type-ahead for finding a lead by a contact PERSON's name rather than the
// company name — the same person can be remembered by name long after which
// account they sit under is forgotten. Searches every contact slot (IT,
// Finance, Business Head, and any additional sections) across every lead,
// and reports whether that particular contact is still marked active there.
// Deliberately unscoped, like company-search: knowing a contact already
// exists somewhere is exactly what stops two people cold-calling the same
// person under two different leads.
app.get("/api/contacts/search", authenticateToken, async (req, res) => {
  try {
    const term = String(req.query.q || "").trim();
    if (term.length < 2) return res.json([]);
    const like = `%${term}%`;

    const result = await mongoose.pool.query(
      `
      SELECT lead_number, company_name, city, role_key, person_name, designation, active
        FROM (
          SELECT l.lead_number, l.company_info->>'companyName' AS company_name,
                 l.company_info->>'city' AS city, 'IT' AS role_key,
                 l.contact_info->'it'->>'name' AS person_name,
                 l.contact_info->'it'->>'designation' AS designation,
                 COALESCE((l.contact_info->'it'->>'active')::boolean, true) AS active
            FROM leads l
           WHERE l.contact_info->'it'->>'name' ILIKE $1
          UNION ALL
          SELECT l.lead_number, l.company_info->>'companyName',
                 l.company_info->>'city', 'Finance',
                 l.contact_info->'finance'->>'name',
                 l.contact_info->'finance'->>'designation',
                 COALESCE((l.contact_info->'finance'->>'active')::boolean, true)
            FROM leads l
           WHERE l.contact_info->'finance'->>'name' ILIKE $1
          UNION ALL
          SELECT l.lead_number, l.company_info->>'companyName',
                 l.company_info->>'city', 'Business Head',
                 l.contact_info->'businessHead'->>'name',
                 l.contact_info->'businessHead'->>'designation',
                 COALESCE((l.contact_info->'businessHead'->>'active')::boolean, true)
            FROM leads l
           WHERE l.contact_info->'businessHead'->>'name' ILIKE $1
          UNION ALL
          SELECT l.lead_number, l.company_info->>'companyName',
                 l.company_info->>'city', COALESCE(elem->>'sectionTitle', 'Other Contact'),
                 elem->>'name', elem->>'designation',
                 COALESCE((elem->>'active')::boolean, true)
            FROM leads l, jsonb_array_elements(COALESCE(l.contact_info->'additional', '[]'::jsonb)) elem
           WHERE elem->>'name' ILIKE $1
        ) matches
       WHERE person_name IS NOT NULL AND person_name <> ''
       ORDER BY person_name
       LIMIT 50
      `,
      [like]
    );

    res.json(
      result.rows.map((r) => ({
        leadNumber: r.lead_number,
        companyName: r.company_name,
        city: r.city,
        role: r.role_key,
        personName: r.person_name,
        designation: r.designation,
        active: r.active,
      }))
    );
  } catch (error) {
    console.error("Error searching contacts:", error);
    res.status(500).json({ error: "Error searching contacts" });
  }
});

// Mass-mail contact export — Admin only. Builds the list an admin picks from
// before sending an announcement/policy-change email to a chunk of the
// contact base: filterable by vertical, contact category (IT / Finance /
// Business Head / Other), and active/inactive — each filter accepts several
// values at once (comma-separated), not just one — returning every matching
// contact's email so the page can offer them pre-selected with a manual
// opt-out, and hand back a CSV of whatever's left checked.
app.get(
  "/api/contacts/export",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  async (req, res) => {
    try {
      // Comma-separated lists — an empty list means "no filter on this field",
      // matching every value, same as before a filter was ever applied.
      const csvList = (raw) => String(raw || "").split(",").map((s) => s.trim()).filter(Boolean);
      const verticals = csvList(req.query.vertical);
      const roles = csvList(req.query.role); // subset of IT / Finance / Business Head / Other
      const statuses = csvList(req.query.status); // subset of active / inactive

      const params = [];
      const verticalClause = () => {
        if (verticals.length === 0) return "";
        params.push(verticals);
        return ` AND l.company_info->>'vertical' = ANY($${params.length}::text[])`;
      };
      const wantsRole = (name) => roles.length === 0 || roles.includes(name);

      const parts = [];
      if (wantsRole("IT")) {
        parts.push(`
          SELECT l.lead_number, l.company_info->>'companyName' AS company_name,
                 l.company_info->>'vertical' AS vertical, l.company_info->>'city' AS city,
                 'IT' AS role_key,
                 l.contact_info->'it'->>'name' AS person_name,
                 l.contact_info->'it'->>'email' AS email,
                 l.contact_info->'it'->>'designation' AS designation,
                 COALESCE((l.contact_info->'it'->>'active')::boolean, true) AS active
            FROM leads l
           WHERE l.contact_info->'it'->>'email' IS NOT NULL
             AND l.contact_info->'it'->>'email' <> ''
             ${verticalClause()}
        `);
      }
      if (wantsRole("Finance")) {
        parts.push(`
          SELECT l.lead_number, l.company_info->>'companyName',
                 l.company_info->>'vertical', l.company_info->>'city', 'Finance',
                 l.contact_info->'finance'->>'name',
                 l.contact_info->'finance'->>'email',
                 l.contact_info->'finance'->>'designation',
                 COALESCE((l.contact_info->'finance'->>'active')::boolean, true)
            FROM leads l
           WHERE l.contact_info->'finance'->>'email' IS NOT NULL
             AND l.contact_info->'finance'->>'email' <> ''
             ${verticalClause()}
        `);
      }
      if (wantsRole("Business Head")) {
        parts.push(`
          SELECT l.lead_number, l.company_info->>'companyName',
                 l.company_info->>'vertical', l.company_info->>'city', 'Business Head',
                 l.contact_info->'businessHead'->>'name',
                 l.contact_info->'businessHead'->>'email',
                 l.contact_info->'businessHead'->>'designation',
                 COALESCE((l.contact_info->'businessHead'->>'active')::boolean, true)
            FROM leads l
           WHERE l.contact_info->'businessHead'->>'email' IS NOT NULL
             AND l.contact_info->'businessHead'->>'email' <> ''
             ${verticalClause()}
        `);
      }
      if (wantsRole("Other")) {
        parts.push(`
          SELECT l.lead_number, l.company_info->>'companyName',
                 l.company_info->>'vertical', l.company_info->>'city',
                 COALESCE(elem->>'sectionTitle', 'Other Contact'),
                 elem->>'name', elem->>'email', elem->>'designation',
                 COALESCE((elem->>'active')::boolean, true)
            FROM leads l, jsonb_array_elements(COALESCE(l.contact_info->'additional', '[]'::jsonb)) elem
           WHERE elem->>'email' IS NOT NULL AND elem->>'email' <> ''
             ${verticalClause()}
        `);
      }

      if (parts.length === 0) return res.json([]);

      // Both, or neither, selected means no filter — only a single value
      // picked out of the two actually narrows it.
      let statusClause = "";
      if (statuses.length === 1 && statuses[0] === "active") statusClause = "WHERE active = true";
      else if (statuses.length === 1 && statuses[0] === "inactive") statusClause = "WHERE active = false";

      const sql = `
        SELECT lead_number, company_name, vertical, city, role_key, person_name, email, designation, active
          FROM (${parts.join(" UNION ALL ")}) matches (
            lead_number, company_name, vertical, city, role_key, person_name, email, designation, active
          )
          ${statusClause}
         ORDER BY company_name, role_key
         LIMIT 10000
      `;

      const result = await mongoose.pool.query(sql, params);

      res.json(
        result.rows.map((r) => ({
          leadNumber: r.lead_number,
          companyName: r.company_name,
          vertical: r.vertical,
          city: r.city,
          role: r.role_key,
          personName: r.person_name,
          email: r.email,
          designation: r.designation,
          active: r.active,
        }))
      );
    } catch (error) {
      console.error("Error building contact export:", error);
      res.status(500).json({ error: "Error building contact export" });
    }
  }
);

// --- Cold lead pool ----------------------------------------------------
// A Cold lead sits in a shared pool anyone can pull from. Pulling always
// claims a fixed batch — up to 100 leads at once, chosen by whatever filters
// are applied, not one at a time. A pull is "resolved" once either the lead
// is converted (its own status moves off Cold) or the puller explicitly
// returns it with a note saying what they did. A lead is available to
// anyone the moment its one active pull is resolved — nothing expires on a
// timer. Pulling a new batch is blocked until every lead in the caller's
// current batch is resolved, so a pool of leads can never sit half-worked
// while someone moves on to more.
const COLD_STATUS = "Cold (9+ months)";
const COLD_BATCH_SIZE = 100;

// Shared WHERE fragment: is this lead currently unclaimed? True unless some
// pull row for it has no returned_at yet (an unresolved pull is always for a
// lead that is still Cold, since conversion or return is what resolves one).
const COLD_AVAILABLE_SQL = `NOT EXISTS (
  SELECT 1 FROM cold_lead_pulls p
   WHERE p.lead_number = l.lead_number AND p.returned_at IS NULL
)`;

// Builds the optional vertical / city / "no note between these dates"
// filters shared by the pool listing and the pull-100 action, so the two can
// never quietly drift apart. dateField values come in as YYYY-MM-DD strings.
function buildColdFilterSql(query, params) {
  let sql = "";
  if (query.vertical) {
    params.push(query.vertical);
    sql += ` AND l.company_info->>'vertical' = $${params.length}`;
  }
  if (query.city) {
    params.push(query.city);
    sql += ` AND l.company_info->>'city' = $${params.length}`;
  }
  // "No note between these dates" — companies nobody logged any action
  // against in that window, the ones going stale. An empty descriptions
  // array trivially has none, so a lead with zero notes ever always matches.
  if (query.noNoteFrom && query.noNoteTo) {
    params.push(query.noNoteFrom, query.noNoteTo);
    const fromIdx = params.length - 1;
    const toIdx = params.length;
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(l.descriptions) d
       WHERE (d->>'createdAt') IS NOT NULL
         AND (d->>'createdAt')::date BETWEEN $${fromIdx}::date AND $${toIdx}::date
    )`;
  }
  // "Freshly Pulled Leads Only" — genuinely untouched, never claimed by
  // anyone before. Distinct from "available" (COLD_AVAILABLE_SQL already
  // guarantees that): this excludes leads with any pull history at all, not
  // just ones currently claimed.
  if (query.freshOnly === true || query.freshOnly === "true") {
    sql += ` AND NOT EXISTS (
      SELECT 1 FROM cold_lead_pulls p3 WHERE p3.lead_number = l.lead_number
    )`;
  }
  return sql;
}

// Every available Cold lead matching the given filters, plus who pulled it
// last and their most recent note (for the hover tooltip), and how many
// times it has ever been pulled (0 means genuinely untouched).
app.get("/api/cold-leads", authenticateToken, async (req, res) => {
  try {
    const params = [COLD_STATUS];
    const filterSql = buildColdFilterSql(req.query, params);

    const result = await mongoose.pool.query(
      `SELECT l.lead_number, l.company_info, l.created_at,
              (SELECT COUNT(*) FROM cold_lead_pulls p WHERE p.lead_number = l.lead_number)::int AS pull_count,
              lp.user_id AS last_puller_id, lp.pulled_at AS last_pulled_at,
              lu.first_name AS last_puller_first_name, lu.last_name AS last_puller_last_name,
              ld.note AS last_note, ld.note_at AS last_note_at
         FROM leads l
         LEFT JOIN LATERAL (
           SELECT user_id, pulled_at FROM cold_lead_pulls p2
            WHERE p2.lead_number = l.lead_number
            ORDER BY p2.pulled_at DESC LIMIT 1
         ) lp ON true
         LEFT JOIN users lu ON lu.id = lp.user_id
         LEFT JOIN LATERAL (
           SELECT d->>'description' AS note, (d->>'createdAt')::timestamptz AS note_at
             FROM jsonb_array_elements(l.descriptions) d
            WHERE d->>'createdAt' IS NOT NULL
              -- The lead's own write-up from when it was created is not an
              -- action taken on it — excluding it here keeps this in step
              -- with how the Activity panel on the lead itself treats it.
              AND COALESCE(d->>'type', '') <> 'description'
            ORDER BY (d->>'createdAt')::timestamptz DESC LIMIT 1
         ) ld ON true
        WHERE l.company_info->>'leadStatus' = $1
          AND ${COLD_AVAILABLE_SQL}
          ${filterSql}
        ORDER BY l.lead_number ASC`,
      params
    );
    res.json(
      result.rows.map((r) => ({
        leadNumber: r.lead_number,
        companyName: r.company_info?.companyName || null,
        vertical: r.company_info?.vertical || null,
        city: r.company_info?.city || null,
        priority: r.company_info?.priority || null,
        createdAt: r.created_at,
        pullCount: r.pull_count,
        neverPulled: r.pull_count === 0,
        lastPulledAt: r.last_pulled_at,
        lastPulledByName:
          [r.last_puller_first_name, r.last_puller_last_name].filter(Boolean).join(" ") || null,
        lastNote: r.last_note || null,
        lastNoteAt: r.last_note_at,
      }))
    );
  } catch (error) {
    console.error("Error listing cold leads:", error);
    res.status(500).json({ error: "Error listing cold leads" });
  }
});

// The caller's current batch (their most recently pulled one), every lead in
// it with its resolution state, and the summary counts the dashboard shows:
// how many converted Hot/Warm, how many were returned Cold-with-a-note, and
// how many are still sitting unresolved with no note at all — the number
// that has to hit zero before another batch can be pulled.
app.get("/api/cold-leads/my-leads", authenticateToken, async (req, res) => {
  try {
    const userId = Number(req.user?._id ?? req.user?.id);
    const batchRes = await mongoose.pool.query(
      `SELECT batch_id FROM cold_lead_pulls
        WHERE user_id = $1 AND batch_id IS NOT NULL
        ORDER BY pulled_at DESC LIMIT 1`,
      [userId]
    );
    const batchId = batchRes.rows[0]?.batch_id || null;
    if (!batchId) {
      return res.json({
        batchId: null,
        leads: [],
        summary: { total: 0, hot: 0, warm: 0, returnedCold: 0, pendingNoNote: 0 },
      });
    }

    const result = await mongoose.pool.query(
      `SELECT p.id, p.lead_number, p.pulled_at, p.returned_at, p.return_note, l.company_info
         FROM cold_lead_pulls p
         JOIN leads l ON l.lead_number = p.lead_number
        WHERE p.batch_id = $1
        ORDER BY p.lead_number ASC`,
      [batchId]
    );

    const summary = { total: 0, hot: 0, warm: 0, returnedCold: 0, pendingNoNote: 0 };
    const leads = result.rows.map((r) => {
      const status = r.company_info?.leadStatus || "";
      const returned = !!r.returned_at;
      let state;
      if (status === "Hot (0–3 months)") state = "hot";
      else if (status === "Warm (3–9 months)") state = "warm";
      else if (returned) state = "returnedCold";
      else state = "pendingNoNote";
      summary.total += 1;
      summary[state] += 1;

      return {
        pullId: r.id,
        leadNumber: r.lead_number,
        companyName: r.company_info?.companyName || null,
        leadStatus: status,
        pulledAt: r.pulled_at,
        returnedAt: r.returned_at,
        returnNote: r.return_note,
        state,
      };
    });

    res.json({ batchId, leads, summary });
  } catch (error) {
    console.error("Error listing my leads:", error);
    res.status(500).json({ error: "Error listing your leads" });
  }
});

// Pull a fresh batch of up to 100 Cold leads matching the given filters, in
// lead-number order. Blocked while the caller's current batch still has any
// lead sitting unresolved (still Cold, no return note) — finish what you
// have before taking more.
app.post("/api/cold-leads/pull-100", authenticateToken, async (req, res) => {
  const client = await mongoose.pool.connect();
  try {
    const userId = Number(req.user?._id ?? req.user?.id);

    await client.query("BEGIN");

    const currentBatch = await client.query(
      `SELECT batch_id FROM cold_lead_pulls
        WHERE user_id = $1 AND batch_id IS NOT NULL
        ORDER BY pulled_at DESC LIMIT 1`,
      [userId]
    );
    const batchId = currentBatch.rows[0]?.batch_id;
    if (batchId) {
      const pendingRes = await client.query(
        `SELECT COUNT(*)::int AS pending
           FROM cold_lead_pulls p
           JOIN leads l ON l.lead_number = p.lead_number
          WHERE p.batch_id = $1
            AND p.returned_at IS NULL
            AND l.company_info->>'leadStatus' = $2`,
        [batchId, COLD_STATUS]
      );
      const pending = pendingRes.rows[0].pending;
      if (pending > 0) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: `You still have ${pending} lead(s) from your current batch that are neither converted nor returned with a note. Resolve those before pulling another 100.`,
          pending,
        });
      }
    }

    const params = [COLD_STATUS];
    const filterSql = buildColdFilterSql(req.body || {}, params);
    const availableRes = await client.query(
      `SELECT l.lead_number
         FROM leads l
        WHERE l.company_info->>'leadStatus' = $1
          AND ${COLD_AVAILABLE_SQL}
          ${filterSql}
        ORDER BY l.lead_number ASC
        LIMIT ${COLD_BATCH_SIZE}
        FOR UPDATE OF l SKIP LOCKED`,
      params
    );

    if (availableRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "No Cold leads match these filters right now." });
    }

    const newBatchId = `${userId}-${Date.now()}`;
    const insertedRows = [];
    for (const row of availableRes.rows) {
      const r = await client.query(
        `INSERT INTO cold_lead_pulls (lead_number, user_id, batch_id)
         VALUES ($1, $2, $3)
         RETURNING id, lead_number, pulled_at`,
        [row.lead_number, userId, newBatchId]
      );
      insertedRows.push(r.rows[0]);
    }

    await client.query("COMMIT");
    res.status(201).json({ batchId: newBatchId, count: insertedRows.length, pulls: insertedRows });
    broadcastChange("cold-leads", "pulled", { count: insertedRows.length });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error pulling a cold-lead batch:", error);
    res.status(500).json({ error: "Error pulling leads" });
  } finally {
    client.release();
  }
});

// Return one Cold lead to the pool — the only way an unconverted lead
// becomes available to someone else again. Requires the note explaining
// what action was taken; the two always happen together.
app.post("/api/cold-leads/:leadNumber/return", authenticateToken, async (req, res) => {
  try {
    const leadNumber = Number(req.params.leadNumber);
    const userId = Number(req.user?._id ?? req.user?.id);
    const note = String(req.body?.note || "").trim();

    if (!note) {
      return res.status(400).json({ error: "Describe what action you took before returning this lead." });
    }
    if (note.length > 5000) {
      return res.status(400).json({ error: "Note is too long (max 5000 characters)." });
    }

    const pullRes = await mongoose.pool.query(
      `SELECT id FROM cold_lead_pulls
        WHERE lead_number = $1 AND user_id = $2 AND returned_at IS NULL
        ORDER BY pulled_at DESC LIMIT 1`,
      [leadNumber, userId]
    );
    if (pullRes.rowCount === 0) {
      return res.status(404).json({ error: "You don't have an unresolved pull on this lead." });
    }

    const leadRes = await mongoose.pool.query(
      `SELECT company_info FROM leads WHERE lead_number = $1`,
      [leadNumber]
    );
    if (leadRes.rowCount === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }
    if (leadRes.rows[0].company_info?.leadStatus !== COLD_STATUS) {
      return res.status(400).json({
        error: "This lead has already moved off Cold — there's nothing to return.",
      });
    }

    const noteEntry = JSON.stringify([
      { description: note, addedBy: userId, createdAt: new Date().toISOString() },
    ]);

    await mongoose.pool.query(
      `UPDATE leads SET descriptions = descriptions || $1::jsonb WHERE lead_number = $2`,
      [noteEntry, leadNumber]
    );
    await mongoose.pool.query(
      `UPDATE cold_lead_pulls SET returned_at = NOW(), return_note = $1 WHERE id = $2`,
      [note, pullRes.rows[0].id]
    );

    res.json({ success: true });
    broadcastChange("cold-leads", "returned", { leadNumber });
    broadcastChange("leads", "updated", { leadNumber });
  } catch (error) {
    console.error("Error returning cold lead:", error);
    res.status(500).json({ error: "Error returning this lead" });
  }
});

// --- Bulk Import (Admin) ----------------------------------------------------
// Strict template mode: no fuzzy header guessing, no manual mapping. A file
// is only ever accepted if its header row matches the CRM Lead Data Entry
// Template's 58 columns exactly — same count, same headers, same order.
// Anything else is rejected outright, with the exact column-by-column
// mismatch shown, before a single row is even read. Only a file that
// passes this check gets duplicate-tested (/preview) and, on explicit
// confirmation, actually written (/commit).

// Builds the per-company summary the confirmation screen shows, and decides
// which rows are duplicates — both against what's already in the database
// and against each other (two rows in the same file for the same company,
// case/spacing aside, are duplicates of each other even before either one
// is saved).
async function summarizeCompaniesForPreview(leadsData) {
  const seenInBatch = new Map(); // normalized name -> the DB lead number it already matched (or null)
  const companies = [];

  for (const leadData of leadsData) {
    const name = leadData.companyInfo.companyName;
    const normalized = normalizeCompanyName(name);
    let isDuplicateInFile = false;
    let isDuplicateInDb = false;
    let existingLeadNumber = null;

    if (seenInBatch.has(normalized)) {
      isDuplicateInFile = true;
      existingLeadNumber = seenInBatch.get(normalized);
      isDuplicateInDb = existingLeadNumber !== null;
    } else {
      const existing = await findLeadByCompanyName(name);
      isDuplicateInDb = Boolean(existing);
      existingLeadNumber = existing ? existing.lead_number : null;
      seenInBatch.set(normalized, existingLeadNumber);
    }

    let duplicateReason = null;
    if (isDuplicateInFile && isDuplicateInDb) duplicateReason = "already in the database, and repeated in this file";
    else if (isDuplicateInFile) duplicateReason = "repeated within this file — only the first occurrence will be imported";
    else if (isDuplicateInDb) duplicateReason = "already in the database";

    companies.push({
      companyName: name,
      city: leadData.companyInfo.city || "",
      vertical: leadData.companyInfo.vertical || "",
      itName: leadData.contactInfo.it.name || "",
      itMobile: leadData.contactInfo.it.mobile || "",
      itEmail: leadData.contactInfo.it.email || "",
      financeName: leadData.contactInfo.finance.name || "",
      businessHeadName: leadData.contactInfo.businessHead.name || "",
      turnOverINR: leadData.companyInfo.turnOverINR || "",
      missingFields: leadData.companyInfo.importMeta.missingFields,
      isDuplicate: isDuplicateInFile || isDuplicateInDb,
      isDuplicateInFile,
      isDuplicateInDb,
      duplicateReason,
      existingLeadNumber,
    });
  }

  return {
    companies,
    duplicateCount: companies.filter((c) => c.isDuplicate).length,
    inFileDuplicateCount: companies.filter((c) => c.isDuplicateInFile).length,
    dbDuplicateCount: companies.filter((c) => c.isDuplicateInDb).length,
  };
}

// Actually writes the leads. A company repeated within the file is always
// collapsed to its first occurrence — that's not a choice, it's just never
// correct to create the same company twice from one upload. `includeDuplicates`
// only governs the separate case of a row matching something already in the
// database: false (default) skips it, true pushes it anyway, and either way
// it's reported back so it's visible afterward what happened.
async function commitLeads(leadsData, includeDuplicates) {
  const created = [];
  const skippedDuplicates = [];
  const pushedDespiteDuplicate = [];
  const seenInBatch = new Map();

  for (const leadData of leadsData) {
    const name = leadData.companyInfo.companyName;
    const normalized = normalizeCompanyName(name);
    let isDuplicate = seenInBatch.has(normalized);
    let existingLeadNumber = isDuplicate ? seenInBatch.get(normalized) : null;

    if (!isDuplicate) {
      const existing = await findLeadByCompanyName(name);
      if (existing) {
        isDuplicate = true;
        existingLeadNumber = existing.lead_number;
      }
    }

    if (isDuplicate && !includeDuplicates) {
      skippedDuplicates.push({ companyName: name, existingLeadNumber });
      continue;
    }
    if (isDuplicate) {
      pushedDespiteDuplicate.push({ companyName: name, existingLeadNumber });
    }

    const lead = new Lead(leadData);
    const saved = await lead.save();
    created.push(saved.leadNumber);
    if (!seenInBatch.has(normalized)) seenInBatch.set(normalized, saved.leadNumber);
  }

  return { created, skippedDuplicates, pushedDespiteDuplicate };
}

app.post(
  "/api/bulk-import/preview",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const workbook = await readWorkbook(req.file.buffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return res.status(400).json({ error: "That file has no sheets" });
      const rows = sheetToRows(worksheet);

      const headerRowIndex = detectHeaderRowIndex(rows);
      const headers = (rows[headerRowIndex] || []).map((h) => normalizeText(h)).filter(Boolean);
      const { valid, mismatches } = validateAgainstTemplate(headers);

      if (!valid) {
        return res.status(422).json({
          error: "This file's columns don't match the CRM Lead Data Entry Template exactly.",
          templateMismatch: true,
          mismatches,
          expectedColumnCount: TEMPLATE_COLUMNS.length,
          foundColumnCount: headers.length,
        });
      }

      const MAX_ROWS = 5000;
      if (rows.length - headerRowIndex - 1 > MAX_ROWS) {
        return res.status(400).json({ error: `That's more than ${MAX_ROWS} rows — split the file and import in batches.` });
      }

      const { leadsData, skipped } = transformTemplateRows({
        rows,
        headerRowIndex,
        originalFileName: req.file.originalname,
        importedBy: req.user.id,
      });
      const { companies, duplicateCount, inFileDuplicateCount, dbDuplicateCount } =
        await summarizeCompaniesForPreview(leadsData);

      res.json({
        headerRowIndex,
        totalCount: companies.length,
        duplicateCount,
        inFileDuplicateCount,
        dbDuplicateCount,
        skipped,
        companies,
      });
    } catch (error) {
      console.error("Error previewing bulk-import file:", error);
      res.status(400).json({ error: "Could not read that file — is it a valid Excel file?" });
    }
  }
);

// The only route that writes leads. Re-validates the template match itself
// (never trusts that a prior /preview call on the same file is still true —
// the file could have changed) before touching the database at all.
app.post(
  "/api/bulk-import/commit",
  authenticateToken,
  checkRole([ROLES.ADMIN]),
  upload.single("file"),
  async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const includeDuplicates = req.body.includeDuplicates === "true" || req.body.includeDuplicates === true;

      const workbook = await readWorkbook(req.file.buffer);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) return res.status(400).json({ error: "That file has no sheets" });
      const rows = sheetToRows(worksheet);

      const headerRowIndex = detectHeaderRowIndex(rows);
      const headers = (rows[headerRowIndex] || []).map((h) => normalizeText(h)).filter(Boolean);
      const { valid, mismatches } = validateAgainstTemplate(headers);
      if (!valid) {
        return res.status(422).json({
          error: "This file's columns don't match the CRM Lead Data Entry Template exactly.",
          templateMismatch: true,
          mismatches,
        });
      }

      const MAX_ROWS = 5000;
      if (rows.length - headerRowIndex - 1 > MAX_ROWS) {
        return res.status(400).json({ error: `That's more than ${MAX_ROWS} rows — split the file and import in batches.` });
      }

      const { leadsData, skipped } = transformTemplateRows({
        rows,
        headerRowIndex,
        originalFileName: req.file.originalname,
        importedBy: req.user.id,
      });

      const { created, skippedDuplicates, pushedDespiteDuplicate } = await commitLeads(leadsData, includeDuplicates);

      if (created.length) {
        broadcastChange("leads", "created", { count: created.length, bulkImport: true });
        broadcastChange("cold-leads", "pulled", { count: 0 });
      }

      res.json({
        createdCount: created.length,
        leadNumbers: created,
        skipped,
        duplicates: skippedDuplicates,
        pushedDespiteDuplicate,
      });
    } catch (error) {
      console.error("Error committing bulk import:", error);
      res.status(500).json({ error: "Error importing leads from that file" });
    }
  }
);

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
      where = `WHERE r.generated_by IN (${placeholderList(scopeIds)})`;
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

// --- Pipeline funnel report -------------------------------------------------
// Two things sales leadership actually asks for that the Pipeline board alone
// can't answer: "how many leads make it from stage to stage" and "how long do
// they sit in each stage". Both are derived from data already stored — no new
// table. The stage-reached funnel comes from each lead's current stage; the
// dwell times come from the field-level diffs the lead-update audit trail
// already records whenever `pipelineStage` changes.

// Mirrors src/components/Home/pipeline.js exactly, so a lead's stage here
// always agrees with what the Pipeline board shows for the same lead.
const FUNNEL_STAGE_ORDER = ["prospecting", "qualification", "proposal", "negotiation", "won"];
const FUNNEL_STAGE_LABELS = {
  prospecting: "Prospecting",
  qualification: "Qualification",
  proposal: "Proposal",
  negotiation: "Negotiation",
  won: "Closed-Won",
};
const FUNNEL_STAGE_BY_LABEL = {
  prospecting: "prospecting",
  qualification: "qualification",
  proposal: "proposal",
  negotiation: "negotiation",
  "closed-won": "won",
};
const FUNNEL_ACTION_STAGE = {
  "Call Back": "prospecting",
  "Follow-Up": "prospecting",
  "": "prospecting",
  "Online Meeting": "qualification",
  "On-Site Meeting": "qualification",
  "Proposal Submitted": "proposal",
  Negotiation: "negotiation",
};
const FUNNEL_DEAD_STATUSES = new Set(["LOST", "Junk", "Duplicate"]);

// Returns a stage key, or null for a lead that has left the open pipeline
// (won or dead) — dead leads are excluded from the funnel entirely, won ones
// count as having reached every stage.
function funnelStageOf(companyInfo = {}) {
  const status = String(companyInfo.leadStatus || "").trim();
  if (status === "WON") return "won";
  if (FUNNEL_DEAD_STATUSES.has(status)) return null;

  const stored = String(companyInfo.pipelineStage || "").trim().toLowerCase();
  if (FUNNEL_STAGE_BY_LABEL[stored]) return FUNNEL_STAGE_BY_LABEL[stored];

  const action = String(companyInfo.nextAction || "").trim();
  return FUNNEL_ACTION_STAGE[action] || "prospecting";
}

// Groups audit_log's pipelineStage diffs by lead, oldest first — pulled out
// of the route handler below purely to keep that function's own branching
// shallow; the behaviour is unchanged.
function groupStageTransitionsByLead(transitionRows) {
  const transitionsByLead = new Map();
  for (const t of transitionRows) {
    const leadNumber = Number(t.entity_id);
    if (!Number.isFinite(leadNumber)) continue;
    const change = (t.changes || []).find((c) => c.field === "pipelineStage");
    if (!change) continue;
    const list = transitionsByLead.get(leadNumber) || [];
    list.push({
      at: t.created_at,
      from: FUNNEL_STAGE_BY_LABEL[String(change.from || "").trim().toLowerCase()] || null,
      to: FUNNEL_STAGE_BY_LABEL[String(change.to || "").trim().toLowerCase()] || null,
    });
    transitionsByLead.set(leadNumber, list);
  }
  return transitionsByLead;
}

// Days spent in each stage, gathered from every lead that has at least one
// recorded transition or is currently sitting in an open stage — the
// in-progress segment (current stage, up to now) is included too, so early
// data isn't thrown away, just averaged in as still-ongoing time.
function computeDwellDaysByStage(openOrWon, transitionsByLead) {
  const durationDaysByStage = Object.fromEntries(FUNNEL_STAGE_ORDER.map((s) => [s, []]));
  const now = Date.now();

  for (const lead of openOrWon) {
    const transitions = transitionsByLead.get(lead.leadNumber) || [];
    let prevTime = new Date(lead.createdAt).getTime();
    let prevStage = transitions.length > 0 ? transitions[0].from || "prospecting" : lead.stage;

    for (const t of transitions) {
      const at = new Date(t.at).getTime();
      if (durationDaysByStage[prevStage] && at > prevTime) {
        durationDaysByStage[prevStage].push((at - prevTime) / 86400000);
      }
      prevTime = at;
      prevStage = t.to || prevStage;
    }

    // Final, still-open segment up to now.
    if (durationDaysByStage[prevStage] && now > prevTime && prevStage !== "won") {
      durationDaysByStage[prevStage].push((now - prevTime) / 86400000);
    }
  }

  return durationDaysByStage;
}

app.get("/api/reports/pipeline-funnel", authenticateToken, async (req, res) => {
  try {
    // Every signed-in user sees every company on the Pipeline board itself
    // (see GET /api/leads), so the funnel built from the same leads is
    // unscoped too — a partial funnel per person would misstate every rate.
    const leadsRes = await mongoose.pool.query(
      `SELECT lead_number, company_info, created_at FROM leads`
    );

    const rows = leadsRes.rows.map((r) => ({
      leadNumber: r.lead_number,
      createdAt: r.created_at,
      companyInfo: r.company_info || {},
      stage: funnelStageOf(r.company_info || {}),
    }));

    const deadByStatus = { LOST: 0, Junk: 0, Duplicate: 0 };
    rows.forEach((r) => {
      if (r.stage === null) {
        const status = String(r.companyInfo.leadStatus || "").trim();
        if (deadByStatus[status] !== undefined) deadByStatus[status] += 1;
      }
    });

    const openOrWon = rows.filter((r) => r.stage !== null);
    const rankOf = (stage) => FUNNEL_STAGE_ORDER.indexOf(stage);

    const funnel = FUNNEL_STAGE_ORDER.map((stage, i) => {
      const count = openOrWon.filter((r) => rankOf(r.stage) >= i).length;
      return { stage, label: FUNNEL_STAGE_LABELS[stage], count };
    });
    for (let i = 0; i < funnel.length; i++) {
      funnel[i].conversionFromPrev =
        i === 0 || funnel[i - 1].count === 0
          ? null
          : Math.round((funnel[i].count / funnel[i - 1].count) * 1000) / 10;
    }

    // Every recorded pipelineStage transition, oldest first, per lead — the
    // raw material for "how long did a lead actually sit in each stage".
    const transitionsRes = await mongoose.pool.query(
      `SELECT entity_id, changes, created_at
         FROM audit_log
        WHERE entity = 'lead'
          AND changes @> '[{"field":"pipelineStage"}]'::jsonb
        ORDER BY entity_id, created_at ASC`
    );

    const transitionsByLead = groupStageTransitionsByLead(transitionsRes.rows);
    const durationDaysByStage = computeDwellDaysByStage(openOrWon, transitionsByLead);

    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10 : null);
    funnel.forEach((f) => {
      f.avgDaysInStage = avg(durationDaysByStage[f.stage]);
      f.dwellSamples = durationDaysByStage[f.stage].length;
    });

    res.json({
      funnel,
      dead: {
        total: Object.values(deadByStatus).reduce((a, b) => a + b, 0),
        byStatus: deadByStatus,
      },
      totalLeads: rows.length,
    });
  } catch (error) {
    console.error("Error building pipeline funnel report:", error);
    res.status(500).json({ error: "Error building pipeline funnel report" });
  }
});

// --- Cold Lead Pool report ---------------------------------------------------
// Admin/Manager visibility into who is actually working the Cold pool: how
// many they've pulled in total, how many they turned Hot/Warm, how many are
// still sitting unresolved, when they last pulled, and — per user — the full
// list of leads they've ever pulled with the note they left on each one.
app.get(
  "/api/reports/cold-leads",
  authenticateToken,
  checkRole([ROLES.ADMIN, ROLES.MANAGER]),
  async (req, res) => {
    try {
      const scopeIds = await visibleUserIds(req.user);
      const scoped = scopeIds !== null;
      if (scoped && scopeIds.length === 0) {
        return res.json({ users: [], detail: null });
      }

      const idParams = scoped ? scopeIds : [];
      const idList = scoped ? `(${placeholderList(scopeIds)})` : null;
      const userFilter = scoped ? `WHERE u.id IN ${idList}` : "";

      const users = await mongoose.pool.query(
        `SELECT u.id, u.first_name, u.last_name, u.role, u.designation
           FROM users u
           ${userFilter}
          ORDER BY u.first_name, u.last_name`,
        idParams
      );

      // One row per pull, joined to the lead's current status so a pull can be
      // classified the same way My Leads classifies it — hot / warm / returned
      // (still Cold, sent back with a note) / pending (still out, no note yet).
      const pulls = await mongoose.pool.query(
        `SELECT p.id, p.user_id, p.lead_number, p.pulled_at, p.returned_at,
                p.return_note, p.batch_id, l.company_info->>'companyName' AS company_name,
                l.company_info->>'leadStatus' AS lead_status
           FROM cold_lead_pulls p
           JOIN leads l ON l.lead_number = p.lead_number
          ${scoped ? `WHERE p.user_id IN ${idList}` : ""}
          ORDER BY p.pulled_at DESC`,
        idParams
      );

      const byUser = new Map();
      pulls.rows.forEach((r) => {
        const uid = Number(r.user_id);
        const list = byUser.get(uid) || [];
        list.push(r);
        byUser.set(uid, list);
      });

      const classify = (row) => {
        if (row.lead_status === "Hot (0–3 months)") return "hot";
        if (row.lead_status === "Warm (3–9 months)") return "warm";
        if (row.returned_at) return "returnedCold";
        return "pendingNoNote";
      };

      const summary = users.rows.map((u) => {
        const rows = byUser.get(u.id) || [];
        const counts = { hot: 0, warm: 0, returnedCold: 0, pendingNoNote: 0 };
        rows.forEach((r) => {
          counts[classify(r)] += 1;
        });

        // "Last pull" means the most recent pull *action* — a whole batch, up
        // to 100 leads at once — not the single most recent lead row. A few
        // historical rows predate batching and carry no batch_id; they're
        // skipped here (same rule /api/cold-leads/my-leads uses for "current
        // batch") so they never get counted as a one-lead "pull".
        const batched = rows.filter((r) => r.batch_id);
        const lastBatchId = batched[0]?.batch_id || null;
        const lastBatchRows = lastBatchId
          ? batched.filter((r) => r.batch_id === lastBatchId)
          : [];
        const lastPullAt = lastBatchRows.length
          ? lastBatchRows.reduce(
              (max, r) => (new Date(r.pulled_at) > new Date(max) ? r.pulled_at : max),
              lastBatchRows[0].pulled_at
            )
          : null;

        return {
          id: u.id,
          name: [u.first_name, u.last_name].filter(Boolean).join(" "),
          role: u.role,
          designation: u.designation,
          totalPulled: rows.length,
          turnedHot: counts.hot,
          turnedWarm: counts.warm,
          returnedCold: counts.returnedCold,
          pendingNoNote: counts.pendingNoNote,
          lastPullAt,
          // How many leads came in that last pull action — this is the number
          // that actually answers "how many did they pull last time", not a
          // single company name that would be meaningless for a 100-lead batch.
          lastPullCount: lastBatchRows.length,
        };
      });

      // Optional drill-down: every pull a single user has ever made, most
      // recent first, with the note they left (if any) and what the lead is
      // now — the "what all have they done on this lead" view.
      const wanted = req.query.userId ? Number(req.query.userId) : null;
      let detail = null;

      if (wanted && !Number.isNaN(wanted)) {
        if (scoped && !scopeIds.includes(wanted)) {
          return res.status(403).json({ error: "Forbidden" });
        }
        const rows = byUser.get(wanted) || [];
        detail = {
          userId: wanted,
          pulls: rows.map((r) => ({
            pullId: r.id,
            leadNumber: r.lead_number,
            companyName: r.company_name,
            leadStatus: r.lead_status,
            batchId: r.batch_id,
            pulledAt: r.pulled_at,
            returnedAt: r.returned_at,
            returnNote: r.return_note,
            state: classify(r),
          })),
        };
      }

      res.json({ users: summary, detail });
    } catch (error) {
      console.error("Error building Cold Lead Pool report:", error);
      res.status(500).json({ error: "Error building Cold Lead Pool report" });
    }
  }
);

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
      const idList = scoped ? `(${placeholderList(scopeIds)})` : null;
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
      `attachment; filename="${report.file_name.replaceAll('"', "")}"`
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
    // A to-do is private between whoever it belongs to and whoever assigned
    // it — not visible to a manager's whole team or to every Admin, unlike
    // leads and most other records. Task.find() only filters by user_id, so
    // the owner-or-assigner check is applied here instead of in the query.
    const callerId = Number(req.user?._id ?? req.user?.id);
    const allTasks = await Task.find({});

    // The one deliberate exception: an Admin looking at the Home dashboard's
    // "view someone's work" dropdown may ask for a specific person's own
    // to-do list (their assigned tasks). Still not the same as the general
    // hierarchy visibility used elsewhere — a non-Admin passing this is
    // simply ignored and falls back to their own tasks as usual.
    const viewUserId = Number(req.query.userId);
    const isAdmin = normalizeRole(req.user?.role) === ROLES.ADMIN;
    const tasks =
      isAdmin && Number.isFinite(viewUserId)
        ? (allTasks || []).filter((t) => Number(t.userId) === viewUserId)
        : (allTasks || []).filter(
            (t) => Number(t.userId) === callerId || Number(t.assignedBy) === callerId
          );

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
    if (!Number.isNaN(Number(taskId))) {
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
    if (assignedUser?.status !== "active") {
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
          "Only the person who created this lead, their manager, whoever " +
          "it's assigned to, or an Admin can edit it.",
      });
    }

    // Record which fields actually changed. The audit log otherwise says only
    // that a lead was updated, and "who moved this to LOST" is the question
    // people actually ask.
    const before = structuredClone(lead.companyInfo || {});

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
          "Only the person who created this lead, their manager, whoever " +
          "it's assigned to, or an Admin can add notes to it.",
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
    // Missing before: the Activity panel, Cold Lead Pool tooltip/report, and
    // Pipeline funnel all read the lead's own note history, but nothing told
    // any other open screen a note had just landed — they'd only pick it up
    // on their next unrelated refresh.
    broadcastChange("leads", "note_added", { leadNumber: lead.leadNumber });
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
  // multer's own oversized-file error — without this it fell through to
  // Express's default HTML error page instead of the JSON error shape every
  // other route already returns.
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      success: false,
      message: "File is too large. Maximum attachment size is 10MB.",
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
    console.error("Error listing admin users:", error);
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
    delete savedUser?.password;

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

// Every Manager's first name, for the BDM field on the lead form. This is a
// label, not an access grant, so it is deliberately NOT scoped by
// visibleUserIds like /api/users is: an Executive's own Manager sits above
// them in the reporting tree and would otherwise never appear in their own
// downward-only view, leaving the BDM dropdown empty for every Executive.
app.get("/api/bdms", authenticateToken, async (req, res) => {
  try {
    const managers = await User.find(
      { role: ROLES.MANAGER, status: "active" },
      { firstName: 1, lastName: 1 }
    );
    res.json((managers || []).map((u) => u.firstName));
  } catch (error) {
    console.error("Error fetching BDM list:", error);
    res.status(500).json({ error: "Error fetching BDM list" });
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

    // An Admin account's role can never be changed — by another Admin, or by
    // itself. rejectSuperAdminChanges above only stops a lower tier from
    // touching an Admin; it does nothing when the actor is already an Admin,
    // which is exactly how an Admin can accidentally demote themselves (or
    // another Admin) with no way back in except direct database access. The
    // account can still be deactivated if it needs to lose access.
    if (
      isSuperAdmin(target.role) &&
      req.body.role !== undefined &&
      normalizeRole(req.body.role) !== ROLES.ADMIN
    ) {
      return res.status(403).json({
        error:
          "An Admin account's role cannot be changed. Deactivate the account instead if it should lose access.",
      });
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
    console.error("Error fetching team overview:", error);
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
      readBy: asArray(r.read_by)
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

    if (!recipientId || !content?.trim()) {
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
      const members = asArray(g.members);
      return g.created_by === currentUserId || members.map(Number).includes(currentUserId);
    }).map(g => ({
      id: g.id,
      name: g.name,
      description: g.description,
      createdBy: g.created_by,
      creatorName: `${g.creator_first_name} ${g.creator_last_name}`.trim(),
      members: asArray(g.members),
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

    if (!name?.trim()) {
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
      readBy: asArray(r.read_by)
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

    if (!groupId || !content?.trim()) {
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
      readBy: asArray(r.read_by)
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

    if (!content?.trim()) {
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
        const members = asArray(g.members);
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
      if (mongoose.pool?.end) await mongoose.pool.end();
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

