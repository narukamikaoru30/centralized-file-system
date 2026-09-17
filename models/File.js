const mongoose = require("mongoose");

const fileVersionSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  sizeBytes: { type: Number, default: 0 },
  contentHash: { type: String, default: "" },
  uploadedAt: { type: Date, default: Date.now }
}, { _id: true });

const fileSchema = new mongoose.Schema({
  filename: { type: String, required: true },
  filetype: { type: String, enum: ["document", "image", "report"], required: true },
  originalName: { type: String, default: "" },
  sizeBytes: { type: Number, default: 0 },
  mimeType: { type: String, default: "" },
  contentHash: { type: String, default: "" },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  branch: { type: String, default: "" },
  uploadedAt: { type: Date, default: Date.now },

  // File Tagging
  tags: [{ type: String, trim: true, lowercase: true }],

  // File Versioning
  versions: [fileVersionSchema],
  version: { type: Number, default: 1 },

  // File Sharing - 🔐 Fix #8: Track expiry and revocation
  sharedWith: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    sharedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },  // null = no expiry
    revoked: { type: Boolean, default: false }
  }],

  // Recycle Bin (soft delete)
  deleted: { type: Boolean, default: false },
  deletedAt: { type: Date, default: null },

  // Blockchain Integration
  blockchainHash: { type: String, default: null, index: true },
  blockchainTxHash: { type: String, default: null, index: true },
  blockchainSynced: { type: Boolean, default: false },
  blockchainRegisteredAt: { type: Date, default: null }
});

fileSchema.index({ owner: 1, filetype: 1, uploadedAt: -1, contentHash: 1 });
fileSchema.index({ owner: 1, filetype: 1, uploadedAt: -1, originalName: 1, sizeBytes: 1 });
fileSchema.index({ tags: 1 });
fileSchema.index({ deleted: 1, deletedAt: 1 });
fileSchema.index({ sharedWith: 1 });
fileSchema.index({ originalName: "text", tags: "text" });

module.exports = mongoose.model("File", fileSchema);
