const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const User = require("../models/User");
const File = require("../models/File");
const Report = require("../models/Report");
const Notification = require("../models/Notification");
const SystemSettings = require("../models/SystemSettings");
const AuditLog = require("../models/AuditLog");
const Branch = require("../models/Branch");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const asyncHandler = require('../utils/asyncHandler');
const BRANCH_OPTIONS = require("../config/branches");
const { requireAuth, requireActor } = require("../middleware/authMiddleware");
const { requireActive, requireRole } = require("../middleware/roleMiddleware");
const { getGlobalSystemSettings } = require("../utils/systemSettings");
const { getObjectBuffer, deleteObject } = require("../utils/objectStorage");

// Matches the Admin dashboard forecasting process, but includes every branch.
async function buildSuperAdminForecast(months = 1) {
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const firstMonthStart = new Date(currentMonthStart);
  firstMonthStart.setMonth(firstMonthStart.getMonth() - (months - 1));
  const nextMonthStart = new Date(today.getFullYear(), today.getMonth() + 1, 1);

  const aggregation = await File.aggregate([
    {
      $match: {
        deleted: false,
        uploadedAt: { $gte: firstMonthStart }
      }
    },
    {
      $group: {
        _id: {
          year: { $year: "$uploadedAt" },
          month: { $month: "$uploadedAt" }
        },
        count: { $sum: 1 }
      }
    }
  ]);

  const lookup = aggregation.reduce((map, doc) => {
    const key = `${doc._id.year}-${String(doc._id.month).padStart(2, "0")}`;
    map[key] = doc.count;
    return map;
  }, {});

  const uploadForecast = [];
  const monthlyCounts = [];
  for (let i = 0; i < months; i += 1) {
    const monthDate = new Date(firstMonthStart);
    monthDate.setMonth(firstMonthStart.getMonth() + i);
    const key = `${monthDate.getFullYear()}-${String(monthDate.getMonth() + 1).padStart(2, "0")}`;
    const count = lookup[key] || 0;

    uploadForecast.push({
      label: monthDate.toLocaleString("en-US", { month: "short", year: "numeric" }),
      count
    });
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
    currentMonthUploads,
    predictedNextMonthUploads,
    predictedNextMonthLabel: nextMonthStart.toLocaleString("en-US", {
      month: "long",
      year: "numeric"
    }),
    dailyUploadRate: Number(Math.max(0, recentWeekDailyRate).toFixed(2))
  };
}

async function buildSuperAdminStats() {
  const forecast = await buildSuperAdminForecast();

  const totalFiles = await File.countDocuments();
  const totalUsers = await User.countDocuments({ role: "user" });
  const totalAdmins = await User.countDocuments({ role: "admin" });
  const activeAdminAccounts = await User.countDocuments({ role: "admin", active: { $ne: false } });
  const activeUserAccounts = await User.countDocuments({ role: "user", active: { $ne: false } });
  const systemActions = await Report.countDocuments();

  return {
    totalFiles,
    totalUsers,
    totalAdmins,
    activeAdminAccounts,
    activeUserAccounts,
    systemActions,
    ...forecast
  };
}

// ==================== SUPER ADMIN DASHBOARD ====================
router.get("/dashboard",
  requireAuth({ mode: "redirect", message: "Please log in to access the dashboard" }),
  requireActive({ mode: "redirect" }),
  requireRole(["super_admin"], { mode: "redirect" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;
  const flash = req.consumeFlash ? req.consumeFlash() : null;
  const stats = await buildSuperAdminStats();
  const systemSettings = await getGlobalSystemSettings();
  
  const allFiles = await File.find().populate("owner", "fullname email branch").sort({ uploadedAt: -1 }).limit(10);
  const allUsers = await User.find().select("_id fullname email role branch active status avatar createdAt").sort({ _id: -1 });
  const allAdmins = await User.find({ role: "admin" }).select("_id fullname email role branch active status avatar createdAt");
  const auditLogs = await Report.find().sort({ date: -1 }).limit(20);
  const recentNotifications = await Notification.find({
    $or: [
      { owner: superAdmin._id },
      { relatedUser: superAdmin._id },
      { type: { $in: ['download', 'general'] } }
    ]
  }).sort({ date: -1 }).limit(12);
  const activeBranchAdmins = await User.find({ role: "admin", active: { $ne: false } }).select("email branch");
  const branchAdminLookup = new Map();
  activeBranchAdmins.forEach((admin) => {
    if (admin.branch && !branchAdminLookup.has(admin.branch)) {
      branchAdminLookup.set(admin.branch, admin.email);
    }
  });

  // Use Branch collection if available, fallback to static config
  let branchList = await Branch.find({ active: true }).sort({ name: 1 });
  if (!branchList.length) {
    branchList = BRANCH_OPTIONS.map((name) => ({ name, _id: null, branchHead: null }));
  }
  const branchAdminAssignments = branchList.map((b) => ({
    branch: b.name,
    branchId: b._id || null,
    adminEmail: branchAdminLookup.get(b.name) || ""
  }));

  res.render("superadmindashboard", {
    email: superAdmin.email,
    fullname: superAdmin.fullname,
    role: superAdmin.role,
    avatar: superAdmin.avatar || "",
    stats,
    files: allFiles,
    users: allUsers,
    admins: allAdmins,
    branchAdminAssignments,
    systemSettings,
    auditLogs,
    recentNotifications,
    success: flash && flash.type === "success" ? flash.message : null,
    error: flash && flash.type === "error" ? flash.message : null
  });
}));

router.get("/stats",
  // Use the same authentication middleware as /dashboard. `requireActor`
  // rejects the browser refresh request with "Missing actor identity".
  requireAuth({ mode: "json", message: "Please log in to access the dashboard" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (_req, res) => {
    const stats = await buildSuperAdminStats();
    res.json({ success: true, stats });
  })
);

router.get("/file/view/:fileId",
  requireActor({ mode: "redirect", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "redirect" }),
  requireRole(["super_admin"], { mode: "redirect" }),
  asyncHandler(async (req, res) => {
    const { fileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(fileId)) {
      return res.status(400).send("Invalid file id");
    }

    const file = await File.findById(fileId).select("filename originalName mimeType");
    if (!file) {
      return res.status(404).send("File not found");
    }

    let fileBuffer;
    try {
      fileBuffer = await getObjectBuffer(file.filename);
    } catch (storageErr) {
      return res.status(404).send("File content is missing on server");
    }

    const mimeType = file.mimeType || "application/octet-stream";
    const preferredName = file.originalName || file.filename;
    if (mimeType.startsWith("text/")) {
      const raw = fileBuffer.toString("utf8");
      const escaped = raw
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

      const safeTitle = String(preferredName)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");

      return res
        .status(200)
        .type("html")
        .send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; font-family: Inter, Arial, sans-serif; background: #f8fafc; color: #111827; }
    header { padding: 12px 16px; border-bottom: 1px solid #e5e7eb; background: #ffffff; font-weight: 600; }
    pre { margin: 0; padding: 16px; white-space: pre-wrap; word-break: break-word; line-height: 1.5; }
  </style>
</head>
<body>
  <header>${safeTitle}</header>
  <pre>${escaped}</pre>
</body>
</html>`);
    }

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename=\"${encodeURIComponent(preferredName)}\"`);
    return res.send(fileBuffer);
  })
);

// ==================== CREATE ADMIN ====================
router.post("/admin/create",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const { adminEmail, adminPassword, adminName, branch } = req.body;
  
  // Validate password complexity
  const passwordError = User.validatePasswordComplexity(adminPassword);
  if (passwordError) {
    return res.json({ success: false, message: `Invalid admin password: ${passwordError}` });
  }
  
  const existingUser = await User.findOne({ email: adminEmail });
  if (existingUser) {
    return res.json({ success: false, message: "Email already exists" });
  }

  const selectedBranch = typeof branch === "string" ? branch.trim() : "";
  if (!selectedBranch) {
    return res.json({ success: false, message: "Branch is required for admin accounts" });
  }

  const existingBranchAdmin = await User.findOne({
    role: "admin",
    branch: selectedBranch,
    active: { $ne: false }
  });
  if (existingBranchAdmin) {
    return res.json({ success: false, message: `Branch already has an active admin (${existingBranchAdmin.email})` });
  }

  const hashedPassword = await bcrypt.hash(adminPassword, 12);
  const newAdmin = new User({
    fullname: adminName,
    email: adminEmail,
    password: hashedPassword,
    role: "admin",
    branch: selectedBranch
  });
  await newAdmin.save();

  const report = new Report({ filename: adminEmail, action: `Admin Created (${selectedBranch})`, user: superAdmin.fullname, owner: superAdmin._id, date: new Date(), ipAddress: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) });
  await report.save();

  res.json({ success: true, message: "Admin created successfully", admin: { _id: newAdmin._id, fullname: newAdmin.fullname, email: newAdmin.email, role: newAdmin.role, branch: newAdmin.branch } });
}));

// ==================== DEACTIVATE ADMIN ====================
router.post("/admin/deactivate/:adminId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const admin = await User.findById(req.params.adminId);
  if (!admin) {
    return res.json({ success: false, message: "Admin not found" });
  }

  if (admin.role !== "admin") {
    return res.json({ success: false, message: "Target account is not an admin" });
  }

  admin.active = false;
  admin.online = false;
  await admin.save();

  const report = new Report({ filename: admin.email, action: "Admin Deactivated", user: superAdmin.fullname, owner: superAdmin._id, date: new Date(), ipAddress: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) });
  await report.save();

  res.json({ success: true, message: "Admin deactivated successfully" });
}));

// ==================== RESET ADMIN PASSWORD ====================
router.post("/admin/reset-password/:adminId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const admin = await User.findById(req.params.adminId);
  if (!admin) {
    return res.json({ success: false, message: "Admin not found" });
  }

  const tempPassword = crypto.randomBytes(8).toString('base64url');
  const hashedPassword = await bcrypt.hash(tempPassword, 12);
  admin.password = hashedPassword;
  await admin.save();

  const report = new Report({ filename: admin.email, action: "Password Reset", user: superAdmin.fullname, owner: superAdmin._id, date: new Date(), ipAddress: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) });
  await report.save();

  res.json({ success: true, message: `Temporary password: ${tempPassword}` });
}));

// ==================== RESET USER/ADMIN PASSWORD ====================
router.post("/account/reset-password/:accountId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const { accountId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    return res.status(400).json({ success: false, message: "Invalid account id" });
  }

  const newPassword = typeof req.body.newPassword === "string" ? req.body.newPassword.trim() : "";
  if (!newPassword || newPassword.length < 6 || newPassword.length > 128) {
    return res.status(400).json({ success: false, message: "Password must be 6-128 characters" });
  }

  const account = await User.findById(accountId);
  if (!account) {
    return res.json({ success: false, message: "Account not found" });
  }

  if (account.role === "super_admin") {
    return res.json({ success: false, message: "Super Admin password reset is not allowed here" });
  }

  const hashedPassword = await bcrypt.hash(newPassword, 12);
  account.password = hashedPassword;
  await account.save();

  const report = new Report({ filename: account.email, action: `Password Reset (${account.role})`, user: superAdmin.fullname, owner: superAdmin._id, date: new Date(), ipAddress: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) });
  await report.save();

  res.json({ success: true, message: `Password updated for ${account.email}` });
}));

// ==================== DELETE GLOBAL FILE ====================
router.post("/file/delete/:fileId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const { fileId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(fileId)) {
    return res.status(400).json({ success: false, message: "Invalid file id" });
  }

  const file = await File.findByIdAndDelete(fileId);
  if (!file) {
    return res.json({ success: false, message: "File not found" });
  }

  await deleteObject(file.filename);

  const report = new Report({ filename: file.filename, action: "Deleted by Super Admin", user: superAdmin.fullname, owner: superAdmin._id, date: new Date(), ipAddress: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300), fileSize: file.sizeBytes || 0 });
  await report.save();

  res.json({ success: true, message: "File deleted successfully" });
}));

// ==================== DELETE USER/ADMIN ACCOUNT ====================
router.post("/account/delete/:accountId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const { accountId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(accountId)) {
    return res.status(400).json({ success: false, message: "Invalid account id" });
  }

  const account = await User.findById(accountId);
  if (!account) {
    return res.json({ success: false, message: "Account not found" });
  }

  if (account.role === "super_admin") {
    return res.json({ success: false, message: "Deleting a super admin account is not allowed" });
  }

  if (String(account._id) === String(superAdmin._id)) {
    return res.json({ success: false, message: "You cannot delete your own account" });
  }

  const ownedFiles = await File.find({ owner: account._id });
  for (const file of ownedFiles) {
    await deleteObject(file.filename);
  }

  await File.deleteMany({ owner: account._id });
  await Notification.deleteMany({ owner: account._id });
  await Report.deleteMany({ owner: account._id });
  await User.deleteOne({ _id: account._id });

  const report = new Report({
    filename: account.email,
    action: `Account Deleted (${account.role})`,
    user: superAdmin.fullname,
    owner: superAdmin._id,
    date: new Date(),
    ipAddress: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });
  await report.save();

  res.json({ success: true, message: `Account ${account.email} deleted successfully` });
}));

// ==================== UPDATE SYSTEM SETTINGS ====================
router.post("/settings/update",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;

  const autoLogoutRaw = Number.parseInt(req.body.autoLogout, 10);
  const autoLogoutMinutes = Number.isFinite(autoLogoutRaw)
    ? Math.min(120, Math.max(5, autoLogoutRaw))
    : 30;
  const notificationsEnabled = req.body.notifications === true || req.body.notifications === "true";
  const aiSortingEnabled = req.body.aiSorting === true || req.body.aiSorting === "true";

  await SystemSettings.findOneAndUpdate(
    { key: "global" },
    {
      $set: {
        notificationsEnabled,
        aiSortingEnabled,
        autoLogoutMinutes,
        updatedBy: superAdmin._id,
        updatedAt: new Date()
      }
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );

  const report = new Report({
    filename: "System Settings",
    action: `Updated: AutoLogout=${autoLogoutMinutes}min, Notifications=${notificationsEnabled ? 'enabled' : 'disabled'}, AISorting=${aiSortingEnabled ? 'enabled' : 'disabled'}`,
    user: superAdmin.fullname,
    owner: superAdmin._id,
    date: new Date(),
    ipAddress: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });
  await report.save();

  res.json({
    success: true,
    message: "Settings updated successfully",
    settings: {
      notificationsEnabled,
      aiSortingEnabled,
      autoLogoutMinutes
    }
  });
}));

// ==================== BRANCH MANAGEMENT ====================
router.get("/branches",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const branches = await Branch.find().populate("branchHead", "fullname email").sort({ name: 1 });
  res.json({ success: true, branches });
}));

router.post("/branch/create",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;
  const { name, code, description, branchHeadId } = req.body;

  if (!name || typeof name !== "string" || !name.trim()) {
    return res.json({ success: false, message: "Branch name is required" });
  }

  const trimmedName = name.trim();
  const existing = await Branch.findOne({ name: trimmedName });
  if (existing) {
    return res.json({ success: false, message: "A branch with this name already exists" });
  }

  const branchData = {
    name: trimmedName,
    code: (code || "").trim(),
    description: (description || "").trim()
  };

  if (branchHeadId && mongoose.Types.ObjectId.isValid(branchHeadId)) {
    branchData.branchHead = branchHeadId;
  }

  const branch = await Branch.create(branchData);

  await AuditLog.create({
    user: superAdmin._id,
    action: "branch_created",
    details: `Created branch: ${trimmedName}`,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "Branch created", branch });
}));

router.post("/branch/update/:branchId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;
  const { branchId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    return res.status(400).json({ success: false, message: "Invalid branch id" });
  }

  const branch = await Branch.findById(branchId);
  if (!branch) {
    return res.json({ success: false, message: "Branch not found" });
  }

  const { name, code, description, branchHeadId, active } = req.body;

  if (name !== undefined) {
    const trimmedName = (name || "").trim();
    if (!trimmedName) {
      return res.json({ success: false, message: "Branch name cannot be empty" });
    }
    const duplicate = await Branch.findOne({ name: trimmedName, _id: { $ne: branch._id } });
    if (duplicate) {
      return res.json({ success: false, message: "Another branch with this name already exists" });
    }
    // Update users who reference the old branch name
    if (branch.name !== trimmedName) {
      await User.updateMany({ branch: branch.name }, { $set: { branch: trimmedName } });
      await File.updateMany({ branch: branch.name }, { $set: { branch: trimmedName } });
    }
    branch.name = trimmedName;
  }
  if (code !== undefined) branch.code = (code || "").trim();
  if (description !== undefined) branch.description = (description || "").trim();
  if (branchHeadId !== undefined) {
    branch.branchHead = (branchHeadId && mongoose.Types.ObjectId.isValid(branchHeadId)) ? branchHeadId : null;
  }
  if (active !== undefined) branch.active = active !== false && active !== "false";

  await branch.save();

  await AuditLog.create({
    user: superAdmin._id,
    action: "branch_updated",
    details: `Updated branch: ${branch.name}`,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "Branch updated", branch });
}));

router.post("/branch/delete/:branchId",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const superAdmin = req.actor;
  const { branchId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(branchId)) {
    return res.status(400).json({ success: false, message: "Invalid branch id" });
  }

  const branch = await Branch.findById(branchId);
  if (!branch) {
    return res.json({ success: false, message: "Branch not found" });
  }

  // Check if branch has users
  const usersInBranch = await User.countDocuments({ branch: branch.name });
  if (usersInBranch > 0) {
    return res.json({ success: false, message: `Cannot delete branch with ${usersInBranch} assigned user(s). Reassign them first.` });
  }

  // Check if branch has files (orphaned files would remain)
  const filesInBranch = await File.countDocuments({ branch: branch.name, deleted: { $ne: true } });
  if (filesInBranch > 0) {
    return res.json({ success: false, message: `Cannot delete branch with ${filesInBranch} active file(s). Delete or reassign files first.` });
  }

  await Branch.findByIdAndDelete(branchId);

  await AuditLog.create({
    user: superAdmin._id,
    action: "branch_deleted",
    details: `Deleted branch: ${branch.name} (${usersInBranch} users verified, ${filesInBranch} files verified)`,
    ip: req.ip || "",
    userAgent: (req.headers["user-agent"] || "").slice(0, 300)
  });

  res.json({ success: true, message: "Branch deleted" });
}));

// Seed branches from static config into Branch collection
router.post("/branch/seed",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  let created = 0;
  for (const name of BRANCH_OPTIONS) {
    const exists = await Branch.findOne({ name });
    if (!exists) {
      await Branch.create({ name });
      created++;
    }
  }
  res.json({ success: true, message: `Seeded ${created} new branch(es)`, total: BRANCH_OPTIONS.length });
}));

// ==================== AUDIT LOG ====================
router.get("/audit-logs",
  requireActor({ mode: "json", notFoundMessage: "Unauthorized" }),
  requireActive({ mode: "json" }),
  requireRole(["super_admin"], { mode: "json" }),
  asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
  const skip = (page - 1) * limit;

  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.userId && mongoose.Types.ObjectId.isValid(req.query.userId)) {
    filter.user = req.query.userId;
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
