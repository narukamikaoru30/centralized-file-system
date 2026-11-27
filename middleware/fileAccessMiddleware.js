const File = require("../models/File");

function sameId(left, right) {
  return left != null && right != null && String(left) === String(right);
}

function sameBranch(user, file) {
  return Boolean(user?.branch && file?.branch && String(user.branch) === String(file.branch));
}

function hasActiveShare(file, userId) {
  return (file?.sharedWith || []).some((share) => {
    const sharedUserId = share?.userId || share;
    if (!sameId(sharedUserId, userId)) return false;
    if (share?.revoked) return false;
    return !(share?.expiresAt && new Date(share.expiresAt) <= new Date());
  });
}

function canAccessFile(user, file) {
  if (!user || !file || file.deleted) return false;
  if (user.role === "super_admin") return true;
  if (user.role === "admin") return sameBranch(user, file);
  return sameBranch(user, file)
    && (sameId(file.owner, user._id) || hasActiveShare(file, user._id));
}

function requireFileAccess(options = {}) {
  const paramName = options.paramName || "fileId";
  return async function fileAccessMiddleware(req, res, next) {
    try {
      const file = await File.findById(req.params[paramName]).lean();
      if (!file) return res.status(404).json({ success: false, message: "File not found" });
      if (!canAccessFile(req.user, file)) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
      req.file = file;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { canAccessFile, hasActiveShare, requireFileAccess };
