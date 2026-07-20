const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const User = require("../Models/User"); // Adjust the path as needed
const { loginValidation } = require("../Middleware/AuthValidation");
const {
  forgotPassword,
  resetPassword,
  changePassword,
  getUserProfile,
} = require("../Controllers/AuthController");

router.post("/login", loginValidation, async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find the user by email
    const user = await User.findOne({ email });   
    if (!user) { 
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }

    if (user.status === "inactive") {
      return res
        .status(403)
        .json({ success: false, message: "Your account is inactive. Please contact admin." });
    }
    // Check password
    let isMatch = false;
    if (user.password && user.password.startsWith('$2b$')) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = password == user.password;
    }


    if (!isMatch) {
     
      return res
        .status(400)
        .json({ success: false, message: "Invalid email or password" });
    }

  

    // Create JWT token
   const token = jwt.sign(
     {
       _id: user._id,
       firstName: user.firstName,
       role: user.role,
       email: user.email, // Optional, include if needed
     },
     process.env.JWT_SECRET,
     { expiresIn: "24h" }
   );

    // Send response with user details including role
    const response = {
      success: true,
      message: "Login successful",
      jwtToken: token,
      firstName: user.firstName ,
      userId: user._id,
      role: user.role,
    };
 

    res.json(response);
  } catch (error) {
    console.error("Login error:", error);
    res
      .status(500)
      .json({ success: false, message: "Server error", error: error.message });
  }
});

router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);
router.post("/change-password", changePassword);
router.get("/profile/:userId", getUserProfile);



// Move this route to a separate router file
router.get("/options", async (req, res) => {
  try {
    const options = await OptionsModel.findOne({});
    if (!options) {
      return res.status(404).json({ error: "Options not found" });
    }
    res.json(options);
  } catch (error) {
    console.error("Error fetching options:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
