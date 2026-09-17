const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: {
    type: String,
    enum: [
      "login", "logout", "login_failed",
      "profile_update", "password_change", "role_change",
      "2fa_enabled", "2fa_disabled",
      "account_created", "account_deactivated", "account_suspended", "account_reactivated",
      "invite_sent", "invite_accepted",
      "branch_created", "branch_updated", "branch_deleted",
      "file_deleted", "file_created", "file_viewed", "file_downloaded", "file_shared"
    ],
    required: true
  },
  details: { type: String, default: "" },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
  ip: { type: String, default: "" },
  userAgent: { type: String, default: "" },
  timestamp: { type: Date, default: Date.now }
});

auditLogSchema.index({ user: 1, timestamp: -1 });
auditLogSchema.index({ action: 1 });
auditLogSchema.index({ timestamp: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
