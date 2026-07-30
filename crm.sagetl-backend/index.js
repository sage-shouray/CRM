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

const { authenticateToken, checkRole, checkUserStatus } = require("./Middleware/auth");
const {
  ROLES,
  ALL_ROLES,
  normalizeRole,
  isSuperAdmin,
} = require("./Middleware/roles");
const { getDescendantUserIds } = require("./Models/db");
const { validate, createUserSchema, updateUserSchema, taskSchema } = require("./Middleware/validation");
const AuthRouter = require("./Routes/AuthRouter");
const OptionsRouter = require("./Routes/OptionsRouter");
const { scheduleNotifications } = require('./Models/emailNotification');


// Add this after your other app configurations
scheduleNotifications();


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

const corsOrigin = (origin, callback) => {
  // Allow non-browser clients (no Origin header) and any whitelisted origin.
  if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
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
app.use(helmet({ crossOriginResourcePolicy: false }));

// CORS configuration
const corsOptions = {
  origin: corsOrigin,
  methods: "GET,POST,PUT,DELETE",
  allowedHeaders: "Content-Type,Authorization",
};
app.use(cors(corsOptions));

// Body-parser configuration
app.use(bodyParser.json({ limit: "50mb" }));
app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }));

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

// Route handlers
app.use("/auth", authLimiter, AuthRouter);
app.use("/api/options", OptionsRouter);

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
  if (isSuperAdmin(user?.role)) return null;
  return await getDescendantUserIds(Number(user?.id));
}

// Whether a user may view/edit a given lead. Uses exactly the same scope as
// the lead list, so a record can never be reachable by id but hidden in lists.
async function userCanAccessLead(user, lead) {
  const ids = await visibleUserIds(user);
  if (ids === null) return true;

  // createdBy may be populated to an object or be a raw id.
  const creatorId = Number(lead.createdBy?._id ?? lead.createdBy);
  const assignedRaw = lead.companyInfo?.leadAssignedTo;
  const assignedId = Number(assignedRaw?._id ?? assignedRaw);

  return ids.includes(creatorId) || ids.includes(assignedId);
}

// Lead query restricted to the caller's scope ({} when unrestricted).
function leadScopeQuery(ids) {
  if (ids === null) return {};
  const idsStr = ids.map(String);
  return {
    $or: [
      { createdBy: { $in: ids } },
      { "companyInfo.leadAssignedTo": { $in: idsStr } },
      { "companyInfo.leadAssignedTo": { $in: ids } },
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
        leadAssignedTo: parsedData.company?.leadAssignedTo ? Number(parsedData.company.leadAssignedTo) : null,
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
    const userIdStr = String(userId);

    const leads = await Lead.find({
      $or: [
        { "companyInfo.leadAssignedTo": userIdStr },
        { "companyInfo.leadAssignedTo": userId }
      ]
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
      const query = leadScopeQuery(await visibleUserIds(req.user));

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
        query["itLandscape.SAPInstalledBase.contractExpiry"] = contractExpiry;
      if (supportPartner)
        query["itLandscape.SAPInstalledBase.supportPartner"] = {
          $regex: supportPartner,
          $options: "i",
        };
      if (turnOver)
        query["companyInfo.turnOverINR"] = { $regex: turnOver, $options: "i" };
      if (leadType)
        query["companyInfo.leadType"] = { $regex: leadType, $options: "i" };
      if (team) query["companyInfo.leadAssignedTo"] = String(team);

      if (allLeads === "createdByMe") {
        query.createdBy = userId;
      } else if (allLeads === "assignedToMe") {
        query["companyInfo.leadAssignedTo"] = String(userId);
      }

      const leads = await Lead.find(query)
        .populate("companyInfo.leadAssignedTo", "firstName lastName")
        .populate("createdBy", "firstName lastName")
        .sort({ createdAt: -1 });

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

// GET all tasks for logged-in user (or subordinates if supervisor/admin)
app.get("/api/tasks", authenticateToken, async (req, res) => {
  try {
    const ids = await visibleUserIds(req.user);
    const query = ids === null ? {} : { user_id: { $in: ids } };

    const tasks = await Task.find(query);
    res.json(tasks);
  } catch (error) {
    console.error("Error fetching tasks:", error);
    res.status(500).json({ error: "Error fetching tasks" });
  }
});

// POST a new task
app.post("/api/tasks", authenticateToken, validate(taskSchema), async (req, res) => {
  try {
    const rawUserId = req.user?._id || req.user?.id;
    const userId = Number(rawUserId);
    const { taskId, title, associatedLead, description, originalDueDate, dueDate, priority, category, status } = req.body;

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
      userId
    });

    res.status(201).json(newTask);
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
  } catch (error) {
    console.error("Error updating task:", error);
    res.status(500).json({ error: "Error updating task" });
  }
});

app.put("/api/leads/assign-bulk", authenticateToken, async (req, res) => {
  const { leadIds, assignedUserId } = req.body;

  try {
    // Validate `assignedUserId`
    if (!mongoose.Types.ObjectId.isValid(assignedUserId)) {
      return res.status(400).json({ error: "Invalid assigned user ID." });
    }

    const assignedUser = await User.findById(assignedUserId);
    if (!assignedUser || assignedUser.status !== "active") {
      return res.status(400).json({ error: "Assigned user must be active." });
    }

    // Update the leads
    await Lead.updateMany(
      { _id: { $in: leadIds } },
      { "companyInfo.leadAssignedTo": assignedUserId }
    );

    res.status(200).json({ message: "Leads assigned successfully." });
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
    if (!(await userCanAccessLead(req.user, lead))) {
      return res.status(403).json({ error: "Forbidden" });
    }
    res.json(lead);
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
    if (!(await userCanAccessLead(req.user, lead))) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Update `companyInfo`, `contactInfo`, `itLandscape`, and `descriptions` if present in request
    if (req.body.companyInfo) {
      Object.assign(lead.companyInfo, req.body.companyInfo);
      // The client may echo back a populated user object; store the id only.
      const assigned = lead.companyInfo.leadAssignedTo;
      if (assigned && typeof assigned === "object") {
        lead.companyInfo.leadAssignedTo = assigned._id ?? assigned.id ?? null;
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

    // Return the record the way GET returns it, so the client can render author
    // names instead of bare ids straight after a save.
    await lead.populate("descriptions.addedBy", "firstName");
    res.json(lead);
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
    if (!(await userCanAccessLead(req.user, lead))) {
      return res.status(403).json({ error: "Forbidden" });
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
  !isSuperAdmin(actorRole) && normalizeRole(targetRole) === ROLES.SUPER_ADMIN;

app.get("/api/admin/users", authenticateToken, checkRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]), async (req, res) => {
  try {
    const users = await User.find({}, "-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/api/users", authenticateToken, checkRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]), validate(createUserSchema), async (req, res) => {
  try {
    if (rejectSuperAdminChanges(req.user.role, req.body.role)) {
      return res
        .status(403)
        .json({ error: "Only a Super Admin can create a Super Admin." });
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
  } catch (error) {
    console.error("Error creating user:", error);
    if (error.code === 11000) {
      // Handle duplicate key error
      res.status(400).json({
        error: "Duplicate key error",
      });
    } else {
      res.status(500).json({ error: "Internal server error" });
    }
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

    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user data",
    });
  }
});

app.put("/api/users/:userId", authenticateToken, checkRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]), validate(updateUserSchema), async (req, res) => {
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
    if (user.password) delete user.password;
    res.json(user);
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Error updating user" });
  }
});

app.get("/api/users/supervisors", authenticateToken, async (req, res) => {
  try {
    // Anyone who can have people reporting to them: every tier above the
    // bottom one. A Business Lead is never somebody else's manager.
    const supervisors = await User.find(
      { role: { $in: [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.BDM] } },
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
    const user = await User.findById(req.params.userId, {
      firstName: 1,
      lastName: 1,
      designation: 1,
      email: 1,
      mobile: 1,
      role: 1,
      supervisor: 1,
      status: 1,
    }).populate("supervisor", "firstName lastName"); // Populating supervisor's details if available

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
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

    if (role === ROLES.SUPER_ADMIN) {
      users = await User.find({}, "firstName lastName email role").populate(
        "supervisor",
        "firstName lastName"
      );
    } else if (role === ROLES.ADMIN || role === ROLES.BDM) {
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
    if (role === ROLES.BUSINESS_LEAD) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const scopeIds = await visibleUserIds(req.user);

    // Users in scope who can no longer work their leads.
    const inactiveQuery = { status: "inactive" };
    if (scopeIds !== null) inactiveQuery._id = { $in: scopeIds };
    const inactiveUsers = await User.find(inactiveQuery, "_id");
    const inactiveUserIds = inactiveUsers
      .map((u) => Number(u._id || u.id))
      .filter((n) => !Number.isNaN(n));

    // A lead needs reassigning when it is assigned to nobody, or assigned to
    // somebody deactivated. Unassigned leads carry no assignee to scope on, so
    // they are matched through their creator instead.
    const conditions = [];
    if (inactiveUserIds.length > 0) {
      conditions.push({
        "companyInfo.leadAssignedTo": { $in: inactiveUserIds.map(String) },
      });
      conditions.push({ "companyInfo.leadAssignedTo": { $in: inactiveUserIds } });
    }
    if (scopeIds === null) {
      conditions.push({ "companyInfo.leadAssignedTo": null });
    } else {
      conditions.push({
        createdBy: { $in: scopeIds },
        "companyInfo.leadAssignedTo": null,
      });
    }

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
        { "companyInfo.leadAssignedTo": newAssignedUserId },
        { new: true }
      );

      if (!updatedLead) {
        return res.status(404).json({ error: "Lead not found." });
      }

      res.json(updatedLead);
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
      senderRole: sender ? sender.role : ROLES.BUSINESS_LEAD,
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
app.post("/api/chat/messages/global", authenticateToken, checkRole([ROLES.SUPER_ADMIN, ROLES.ADMIN]), async (req, res) => {
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

