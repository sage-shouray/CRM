const nodemailer = require("nodemailer");
require("dotenv").config();

// Mail transport, configurable per environment.
//
// sagetl.com is hosted on Microsoft 365 and publishes a strict SPF record
// ("-all"), which tells receiving servers to reject mail claiming to come from
// the domain unless it was sent through Microsoft's own servers. Sending
// company mail through a personal Gmail account therefore arrives
// unauthenticated and is filed as junk or quarantined — the message leaves,
// nobody sees it, and nothing in the logs looks wrong.
//
// Set SMTP_HOST to route through the company server instead:
//   SMTP_HOST=smtp.office365.com
//   SMTP_PORT=587
//   EMAIL_USER=crm@sagetl.com        (a real mailbox with SMTP AUTH enabled)
//   EMAIL_PASS=<its password / app password>
//
// With SMTP_HOST unset it falls back to the Gmail service account, which is
// fine for local testing but should not be used to mail staff addresses.
const host = (process.env.SMTP_HOST || "").trim();
const port = Number(process.env.SMTP_PORT || 587);

const transporter = host
  ? nodemailer.createTransport({
      host,
      port,
      // Port 465 is implicit TLS; 587 starts plain and upgrades via STARTTLS,
      // which is what Microsoft 365 expects.
      secure: port === 465,
      requireTLS: port !== 465,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

// The address staff actually see. It must belong to the authenticated domain,
// or SPF/DKIM alignment fails and the message is treated as forged.
const fromAddress =
  (process.env.EMAIL_FROM || "").trim() ||
  `"Sage CRM" <${process.env.EMAIL_USER}>`;

if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
  console.warn(
    "Mail is not configured (EMAIL_USER / EMAIL_PASS unset). Password reset " +
      "emails will fail until they are."
  );
} else {
  transporter.verify((error) => {
    if (error) {
      console.error(
        `Mail transport verification failed for ${host || "gmail"}:`,
        error.responseCode || error.code,
        (error.message || "").split("\n")[0]
      );
    } else {
      console.log(
        `Mail transport ready (${host || "gmail"}), sending as ${fromAddress}`
      );
    }
  });
}

module.exports = transporter;
module.exports.fromAddress = fromAddress;
