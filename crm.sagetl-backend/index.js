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
        leadType: parsedData.company.leadType,
        genericEmail1: parsedData.company.genericEmail1,
        vertical: parsedData.company.vertical,
        companyName: parsedData.company.companyName,
        genericEmail2: parsedData.company.genericEmail2,
        leadAssignedTo: parsedData.company.leadAssignedTo,
        website: parsedData.company.website,
        genericPhone1: parsedData.company.genericPhone1,
        bdm: parsedData.company.bdm,
        address: parsedData.company.address,
        genericPhone2: parsedData.company.genericPhone2,
        leadStatus: parsedData.company.leadStatus,
        city: parsedData.company.city,
        leadSource: parsedData.company.leadSource,
        priority: parsedData.company.priority,
        state: parsedData.company.state,
        totalNoOfOffices: Number(parsedData.company.totalNoOfOffices),
        nextAction: parsedData.company.nextAction,
        country: parsedData.company.country,
        turnOverINR: parsedData.company.turnOverINR,
        leadUsable: parsedData.company.leadUsable,
        employeeCount: parsedData.company.employeeCount,
        totalNoOfManufUnits: Number(parsedData.company.totalNoOfManufUnits),
        reason: parsedData.company.reason,
        aboutTheCompany: parsedData.company.aboutTheCompany,
        dateField: parsedData.company.dateField,
      },
      contactInfo: {
        it: {
          name: parsedData.contact.itName,
          dlExt: parsedData.contact.itDlExt,
          designation: parsedData.contact.itDesignation,
          mobile: parsedData.contact.itMobile,
          email: parsedData.contact.itEmail,
          personalEmail: parsedData.contact.itPersonalEmail,
        },
        finance: {
          name: parsedData.contact.financeName,
          dlExt: parsedData.contact.financeDlExt,
          designation: parsedData.contact.financeDesignation,
          mobile: parsedData.contact.financeMobile,
          email: parsedData.contact.financeEmail,
          personalEmail: parsedData.contact.financePersonalEmail,
        },
        businessHead: {
          name: parsedData.contact.businessHeadName,
          dlExt: parsedData.contact.businessHeadDlExt,
          designation: parsedData.contact.businessHeadDesignation,
          mobile: parsedData.contact.businessHeadMobile,
          email: parsedData.contact.businessHeadEmail,
          personalEmail: parsedData.contact.businessHeadPersonalEmail,
        },
      },
      itLandscape: {
        netNew: parsedData.itLandscape.netNew,
        SAPInstalledBase: parsedData.itLandscape.SAPInstalledBase,
      },
      descriptions: [
        {
          description: parsedData.description,
          selectedOption: parsedData.selectedOption,
          radioValue: parsedData.radioValue,
          addedBy: new mongoose.Types.ObjectId(parsedData.createdBy),
        },
      ],
      createdBy: new mongoose.Types.ObjectId(parsedData.createdBy),
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


// Helper function to safely convert string to ObjectId
const safeObjectId = (id) => {
  try {
    return mongoose.Types.ObjectId(id);
  } catch (error) {
    console.warn(`Invalid ObjectId: ${id}`);
    return id; // Return the original string if conversion fails
  }
};
app.get("/api/assigned-leads", authenticateToken, async (req, res) => {
   console.log("Route hit: /api/assigned-leads");
  try {
    const userId = req.user._id; // The logged-in user's ID
console.log("User ID:", userId);
    // Query to fetch leads assigned to the logged-in user
    const leads = await Lead.find({
      "companyInfo.leadAssignedTo": userId,
    })
      .populate("companyInfo.leadAssignedTo", "firstName lastName") // Optional, if you want to include assigned user's name
      .populate("createdBy", "firstName lastName") // Optional, for creator details
      .sort({ createdAt: -1 });
console.log("Leads fetched:", leads);
    if (!leads || leads.length === 0) {
      return res
        .status(200)
        .json({ message: "No leads assigned to you.", leads: [] });
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
      const userId = req.user?._id; // The user ID from the authenticated user
      const userRole = req.user?.role; // The role of the authenticated user

      // Check if userId and userRole are valid
      if (!userId || !userRole) {
        return res.status(400).json({ error: "Invalid user data" });
      }

      // Initialize the query object based on role-based filtering
      let query = {};

      if (userRole === "admin") {
        // Admin can see all leads, no need to modify the query
      } else {
        let userIds = [new mongoose.Types.ObjectId(userId)]; // Include current user

        if (userRole === "supervisor") {
          // Find subusers if the user is a supervisor
          const subusers = await User.find({
            supervisor: userId,
            role: "subuser",
          }).select("_id");

          if (subusers.length > 0) {
            const subuserIds = subusers.map(
              (user) => new mongoose.Types.ObjectId(user._id)
            );
            userIds = [...userIds, ...subuserIds]; // Include subuser IDs in the array
          }
        }

        // Role-based query for created or assigned leads
        query = {
          $or: [
            { createdBy: { $in: userIds } },
            { "companyInfo.leadAssignedTo": { $in: userIds } },
          ],
        };
      }

      // Extract filter parameters from the request query
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

      // Add additional filters to the query object
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
      if (team) query["companyInfo.leadAssignedTo"] = team;

      // Filter leads created or assigned based on allLeads option
      if (allLeads === "createdByMe") {
        query.createdBy = userId;
      } else if (allLeads === "assignedToMe") {
        query["companyInfo.leadAssignedTo"] = userId;
      }

      // Fetch leads based on the constructed query
      const leads = await Lead.find(query)
        .populate("companyInfo.leadAssignedTo", "firstName lastName")
        .populate("createdBy", "firstName lastName")
        .sort({ createdAt: -1 })
        .limit(userRole === "admin" ? 0 : 10); // Limit results for non-admins

      // Return the fetched leads
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



// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
