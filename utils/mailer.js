/**
 * Email utility for sending invitation emails.
 * Uses nodemailer if available and configured via environment variables:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
 *
 * If nodemailer is not installed or SMTP is not configured, this is a no-op.
 */

const logger = require('../config/logger');

let transporter = null;
let mailConfigError = null;

try {
  const nodemailer = require("nodemailer");

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  } else {
    mailConfigError = 'SMTP configuration incomplete (missing SMTP_HOST, SMTP_USER, or SMTP_PASS)';
  }
} catch (err) {
  // nodemailer not installed or configuration failed
  mailConfigError = `Email service initialization failed: ${err.message}`;
  logger.warn('[Mailer] ' + mailConfigError);
}

/**
 * Send an invitation email with retry logic and error handling.
 * @param {string} toEmail
 * @param {string} inviteLink
 * @param {string} branch
 * @param {string} role
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function sendInviteEmail(toEmail, inviteLink, branch, role) {
  if (!transporter) {
    if (mailConfigError) {
      logger.warn('[Mailer] Cannot send invitation email:', { reason: mailConfigError, toEmail, branch, role });
    }
    return { success: false, error: mailConfigError || 'Email service not configured' };
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "noreply@example.com";
  const maxRetries = 2;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await transporter.sendMail({
        from,
        to: toEmail,
        subject: "You've been invited to DOJ-PPA File System",
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1e40af;">DOJ-PPA Centralized File System</h2>
            <p>You have been invited to join as <strong>${role}</strong> for branch <strong>${branch}</strong>.</p>
            <p>Click the button below to create your account:</p>
            <p style="text-align: center; margin: 30px 0;">
              <a href="${inviteLink}" style="background: #2563eb; color: #fff; text-decoration: none; padding: 12px 32px; border-radius: 6px; font-weight: 600;">
                Accept Invitation
              </a>
            </p>
            <p style="color: #6b7280; font-size: 13px;">This link expires in 7 days. If you did not expect this invitation, please ignore this email.</p>
          </div>
        `
      });
      logger.info('[Mailer] Invitation email sent successfully', { toEmail, branch, role });
      return { success: true };
    } catch (err) {
      lastError = err;
      logger.warn('[Mailer] Email send attempt failed', { 
        attempt, 
        maxRetries,
        toEmail, 
        branch, 
        error: err.message,
        code: err.code 
      });
      
      // Wait before retry (exponential backoff: 500ms, 1000ms)
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  // All retries failed
  logger.error('[Mailer] Failed to send invitation email after retries', { 
    toEmail, 
    branch, 
    role,
    error: lastError.message,
    code: lastError.code 
  });
  
  return { 
    success: false, 
    error: `Failed to send email after ${maxRetries} attempts: ${lastError.message}` 
  };
}

module.exports = sendInviteEmail;
