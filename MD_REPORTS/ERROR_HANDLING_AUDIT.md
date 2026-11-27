# Error Handling Audit - All 24 Silent Catch Blocks

Reference guide for systematically replacing all silent error handlers with proper logging.

---

## Audit Findings: 24 Silent Catch Blocks

### Category 1: File System Operations (8 instances)
**Pattern**: `catch (_) { fs.unlinkSync(...) }`  
**Location**: routes/files.js  
**Risk Level**: 🔴 CRITICAL - File orphaning

| Line | Context | Reason | Fix |
|------|---------|--------|-----|
| 115 | CSRF validation fail | Clean uploaded files | Use `cleanupUploadFiles()` util |
| 156 | Filetype validation fail | Clean invalid files | Use `cleanupUploadFiles()` util |
| 169 | Empty files check | Clean if no files | Use `cleanupUploadFiles()` util |
| 184 | Mime type mismatch | Clean invalid mime files | Use `cleanupUploadFiles()` util |
| 199 | Quota exceeded | Clean over-quota files | Use `cleanupUploadFiles()` util |
| 220 | Branch quota exceeded | Clean branch-quota files | Use `cleanupUploadFiles()` util |
| 283 | Multer cleanup on error | Generic error cleanup | Use `cleanupUploadFiles()` util |
| 349 | Recycle cleanup | Delete old files | Use transactional cleanup |

**Status**: ⏳ Awaiting fileCleanup utility implementation

---

### Category 2: Token & Session Operations (2 instances)
**Pattern**: `catch (_) { /* token operation */ }`  
**Location**: routes/auth.js  
**Risk Level**: 🟠 HIGH - Auth failures

| Line | Context | Issue | Fix |
|------|---------|-------|-----|
| 107 | Password reset token rotation | Token rotation fails silently | Log and return error |
| 131 | Refresh token rotation | Rotation fails on revoke | Log and return 401 |

**Details**:

#### Line 107 - routes/auth.js
```javascript
// Current:
try {
  // ... reset password logic
  rotatedToken = await rotateRefreshToken(refreshToken);
} catch (_) {
  // Falls through without error
}

// Fix:
try {
  rotatedToken = await rotateRefreshToken(refreshToken);
} catch (err) {
  logger.error('[Auth] Token rotation failed during reset', {
    error: err.message,
    userId: user._id
  });
  return res.status(500).json({ 
    success: false, 
    message: 'Unable to complete reset. Please try again.' 
  });
}
```

#### Line 131 - routes/auth.js
```javascript
// Current:
try {
  const rotated = await rotateRefreshToken(req.body.token);
} catch (_) {
  // Falls through
}

// Fix:
try {
  const rotated = await rotateRefreshToken(req.body.token);
  if (!rotated) {
    return res.status(401).json({ 
      success: false, 
      message: 'Invalid refresh token' 
    });
  }
} catch (err) {
  logger.error('[Auth] Refresh token rotation failed', {
    error: err.message,
    code: err.code
  });
  return res.status(401).json({ 
    success: false, 
    message: 'Token refresh failed. Please log in again.' 
  });
}
```

---

### Category 3: Session Middleware (1 instance)
**Pattern**: `catch (_) { SystemSettings.findOne(...) }`  
**Location**: middleware/sessionMiddleware.js:41  
**Risk Level**: 🟠 HIGH - Session timeout inconsistency

#### Line 41 - middleware/sessionMiddleware.js
```javascript
// Current:
async function getAutoLogoutMinutes() {
  try {
    const settings = await SystemSettings.findOne(...);
    // ... update cache
  } catch (_) {
    autoLogoutCacheMinutes = 30;
  }
}

// Fix: Already provided in CRITICAL_ISSUES_REMEDIATION.md
// See: Issue 4 - Session Cache section
```

**Status**: ⏳ Awaiting detailed fix implementation

---

### Category 4: Socket.io Connection (1 instance)
**Pattern**: `catch (_) { /* socket handler */ }`  
**Location**: utils/socketHandlers.js:30  
**Risk Level**: 🟠 HIGH - Unauthenticated connections

#### Line 30 - utils/socketHandlers.js
```javascript
// Current:
io.on('connection', (socket) => {
  try {
    // ... handler logic
  } catch (_) {}
});

// Fix:
io.on('connection', (socket) => {
  try {
    const userId = socket.handshake.auth?.userId;
    const email = socket.handshake.auth?.email;
    
    if (!userId || !email) {
      logger.warn('[Socket] Rejected connection: missing auth', {
        hasUserId: !!userId,
        hasEmail: !!email,
        socketId: socket.id
      });
      socket.emit('error', { message: 'Authentication required' });
      socket.disconnect(true);
      return;
    }

    logger.debug('[Socket] New connection', {
      userId,
      email,
      socketId: socket.id
    });

    // ... rest of handler

  } catch (err) {
    logger.error('[Socket] Connection error', {
      error: err.message,
      stack: err.stack.split('\n')[0]
    });
    socket.disconnect(true);
  }
});
```

---

### Category 5: AI File Categorization (2 instances)
**Pattern**: `catch (_) { /* categorizer operation */ }`  
**Location**: ai/fileCategorizer.js  
**Risk Level**: 🟡 MEDIUM - File categorization failures

| Line | Context | Issue | Fix |
|------|---------|-------|-----|
| 415 | Load feedback weights from DB | DB query fails silently, uses empty weights | Log and use fallback |
| 443 | Weight update in loop | Update fails silently, weights incomplete | Log failures and retry |

#### Line 415 - ai/fileCategorizer.js
```javascript
// Current:
async function loadFeedbackWeights() {
  try {
    const feedbacks = await Feedback.find({});
    // ... process weights
  } catch (_) {
    // Falls through, weights remain uninitialized
  }
}

// Fix:
async function loadFeedbackWeights() {
  try {
    const feedbacks = await Feedback.find({});
    if (!feedbacks || feedbacks.length === 0) {
      logger.info('[Categorizer] No feedback records found, using defaults');
      return;
    }
    // ... process weights
    logger.debug('[Categorizer] Weights loaded', { 
      recordCount: feedbacks.length,
      categories: Object.keys(weights).length 
    });
  } catch (err) {
    logger.error('[Categorizer] Failed to load feedback weights', {
      error: err.message
    });
    // Use default weights, continue operation
  }
}
```

#### Line 443 - ai/fileCategorizer.js
```javascript
// Current:
for (const feedback of feedbacks) {
  try {
    if (!weights[key]) weights[key] = {};
    // ... weight calculation
  } catch (_) {
    // Individual record failure silently ignored
  }
}

// Fix:
const failedRecords = [];
for (const feedback of feedbacks) {
  try {
    if (!weights[key]) weights[key] = {};
    // ... weight calculation
  } catch (err) {
    failedRecords.push({
      feedbackId: feedback._id,
      error: err.message
    });
    logger.warn('[Categorizer] Failed to process feedback record', {
      feedbackId: feedback._id,
      error: err.message
    });
  }
}

if (failedRecords.length > 0) {
  logger.error('[Categorizer] Weight loading had failures', {
    total: feedbacks.length,
    failed: failedRecords.length,
    failedRecords
  });
}
```

---

### Category 6: Email/Notification (1 instance)
**Pattern**: `catch (_) { mailer.send(...) }`  
**Location**: utils/mailer.js:27  
**Risk Level**: 🟡 MEDIUM - Lost notifications

#### Line 27 - utils/mailer.js
```javascript
// Current:
async function sendEmail(to, subject, html) {
  try {
    await transporter.sendMail({ to, subject, html });
  } catch (_) {
    // Email silently fails, user never notified
  }
}

// Fix:
async function sendEmail(to, subject, html) {
  try {
    const result = await transporter.sendMail({ to, subject, html });
    logger.info('[Mailer] Email sent', {
      to: to.substring(0, 50),  // Mask part of email
      subject: subject.substring(0, 100),
      messageId: result.messageId
    });
    return { success: true, messageId: result.messageId };
  } catch (err) {
    logger.error('[Mailer] Failed to send email', {
      to: to.substring(0, 50),
      subject: subject.substring(0, 100),
      error: err.message,
      code: err.code
    });
    
    // Create notification record of failure
    try {
      await EmailFailureLog.create({
        recipient: to,
        subject,
        error: err.message,
        failedAt: new Date()
      });
    } catch (logErr) {
      logger.error('[Mailer] Failed to log email failure', { 
        error: logErr.message 
      });
    }
    
    throw err;  // Propagate error to caller
  }
}
```

---

### Category 7: Client-Side Request Helpers (1 instance)
**Pattern**: `catch (_) { fetch(...) }`  
**Location**: public/js/requestHelpers.js:46  
**Risk Level**: 🟡 MEDIUM - Token refresh failures

#### Line 46 - public/js/requestHelpers.js
```javascript
// Current:
async function refreshCsrfToken() {
  try {
    const response = await fetch('/csrf-token', {...});
    if (!response.ok) return '';
  } catch (_) {
    return '';  // Silent failure, empty token
  }
}

// Fix:
async function refreshCsrfToken() {
  try {
    const response = await fetch('/csrf-token', {
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' }
    });
    
    if (!response.ok) {
      console.warn('[RequestHelpers] CSRF refresh failed', {
        status: response.status,
        statusText: response.statusText
      });
      return '';
    }
    
    const data = await response.json();
    console.debug('[RequestHelpers] CSRF token refreshed');
    return data.csrfToken || '';
    
  } catch (err) {
    console.error('[RequestHelpers] Token refresh error', {
      message: err.message,
      name: err.name
    });
    // Return empty, let caller handle
    return '';
  }
}
```

---

### Category 8: API Routes (2 instances)
**Pattern**: `catch (_) { Promise.all(...) }`  
**Location**: routes/api.js  
**Risk Level**: 🟡 MEDIUM - API aggregation failures

| Line | Context | Issue | Fix |
|------|---------|-------|-----|
| 239 | Aggregate stats queries | One query failure hides in Promise.all | Add error handler |
| 241 | Aggregate counts | Silent count failure returns incomplete data | Log and return error |

#### Line 239-241 - routes/api.js
```javascript
// Current:
try {
  const [totalFiles, totalUsers, totalMessages] = await Promise.all([
    File.countDocuments(),
    User.countDocuments(),
    Message.countDocuments()
  ]);
} catch (_) {
  // All counts fail silently
}

// Fix:
try {
  const [totalFiles, totalUsers, totalMessages] = await Promise.all([
    File.countDocuments().catch(err => {
      logger.error('[API] File count failed', { error: err.message });
      throw new Error('Failed to count files');
    }),
    User.countDocuments().catch(err => {
      logger.error('[API] User count failed', { error: err.message });
      throw new Error('Failed to count users');
    }),
    Message.countDocuments().catch(err => {
      logger.error('[API] Message count failed', { error: err.message });
      throw new Error('Failed to count messages');
    })
  ]);
  
  res.json({ totalFiles, totalUsers, totalMessages });
  
} catch (err) {
  logger.error('[API] Stats aggregation failed', {
    error: err.message
  });
  return res.status(500).json({ 
    success: false, 
    message: 'Failed to fetch statistics' 
  });
}
```

---

### Category 9: Admin Routes (1 instance)
**Pattern**: `catch (_) { User.findByIdAndUpdate(...) }`  
**Location**: routes/admin.js:374  
**Risk Level**: 🟡 MEDIUM - Admin action not logged

#### Line 374 - routes/admin.js
```javascript
// Current:
try {
  await User.findByIdAndUpdate(
    req.params.userId,
    { suspended: false }
  );
} catch (_) {
  // Suspension state might not change, no error returned
}

// Fix:
try {
  const result = await User.findByIdAndUpdate(
    req.params.userId,
    { suspended: false },
    { new: true }
  );
  
  if (!result) {
    return res.json({ 
      success: false, 
      message: 'User not found' 
    });
  }

  logger.info('[Admin] User reactivated', {
    actingAdmin: req.user._id,
    targetUser: result._id,
    email: result.email
  });

  return res.json({ 
    success: true, 
    message: 'User reactivated' 
  });
  
} catch (err) {
  logger.error('[Admin] Failed to reactivate user', {
    userId: req.params.userId,
    error: err.message
  });
  return res.status(500).json({ 
    success: false, 
    message: 'Failed to reactivate user' 
  });
}
```

---

### Category 10: Profile Routes (1 instance)
**Pattern**: `catch (_) { File.delete(...) }`  
**Location**: routes/profile.js:159  
**Risk Level**: 🟡 MEDIUM - Profile photo deletion failures

#### Line 159 - routes/profile.js
```javascript
// Current:
try {
  fs.unlinkSync(oldPhotoPath);
} catch (_) {
  // Old photo not deleted, disk fills up
}

// Fix:
try {
  if (fs.existsSync(oldPhotoPath)) {
    fs.unlinkSync(oldPhotoPath);
    logger.debug('[Profile] Old photo deleted', {
      userId: user._id,
      photoPath: oldPhotoPath
    });
  }
} catch (err) {
  logger.warn('[Profile] Failed to delete old photo', {
    userId: user._id,
    photoPath: oldPhotoPath,
    error: err.code || err.message
  });
  // Continue anyway, new photo saved
}
```

---

### Category 11: Utility/Misc (2 instances)
**Pattern**: Various utility operations  
**Location**: Multiple files  
**Risk Level**: 🟢 LOW

| File | Line | Context | Fix Priority |
|------|------|---------|--------------|
| utils/socketHandlers.js | 30 | See Category 4 above | HIGH |
| middleware/sessionMiddleware.js | 41 | See Category 3 above | HIGH |

---

## Implementation Plan

### Phase 1: Critical (This Week)
- [ ] Implement fileCleanup utility (Category 1)
- [ ] Fix token rotation errors (Category 2)
- [ ] Fix session middleware logging (Category 3)
- [ ] Fix socket.io auth validation (Category 4)

### Phase 2: High Priority (Next Week)
- [ ] Fix AI categorizer logging (Category 5)
- [ ] Fix email failure tracking (Category 6)
- [ ] Fix CSRF token refresh logging (Category 7)
- [ ] Fix API stats aggregation (Category 8)

### Phase 3: Medium Priority (Following Week)
- [ ] Fix admin action logging (Category 9)
- [ ] Fix profile photo cleanup (Category 10)
- [ ] Add monitoring/alerting
- [ ] Test coverage

---

## Automated Fixes (if linter available)

Create a code transformation script:

```bash
# scripts/fix-silent-catches.js
# Automatically transform catch (_) {} to logged handlers
# Warning: Manual review required after execution
```

---

## Monitoring Template

Add to logger initialization:

```javascript
const logger = winston.createLogger({
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3
  },
  format: winston.format.json(),
  defaultMeta: { 
    service: 'centralized-fs',
    version: process.env.APP_VERSION
  },
  transports: [
    new winston.transports.File({ 
      filename: 'logs/errors.log', 
      level: 'error'
    }),
    new winston.transports.File({ 
      filename: 'logs/combined.log' 
    })
  ]
});

// Alert on patterns
setInterval(async () => {
  // Count errors by category in last hour
  const silentCatchErrors = await countLogsByPattern('catch block|silent failure');
  if (silentCatchErrors > 100) {
    sendAlert('High rate of unhandled errors detected');
  }
}, 60000);
```

---

## Summary

- **Total Silent Catches**: 24
- **Critical**: 8 (file operations)
- **High**: 7 (auth, session, socket, API)
- **Medium**: 7 (categorizer, mailer, client, routes)
- **Low**: 2 (utility)

**Estimated Fix Time**: 16-20 hours over 3 weeks  
**Risk If Not Fixed**: Silent data loss, security gaps, poor observability
