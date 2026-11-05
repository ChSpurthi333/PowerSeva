const nodemailer = require('nodemailer');

let transporter = null;

function smtpConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

// Sends an email. When SMTP is not configured in .env, the message is printed in the
// server console instead, so the reset flow can still be tested on a laptop.
async function sendMail({ to, subject, text }) {
  if (!smtpConfigured()) {
    console.log(`\n--- EMAIL (SMTP not configured, printed here instead) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n---------------------------------------------------------\n`);
    return;
  }
  transporter = transporter || nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  await transporter.sendMail({ from: process.env.MAIL_FROM || `PowerSeva <${process.env.SMTP_USER}>`, to, subject, text });
}

module.exports = { sendMail };
