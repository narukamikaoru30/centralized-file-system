// models/Notification.js
const mongoose = require("mongoose");

const NOTIFICATION_TYPES = [
  'upload', 'delete', 'download', 'share',
  'system_alert', 'mention', 'message',
  'version', 'restore', 'tag',
  'admin_action', 'quota_warning', 'invite',
  'branch_update', 'security', 'general'
];

const NOTIFICATION_ICONS = {
  upload: '📤', delete: '🗑️', download: '📥', share: '🔗',
  system_alert: '⚠️', mention: '💬', message: '✉️',
  version: '📋', restore: '♻️', tag: '🏷️',
  admin_action: '🛡️', quota_warning: '📊', invite: '📨',
  branch_update: '🏢', security: '🔒', general: '🔔'
};

const notificationSchema = new mongoose.Schema({
  message: { type: String, required: true },
  type: { type: String, enum: NOTIFICATION_TYPES, default: 'general' },
  icon: { type: String, default: '🔔' },
  read: { type: Boolean, default: false },
  date: { type: Date, default: Date.now },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  relatedFile: { type: mongoose.Schema.Types.ObjectId, ref: "File" },
  relatedUser: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  metadata: { type: mongoose.Schema.Types.Mixed }
});

notificationSchema.index({ owner: 1, date: -1 });
notificationSchema.index({ owner: 1, read: 1 });
notificationSchema.index({ type: 1 });

// Auto-set icon from type on save
notificationSchema.pre('save', async function() {
  if (this.isNew && !this.isModified('icon')) {
    this.icon = NOTIFICATION_ICONS[this.type] || '🔔';
  }
});

const Notification = mongoose.model("Notification", notificationSchema);

module.exports = Notification;
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;
module.exports.NOTIFICATION_ICONS = NOTIFICATION_ICONS;
