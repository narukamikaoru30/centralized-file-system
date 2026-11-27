/**
 * Email utility for sending invitation emails.
 * Uses nodemailer if available and configured via MAIL_* or SMTP_* variables.
 *
 * If nodemailer is not installed or SMTP is not configured, this is a no-op.
 */

const logger = require('../utils/logger');

let transporter = null;
let mailConfigError = null;

function resolveMailConfig(env = process.env) {
  const port = parseInt(env.SMTP_PORT || env.MAIL_PORT || "587", 10);
  return {
    host: env.SMTP_HOST || env.MAIL_HOST || "",
    port: Number.isFinite(port) ? port : 587,
    user: env.SMTP_USER || env.MAIL_USER || "",
    pass: env.SMTP_PASS || env.MAIL_PASS || "",
    from: env.SMTP_FROM || env.MAIL_FROM || env.SMTP_USER || env.MAIL_USER || "noreply@example.com"
  };
}

try {
  const nodemailer = require("nodemailer");
  const { host, port, user, pass } = resolveMailConfig();

  if (host && user && pass) {
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      auth: { user, pass }
    });
  } else {
    mailConfigError = 'Email configuration incomplete (set MAIL_HOST/SMTP_HOST, MAIL_USER/SMTP_USER, and MAIL_PASS/SMTP_PASS)';
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

  const { from } = resolveMailConfig();
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

async function sendOnboardingOtp(toEmail, code) {
  if (!transporter) {
    if (mailConfigError) {
      logger.warn('[Mailer] Cannot send onboarding verification code', { reason: mailConfigError, toEmail });
    }
    return { success: false, error: mailConfigError || 'Email service not configured' };
  }

  const { from } = resolveMailConfig();
  try {
    await transporter.sendMail({
      from,
      to: toEmail,
      subject: "Verify your PPO Regional FileSystem account",
      text: `Your email verification code is ${code}. It expires in 10 minutes.`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
          <h2 style="color:#8a6a00">Verify your email address</h2>
          <p>Enter this code to finish creating your PPO Regional FileSystem account:</p>
          <p style="font-size:30px;font-weight:700;letter-spacing:8px;padding:16px;background:#f8fafc;border:1px solid #e5e7eb;display:inline-block">${code}</p>
          <p>This code expires in 10 minutes. If you did not request an account, you can ignore this email.</p>
        </div>
      `
    });
    logger.info('[Mailer] Onboarding verification email sent', { toEmail });
    return { success: true };
  } catch (err) {
    logger.error('[Mailer] Failed to send onboarding verification email', { toEmail, error: err.message });
    return { success: false, error: 'Unable to send verification email' };
  }
}

module.exports = sendInviteEmail;
module.exports.sendOnboardingOtp = sendOnboardingOtp;
module.exports.resolveMailConfig = resolveMailConfig;
