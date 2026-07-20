const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const fs = require("fs");
const User = require("./Models/User"); // Adjust the path if needed
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const mongo_url = process.env.MONGO_CONN;
mongoose
  .connect(mongo_url, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("MongoDB connected..."))
  .catch((err) => console.log("MongoDB Connection Error: ", err));

const users = JSON.parse(fs.readFileSync("Users.json", "utf-8"));

async function hashAndSaveUsers() {
  const supervisors = new Map();

  for (let user of users) {
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(user.password, salt);
    user.userId = uuidv4();

    // Ensure the role is set and valid
    if (!user.role || !["subuser", "supervisor", "admin"].includes(user.role)) {
      user.role = "subuser"; // Default to subuser if not specified or invalid
    }

    // Handle supervisor assignment for subusers
    if (user.role === "subuser" && user.supervisorEmail) {
      const supervisor = await User.findOne({ email: user.supervisorEmail });
      if (supervisor) {
        user.supervisor = supervisor._id;
      } else {
        console.log(
          `Supervisor not found for ${user.email}. Will be assigned later.`
        );
      }
    }

    // Save the user
    const newUser = new User(user);
    await newUser.save();

    // Store supervisor for later assignment
    if (user.role === "supervisor") {
      supervisors.set(user.email, newUser._id);
    }
  }

  // Assign supervisors to subusers who didn't have a supervisor yet
  for (let user of users) {
    if (user.role === "subuser" && user.supervisorEmail && !user.supervisor) {
      const supervisorId = supervisors.get(user.supervisorEmail);
      if (supervisorId) {
        await User.findOneAndUpdate(
          { email: user.email },
          { supervisor: supervisorId }
        );
      } else {
        console.log(`Supervisor still not found for ${user.email}`);
      }
    }
  }

  console.log("Users created successfully");
  mongoose.connection.close();
}

hashAndSaveUsers().catch((err) => console.error(err));
