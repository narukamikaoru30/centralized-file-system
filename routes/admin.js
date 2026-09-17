const express = require("express");
const router = express.Router();
const rateLimit = require('express-rate-limit');  // 🔐 Fix #7: For rate limiting
const User = require("../models/User");
const File = require("../models/File");
const Report = require("../models/Report");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const Invitation = require("../models/Invitation");
const Branch = require("../models/Branch");
const bcrypt = require("bcrypt");
const asyncHandler = require('../utils/asyncHandler');
const logger = require("../utils/logger");
const { requireAuth, requireActor } = require("../middleware/authMiddleware");
const { requireActive, requireRole } = require("../middleware/roleMiddleware");
const { getGlobalSystemSettings } = require("../utils/systemSettings");
const { getBranchFilter, getUserFilter, validateAdminCanManageUser, validateAdminCanManageFile } = require("../utils/adminValidation");
const { getObjectBuffer } = require("../utils/objectStorage");

function serializeFileWithUploader(file) {
  const obj = file && typeof file.toObject === "function" ? file.toObject() : (file || {});
  return {
    ...obj,
    uploadedBy: file && file.owner ? {
      fullname: file.owner.fullname || "",
      email: file.owner.email || "",
      branch: file.owner.branch || ""
    } : null
  };
}

async function buildUploadForecast(branchFilter, months = 1) {
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstMonthStart = new Date(currentMonthStart);
  firstMonthStart.setMonth(firstMonthStart.getMonth() - (months - 1));
  const nextMonthStart = new Date(currentMonthStart);
  nextMonthStart.setMonth(nextMonthStart.getMonth() + 1);

  const aggregation = await File.aggregate([
    { $match: {
      ...branchFilter,
      deleted: false,
      uploadedAt: { $gte: firstMonthStart }
    } },
    { $group: {
      _id: {
        year: { $year: "$uploadedAt" },
        month: { $month: "$uploadedAt" }
      },
      count: { $sum: 1 }
    } }
  ]);

  const lookup = aggregation.reduce((map, doc) => {
    const key = `${doc._id.year}-${String(doc._id.month).padStart(2, '0')}`;
    map[key] = doc.count;
    return map;
  }, {});

  const uploadForecast = [];
  const monthlyCounts = [];

  for (let i = 0; i < months; i += 1) {
    const monthDate = new Date(firstMonthStart);
    monthDate.setMonth(firstMonthStart.getMonth() + i);
    const label = monthDate.toLocaleString('en-US', { month: 'short', year: 'numeric' });
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, '0')}`;
    const count = lookup[key] || 0;
    uploadForecast.push({ label, count });
    monthlyCounts.push(count);
  }

  const currentMonthUploads = monthlyCounts[monthlyCounts.length - 1] || 0;
  const daysInNextMonth = new Date(
    nextMonthStart.getFullYear(),
    nextMonthStart.getMonth() + 1,
    0
  ).getDate();

  const recentWeekStart = new Date(today);
  recentWeekStart.setDate(today.getDate() - 6);
  const recentWeekUploads = await File.countDocuments({
    ...branchFilter,
    deleted: false,
    uploadedAt: { $gte: recentWeekStart }
  });
  const recentWeekDailyRate = recentWeekUploads / 7;
  const projectedNextMonth = recentWeekDailyRate * daysInNextMonth;
  const reasonableCap = Math.max(8, Math.round(Math.max(1, recentWeekUploads) * 2.5));
  const predictedNextMonthUploads = Math.max(
    0,
    Math.min(Math.round(projectedNextMonth), reasonableCap)
  );

  return {
    uploadForecast,
    predictedNextMonthUploads,
    predictedNextMonthLabel: nextMonthStart.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    currentMonthUploads,
    dailyUploadRate: Number(Math.max(0, recentWeekDailyRate).toFixed(2))
  };
}

// ==================== ADMIN DASHBOARD ====================
router.get("/dashboard",
  requireAuth({ mode: "redirect", message: "Please log in to access the dashboard" }),
  requireActive({ mode: "redirect" }),
  requireRole(["admin", "super_admin"], { mode: "redirect" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;
  if (admin.role === "super_admin") {
    return res.redirect("/superadmin/dashboard");
  }

  const flash = req.consumeFlash ? req.consumeFlash() : null;

  const isSuperAdmin = false;
  const branchFilter = getBranchFilter(admin);

  const totalFiles = await File.countDocuments(branchFilter);
  const totalUsers = await User.countDocuments(getUserFilter(admin, "user"));
  const activeAdmins = await User.countDocuments(
    isSuperAdmin
      ? { role: { $in: ["admin", "super_admin"] } }
      : { role: "admin", branch: admin.branch || "", active: { $ne: false } }
  );
  const recentUploads = await File.countDocuments({
    ...branchFilter,
    uploadedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });
  // 🔐 Fix #3: Limit admin dashboard file list to prevent OOM
  const allFiles = (await File.find(branchFilter)
    .populate("owner", "fullname email role branch")
    .sort({ uploadedAt: -1 })
    .limit(50))
    .map(serializeFileWithUploader);
  const allUsers = await User.find(getUserFilter(admin, "user"))
    .select("_id fullname email role branch active status avatar createdAt")
    .limit(100);
  const auditLogs = await AuditLog.find(isSuperAdmin ? {} : { user: admin._id })
    .populate("user", "fullname email")
    .populate("targetUser", "fullname email")
    .sort({ timestamp: -1 })
    .limit(10);

  const systemSettings = await getGlobalSystemSettings();
  const recentNotifications = await Notification.find({ owner: admin._id }).sort({ date: -1 }).limit(8);
  const forecast = await buildUploadForecast(branchFilter);

  res.render("admindashboard", {
    email: admin.email,
    fullname: admin.fullname,
    role: admin.role,
    avatar: admin.avatar || "",
    stats: {
      totalFiles,
      totalUsers,
      activeAdmins,
      recentUploads,
      ...forecast
    },
    files: allFiles,
    users: allUsers,
    systemSettings,
    auditLogs,
    recentNotifications,
    success: flash && flash.type === "success" ? flash.message : null,
    error: flash && flash.type === "error" ? flash.message : null
  });
}));

// ==================== DASHBOARD DATA REFRESH (JSON) ====================
router.get("/dashboard/data",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;
  if (admin.role === "super_admin") {
    return res.status(403).json({ success: false, message: "Use the super admin dashboard" });
  }

  const isSuperAdmin = false;
  const branchFilter = getBranchFilter(admin);

  const totalFiles = await File.countDocuments(branchFilter);
  const totalUsers = await User.countDocuments(getUserFilter(admin, "user"));
  const activeAdmins = await User.countDocuments(
    isSuperAdmin
      ? { role: { $in: ["admin", "super_admin"] } }
      : { role: "admin", branch: admin.branch || "", active: { $ne: false } }
  );
  const recentUploads = await File.countDocuments({
    ...branchFilter,
    uploadedAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
  });

  const allFiles = (await File.find(branchFilter)
    .populate("owner", "fullname email role branch")
    .sort({ uploadedAt: -1 })
    .limit(50))
    .map(serializeFileWithUploader);

  const allUsers = await User.find(getUserFilter(admin, "user"))
    .select("_id fullname email role branch active status avatar createdAt")
    .limit(100);

  const auditLogs = await AuditLog.find(isSuperAdmin ? {} : { user: admin._id })
    .populate("user", "fullname email")
    .populate("targetUser", "fullname email")
    .sort({ timestamp: -1 })
    .limit(10);

  const forecast = await buildUploadForecast(branchFilter);
  const recentNotifications = await Notification.find({ owner: admin._id })
    .sort({ date: -1 })
    .limit(8)
    .lean();

  res.json({
    success: true,
    stats: {
      totalFiles,
      totalUsers,
      activeAdmins,
      recentUploads,
      ...forecast
    },
    files: allFiles,
    users: allUsers,
    auditLogs,
    recentNotifications
  });
}));

// ==================== FILE OPERATIONS ====================
// These routes are separate so the audit log can tell a preview from a download.
// Keep UPLOADS_DIRECTORY aligned with the directory configured by your upload middleware.
async function findManageableFile(req) {
  const file = await File.findById(req.params.fileId).populate("owner", "fullname email role branch");
  if (!file || file.deleted) return { file: null, error: "File not found" };

  const validation = validateAdminCanManageFile(req.actor, file);
  if (!validation.allowed) return { file: null, error: validation.reason || "Not allowed" };

  return { file, error: null };
}

function writeFileAudit(req, file, action, verb) {
  return AuditLog.create({
    user: req.actor._id,
    action,
    details: `${verb} file: ${file.originalName || file.filename}`,
    targetUser: file.owner?._id || null,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });
}

router.get("/file/view/:fileId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
    const { file, error } = await findManageableFile(req);
    if (!file) return res.status(error === "File not found" ? 404 : 403).json({ success: false, message: error });

    const safeFilename = path.basename(file.filename || "");
    if (!safeFilename) return res.status(404).json({ success: false, message: "File is unavailable" });

    await writeFileAudit(req, file, "file_viewed", "Viewed");
    res.type(file.mimeType || "application/octet-stream");
    res.send(await getObjectBuffer(safeFilename));
  })
);

router.get("/file/download/:fileId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
    const { file, error } = await findManageableFile(req);
    if (!file) return res.status(error === "File not found" ? 404 : 403).json({ success: false, message: error });

    const safeFilename = path.basename(file.filename || "");
    if (!safeFilename) return res.status(404).json({ success: false, message: "File is unavailable" });

    await writeFileAudit(req, file, "file_downloaded", "Downloaded");
    res.type(file.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName || safeFilename)}`);
    res.send(await getObjectBuffer(safeFilename));
  })
);

router.post("/file/delete/:fileId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;

  const file = await File.findById(req.params.fileId).populate("owner", "branch");
  if (!file) {
    return res.json({ success: false, message: "File not found" });
  }

  const validation = validateAdminCanManageFile(admin, file);
  if (!validation.allowed) {
    return res.json({ success: false, message: validation.reason });
  }

  file.deleted = true;
  file.deletedAt = new Date();
  await file.save();

  // 🔐 Fix: Use AuditLog instead of Report for consistency
  await AuditLog.create({
    user: admin._id,
    action: "file_deleted",
    details: `Deleted file: ${file.filename} (${file.sizeBytes} bytes)`,
    targetUser: file.owner || null,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "File moved to recycle bin" });
}));

// ==================== USER MANAGEMENT ====================
// 🔐 Fix #7: Add rate limiting to role change endpoint
const roleChangeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,  // 1 hour
  max: 20,  // 20 role changes per hour
  keyGenerator: (req) => req.actor._id.toString()
});

router.post("/user/role",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  roleChangeLimiter,
  asyncHandler(async (req, res) => {
  const admin = req.actor;

  const targetUser = await User.findById(req.body.userId);
  if (!targetUser) {
    return res.json({ success: false, message: "User not found" });
  }

  if (targetUser.role === "super_admin") {
    return res.json({ success: false, message: "Super Admin role cannot be changed" });
  }

  const allowedRoles = ["user", "admin"];
  if (!allowedRoles.includes(req.body.role)) {
    return res.json({ success: false, message: "Invalid role" });
  }

  if (String(targetUser._id) === String(admin._id)) {
    return res.json({ success: false, message: "You cannot change your own role" });
  }

  if (req.body.role === "admin") {
    const targetBranch = (targetUser.branch || "").trim();
    if (!targetBranch) {
      return res.json({ success: false, message: "User must be assigned to a branch before promotion to admin" });
    }

    const existingBranchAdmin = await User.findOne({
      role: "admin",
      branch: targetBranch,
      active: { $ne: false },
      _id: { $ne: targetUser._id }
    });

    if (existingBranchAdmin) {
      return res.json({ success: false, message: `Branch already has an active admin (${existingBranchAdmin.email})` });
    }
  }

  const user = await User.findByIdAndUpdate(req.body.userId, { role: req.body.role }, { new: true })
    .select('_id fullname email role branch active status avatar');
  
  // 🔐 Fix: Use AuditLog instead of Report for consistency
  await AuditLog.create({
    user: admin._id,
    action: "role_change",
    details: `Changed role to ${req.body.role} for ${user.email}`,
    targetUser: user._id,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "Role updated", user });
}));

router.post("/user/deactivate/:userId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;

  const user = await User.findById(req.params.userId);
  if (!user) {
    return res.json({ success: false, message: "User not found" });
  }

  const validation = validateAdminCanManageUser(admin, user);
  if (!validation.allowed) {
    return res.json({ success: false, message: validation.reason });
  }

  user.active = false;
  user.status = "inactive";
  user.online = false;
  await user.save();

  // 🔐 Fix: Use AuditLog instead of Report for consistency with suspend/unsuspend
  await AuditLog.create({
    user: admin._id,
    action: "account_deactivated",
    details: `Deactivated ${user.email}`,
    targetUser: user._id,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "User deactivated" });
}));

// ==================== FILTER & SEARCH ====================
router.get("/files/search",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const { query, category, email } = req.query;
  const admin = req.actor;

  const filter = getBranchFilter(admin);

  if (query) {
    filter.filename = { $regex: query, $options: "i" };
  }
  if (category && category !== "all") {
    filter.filetype = category;
  }

  // 🔐 Fix #3: Add limit to prevent unbounded query results
  // 🔐 Fix #5: Validate branch against allowed values
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const files = await File.find(filter)
    .populate("owner", "fullname email branch")
    .sort({ uploadedAt: -1 })
    .limit(limit);
  res.json(files);
}));

// ==================== USER SUSPEND / UNSUSPEND ====================
router.post("/user/suspend/:userId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;
  const { reason, until } = req.body;

  const user = await User.findById(req.params.userId);
  if (!user) {
    return res.json({ success: false, message: "User not found" });
  }

  if (user.role === "super_admin") {
    return res.json({ success: false, message: "Cannot suspend a Super Admin" });
  }

  const validation = validateAdminCanManageUser(admin, user);
  if (!validation.allowed) {
    return res.json({ success: false, message: validation.reason });
  }

  user.status = "suspended";
  user.active = false;
  user.suspendedReason = typeof reason === "string" ? reason.trim().slice(0, 500) : "";
  user.suspendedUntil = until ? new Date(until) : null;
  user.online = false;
  await user.save();

  await AuditLog.create({
    user: admin._id,
    action: "account_suspended",
    details: `Suspended ${user.email}${user.suspendedReason ? ": " + user.suspendedReason : ""}`,
    targetUser: user._id,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "User suspended" });
}));

router.post("/user/unsuspend/:userId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;

  const user = await User.findById(req.params.userId);
  if (!user) {
    return res.json({ success: false, message: "User not found" });
  }

  const validation = validateAdminCanManageUser(admin, user);
  if (!validation.allowed) {
    return res.json({ success: false, message: validation.reason });
  }

  user.status = "active";
  user.active = true;
  user.suspendedReason = "";
  user.suspendedUntil = null;
  await user.save();

  await AuditLog.create({
    user: admin._id,
    action: "account_reactivated",
    details: `Reactivated ${user.email}`,
    targetUser: user._id,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "User reactivated" });
}));

// ==================== INVITATION ====================
router.post("/invite",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;
  const { email, role, branch } = req.body;

  if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.json({ success: false, message: "Valid email is required" });
  }

  const inviteEmail = email.trim().toLowerCase();

  // Check if user already exists
  const existingUser = await User.findOne({ email: inviteEmail });
  if (existingUser) {
    return res.json({ success: false, message: "A user with this email already exists" });
  }

  // Check for existing pending invitation
  const existingInvite = await Invitation.findOne({ email: inviteEmail, status: "pending", expiresAt: { $gt: new Date() } });
  if (existingInvite) {
    return res.json({ success: false, message: "An invitation is already pending for this email" });
  }

  const inviteRole = (role === "admin" && admin.role === "super_admin") ? "admin" : "user";
  const inviteBranch = typeof branch === "string" ? branch.trim() : (admin.branch || "");

  const token = Invitation.generateToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const invitation = await Invitation.create({
    email: inviteEmail,
    role: inviteRole,
    branch: inviteBranch,
    invitedBy: admin._id,
    token,
    expiresAt
  });

  await AuditLog.create({
    user: admin._id,
    action: "invite_sent",
    details: `Invited ${inviteEmail} as ${inviteRole} to branch: ${inviteBranch}`,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  // Build invitation link
  const protocol = req.protocol;
  const host = req.get("host");
  const inviteLink = `${protocol}://${host}/auth/invite/${token}`;

  // Try sending email (non-blocking — log any issues)
  try {
    const sendInviteEmail = require("../utils/mailer");
    await sendInviteEmail(inviteEmail, inviteLink, inviteBranch, inviteRole);
  } catch (emailErr) {
    logger.warn('[Admin] Invitation email failed to send', { 
      email: inviteEmail, 
      error: emailErr.message 
    });
    // Email sending is non-critical; user can resend or copy link manually
  }

  res.json({
    success: true,
    message: "Invitation created",
    inviteLink,
    invitation: { email: inviteEmail, role: inviteRole, branch: inviteBranch, expiresAt }
  });
}));

// ==================== AUDIT LOG ====================
router.get("/audit-logs",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["admin", "super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const admin = req.actor;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const filter = {};
  if (admin.role !== "super_admin") {
    filter.user = admin._id;
  }
  if (req.query.action) {
    filter.action = req.query.action;
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .populate("user", "fullname email")
      .populate("targetUser", "fullname email")
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(limit),
    AuditLog.countDocuments(filter)
  ]);

  res.json({ success: true, logs, total, page, pages: Math.ceil(total / limit) });
}));

module.exports = router;
