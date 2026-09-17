# Critical Issues Remediation Guide

Quick reference for fixing the 8 critical data integrity issues identified in the system audit.

---

## Issue 1: Upload Error Cleanup - Silent File Orphaning

### Current Code (routes/files.js:115)
```javascript
if (!csrfValidation.valid) {
  (req.files || []).forEach(f => {
    try { fs.unlinkSync(path.join(__dirname, "../uploads", f.filename)); } catch (_) {}
  });
  return uploadErrorResponse(req, res, csrfValidation.message, 403);
}
```

### Problem
- Silent catch blocks hide filesystem errors
- No audit trail when cleanup fails
- Temp files orphan if permission denied or disk full

### Solution
Create `utils/fileCleanup.js`:

```javascript
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * Safely cleanup uploaded files with logging
 * @param {Array} files - multer file objects with {filename, path}
 * @param {Object} context - {reason, userId, correlationId, etc}
 * @returns {Object} {cleaned: number, failed: Array}
 */
function cleanupUploadFiles(files = [], context = {}) {
  if (!files || !files.length) return { cleaned: 0, failed: [] };

  const results = { cleaned: 0, failed: [] };
  const uploadsDir = path.join(__dirname, '../uploads');

  files.forEach(file => {
    const filepath = path.join(uploadsDir, file.filename);
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        results.cleaned++;
        logger.debug('[FileCleanup] Deleted', { 
          filename: file.filename, 
          ...context 
        });
      }
    } catch (err) {
      results.failed.push({
        filename: file.filename,
        error: err.code,
        message: err.message
      });
      logger.warn('[FileCleanup] Failed to delete', { 
        filename: file.filename,
        error: err.message,
        context 
      });
    }
  });

  if (results.failed.length > 0) {
    logger.error('[FileCleanup] Cleanup had failures', {
      total: files.length,
      cleaned: results.cleaned,
      failed: results.failed.length,
      details: results.failed,
      context
    });
  }

  return results;
}

module.exports = { cleanupUploadFiles };
```

Then in routes/files.js:

```javascript
const { cleanupUploadFiles } = require('../utils/fileCleanup');

// Line ~115: Replace forEach with:
if (!csrfValidation.valid) {
  const cleanup = cleanupUploadFiles(req.files, { 
    reason: 'csrf_validation_failed',
    userId: req.user?._id 
  });
  if (cleanup.failed.length > 0) {
    logger.warn('[Upload] CSRF cleanup incomplete', {
      filesFailed: cleanup.failed.length,
      files: cleanup.failed
    });
    // Optionally notify admin of orphaned files
  }
  return uploadErrorResponse(req, res, csrfValidation.message, 403);
}

// Line ~156, 169, 184, 199, 220, 283, 349: Replace all similar patterns
files.forEach(f => {
  try { fs.unlinkSync(path.join(__dirname, "../uploads", f.filename)); } catch (_) {}
});

// With:
cleanupUploadFiles(files, { 
  reason: 'upload_validation_failed',
  validationType: 'filetype_mismatch',  // or quota_exceeded, etc
  userId: req.user?._id 
});
```

---

## Issue 2: Recycle Bin Cleanup - Version Files Not Cleaned

### Current Code (server.js:404)
```javascript
for (const file of expiredFiles) {
  const allFilenames = [file.filename, ...file.versions.map(v => v.filename)];
  for (const fn of allFilenames) {
    try { fs.unlinkSync(path.join(__dirname, "uploads", fn)); } catch (_) {}
  }
  await File.findByIdAndDelete(file._id);  // ← DB deleted even if FS cleanup failed
}
```

### Problem
- If FS delete fails for ANY version file, DB record still deleted
- Orphaned files remain on disk indefinitely
- Storage quota incorrect

### Solution
Replace in server.js startRecycleBinCleanupJob():

```javascript
async function startRecycleBinCleanupJob() {
  const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;

  async function runRecycleBinCleanup() {
    try {
      const settings = await SystemSettings.findOne({});
      const days = (settings && settings.recycleBinDays) || 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const expiredFiles = await File.find({ deleted: true, deletedAt: { $lt: cutoff } });
      if (!expiredFiles.length) return;

      const results = { successful: 0, partialCleanup: 0, failed: 0 };

      for (const file of expiredFiles) {
        const allFilenames = [file.filename, ...file.versions.map(v => v.filename)];
        const fsResults = { deleted: 0, failed: [] };

        // Try to delete all physical files
        for (const fn of allFilenames) {
          try {
            const filepath = path.join(__dirname, "uploads", fn);
            if (fs.existsSync(filepath)) {
              fs.unlinkSync(filepath);
              fsResults.deleted++;
            }
          } catch (err) {
            fsResults.failed.push({ 
              filename: fn, 
              error: err.code || err.message 
            });
          }
        }

        // Only delete DB record if ALL files successfully deleted
        if (fsResults.failed.length === 0) {
          try {
            await File.findByIdAndDelete(file._id);
            results.successful++;
          } catch (dbErr) {
            logger.error('[RecycleBin] DB deletion failed', {
              fileId: file._id,
              error: dbErr.message
            });
            results.failed++;
          }
        } else {
          // Partial cleanup - keep DB record for retry
          logger.warn('[RecycleBin] Partial cleanup - keeping DB record', {
            fileId: file._id,
            filename: file.originalName,
            filesDeleted: fsResults.deleted,
            filesFailed: fsResults.failed.length,
            failedFiles: fsResults.failed
          });
          results.partialCleanup++;
        }
      }

      logger.info(`[RecycleBin] Cleanup complete: ${results.successful} successful, ${results.partialCleanup} partial, ${results.failed} failed`);
    } catch (err) {
      logger.error("[RecycleBin Cleanup] Error:", err.message);
    }
  }

  runRecycleBinCleanup();
  setInterval(runRecycleBinCleanup, CLEANUP_INTERVAL_MS);
  console.log("ℹ️ Recycle bin cleanup job scheduled (every 12 hours)");
}
```

---

## Issue 3: File Versioning - Race Condition

### Current Code (routes/files.js:225)
```javascript
const existingFile = await File.findOne({
  owner: user._id,
  originalName: file.originalname,
  deleted: { $ne: true }
});

if (existingFile) {
  existingFile.versions.push({
    filename: existingFile.filename,
    sizeBytes: existingFile.sizeBytes,
    contentHash: existingFile.contentHash,
    uploadedAt: existingFile.uploadedAt
  });
  existingFile.filename = file.filename;
  existingFile.sizeBytes = file.size;
  // ... more updates
  await existingFile.save();  // ← Not atomic, can lose concurrent updates
}
```

### Problem
- Two concurrent uploads of same filename → both update same document
- Last save wins, earlier version history lost
- Data corruption in version tracking

### Solution
Use atomic MongoDB operations:

```javascript
// Replace the version update logic with atomic operation
if (existingFile) {
  try {
    const updated = await File.findByIdAndUpdate(
      existingFile._id,
      {
        $push: {
          versions: {
            filename: existingFile.filename,
            sizeBytes: existingFile.sizeBytes,
            mimeType: existingFile.mimeType,
            contentHash: existingFile.contentHash,
            uploadedAt: existingFile.uploadedAt
          }
        },
        $set: {
          filename: file.filename,
          sizeBytes: file.size,
          mimeType: file.mimetype,
          contentHash: contentHash,
          filetype: filetype,
          uploadedAt: new Date(),
          version: (existingFile.version || 1) + 1,
          tags: tags.length ? tags : existingFile.tags
        }
      },
      { new: true, runValidators: true }
    );

    if (!updated) {
      // File was deleted or something else happened between findOne and update
      return uploadErrorResponse(
        req, 
        res, 
        "File no longer exists or was modified", 
        409
      );
    }

    versionedFiles.push(file.originalname);
    uploadedCount++;

  } catch (updateErr) {
    logger.error('[Upload] Version update failed', {
      fileId: existingFile._id,
      error: updateErr.message
    });
    
    // Clean up the uploaded file since version update failed
    cleanupUploadFiles([file], { 
      reason: 'version_update_failed',
      fileId: existingFile._id 
    });
    
    return uploadErrorResponse(
      req,
      res,
      'Failed to version file. Please try again.',
      500
    );
  }
}
```

---

## Issue 4: Session Cache - Unhandled Promise

### Current Code (middleware/sessionMiddleware.js:38)
```javascript
async function getAutoLogoutMinutes() {
  const now = Date.now();
  if (now - autoLogoutCacheUpdatedAt < AUTO_LOGOUT_CACHE_TTL_MS) {
    return autoLogoutCacheMinutes;
  }

  try {
    const settings = await SystemSettings.findOne({ key: "global" }).select("autoLogoutMinutes").lean();
    const raw = Number.parseInt(settings && settings.autoLogoutMinutes, 10);
    autoLogoutCacheMinutes = Number.isFinite(raw) ? Math.min(120, Math.max(5, raw)) : 30;
  } catch (_) {  // ← Silent catch
    autoLogoutCacheMinutes = 30;  // Falls back without any indication
  }

  autoLogoutCacheUpdatedAt = now;
  return autoLogoutCacheMinutes;
}
```

### Problem
- DB failure results in silent fallback
- No way to know if using cached vs. actual setting
- Stale timeout forever if DB unreachable

### Solution
Replace with:

```javascript
async function getAutoLogoutMinutes() {
  const now = Date.now();
  
  // Check if cache is still fresh
  if (now - autoLogoutCacheUpdatedAt < AUTO_LOGOUT_CACHE_TTL_MS) {
    return autoLogoutCacheMinutes;
  }

  try {
    const settings = await SystemSettings.findOne({ 
      key: "global" 
    }).select("autoLogoutMinutes").lean();
    
    const raw = Number.parseInt(settings?.autoLogoutMinutes, 10);
    const newValue = Number.isFinite(raw) ? Math.min(120, Math.max(5, raw)) : 30;
    
    // Update cache with new value
    autoLogoutCacheMinutes = newValue;
    autoLogoutCacheUpdatedAt = now;
    
    logger.debug('[SessionMiddleware] Auto-logout cache refreshed', { 
      minutes: newValue 
    });
    
    return newValue;
    
  } catch (err) {
    logger.error('[SessionMiddleware] Failed to fetch auto-logout setting', {
      error: err.message,
      usingFallback: autoLogoutCacheMinutes,
      cacheAge: now - autoLogoutCacheUpdatedAt
    });
    
    // Use stale cache if available, otherwise 30 min default
    // But mark that we're using a fallback
    if (now - autoLogoutCacheUpdatedAt > AUTO_LOGOUT_CACHE_TTL_MS * 10) {
      // Cache is VERY stale (10x TTL), might be DB down for a while
      logger.warn('[SessionMiddleware] Using very stale cache', {
        minutes: autoLogoutCacheMinutes,
        staleAge: now - autoLogoutCacheUpdatedAt
      });
    }
    
    return autoLogoutCacheMinutes;
  }
}
```

---

## Issue 5: Admin Role Change - Race Condition

### Current Code (routes/admin.js:137)
```javascript
const existingBranchAdmin = await User.findOne({
  role: 'admin',
  branch: targetBranch,
  active: true,
  _id: { $ne: targetUser._id }
});

if (existingBranchAdmin) {
  return res.json({ success: false, message: `Branch already has an active admin` });
}

// Between query above and update below, another admin can be created
const user = await User.findByIdAndUpdate(
  req.body.userId,
  { role: req.body.role },
  { new: true }
);
```

### Problem
- Race condition: check and update not atomic
- Two concurrent admin promotions can create 2 admins

### Solution
Add unique index to User schema and catch duplicate key error:

```javascript
// In models/User.js:

userSchema.index(
  { branch: 1, role: 1, active: 1 }, 
  { 
    unique: true, 
    sparse: true,
    partialFilterExpression: { 
      active: true, 
      role: 'admin'  // Only enforce uniqueness for active admins
    },
    name: 'unique_branch_admin_active'
  }
);
```

Then in routes/admin.js:

```javascript
try {
  const user = await User.findByIdAndUpdate(
    req.body.userId,
    { 
      role: req.body.role,
      branch: selectedBranch 
    },
    { new: true, runValidators: true }
  );

  if (!user) {
    return res.json({ 
      success: false, 
      message: "User not found" 
    });
  }

  // Log the role change
  await AuditLog.create({
    user: req.user._id,
    action: 'role_changed',
    target: user._id,
    oldValue: targetUser.role,
    newValue: req.body.role,
    branch: req.user.branch
  });

  res.json({ success: true, message: "Role updated", user });

} catch (err) {
  // Check for duplicate key error (another admin already created)
  if (err.code === 11000 && err.keyPattern.role === 1 && err.keyPattern.branch === 1) {
    logger.warn('[Admin] Duplicate admin attempt blocked by unique index', {
      userId: req.body.userId,
      branch: selectedBranch
    });
    return res.json({ 
      success: false, 
      message: "This branch already has an active admin. Cannot have multiple admins per branch." 
    });
  }
  
  logger.error('[Admin] Failed to update role', { error: err.message });
  return res.status(500).json({ 
    success: false, 
    message: "Failed to update role" 
  });
}
```

---

## Issue 6: Recycle Bin - File Restoration Name Collision

### Current Code (routes/files.js:604)
```javascript
const file = await File.findById(req.params.fileId);
if (!file.deleted) return res.status(400).json(...);

file.deleted = false;
file.deletedAt = null;
await file.save();

res.json({ success: true, message: "File restored" });
```

### Problem
- Restores to same name even if new file exists with that name
- Metadata collision in UI

### Solution

```javascript
const file = await File.findById(req.params.fileId);
if (!file.deleted) {
  return res.status(400).json({ 
    success: false, 
    message: "File is not in recycle bin" 
  });
}

// Check for name collision with active files
const collision = await File.findOne({
  owner: file.owner,
  originalName: file.originalName,
  deleted: { $ne: true },
  _id: { $ne: file._id }
});

if (collision) {
  // Rename on restore
  const timestamp = new Date().toISOString().split('T')[0];
  const ext = path.extname(file.originalName);
  const baseName = path.basename(file.originalName, ext);
  file.originalName = `${baseName} (restored ${timestamp})${ext}`;
  
  logger.info('[FileRestore] Name collision - renamed on restore', {
    fileId: file._id,
    originalName: collision.originalName,
    newName: file.originalName
  });
}

try {
  file.deleted = false;
  file.deletedAt = null;
  await file.save();
  
  res.json({ 
    success: true, 
    message: "File restored",
    renamed: !!collision,
    filename: file.originalName
  });
} catch (err) {
  logger.error('[FileRestore] Failed to restore', { 
    error: err.message,
    fileId: file._id 
  });
  return res.status(500).json({ 
    success: false, 
    message: "Failed to restore file" 
  });
}
```

---

## Issue 7: Invitation Token - Expiry Validation

### Current Code (routes/profile.js:182)
```javascript
const invitation = await Invitation.findOne({
  token: hashedToken,
  status: 'pending'
  // ← Missing expiry check
});

if (!invitation) {
  return res.redirect("/auth/register");
}
```

### Problem
- Expired invitations accepted
- No audit trail

### Solution

```javascript
const invitation = await Invitation.findOne({
  token: hashedToken,
  status: 'pending',
  expiresAt: { $gt: new Date() }  // ← Add this
});

if (!invitation) {
  // Log attempt with masked token
  const maskedToken = hashedToken.substring(0, 8) + '...';
  logger.warn('[Invitation] Invalid or expired token', {
    maskedToken,
    ipAddress: req.ip
  });
  
  return res.render("register", {
    flash: { error: "Invalid or expired invitation" }
  });
}

// Additional: check user hasn't used this email already
const existingUser = await User.findOne({ email: invitation.email });
if (existingUser) {
  logger.info('[Invitation] User already exists', {
    email: invitation.email
  });
  return res.redirect("/auth/login");
}

// Accept invitation
try {
  invitation.status = 'accepted';
  invitation.acceptedAt = new Date();
  await invitation.save();
  
  logger.info('[Invitation] Accepted', {
    email: invitation.email,
    invitedBy: invitation.invitedBy
  });
  
  // Redirect to registration with pre-filled email
  res.render("register", {
    inviteEmail: invitation.email,
    inviteToken: req.params.token
  });
} catch (err) {
  logger.error('[Invitation] Failed to accept', {
    error: err.message,
    email: invitation.email
  });
  return res.status(500).render("register", {
    flash: { error: "Failed to process invitation" }
  });
}
```

---

## Issue 8: ShareLink Download Counter - Race Condition

### Current Code (server.js:197)
```javascript
const link = await ShareLink.findOneAndUpdate(
  { _id: linkId, 'file': fileId },
  { $inc: { 'downloads': 1 } },
  { new: true }
);

if (maxDownloads > 0 && link.downloads >= maxDownloads) {
  // Delete after check - might be too late for concurrent requests
}
```

### Problem
- Two concurrent downloads both see old count
- Both might trigger limit deletion
- Link deleted while user downloading

### Solution

```javascript
/**
 * Atomic increment and check if limit reached
 * @returns {Object} { allowed: bool, shouldDelete: bool, downloads: number }
 */
async function atomicDownloadCountCheck(linkId, maxDownloads) {
  if (maxDownloads <= 0) {
    // No limit, just increment
    const updated = await ShareLink.findByIdAndUpdate(
      linkId,
      { $inc: { downloads: 1 } },
      { new: true }
    );
    return { 
      allowed: !!updated, 
      shouldDelete: false,
      downloads: updated?.downloads || 0
    };
  }

  // With limit - use transaction-like logic
  try {
    // First increment
    const beforeIncrement = await ShareLink.findById(linkId);
    
    if (!beforeIncrement) {
      return { allowed: false, reason: 'Link not found' };
    }

    if (beforeIncrement.downloads >= maxDownloads) {
      return { 
        allowed: false, 
        reason: 'Download limit already reached',
        downloads: beforeIncrement.downloads
      };
    }

    // Increment atomically
    const updated = await ShareLink.findByIdAndUpdate(
      linkId,
      { $inc: { downloads: 1 } },
      { new: true }
    );

    const limitReached = maxDownloads > 0 && updated.downloads >= maxDownloads;

    return { 
      allowed: true,
      shouldDelete: limitReached,
      downloads: updated.downloads
    };

  } catch (err) {
    logger.error('[ShareLink] Download count check failed', {
      linkId,
      error: err.message
    });
    return { 
      allowed: false, 
      reason: 'Database error',
      retryable: true
    };
  }
}

// Usage in download handler (server.js)
app.get('/share/:linkId/:fileId/download', async (req, res) => {
  try {
    const check = await atomicDownloadCountCheck(req.params.linkId, maxDownloads);
    
    if (!check.allowed) {
      return res.status(410).send('Download limit reached or link invalid');
    }

    // Stream file to user
    res.sendFile(filePath);

    // After successful send, delete if limit reached
    if (check.shouldDelete) {
      try {
        await ShareLink.findByIdAndDelete(req.params.linkId);
        logger.info('[ShareLink] Link deleted after download limit', {
          linkId: req.params.linkId,
          downloads: check.downloads
        });
      } catch (err) {
        logger.error('[ShareLink] Failed to delete link', {
          linkId: req.params.linkId,
          error: err.message
        });
      }
    }

  } catch (err) {
    logger.error('[ShareLink] Download failed', {
      error: err.message,
      linkId: req.params.linkId
    });
    res.status(500).send('Error processing download');
  }
});
```

---

## Testing Commands

```bash
# Test file cleanup logging
npm test -- --grep "file cleanup"

# Test version history race condition
npm test -- --grep "concurrent upload same filename"

# Test admin role unique constraint
npm test -- --grep "duplicate admin"

# Test invitation expiry
npm test -- --grep "expired invitation"

# Integration test: upload -> CSRF fail -> verify cleanup
npm run test:e2e -- --grep "upload csrf cleanup"

# Stress test: quota enforcement with concurrent uploads
npm run test:stress -- concurrent-uploads --users=5 --files-per-user=10
```

---

## Deployment Checklist

- [ ] Add index for unique branch admin
- [ ] Deploy sessionMiddleware logging changes
- [ ] Deploy fileCleanup utility and add to all upload error paths
- [ ] Deploy atomic file version update
- [ ] Deploy recycle bin transactional cleanup
- [ ] Update invitation acceptance with expiry check
- [ ] Update file restoration with collision detection
- [ ] Update share link download counter logic
- [ ] Monitor logs for errors during first 24h
- [ ] Review orphaned files directory weekly
- [ ] Run data integrity check: `npm run audit:orphaned-files`

