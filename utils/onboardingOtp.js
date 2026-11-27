const crypto = require("crypto");

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const MAX_RESENDS = 3;

function generateOnboardingOtp() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, "0");
}

function hashOnboardingOtp(code) {
  return crypto.createHash("sha256").update(String(code || "")).digest();
}

function verifyOnboardingOtp(code, expectedHash) {
  if (!expectedHash || !Buffer.isBuffer(expectedHash)) return false;
  const actualHash = hashOnboardingOtp(code);
  return actualHash.length === expectedHash.length
    && crypto.timingSafeEqual(actualHash, expectedHash);
}

function createPendingOnboarding(user, code, options = {}) {
  return {
    user,
    codeHash: hashOnboardingOtp(code),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    resendCount: 0,
    invitationToken: options.invitationToken || ""
  };
}

module.exports = {
  OTP_TTL_MS,
  MAX_OTP_ATTEMPTS,
  MAX_RESENDS,
  generateOnboardingOtp,
  hashOnboardingOtp,
  verifyOnboardingOtp,
  createPendingOnboarding
};
