const express = require("express");
const router = express.Router();
const User = require("../models/User");
const File = require("../models/File");
const Report = require("../models/Report");
const Notification = require("../models/Notification");
const { requireAuth } = require("../middleware/authMiddleware");
const { requireActive, requireRole } = require("../middleware/roleMiddleware");
const BRANCH_OPTIONS = require("../config/branches");
const { getGlobalSystemSettings } = require("../utils/systemSettings");
const { pushFlash } = require("../utils/sessionHelpers");

function getPageOptions(query = {}, defaultLimit = 50, maxLimit = 200) {
  const page = Math.max(Number.parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(Number.parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  return { page, limit, skip: (page - 1) * limit };
}

// -------------------- ADMIN DASHBOARD --------------------
router.get("/admin", requireAuth({ mode: "redirect", message: "Unauthorized" }), requireActive({ mode: "redirect" }), async (req, res) => {
  const admin = req.user;
  if (admin.role !== "admin" && admin.role !== "super_admin") {
    pushFlash(req, res, "error", "Unauthorized");
    return res.redirect("/auth/login");
  }
  return res.redirect("/admin/dashboard");
});

// -------------------- ADMIN USER UPLOADS --------------------
router.get("/admin-user-uploads", requireAuth({ mode: "redirect", message: "Unauthorized" }), requireActive({ mode: "redirect" }), async (req, res) => {
  try {
    const admin = req.user;
    if (admin.role !== "admin" && admin.role !== "super_admin") {
      pushFlash(req, res, "error", "Unauthorized");
      return res.redirect("/auth/login");
    }

    const flash = req.consumeFlash ? req.consumeFlash() : null;

    const userQuery = admin.role === "super_admin"
      ? { role: "user" }
      : { role: "user", branch: admin.branch || "" };
    const userIds = (await User.find(userQuery).select("_id")).map(u => u._id);
    const userFiles = await File.find({ owner: { $in: userIds } })
      .populate("owner", "fullname email role branch")
      .sort({ uploadedAt: -1 })
      .limit(1000);

    res.render("adminUserUploads", {
      email: admin.email,
      fullname: admin.fullname,
      role: admin.role,
      files: userFiles,
      success: flash && flash.type === "success" ? flash.message : null,
      error: flash && flash.type === "error" ? flash.message : null
    });
  } catch (err) {
    if (req.setFlash) req.setFlash("error", "Unable to load user uploads page");
    res.redirect("/auth/admin");
  }
});

// -------------------- SUPER ADMIN DASHBOARD --------------------
router.get("/super",
  requireAuth({ mode: "redirect", message: "Please log in to access the dashboard" }),
  requireActive({ mode: "redirect" }),
  requireRole(["super_admin"], { mode: "redirect" }),
  async (req, res) => {
  try {
    const superAdmin = req.user;
    if (!superAdmin) {
      pushFlash(req, res, "error", "Unauthorized");
      return res.redirect("/auth/login");
    }
    if (superAdmin.role !== "super_admin") {
      pushFlash(req, res, "error", "Unauthorized");
      return res.redirect("/auth/login");
    }

    const flash = req.consumeFlash ? req.consumeFlash() : null;
    const systemSettings = await getGlobalSystemSettings();
    const filePage = getPageOptions({ page: req.query.filePage, limit: req.query.fileLimit }, 50, 100);
    const userPage = getPageOptions(req.query, 100, 200);
    const adminPage = getPageOptions({ page: req.query.adminPage, limit: req.query.adminLimit }, 50, 100);
    const reportPage = getPageOptions({ page: req.query.reportPage, limit: req.query.reportLimit }, 50, 200);

    const totalFiles = await File.countDocuments();
    const totalUsers = await User.countDocuments({ role: "user" });
    const totalAdmins = await User.countDocuments({ role: "admin" });
    const activeAdminAccounts = await User.countDocuments({ role: "admin", active: { $ne: false } });
    const activeUserAccounts = await User.countDocuments({ role: "user", active: { $ne: false } });
    const systemActions = await Report.countDocuments();

    const allFiles = await File.find().populate("owner", "fullname email branch").sort({ uploadedAt: -1 }).skip(filePage.skip).limit(filePage.limit);
    const allUsers = await User.find().select("_id fullname email role branch active status avatar createdAt").sort({ _id: -1 }).skip(userPage.skip).limit(userPage.limit);
    const allAdmins = await User.find({ role: "admin" }).select("_id fullname email role branch active status avatar createdAt").sort({ _id: -1 }).skip(adminPage.skip).limit(adminPage.limit);
    const auditLogs = await Report.find().sort({ date: -1 }).skip(reportPage.skip).limit(reportPage.limit);
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
    const branchAdminAssignments = BRANCH_OPTIONS.map((branchName) => ({
      branch: branchName,
      adminEmail: branchAdminLookup.get(branchName) || ""
    }));

    res.render("superadmindashboard", {
      email: superAdmin.email,
      fullname: superAdmin.fullname,
      role: superAdmin.role,
      avatar: superAdmin.avatar || "",
      stats: {
        totalFiles,
        totalUsers,
        totalAdmins,
        activeAdminAccounts,
        activeUserAccounts,
        systemActions
      },
      files: allFiles,
      users: allUsers,
      admins: allAdmins,
      systemSettings,
      branchAdminAssignments,
      auditLogs,
      pagination: {
        files: { page: filePage.page, limit: filePage.limit },
        users: { page: userPage.page, limit: userPage.limit },
        admins: { page: adminPage.page, limit: adminPage.limit },
        reports: { page: reportPage.page, limit: reportPage.limit }
      },
      recentNotifications,
      success: flash && flash.type === "success" ? flash.message : null,
      error: flash && flash.type === "error" ? flash.message : null
    });
  } catch (err) {
    pushFlash(req, res, "error", err.message || "Unable to load super admin dashboard");
    res.redirect("/auth/login");
  }
});

// -------------------- USER DASHBOARD --------------------
router.get("/user", requireAuth({ mode: "redirect", message: "Please log in to access the dashboard" }), async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      pushFlash(req, res, "error", "User not found");
      return res.redirect("/auth/login");
    }

    const flash = req.consumeFlash ? req.consumeFlash() : null;
    const systemSettings = await getGlobalSystemSettings();
    const filePage = getPageOptions(req.query, 100, 200);
    const sharedPage = getPageOptions({ page: req.query.sharedPage, limit: req.query.sharedLimit }, 100, 200);

    let files = [];
    try {
      files = await File.find({ owner: user._id, deleted: { $ne: true } }).sort({ uploadedAt: -1 }).skip(filePage.skip).limit(filePage.limit);
    } catch (err) {
      console.log("Error fetching files:", err.message);
    }

    let sharedFiles = [];
    try {
      // 🔧 Fix #8: Query shared files with expiry/revocation check
      const now = new Date();
      sharedFiles = await File.find({
        sharedWith: {
          $elemMatch: {
            userId: user._id,
            revoked: { $ne: true },
            $or: [
              { expiresAt: { $exists: false } },
              { expiresAt: null },
              { expiresAt: { $gt: now } }
            ]
          }
        },
        deleted: { $ne: true }
      }).populate("owner", "fullname email").sort({ uploadedAt: -1 }).skip(sharedPage.skip).limit(sharedPage.limit);
    } catch (err) {
      console.log("Error fetching shared files:", err.message);
    }

    // Files uploaded by colleagues in the same office are shared automatically.
    // Do not match an empty branch: unassigned accounts must not see each other's files.
    if (user.branch) {
      try {
        const officeFiles = await File.find({
          branch: user.branch,
          owner: { $ne: user._id },
          deleted: { $ne: true }
        })
          .populate("owner", "fullname email branch")
          .sort({ uploadedAt: -1 })
          .limit(200);

        const knownIds = new Set(sharedFiles.map(file => String(file._id)));
        sharedFiles.push(...officeFiles.filter(file => !knownIds.has(String(file._id))));
        sharedFiles.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
      } catch (err) {
        console.log("Error fetching office files:", err.message);
      }
    }

    res.render("userdashboard", {
      userId: String(user._id),
      fullname: user.fullname,
      email: user.email,
      role: user.role,
      avatar: user.avatar || "",
      totpEnabled: user.totpEnabled || false,
      systemSettings,
      files,
      sharedFiles,
      pagination: {
        files: { page: filePage.page, limit: filePage.limit },
        sharedFiles: { page: sharedPage.page, limit: sharedPage.limit }
      },
      success: flash && flash.type === "success" ? flash.message : null,
      error: flash && flash.type === "error" ? flash.message : null,
      viewReports: req.query.viewReports || null
    });
  } catch (err) {
    console.error("User dashboard error:", err.message);
    pushFlash(req, res, "error", "Unable to load dashboard");
    res.redirect("/auth/login");
  }
});

module.exports = router;
