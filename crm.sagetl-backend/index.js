const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const multer = require("multer");
const mongoose = require("./Models/db");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

const Lead = require("./Models/createLeads");
const User = require("./Models/User");

const AuthRouter = require("./Routes/AuthRouter");
const OptionsRouter = require("./Routes/OptionsRouter");
const { scheduleNotifications } = require('./Models/emailNotification');


// Add this after your other app configurations
scheduleNotifications();


require("dotenv").config();
require("./Models/db");

const app = express();

// CORS configuration
const corsOptions = {
  origin: "*",
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

// Route handlers
app.use("/auth", AuthRouter);
app.use("/api/options", OptionsRouter);

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  // console.log("Authorization Header:", authHeader);

  if (!token) return res.status(401).send("Token missing");

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      console.error("Token verification error:", err);
      return res.status(403).send("Token invalid");
    }
    // console.log("Decoded User:", user);
    req.user = user;
    if (req.user) {
      if (req.user._id && !req.user.id) req.user.id = req.user._id;
      if (req.user.id && !req.user._id) req.user._id = req.user.id;
    }
    next();
  });
};


const checkRole = (roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (roles.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ error: "Forbidden" });
  }
};

const checkUserStatus = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.status === "inactive") {
      return res
        .status(403)
        .json({ message: "Access denied. User is inactive." });
    }
    next();
  } catch (error) {
    res.status(500).json({ message: "Error checking user status", error });
  }
};

// POST lead data with file upload
app.post("/api/leads", upload.single("file"), async (req, res) => {
  try {
    const parsedData = JSON.parse(req.body.data);

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
    res.status(500).json({
      success: false,
      error: "Error creating lead",
      details: error.message,
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
      details: error.message,
    });
  }
});

app.get(
  "/api/leads",
  authenticateToken,
  checkRole(["subuser", "supervisor", "admin"]),
  async (req, res) => {
    try {
      const rawUserId = req.user?._id || req.user?.id;
      const userRole = (req.user?.role || "").toLowerCase();

      if (!rawUserId || !userRole) {
        return res.status(400).json({ error: "Invalid user data" });
      }

      const userId = Number(rawUserId);
      let query = {};

      if (userRole === "admin") {
        // Super Admin has full company-wide access to view all leads
        query = {};
      } else if (userRole === "supervisor") {
        // Supervisor sees their own leads + all leads of subusers assigned to them
        const subusers = await User.find({ supervisor: userId });
        const subuserIds = subusers.map((user) => Number(user._id || user.id)).filter(id => !isNaN(id));
        const allowedUserIds = [userId, ...subuserIds];
        const allowedUserIdsStr = allowedUserIds.map(String);

        query = {
          $or: [
            { createdBy: { $in: allowedUserIds } },
            { "companyInfo.leadAssignedTo": { $in: allowedUserIdsStr } },
            { "companyInfo.leadAssignedTo": { $in: allowedUserIds } }
          ],
        };
      } else {
        // Subuser sees ONLY leads created by them OR assigned to them
        const userIdStr = String(userId);
        query = {
          $or: [
            { createdBy: userId },
            { "companyInfo.leadAssignedTo": userIdStr },
            { "companyInfo.leadAssignedTo": userId }
          ],
        };
      }

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
        details: error.message,
      });
    }
  }
);

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
      .json({ error: "Error assigning leads", details: error.message });
  }
});


// GET lead by lead number
app.get("/api/leads/:leadNumber", async (req, res) => {
  try {
    const lead = await Lead.findOne({ leadNumber: req.params.leadNumber })
      .populate("descriptions.addedBy", "firstName")
      .populate("createdBy", "firstName");
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }
    res.json(lead);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/leads/:leadNumber", async (req, res) => {
  try {
    const lead = await Lead.findOne({ leadNumber: req.params.leadNumber });
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    // Update `companyInfo`, `contactInfo`, `itLandscape`, and `descriptions` if present in request
    if (req.body.companyInfo) {
      Object.assign(lead.companyInfo, req.body.companyInfo);
    }
    if (req.body.contactInfo) {
      Object.assign(lead.contactInfo, req.body.contactInfo);
    }
    if (req.body.itLandscape) {
      Object.assign(lead.itLandscape, req.body.itLandscape);
    }
    if (req.body.descriptions) {
      lead.descriptions = req.body.descriptions;
    }

    // Save updated lead to the database
    await lead.save();
    res.json(lead);
  } catch (error) {
    console.error("Error updating lead:", error);
    res.status(400).json({ error: error.message });
  }
});


// POST new description for a lead
app.post("/api/leads/:leadNumber/descriptions", async (req, res) => {
  try {
    const { leadNumber } = req.params;
    const { description, userId } = req.body;

    if (!description || !userId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const lead = await Lead.findOne({ leadNumber });
    if (!lead) {
      return res.status(404).json({ error: "Lead not found" });
    }

    lead.descriptions.push({
      description,
      addedBy: userId,
      // Include other fields as necessary
    });

    await lead.save();

    // Populate the user information
    await lead.populate("descriptions.addedBy", "firstName");

    res.json(lead);
  } catch (error) {
    console.error("Error in add description route:", error);
    res.status(500).json({ error: "Server error", details: error.message });
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

app.get("/api/admin/users", checkRole(["admin"]), async (req, res) => {
  try {
    const users = await User.find({}, "-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/users", async (req, res) => {
  try {
    console.log("Request Body:", req.body);

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
      console.log("Missing required fields");
      return res.status(400).json({ error: "Missing required fields" });
    }

    console.log("Hashing password...");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    console.log("Hashed Password:", hashedPassword);

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

    console.log("User to be saved:", newUser);

    const savedUser = await newUser.save();

    console.log("User saved successfully:", savedUser);

    res.status(201).json(savedUser);
  } catch (error) {
    console.error("Error creating user:", error);
    if (error.code === 11000) {
      // Handle duplicate key error
      res.status(400).json({
        error: "Duplicate key error",
        details: error.message,
      });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get("/api/users", async (req, res) => {
  try {
    const { name, supervisor, role, designation, status } = req.query;

    // Log the incoming query parameters for debugging
    console.log("Received filters:", {
      name,
      supervisor,
      role,
      designation,
      status,
    });

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

    console.log("MongoDB query:", query);

    const users = await User.find(query, {
      firstName: 1,
      lastName: 1,
      email: 1,
      role: 1,
      status: 1,
    }).populate("supervisor", "firstName lastName");

    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({
      success: false,
      error: "Error fetching user data",
      details: error.message,
    });
  }
});

app.put("/api/users/:userId", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.userId, req.body, {
      new: true,
    });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/users/supervisors", async (req, res) => {
  try {
    // Fetch users with role as either 'supervisor' or 'admin'
    const supervisors = await User.find(
      { role: { $in: ["supervisor", "admin"] } }, // Correctly filtering by role
      { firstName: 1, lastName: 1, _id: 1 } // Returning only necessary fields
    );
    res.json(supervisors);
  } catch (error) {
    console.error("Error fetching supervisors:", error);
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/users/:userId", async (req, res) => {
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
      details: error.message,
    });
  }
});

app.get("/api/team-overview", authenticateToken, async (req, res) => {
  try {
    const userRole = req.user.role;
    let users;

    if (userRole === "admin") {
      users = await User.find({}, "firstName lastName email role").populate(
        "supervisor",
        "firstName lastName"
      );
    } else if (userRole === "supervisor") {
      users = await User.find(
        { supervisor: req.user._id },
        "firstName lastName email role"
      );
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    // Make sure you send a valid JSON response
    res.json({ users });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Error fetching team data", details: error.message });
  }
});

app.get("/api/users/:userId/leads", authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;

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
    const userId = req.user._id;
    const userRole = req.user.role;

    if (userRole === "admin") {
      const inactiveUsers = await User.find({ status: "inactive" }, "_id");
      const inactiveUserIds = inactiveUsers.map((user) => user._id);
   
      const leads = await Lead.find({
        $or: [
          { "companyInfo.leadAssignedTo": { $in: inactiveUserIds } },
          { "companyInfo.leadAssignedTo": null },
          
       

        ],
      })
        .populate("companyInfo.leadAssignedTo", "firstName lastName")
        .populate("createdBy", "firstName lastName");

      return res.json(leads);
    } else if (userRole === "supervisor") {
      const inactiveSubordinates = await User.find(
        {
          supervisor: userId,
          status: "inactive",
        },
        "_id"
      );
      const inactiveUserIds = inactiveSubordinates.map((user) => user._id);
   const allSubusers = await User.find({ supervisor: userId }, "_id status");
   const activeUserIds = allSubusers
     .filter((user) => user.status === "active")
     .map((user) => user._id);

      const leads = await Lead.find({
        $or: [
          { createdBy: userId, "companyInfo.leadAssignedTo": null },
          { "companyInfo.leadAssignedTo": { $in: inactiveUserIds } },
          {
            createdBy: { $in: inactiveUserIds },
            "companyInfo.leadAssignedTo": null,
          },
          {
            createdBy: { $in: activeUserIds },
            "companyInfo.leadAssignedTo": null,
          },
        ],
      })
        .populate("companyInfo.leadAssignedTo", "firstName lastName")
        .populate("createdBy", "firstName lastName");

      return res.json(leads);
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }
  } catch (error) {
    console.error("Error fetching unassigned leads:", error);
    res
      .status(500)
      .json({
        error: "Error fetching unassigned leads",
        details: error.message,
      });
  }
});


// Fetch all active users
app.get("/api/active-users", authenticateToken, async (req, res) => {
  try {
    const query = { status: "active" };
    if (req.user.role === "supervisor") {
      query.supervisor = req.user._id;
    }
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
        .json({ error: "Error assigning lead", details: error.message });
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
      createdAt: r.created_at
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
      createdAt: result.rows[0].created_at
    };

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
      createdAt: r.created_at
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
      senderRole: sender ? sender.role : "subuser",
      groupId: Number(groupId),
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at
    };

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
      createdAt: r.created_at
    }));

    res.json(messages);
  } catch (error) {
    console.error("Error fetching global messages:", error);
    res.status(500).json({ error: "Failed to fetch global messages" });
  }
});

// Broadcast global announcement (Admin only)
app.post("/api/chat/messages/global", authenticateToken, checkRole(["admin"]), async (req, res) => {
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
      senderRole: "admin",
      isGlobal: true,
      content: result.rows[0].content,
      createdAt: result.rows[0].created_at
    };

    res.status(201).json(newMsg);
  } catch (error) {
    console.error("Error posting global announcement:", error);
    res.status(500).json({ error: "Failed to post global announcement" });
  }
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
