const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const UserModel = require("../Models/User");
const nodemailer = require('nodemailer');
const transporter = require("../Models/emailService");
const { ROLES, normalizeRole } = require("../Middleware/roles");

// Same allow-list index.js uses for CORS — one shared copy now (see
// Middleware/corsOrigins.js) instead of a second one drifting apart here.
const { isTrustedOrigin } = require("../Middleware/corsOrigins");

// Where the reset link should point. The app's own address, not the API's.
//
// This was hardcoded to localhost:3000 while the frontend runs on 3005, so
// every link that did arrive led nowhere. Preference order: an explicit
// APP_URL, then the address the browser actually made the request from — but
// only once it's checked against the same allow-list CORS uses. Trusting
// Origin/Referer outright let a caller point the emailed reset link (which
// carries a live, self-contained token) at an attacker-controlled domain;
// falling back to the local default is safe, since it grants no attacker
// anything a legitimate request wouldn't already have.
const appBaseUrl = (req) => {
  const configured = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  const origin = req.headers.origin;
  if (origin && isTrustedOrigin(origin)) return origin.replace(/\/+$/, "");

  const referer = req.headers.referer;
  if (referer) {
    try {
      const refererOrigin = new URL(referer).origin;
      if (isTrustedOrigin(refererOrigin)) return refererOrigin;
    } catch (err) {
      /* fall through to the default */
    }
  }

  return "http://localhost:3005";
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
      console.error("Password reset requested but no mail account configured.");
      return res.status(500).json({
        success: false,
        message:
          "Email is not configured on the server, so the reset link cannot " +
          "be sent. Ask an administrator to set your password directly.",
      });
    }

    const user = await UserModel.findOne({ email });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Kept at 24h to match the copy in the email below; the two used to
    // disagree, telling people a link had an hour when it had a day.
    const token = jwt.sign(
      {
        _id: user._id,
        firstName: user.firstName,
        role: user.role,
      },
      process.env.JWT_SECRET,
      { expiresIn: "24h" }
    );
    const resetLink = `${appBaseUrl(req)}/reset-password/${token}`;

    const mailOptions = {
      from: transporter.fromAddress,
      to: email,
      subject: "Reset your Sage CRM password",
      // A text part alongside the HTML: mail that is HTML-only is far more
      // likely to be filed as spam, which is one way a "delivered" message
      // still never reaches the inbox.
      text:
        `You requested a password reset for Sage CRM.\n\n` +
        `Open this link to choose a new password:\n${resetLink}\n\n` +
        `The link expires in 24 hours. If you did not request this, ignore ` +
        `this email — your password stays unchanged.`,
      html: `
        <h2>Password reset</h2>
        <p>You requested a password reset for Sage CRM. Click below to choose a new password:</p>
        <p><a href="${resetLink}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
        <p>Or paste this link into your browser:<br><span style="color:#475569">${resetLink}</span></p>
        <p>This link expires in 24 hours.</p>
        <p style="color:#64748b;font-size:13px">If you didn't request this, ignore this email — your password stays unchanged.</p>
      `,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      // Gmail accepting a message is not the same as the recipient receiving
      // it. Recording accepted/rejected here is what makes a silent
      // non-delivery diagnosable afterwards.
      console.log(
        `Password reset mail for ${email}: accepted=${JSON.stringify(
          info.accepted
        )} rejected=${JSON.stringify(info.rejected)} response=${info.response}`
      );

      if (info.rejected?.length > 0) {
        return res.status(502).json({
          success: false,
          message: `The mail server rejected ${email}. Check the address exists.`,
        });
      }

      return res.json({
        success: true,
        message: "Password reset link sent to email",
      });
    } catch (mailError) {
      // The real SMTP failure, not a generic "Error sending email" that gives
      // nothing to act on.
      console.error("Could not send password reset email:", {
        code: mailError.code,
        responseCode: mailError.responseCode,
        message: mailError.message,
      });
      return res.status(502).json({
        success: false,
        message:
          mailError.responseCode === 535
            ? "The server's email login was refused. The EMAIL_PASS app password needs renewing."
            : `Could not send the email (${mailError.code || "unknown error"}).`,
      });
    }
  } catch (error) {
    console.error("Server error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;

    if (!password) {
      return res
        .status(400)
        .json({ success: false, message: "Password is required" });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        return res
          .status(400)
          .json({ success: false, message: "Token has expired" });
      }
      console.error("Token verification error:", error);
      return res.status(400).json({ success: false, message: "Invalid token" });
    }

    const user = await UserModel.findById(decoded._id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    user.password = hashedPassword;
    await user.save();

    res.json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Reset Password Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    // Always act on the authenticated user, never a client-supplied id.
    const userId = req.user?.id;

    if (!userId || !newPassword) {
      return res
        .status(400)
        .json({ success: false, message: "New password is required" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Verify the current password (bcrypt only — no plaintext fallback).
    const isMatch = user.password
      ? await bcrypt.compare(currentPassword || "", user.password)
      : false;
    if (!isMatch) {
      return res
        .status(400)
        .json({ success: false, message: "Current password is incorrect" });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(newPassword, salt);

    user.password = hashedPassword;
    await user.save();

    res.json({ success: true, message: "Password changed successfully" });
  } catch (error) {
    console.error("Change Password Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // A signed-in session is not, by itself, permission to read anyone's
    // profile — only your own. Every caller of this route today only ever
    // asks for their own id; an Admin gets the wider view every other admin
    // screen already grants it.
    const callerId = Number(req.user?._id ?? req.user?.id);
    const isAdmin = normalizeRole(req.user?.role) === ROLES.ADMIN;
    if (!isAdmin && callerId !== Number(userId)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const user = await UserModel.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    let supervisorInfo = null;
    if (user.supervisor) {
      const supervisor = await UserModel.findById(user.supervisor);
      if (supervisor) {
        supervisorInfo = {
          id: supervisor._id,
          name: `${supervisor.firstName} ${supervisor.lastName}`,
          email: supervisor.email,
        };
      }
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        designation: user.designation,
        mobile: user.mobile,
        role: user.role,
        status: user.status,
        supervisor: supervisorInfo,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Get Profile Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { forgotPassword, resetPassword, changePassword, getUserProfile };
