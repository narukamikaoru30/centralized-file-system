const mongoose = require("mongoose");

const SENSITIVE_USER_FIELDS = [
  "password",
  "totpSecret",
  "recoveryCodes",
  "resetToken",
  "resetTokenExpires",
  "totpLastUsedWindow",
  "totpLastUsedCodeHash"
];

const userSchema = new mongoose.Schema({
  fullname: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true }, // hashed with bcrypt
  role: { type: String, enum: ["user", "admin", "super_admin"], default: "user" },
  branch: { type: String, default: "" },
  active: { type: Boolean, default: true },
  status: { type: String, enum: ["active", "inactive", "suspended"], default: "active" },
  suspendedReason: { type: String, default: "" },
  suspendedUntil: { type: Date, default: null },
  avatar: { type: String, default: "" },
  online: { type: Boolean, default: false },
  lastOnline: { type: Date },

  // Account lockout
  failedLoginAttempts: { type: Number, default: 0 },
  lockUntil: { type: Date, default: null },

  // TOTP 2FA
  totpSecret: { type: String, default: "" },
  totpEnabled: { type: Boolean, default: false },
  recoveryCodes: { type: [String], default: [] },
  totpLastUsedWindow: { type: Number, default: null },
  totpLastUsedCodeHash: { type: String, default: "" },

  // Password reset
  resetToken: { type: String, default: "" },
  resetTokenExpires: { type: Date, default: null }
});

function stripSensitiveUserFields(_doc, ret) {
  for (const field of SENSITIVE_USER_FIELDS) delete ret[field];
  return ret;
}

userSchema.set("toJSON", { transform: stripSensitiveUserFields });
userSchema.set("toObject", { transform: stripSensitiveUserFields });

userSchema.methods.isLocked = function () {
  return this.lockUntil && this.lockUntil > Date.now();
};

userSchema.methods.isSuspended = function () {
  if (this.status !== "suspended") return false;
  // Auto-reactivate if suspension has expired
  if (this.suspendedUntil && this.suspendedUntil <= new Date()) {
    return false;
  }
  return true;
};

// Password complexity validation (static helper)
userSchema.statics.validatePasswordComplexity = function (password) {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long";
  }
  if (!/[A-Z]/.test(password)) {
    return "Password must contain at least one uppercase letter";
  }
  if (!/[a-z]/.test(password)) {
    return "Password must contain at least one lowercase letter";
  }
  if (!/[0-9]/.test(password)) {
    return "Password must contain at least one number";
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return "Password must contain at least one special character";
  }
  return null; // valid
};

module.exports = mongoose.model("User", userSchema);
