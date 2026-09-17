const express = require("express");
const router = express.Router();
const path = require("path");
const multer = require("multer");
const User = require("../models/User");
const Notification = require("../models/Notification");
const AuditLog = require("../models/AuditLog");
const Invitation = require("../models/Invitation");
const Branch = require("../models/Branch");
const Report = require("../models/Report");
const File = require("../models/File");
const bcrypt = require("bcrypt");
const rateLimit = require("express-rate-limit");
const BRANCH_OPTIONS = require("../config/branches");
const { requireAuth } = require("../middleware/authMiddleware");
const { sendPushToUser } = require("../utils/pushNotify");
const { getGlobalSystemSettings } = require("../utils/systemSettings");
const { pushFlash, pullFlash } = require("../utils/sessionHelpers");
const { createStorageFilename, putObject, deleteObject } = require("../utils/objectStorage");

// -------------------- MULTER (profile photos) --------------------
const PROFILE_PHOTO_MAX_SIZE = 2 * 1024 * 1024;
const PROFILE_PHOTO_ALLOWED_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];

function sanitizeFilename(filename) {
  const base = path.basename(filename || "file");
  return base.replace(/[^a-zA-Z0-9._-]/g, "_");
}

const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: PROFILE_PHOTO_MAX_SIZE },
  fileFilter: (req, file, cb) => {
    if (!PROFILE_PHOTO_ALLOWED_TYPES.includes(file.mimetype)) {
      return cb(new Error("Only JPG, PNG, GIF, or WEBP images are allowed"));
    }
    cb(null, true);
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

// -------------------- PROFILE UPDATE --------------------
router.post("/user/profile", requireAuth({ mode: "json" }), (req, res) => {
  profileUpload.single("profilePhoto")(req, res, async (uploadErr) => {
    if (uploadErr) {
      if (uploadErr.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({ success: false, message: "Profile photo must be 2MB or smaller" });
      }
      return res.status(400).json({ success: false, message: uploadErr.message || "Invalid profile photo" });
    }

    try {
      const actorEmail = req.user && req.user.email;
      const fullname = (req.body.fullname || "").trim();

      if (!actorEmail) {
        return res.status(400).json({ success: false, message: "Email is required" });
      }

      if (!fullname) {
        return res.status(400).json({ success: false, message: "Full name is required" });
      }

      if (fullname.length > 80) {
        return res.status(400).json({ success: false, message: "Full name must be 80 characters or fewer" });
      }

      const user = req.user;
      if (!user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }

      user.fullname = fullname;
      if (req.file) {
        req.file.filename = createStorageFilename(req.file.originalname);
        await putObject({
          filename: req.file.filename,
          body: req.file.buffer,
          contentType: req.file.mimetype
        });
        if (user.avatar) await deleteObject(user.avatar);
        user.avatar = req.file.filename;
      }
      await user.save();

      AuditLog.create({ user: user._id, action: "profile_update", details: `Updated fullname${req.file ? " and avatar" : ""}`, ip: req.ip || "", userAgent: (req.headers["user-agent"] || "").slice(0, 300) }).catch(() => {});

      const systemSettings = await getGlobalSystemSettings();
      if (systemSettings.notificationsEnabled !== false) {
        const profileNotification = new Notification({
          message: "Profile updated successfully",
          type: "general",
          owner: user._id,
          date: new Date()
        });
        await profileNotification.save();
        sendPushToUser(user._id, { title: "Profile Updated", body: "Your profile was updated successfully", tag: "general" }).catch(() => {});
      }

      try {
        const io = req.app.get("io");
        if (io) {
          io.emit("profileUpdated", {
            email: user.email,
            fullname: user.fullname,
            avatar: user.avatar || ""
          });
        }
      } catch (emitErr) {
        console.error("emit profileUpdated error", emitErr);
      }

      return res.json({
        success: true,
        message: "Profile updated successfully",
        fullname: user.fullname,
        avatar: user.avatar || ""
      });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Unable to update profile" });
    }
  });
});


// -------------------- INVITATION REGISTRATION --------------------
router.get("/invite/:token", async (req, res) => {
  try {
    const invitation = await Invitation.findOne({
      token: req.params.token,
      status: "pending",
      expiresAt: { $gt: new Date() }
    });

    if (!invitation) {
      const flash = { type: "error", message: "Invitation link is invalid or expired" };
      return res.render("register", {
        success: null,
        error: flash.message,
        branches: BRANCH_OPTIONS,
        inviteEmail: "",
        inviteBranch: "",
        inviteToken: ""
      });
    }

    let branches = BRANCH_OPTIONS;
    try {
      const dbBranches = await Branch.find({ active: true }).sort({ name: 1 }).select("name");
      if (dbBranches.length) branches = dbBranches.map(b => b.name);
    } catch (_) {}

    res.render("register", {
      success: null,
      error: null,
      branches,
      inviteEmail: invitation.email,
      inviteBranch: invitation.branch,
      inviteToken: invitation.token
    });
  } catch (err) {
    res.redirect("/auth/register");
  }
});

router.post("/invite/accept", registerLimiter, async (req, res) => {
  const { fullname, password, inviteToken } = req.body;
  try {
    if (!inviteToken) {
      pushFlash(req, res, "error", "Invalid invitation");
      return res.redirect("/auth/register");
    }

    const invitation = await Invitation.findOne({
      token: inviteToken,
      status: "pending",
      expiresAt: { $gt: new Date() }
    });

    if (!invitation) {
      pushFlash(req, res, "error", "Invitation link is invalid or expired");
      return res.redirect("/auth/register");
    }

    const passwordError = User.validatePasswordComplexity(password);
    if (passwordError) {
      pushFlash(req, res, "error", passwordError);
      return res.redirect(`/auth/invite/${inviteToken}`);
    }

    const existingUser = await User.findOne({ email: invitation.email });
    if (existingUser) {
      pushFlash(req, res, "error", "An account with this email already exists");
      return res.redirect("/auth/login");
    }

    // Issue #22 Fix: Check if this email/branch combo already accepted invitation
    const existingAcceptedInvite = await Invitation.findOne({
      email: invitation.email,
      branch: invitation.branch,
      status: "accepted"
    });
    if (existingAcceptedInvite) {
      pushFlash(req, res, "error", "This invitation has already been activated for this branch");
      return res.redirect("/auth/login");
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({
      fullname: (fullname || "").trim(),
      email: invitation.email,
      password: hashedPassword,
      role: invitation.role,
      branch: invitation.branch
    });
    await newUser.save();

    invitation.status = "accepted";
    await invitation.save();

    AuditLog.create({
      user: newUser._id,
      action: "invite_accepted",
      details: `Accepted invitation as ${invitation.role} for branch: ${invitation.branch}`,
      ip: req.ip || "",
      userAgent: (req.headers["user-agent"] || "").slice(0, 300)
    }).catch(() => {});

    pushFlash(req, res, "success", "Account created successfully. Please log in.");
    res.redirect("/auth/login");
  } catch (error) {
    pushFlash(req, res, "error", error.message || "Registration failed");
    res.redirect("/auth/register");
  }
});


// -------------------- REPORTS PAGE --------------------
router.get("/reports", requireAuth({ mode: "redirect", message: "Please log in to view reports" }), async (req, res) => {
  try {
    const user = req.user;
    const flash = req.consumeFlash ? req.consumeFlash() : null;
    const reports = await Report.find({ owner: user._id }).sort({ date: -1 });
    const formattedReports = reports.map(r => ({
      filename: r.filename,
      action: r.action,
      date: r.date ? new Date(r.date).toDateString() : "N/A",
      user: r.user,
      branch: r.branch || user.branch || "N/A"
    }));
    res.render("reports", {
      fullname: user.fullname,
      email: user.email,
      role: user.role,
      reports: formattedReports,
      success: flash && flash.type === "success" ? flash.message : null,
      error: flash && flash.type === "error" ? flash.message : null
    });
  } catch (err) {
    pushFlash(req, res, "error", "Unable to load reports");
    res.redirect("/auth/login");
  }
});

// -------------------- REPORTS DATA (JSON) --------------------
router.get("/reports/data", requireAuth({ mode: "json" }), async (req, res) => {
  try {
    const user = req.user;
    const reports = await Report.find({ owner: user._id }).sort({ date: -1 });

    const fileTypeCounts = { documents: 0, images: 0, others: 0 };
    const uploadsOverTime = {};

    reports.forEach(r => {
      const name = (r.filename || "").toLowerCase();
      if (name.endsWith(".pdf") || name.endsWith(".docx") || name.endsWith(".doc")) fileTypeCounts.documents += 1;
      else if (name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg") || name.endsWith(".gif")) fileTypeCounts.images += 1;
      else fileTypeCounts.others += 1;

      const key = r.date ? new Date(r.date).toDateString() : "Unknown";
      uploadsOverTime[key] = (uploadsOverTime[key] || 0) + 1;
    });

    const uploadsArray = Object.keys(uploadsOverTime).sort((a, b) => new Date(a) - new Date(b)).map(d => ({ date: d, count: uploadsOverTime[d] }));

    res.json({
      success: true,
      reports: reports.map(r => ({
        filename: r.filename,
        action: r.action,
        date: r.date,
        user: r.user,
        branch: r.branch || user.branch || "N/A"
      })),
      stats: { fileTypeCounts, uploadsArray }
    });
  } catch (err) {
    console.error("Reports data error:", err.message);
    res.status(500).json({ success: false, message: "Unable to fetch report data" });
  }
});

// -------------------- REPORTS CSV EXPORT --------------------
router.get("/reports/export.csv", requireAuth({ mode: "json" }), async (req, res) => {
  try {
    const user = req.user;
    const reports = await Report.find({ owner: user._id })
      .sort({ date: -1 })
      .limit(5000)
      .lean();

    const { Parser } = require("json2csv");
    const fields = ["filename", "action", "date", "user", "branch"];
    const rows = reports.map((report) => ({
      filename: report.filename || "",
      action: report.action || "",
      date: report.date || "",
      user: report.user || "",
      branch: report.branch || user.branch || "N/A"
    }));
    const csv = rows.length
      ? new Parser({ fields }).parse(rows)
      : `${fields.join(",")}\r\n`;
    const safeFilename = `my_reports_${new Date().toISOString().slice(0, 10)}.csv`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
    return res.send(csv);
  } catch (err) {
    console.error("Reports CSV export error:", err.message);
    return res.status(500).json({ success: false, message: "Unable to generate CSV report" });
  }
});

// -------------------- NOTIFICATIONS PAGE --------------------
router.get("/notifications", requireAuth({ mode: "redirect", message: "Please log in" }), async (req, res) => {
  try {
    const user = req.user;
    const flash = req.consumeFlash ? req.consumeFlash() : null;
    res.render("notifications", {
      fullname: user.fullname,
      email: user.email,
      role: user.role,
      success: flash && flash.type === "success" ? flash.message : null,
      error: flash && flash.type === "error" ? flash.message : null
    });
  } catch (err) {
    pushFlash(req, res, "error", "Unable to load notifications");
    res.redirect("/auth/login");
  }
});

module.exports = router;
