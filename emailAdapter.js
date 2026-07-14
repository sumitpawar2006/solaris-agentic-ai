const nodemailer = require("nodemailer");

function isEmailConfigured() {
  return Boolean(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function createTransporter() {
  if (!isEmailConfigured()) return null;

  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

async function sendSolarisEmail({ to, subject, text, html }) {
  const fromName = process.env.GMAIL_FROM_NAME || "Solaris";
  const fromAddress = process.env.GMAIL_USER || "not-configured@solaris.local";

  if (!isEmailConfigured()) {
    return {
      sent: false,
      preview: true,
      reason: "Gmail SMTP is not configured.",
      message: { to, subject, text },
    };
  }

  const transporter = createTransporter();
  const info = await transporter.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text,
    html,
  });

  return {
    sent: true,
    preview: false,
    messageId: info.messageId,
  };
}

module.exports = {
  isEmailConfigured,
  sendSolarisEmail,
};
