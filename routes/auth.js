const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const User = require("../models/User");
const AuditLog = require("../models/AuditLog");
const Branch = require("../models/Branch");
const bcrypt = require("bcrypt");
const { rateLimit, ipKeyGenerator } = require("express-rate-limit");
const OTPAuth = require("otpauth");
const QRCode = require("qrcode");
const BRANCH_OPTIONS = require("../config/branches");
const { requireAuth } = require("../middleware/authMiddleware");
const {
  setSessionCookie,
  clearSessionCookie,
  resolveSessionId,
  ensureSessionId,
  pushFlash,
  pullFlash
} = require("../utils/sessionHelpers");
const {
  createSession,
  getSession,
  updateSession,
  destroySession,
  setSessionFlash,
  SESSION_COOKIE_NAME,
  parseCookies
} = require("../utils/sessionStore");
const {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  signAccessToken,
  setAccessCookie,
  clearAccessCookie,
  clearRefreshCookie
} = require("../utils/jwtAuth");
const {
  issueRefreshToken,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAccessTokenFromRaw
} = require("../utils/tokenLifecycle");


// -------------------- RATE LIMITING --------------------
const MAX_FAILED_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts from this IP. Please try again in 15 minutes.",
  handler(req, res) {
    pushFlash(req, res, "error", "Too many login attempts. Please try again later.");
    return res.redirect("/auth/login");
  }
});

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    pushFlash(req, res, "error", "Too many registration attempts. Please try again later.");
    return res.redirect("/auth/register");
  }
});

const resetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  handler(req, res) {
    pushFlash(req, res, "error", "Too many reset attempts. Try again later.");
    return res.redirect("/auth/forgot-password");
  }
});

const twoFALimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator(req) {
    const userId = req.user?._id
      || req.session?.userId
      || req.session?.pendingTotpUserId
      || req.body?.userId;
    if (userId) return `user:${String(userId)}`;

    const sid = resolveSessionId(req);
    if (sid) return `session:${sid}`;

    return `ip:${ipKeyGenerator(req.ip || "unknown")}`;
  },
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    pushFlash(req, res, "error", "Too many 2FA attempts. Please try again later.");
    return res.redirect("/auth/login");
  }
});

function resetTwoFAAttempts(req, userId) {
  const key = userId
    ? `user:${String(userId)}`
    : (resolveSessionId(req) ? `session:${resolveSessionId(req)}` : null);
  if (key && typeof twoFALimiter.resetKey === "function") {
    twoFALimiter.resetKey(key);
  }
}

const resetPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler(req, res) {
    pushFlash(req, res, "error", "Too many password reset attempts. Try again later.");
    return res.redirect("/auth/forgot-password");
  }
});

function generateRecoveryCodes() {
  const codes = new Set();
  while (codes.size < 8) {
    const code = crypto.randomBytes(4).toString("hex").toUpperCase().slice(0, 8);
    if (code.length === 8) codes.add(code);
  }
  return Array.from(codes);
}

function hashRecoveryCode(code) {
  return crypto.createHash("sha256").update((code || "").trim().toUpperCase()).digest("hex");
}

function isTotpReplay(user, token) {
  if (!user || !token) return false;

  const candidateHash = hashRecoveryCode(token);
  const lastWindow = Number(user.totpLastUsedWindow);
  const lastHash = user.totpLastUsedCodeHash || "";

  if (!lastHash || Number.isNaN(lastWindow)) return false;

  const currentWindow = Math.floor(Date.now() / 30000);
  const replayWindows = new Set([currentWindow - 1, currentWindow, currentWindow + 1]);

  return replayWindows.has(lastWindow) && lastHash === candidateHash;
}

function normalizeTotpToken(token) {
  return token == null ? "" : token.toString().trim();
}

function normalizeTotpSecret(secret) {
  return secret == null ? "" : secret.toString().replace(/\s+/g, "").trim().toUpperCase();
}

function createTotp(secret, label) {
  const normalizedSecret = normalizeTotpSecret(secret);
  return new OTPAuth.TOTP({
    issuer: "CFS-DOJ-PPA",
    label: label || "CFS-DOJ-PPA",
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(normalizedSecret)
  });
}

function logTotpDiagnostic(context, totp, incomingToken, delta) {
  if (process.env.NODE_ENV === "production") return;
  console.log(`[2FA:${context}]`, {
    serverUtc: new Date().toISOString(),
    expectedCode: totp.generate(),
    incomingCode: normalizeTotpToken(incomingToken),
    validationDelta: delta
  });
}

function verifyTotpToken(user, token) {
  if (!user || !user.totpSecret) return false;

  const totp = createTotp(user.totpSecret, user.email);

  const normalizedToken = normalizeTotpToken(token);
  return totp.validate({ token: normalizedToken, window: 1 }) !== null;
}

// ==================== REGISTER ====================
router.get("/register", async (req, res) => {
  const flash = pullFlash(req);
  let branches = BRANCH_OPTIONS;
  try {
    const dbBranches = await Branch.find({ active: true }).sort({ name: 1 }).select("name");
    if (dbBranches.length) branches = dbBranches.map(b => b.name);
  } catch (_) {}
  res.render("register", {
    success: flash && flash.type === "success" ? flash.message : null,
    error: flash && flash.type === "error" ? flash.message : null,
    branches
  });
});

router.post("/register", registerLimiter, async (req, res) => {
  const { fullname, password, branch } = req.body;
  const email = (req.body.email || "").trim().toLowerCase();
  const role = "user";
  try {
    const passwordError = User.validatePasswordComplexity(password);
    if (passwordError) {
      pushFlash(req, res, "error", passwordError);
      return res.redirect("/auth/register");
    }
    const selectedBranch = typeof branch === "string" ? branch.trim() : "";

    let validBranches = BRANCH_OPTIONS;
    try {
      const dbBranches = await Branch.find({ active: true }).select("name");
      if (dbBranches.length) validBranches = dbBranches.map(b => b.name);
    } catch (_) {}

    if (!selectedBranch || !validBranches.includes(selectedBranch)) {
      pushFlash(req, res, "error", "Please select a valid branch");
      return res.redirect("/auth/register");
    }
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      pushFlash(req, res, "error", "Email already exists");
      return res.redirect("/auth/register");
    }
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({ fullname, email, password: hashedPassword, role, branch: selectedBranch });
    await newUser.save();
    resetTwoFAAttempts(req, newUser._id);
    pushFlash(req, res, "success", "Account created successfully");
    res.redirect("/auth/login");
  } catch (error) {
    pushFlash(req, res, "error", error.message || "Registration failed");
    res.redirect("/auth/register");
  }
});


// ==================== LOGIN ====================
router.get("/login", (req, res) => {
  let flash = pullFlash(req);
  if (!flash && req.query && req.query.reason === "timeout") {
    flash = {
      type: "error",
      message: "Session expired due to inactivity. Please log in again."
    };
  }
  res.render("login", {
    success: flash && flash.type === "success" ? flash.message : null,
    error: flash && flash.type === "error" ? flash.message : null
  });
});

router.post("/login", loginLimiter, async (req, res) => {
  const { password } = req.body;
  const email = (req.body.email || "").trim().toLowerCase();
  try {
    const user = await User.findOne({ email });
    if (!user) {
      pushFlash(req, res, "error", "Invalid email or password");
      return res.redirect("/auth/login");
    }
    if (user.active === false) {
      pushFlash(req, res, "error", "Account is deactivated");
      return res.redirect("/auth/login");
    }

    // Check suspension
    if (user.isSuspended()) {
      const msg = user.suspendedUntil
        ? `Account is suspended until ${user.suspendedUntil.toLocaleDateString()}. Reason: ${user.suspendedReason || "N/A"}`
        : `Account is suspended. Reason: ${user.suspendedReason || "N/A"}`;
      AuditLog.create({ user: user._id, action: "login_failed", details: "Suspended account login attempt", ip: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) }).catch(() => {});
      pushFlash(req, res, "error", msg);
      return res.redirect("/auth/login");
    }
    // Auto-reactivate expired suspension
    if (user.status === "suspended" && user.suspendedUntil && user.suspendedUntil <= new Date()) {
      user.status = "active";
      user.active = true;
      user.suspendedReason = "";
      user.suspendedUntil = null;
      await user.save();
    }

    // Check account lockout
    if (user.isLocked()) {
      const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
      pushFlash(req, res, "error", `Account is locked. Try again in ${minutesLeft} minute${minutesLeft !== 1 ? "s" : ""}.`);
      return res.redirect("/auth/login");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= MAX_FAILED_ATTEMPTS) {
        user.lockUntil = new Date(Date.now() + LOCK_DURATION_MS);
        user.failedLoginAttempts = 0;
        await user.save();
        AuditLog.create({ user: user._id, action: "login_failed", details: "Account locked after max attempts", ip: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) }).catch(() => {});
        pushFlash(req, res, "error", "Too many failed attempts. Account locked for 15 minutes.");
        return res.redirect("/auth/login");
      }
      await user.save();
      AuditLog.create({ user: user._id, action: "login_failed", details: "Invalid password", ip: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) }).catch(() => {});
      pushFlash(req, res, "error", "Invalid email or password");
      return res.redirect("/auth/login");
    }

    // Successful login — reset lockout counters
    if (user.failedLoginAttempts > 0 || user.lockUntil) {
      user.failedLoginAttempts = 0;
      user.lockUntil = null;
      await user.save();
    }

    // Check if 2FA is enabled
    if (user.totpEnabled && user.totpSecret) {
      const sid = ensureSessionId(req, res);
      const session = getSession(sid);
      if (session) {
        session.pendingTotpUserId = String(user._id);
        session.pendingTotpAt = Date.now();
        session.twoFAAttempts = 0;
        session.is2FAComplete = false;
      }
      resetTwoFAAttempts(req, user._id);
      return res.redirect("/auth/2fa/verify");
    }

    const sid = ensureSessionId(req, res);
    const session = getSession(sid);
    if (session) {
      session.twoFAAttempts = 0;
      session.is2FAComplete = true;
    }
    resetTwoFAAttempts(req, user._id);
    const accessSigned = signAccessToken(user);
    req.user = user;
    req.actor = user;
    req.actorEmail = user.email;
    setAccessCookie(res, accessSigned.token);
    await issueRefreshToken(req, res, user._id);
    setSessionFlash(sid, { type: "success", message: "Login successful" });

    AuditLog.create({ user: user._id, action: "login", details: "Successful login", ip: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) }).catch(() => {});

    if (user.role === "admin") {
      res.redirect("/auth/admin");
    } else if (user.role === "super_admin") {
      res.redirect("/auth/super");
    } else {
      res.redirect("/auth/user");
    }
  } catch (error) {
    pushFlash(req, res, "error", error.message || "Login failed");
    res.redirect("/auth/login");
  }
});


// ==================== LOGOUT ====================
router.get("/logout", (req, res) => {
  const cookies = parseCookies(req.headers.cookie || "");
  const accessToken = cookies[ACCESS_COOKIE_NAME] || "";
  const refreshToken = cookies[REFRESH_COOKIE_NAME] || "";

  if (req.user && req.user._id) {
    AuditLog.create({ user: req.user._id, action: "logout", details: "User logged out", ip: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) }).catch(() => {});
  }

  const sid = resolveSessionId(req);
  if (sid) destroySession(sid);
  clearSessionCookie(res);

  Promise.all([
    revokeAccessTokenFromRaw(accessToken, "logout"),
    revokeRefreshToken(refreshToken, "logout")
  ]).catch(() => {});

  clearAccessCookie(res);
  clearRefreshCookie(res);
  const flashSid = createSession();
  setSessionCookie(res, flashSid);
  setSessionFlash(flashSid, { type: "success", message: "Logged out" });
  return res.redirect("/auth/login");
});


// ==================== PASSWORD RESET ====================
router.get("/forgot-password", (req, res) => {
  const flash = pullFlash(req);
  res.render("forgot-password", {
    success: flash && flash.type === "success" ? flash.message : null,
    error: flash && flash.type === "error" ? flash.message : null
  });
});

router.post("/forgot-password", resetLimiter, async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email: (email || "").trim().toLowerCase() });
    const genericMsg = "If an account with that email exists, a reset link has been generated.";

    if (!user) {
      pushFlash(req, res, "success", genericMsg);
      return res.redirect("/auth/forgot-password");
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");
    user.resetToken = hashedToken;
    user.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
    await user.save();

    const resetUrl = `${req.protocol}://${req.get("host")}/auth/reset-password/${rawToken}`;

    pushFlash(req, res, "success", genericMsg);
    if (process.env.NODE_ENV !== "production") {
      pushFlash(req, res, "success", `DEV ONLY — Reset link: /auth/reset-password/${rawToken}`);
    }
    return res.redirect("/auth/forgot-password");
  } catch (err) {
    pushFlash(req, res, "error", "Something went wrong. Please try again.");
    return res.redirect("/auth/forgot-password");
  }
});

router.get("/reset-password/:token", async (req, res) => {
  const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");
  const user = await User.findOne({
    resetToken: hashedToken,
    resetTokenExpires: { $gt: Date.now() }
  });

  if (!user) {
    pushFlash(req, res, "error", "Invalid or expired reset link");
    return res.redirect("/auth/forgot-password");
  }

  res.render("reset-password", {
    token: req.params.token,
    error: null,
    success: null
  });
});

router.post("/reset-password/:token", resetPasswordLimiter, async (req, res) => {
  const { password, confirmPassword } = req.body;
  const hashedToken = crypto.createHash("sha256").update(req.params.token).digest("hex");

  try {
    const user = await User.findOne({
      resetToken: hashedToken,
      resetTokenExpires: { $gt: Date.now() }
    });

    if (!user) {
      pushFlash(req, res, "error", "Invalid or expired reset link");
      return res.redirect("/auth/forgot-password");
    }

    if (password !== confirmPassword) {
      return res.render("reset-password", {
        token: req.params.token,
        error: "Passwords do not match",
        success: null
      });
    }

    const passwordError = User.validatePasswordComplexity(password);
    if (passwordError) {
      return res.render("reset-password", {
        token: req.params.token,
        error: passwordError,
        success: null
      });
    }

    user.password = await bcrypt.hash(password, 12);
    user.resetToken = "";
    user.resetTokenExpires = null;
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
    await user.save();

    pushFlash(req, res, "success", "Password has been reset. Please log in.");
    return res.redirect("/auth/login");
  } catch (err) {
    pushFlash(req, res, "error", "Password reset failed. Please try again.");
    return res.redirect("/auth/forgot-password");
  }
});


// ==================== 2FA TOTP ====================

router.get("/2fa/setup", twoFALimiter, requireAuth({ mode: "redirect" }), async (req, res) => {
  const user = req.user;
  if (user.totpEnabled) {
    pushFlash(req, res, "error", "2FA is already enabled");
    return res.redirect("/auth/user");
  }

  const sid = ensureSessionId(req, res);
  const session = getSession(sid);
  const pendingSecret = session && session.pendingTotpSecret;
  const pendingRecoveryCodes = session && session.pendingTotpRecoveryCodes;
  const secret = pendingSecret
    ? OTPAuth.Secret.fromBase32(normalizeTotpSecret(pendingSecret))
    : new OTPAuth.Secret({ size: 20 });
  const recoveryCodes = Array.isArray(pendingRecoveryCodes) && pendingRecoveryCodes.length
    ? pendingRecoveryCodes
    : generateRecoveryCodes();
  const totp = createTotp(secret.base32, user.email);

  const otpauthUrl = totp.toString();
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl);

  if (session) {
    session.pendingTotpSecret = normalizeTotpSecret(secret.base32);
    session.pendingTotpRecoveryCodes = recoveryCodes;
  }

  res.render("2fa-setup", {
    qrDataUrl,
    secret: secret.base32,
    recoveryCodes,
    role: user.role,
    error: null,
    success: null
  });
});

router.post("/2fa/setup", twoFALimiter, requireAuth({ mode: "redirect" }), async (req, res) => {
  const user = req.user;
  const { totpCode: token } = req.body;
  const normalizedToken = normalizeTotpToken(token);

  const sid = resolveSessionId(req);
  const session = sid ? getSession(sid) : null;
  const pendingSecret = session && session.pendingTotpSecret;
  const recoveryCodes = (session && session.pendingTotpRecoveryCodes) || generateRecoveryCodes();

  if (!pendingSecret) {
    pushFlash(req, res, "error", "2FA setup session expired. Please try again.");
    return res.redirect("/auth/2fa/setup");
  }

  const cleanPendingSecret = normalizeTotpSecret(pendingSecret);
  const totp = createTotp(cleanPendingSecret, user.email);

  const delta = totp.validate({ token: normalizedToken, window: 1 });
  logTotpDiagnostic("setup", totp, normalizedToken, delta);
  if (delta === null) {
    const qrDataUrl = await QRCode.toDataURL(totp.toString());
    return res.render("2fa-setup", {
      qrDataUrl,
      secret: pendingSecret,
      recoveryCodes,
      role: user.role,
      error: "Invalid code. Please check that your device time is synced and use the current authenticator code.",
      success: null
    });
  }

  user.totpSecret = cleanPendingSecret;
  user.totpEnabled = true;
  user.recoveryCodes = recoveryCodes.map(code => hashRecoveryCode(code));
  user.totpLastUsedWindow = null;
  user.totpLastUsedCodeHash = "";
  await user.save();
  resetTwoFAAttempts(req, user._id);

  delete session.pendingTotpSecret;
  delete session.pendingTotpRecoveryCodes;

  res.render("2fa-setup", {
    qrDataUrl: await QRCode.toDataURL(totp.toString()),
    secret: pendingSecret,
    recoveryCodes,
    role: user.role,
    error: null,
    success: "Two-factor authentication enabled successfully. Save the recovery codes below."
  });
});

router.get("/2fa/verify", (req, res) => {
  const sid = resolveSessionId(req);
  const session = sid ? getSession(sid) : null;

  if (!session || !session.pendingTotpUserId) {
    pushFlash(req, res, "error", "Invalid 2FA session");
    return res.redirect("/auth/login");
  }

  if (Date.now() - (session.pendingTotpAt || 0) > 5 * 60 * 1000) {
    delete session.pendingTotpUserId;
    delete session.pendingTotpAt;
    pushFlash(req, res, "error", "2FA session expired. Please log in again.");
    return res.redirect("/auth/login");
  }

  const flash = pullFlash(req);
  res.render("2fa-verify", {
    error: flash && flash.type === "error" ? flash.message : null
  });
});

router.post("/2fa/verify", twoFALimiter, async (req, res) => {
  const cleanToken = req.body.token?.toString().trim()
    || req.body.totpCode?.toString().trim()
    || "";
  const sid = resolveSessionId(req);
  const session = sid ? getSession(sid) : null;

  if (!session || !session.pendingTotpUserId) {
    pushFlash(req, res, "error", "Your 2FA login session is missing or expired. Please log in again.");
    return res.redirect("/auth/login");
  }

  if (Date.now() - (session.pendingTotpAt || 0) > 5 * 60 * 1000) {
    delete session.pendingTotpUserId;
    delete session.pendingTotpAt;
    pushFlash(req, res, "error", "2FA session expired. Please log in again.");
    return res.redirect("/auth/login");
  }

  const user = await User.findById(session.pendingTotpUserId);
  if (!user || !user.totpSecret) {
    delete session.pendingTotpUserId;
    delete session.pendingTotpAt;
    updateSession(sid, session);
    pushFlash(req, res, "error", "2FA is not configured for this account. Please log in again.");
    return res.redirect("/auth/login");
  }

  const normalizedToken = cleanToken;
  const userHasRecoveryCodes = Array.isArray(user.recoveryCodes) && user.recoveryCodes.length > 0;
  const replayDetected = isTotpReplay(user, normalizedToken);

  if (replayDetected) {
    pushFlash(req, res, "error", "This code was already used. Please wait for a fresh code or use a recovery code.");
    return res.redirect("/auth/2fa/verify");
  }

  let validTotp = false;
  const totp = createTotp(user.totpSecret, user.email);

  const delta = totp.validate({ token: cleanToken, window: 1 });
  if (process.env.NODE_ENV !== "production") {
    console.log("[2FA:login]", {
      serverUtc: new Date().toISOString(),
      expectedToken: totp.generate(),
      receivedToken: cleanToken,
      delta
    });
  }
  if (delta !== null) {
    validTotp = true;
  } else if (userHasRecoveryCodes) {
    const hashedInput = hashRecoveryCode(normalizedToken);
    const matchedIndex = user.recoveryCodes.findIndex(code => code === hashedInput);
    if (matchedIndex !== -1) {
      validTotp = true;
      user.recoveryCodes.splice(matchedIndex, 1);
    }
  }

  if (!validTotp) {
    pushFlash(req, res, "error", "Invalid verification code. Check that your phone time is synced and use the newest code from your authenticator app.");
    return res.redirect("/auth/2fa/verify");
  }

  user.totpLastUsedWindow = Math.floor(Date.now() / 30000);
  user.totpLastUsedCodeHash = hashRecoveryCode(normalizedToken);
  await user.save();

  session.user = user;
  session.userId = String(user._id);
  session.twoFAAttempts = 0;
  session.is2FAComplete = true;
  delete session.pendingTotpUserId;
  delete session.pendingTotpAt;
  updateSession(sid, session);
  if (typeof req.session.save === "function") {
    await new Promise((resolve, reject) => {
      req.session.save((err) => (err ? reject(err) : resolve()));
    });
  }

  const accessSigned = signAccessToken(user);
  req.user = user;
  req.actor = user;
  req.actorEmail = user.email;
  setAccessCookie(res, accessSigned.token);
  await issueRefreshToken(req, res, user._id);
  setSessionFlash(sid, { type: "success", message: "Login successful" });

  if (user.role === "admin") return res.redirect("/auth/admin");
  if (user.role === "super_admin") return res.redirect("/auth/super");
  return res.redirect("/auth/user");
});

router.post("/2fa/disable", requireAuth({ mode: "redirect" }), async (req, res) => {
  const user = req.user;
  const { password, totpCode } = req.body;

  const isMatch = await bcrypt.compare(password || "", user.password);
  if (!isMatch) {
    return res.status(400).json({ success: false, message: "Invalid password. 2FA was not disabled." });
  }

  if (!user.totpSecret || !user.totpEnabled) {
    return res.status(400).json({ success: false, message: "2FA is not enabled for this account." });
  }

  const normalizedToken = normalizeTotpToken(totpCode);
  const replayDetected = isTotpReplay(user, normalizedToken);
  if (replayDetected) {
    return res.status(400).json({ success: false, message: "This code has already been used. Please wait for a fresh one." });
  }

  const totp = createTotp(user.totpSecret, user.email);

  const delta = totp.validate({ token: normalizedToken, window: 1 });
  logTotpDiagnostic("disable", totp, normalizedToken, delta);
  if (delta === null) {
    return res.status(400).json({ success: false, message: "Invalid TOTP code. 2FA was not disabled." });
  }

  user.totpEnabled = false;
  user.totpSecret = "";
  user.recoveryCodes = [];
  user.totpLastUsedWindow = null;
  user.totpLastUsedCodeHash = "";
  await user.save();

  return res.json({ success: true, message: "Two-factor authentication has been disabled" });
});


// ==================== TOKEN REFRESH ====================
router.post("/refresh", async (req, res) => {
  try {
    const cookies = parseCookies(req.headers.cookie || "");
    const refreshToken = cookies[REFRESH_COOKIE_NAME] || "";
    if (!refreshToken) {
      return res.status(401).json({ success: false, message: "Missing refresh token" });
    }

    const rotated = await rotateRefreshToken(req, res, refreshToken);
    if (!rotated || !rotated.userId) {
      clearAccessCookie(res);
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "Invalid refresh token" });
    }

    const refreshedUser = await User.findById(rotated.userId);
    if (!refreshedUser || refreshedUser.active === false) {
      clearAccessCookie(res);
      clearRefreshCookie(res);
      return res.status(401).json({ success: false, message: "User is not active" });
    }

    const signed = signAccessToken(refreshedUser);
    setAccessCookie(res, signed.token);
    return res.json({ success: true });
  } catch (error) {
    clearAccessCookie(res);
    clearRefreshCookie(res);
    return res.status(500).json({ success: false, message: "Unable to refresh session" });
  }
});


module.exports = router;
module.exports.generateRecoveryCodes = generateRecoveryCodes;
module.exports.hashRecoveryCode = hashRecoveryCode;
module.exports.isTotpReplay = isTotpReplay;
module.exports.verifyTotpToken = verifyTotpToken;
module.exports.normalizeTotpToken = normalizeTotpToken;
module.exports.normalizeTotpSecret = normalizeTotpSecret;
module.exports.createTotp = createTotp;


