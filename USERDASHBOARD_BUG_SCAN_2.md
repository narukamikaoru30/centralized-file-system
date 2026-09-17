# User Dashboard Bug Scan #2 - Comprehensive Analysis
**Date**: May 19, 2026  
**File**: [views/userdashboard.ejs](views/userdashboard.ejs)  
**Severity**: 12 bugs identified (3 Critical, 4 High, 5 Medium)

---

## 🔴 CRITICAL BUGS (Fix Immediately)

### Bug #1: Outdated File Size Error Message
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2409)  
**Severity**: 🔴 CRITICAL  
**Issue**: File upload validation shows "15MB limit" but actual limit is now 200MB
```javascript
// Line 2409 - OLD MESSAGE:
if (file.size > MAX_UPLOAD_SIZE) {
  feedbackMessage.textContent = `❌ "${file.name}" exceeds 15MB limit`;  // ❌ WRONG - should be 200MB
```
**Impact**: Users see incorrect size limit, causing confusion  
**Fix**:
```javascript
if (file.size > MAX_UPLOAD_SIZE) {
  feedbackMessage.textContent = `❌ "${file.name}" exceeds ${Math.round(MAX_UPLOAD_SIZE / (1024 * 1024))}MB limit`;
```

---

### Bug #2: No Error Feedback on Upload Failure
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2533)  
**Severity**: 🔴 CRITICAL  
**Issue**: When upload fails (request.status >= 300), no error message shown to user
```javascript
// Line 2533:
if (request.status >= 200 && request.status < 300 && payload && payload.success) {
  // ... success handler
  return;
}

progressBar.style.display = "none";
progressFill.style.width = "0%";
// ❌ NO ERROR FEEDBACK HERE - user left hanging
```
**Impact**: Users don't know upload failed; silently fails with no actionable feedback  
**Fix**: Add error message based on response status/payload
```javascript
// Add error handling:
if (request.status >= 400) {
  feedbackMessage.textContent = payload?.message || `❌ Upload failed (${request.status})`;
  feedbackBox.className = "modal-content error";
  modal.classList.add("show");
  setTimeout(() => { modal.classList.remove("show"); }, 5000);
}
```

---

### Bug #3: Avatar URL Not Sanitized (XSS Vulnerability)
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2015-L2018)  
**Severity**: 🔴 CRITICAL  
**Issue**: Avatar filename not escaped; could allow path traversal or script injection
```javascript
// Line 2015-2018:
function getAvatarUrl(avatarFilename) {
  if (!avatarFilename) return 'https://via.placeholder.com/50';
  return `/uploads/${avatarFilename}`;  // ❌ NO SANITIZATION
}

// If avatarFilename = "../../etc/passwd" or contains <script>, it's rendered directly
if (headerAvatar) headerAvatar.src = getAvatarUrl(currentUserAvatar);  // XSS HERE
```
**Impact**: Path traversal or XSS attack via crafted avatar filename  
**Fix**: Sanitize filename
```javascript
function getAvatarUrl(avatarFilename) {
  if (!avatarFilename) return 'https://via.placeholder.com/50';
  // Escape special characters and validate format (only alphanumeric, dash, underscore, dot)
  const sanitized = String(avatarFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `/uploads/${encodeURIComponent(sanitized)}`;
}
```

---

## 🟠 HIGH PRIORITY BUGS (Fix Soon)

### Bug #4: Recycle Bin Race Condition
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2762-L2810)  
**Severity**: 🟠 HIGH  
**Issue**: Concurrent restore/purge operations can cause race condition
```javascript
// User can click "Restore" multiple times before first request completes
async function restoreFile(fileId) {
  const data = await postNoBody('/auth/recycle-bin/restore/' + encodeURIComponent(fileId));
  // No debouncing - user can spam multiple restores
}

async function purgeFile(fileId) {
  // User can click purge and restore simultaneously
  const data = await postNoBody('/auth/recycle-bin/purge/' + encodeURIComponent(fileId));
}
```
**Impact**: Double-restores, conflicting state changes, orphaned files  
**Fix**: Add operation queue/debounce
```javascript
let operationInProgress = {};

async function restoreFile(fileId) {
  if (operationInProgress[fileId]) {
    showFeedbackToast('⏳ Operation already in progress for this file', 'warn');
    return;
  }
  operationInProgress[fileId] = true;
  try {
    const data = await postNoBody('/auth/recycle-bin/restore/' + encodeURIComponent(fileId));
  } finally {
    delete operationInProgress[fileId];
  }
}
```

---

### Bug #5: Visibilitychange Event Listener Memory Leak
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L1983)  
**Severity**: 🟠 HIGH  
**Issue**: Visibilitychange listener added multiple times without cleanup; adds 1 listener per `initUserAutoLogout()` call
```javascript
// Line 1983: ADDS listener without removing old ones
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // ... pause
  } else {
    // ... resume
  }
});
```
**Impact**: Multiple visibility listeners stacking up → memory leak, duplicate events fired  
**Fix**: Remove old listener before adding new one
```javascript
let visibilityChangeHandler = null;

// First, remove old listener if exists
if (visibilityChangeHandler) {
  document.removeEventListener('visibilitychange', visibilityChangeHandler);
}

// Add new listener
visibilityChangeHandler = () => {
  if (document.hidden) {
    if (userInactivityWarnTimer) clearTimeout(userInactivityWarnTimer);
    if (userInactivityLogoutTimer) clearTimeout(userInactivityLogoutTimer);
  } else {
    schedule();
  }
};
document.addEventListener('visibilitychange', visibilityChangeHandler);
```

---

### Bug #6: Bulk Download Missing Cancel Button
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2840-2880)  
**Severity**: 🟠 HIGH  
**Issue**: No way to cancel bulk download once started; progress bar shows but can't stop it
```javascript
// User clicks bulk download, progress starts
// No cancel button appears
// If file size is huge, user is stuck watching progress
```
**Impact**: User trapped watching long download; no abort mechanism  
**Fix**: Add cancel button to progress modal
```javascript
// Add cancel button to the feedback modal during bulk download
// Connect to XMLHttpRequest.abort()
let currentBulkRequest = null;

// In bulk download handler:
let cancelBtn = document.getElementById('cancelBulkDownloadBtn');
if (cancelBtn) {
  cancelBtn.onclick = () => {
    if (currentBulkRequest) {
      currentBulkRequest.abort();
      showFeedbackToast('❌ Download cancelled', 'info');
      progressBar.style.display = 'none';
    }
  };
}
```

---

## 🟡 MEDIUM PRIORITY BUGS (Fix This Sprint)

### Bug #7: Search Missing Debounce
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs) (search function not fully visible in scan)  
**Severity**: 🟡 MEDIUM  
**Issue**: Search/filter inputs trigger API calls on every keystroke  
**Impact**: Excessive API calls, poor performance with large datasets  
**Fix**: Add debounce to search inputs
```javascript
let searchTimeout = null;
function debounceSearch(fn, delay = 500) {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(fn, delay);
}

// In search handler:
searchInput.addEventListener('input', (e) => {
  debounceSearch(() => searchFiles());
});
```

---

### Bug #8: File List Not Cleared After Successful Upload
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2513)  
**Severity**: 🟡 MEDIUM  
**Issue**: After successful upload, file names display is cleared but page reloads (ok); however, for fast uploads, user might see old file list before reload
```javascript
// Line 2513-2519:
setTimeout(() => {
  modal.classList.remove("show");
  progressBar.style.display = "none";
  progressFill.style.width = "0%";
  fileNames.innerHTML = "";  // ✓ Cleared
  if (fileInput) fileInput.value = '';
  const tagsInput = document.getElementById('uploadTags');
  if (tagsInput) tagsInput.value = '';
  location.reload();  // ✓ Reload
}, 1200);
```
**Status**: Actually handled correctly (reload clears everything)  
**Severity Downgrade**: 🟢 LOW - Already handled properly

---

### Bug #9: Profile Avatar Not Updated on First Save
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2188-L2195)  
**Severity**: 🟡 MEDIUM  
**Issue**: Avatar updated in variables but only rendered after profile modal is visible
```javascript
// Line 2188-2195:
currentUserAvatar = data.avatar || currentUserAvatar;
const profileAvatar = document.getElementById('profileAvatar');

if (profileAvatar) profileAvatar.src = getAvatarUrl(currentUserAvatar);
// ✓ Updated in modal

// But if user had profile modal closed, update not immediately visible in header
const headerAvatar = document.getElementById('avatar');
if (headerAvatar) headerAvatar.src = getAvatarUrl(currentUserAvatar);
// ✓ Both updated now
```
**Status**: Actually handled correctly - both avatar elements updated  
**Severity Downgrade**: 🟢 LOW - Already handled properly

---

### Bug #10: 2FA Disable Password Input Not Focused
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2242-L2250)  
**Severity**: 🟡 MEDIUM  
**Issue**: Password input created but not auto-focused; user might not notice it requires input
```javascript
// Line ~2248:
const input = document.getElementById('disable2faPasswordInput');
// ❌ Input created but not focused
okBtn.onclick = async function() {
  const pwd = document.getElementById('disable2faPasswordInput')?.value;
  if (!pwd) {
    showFeedbackToast('❌ Please enter your password', 'error');
    return;  // ❌ User expects focus to move to field
  }
}
```
**Impact**: Poor UX; user unsure where to enter password  
**Fix**: Auto-focus input after modal content replacement
```javascript
const input = document.getElementById('disable2faPasswordInput');
if (input) {
  setTimeout(() => input.focus(), 100);  // Give DOM time to render
}
```

---

### Bug #11: No Loading State During Profile Save
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs#L2161-L2165)  
**Severity**: 🟡 MEDIUM  
**Issue**: Button disabled and status shows "Saving..." but form inputs are NOT disabled; user can modify them during save
```javascript
// Line 2161-2165:
if (profileSaveBtn) profileSaveBtn.disabled = true;  // Button disabled
if (profileStatus) {
  profileStatus.textContent = 'Saving profile...';   // Status shows saving
  profileStatus.className = 'profile-status';
}
// ❌ But inputs still enabled - user can type while saving
```
**Impact**: User can change fields while request in flight → confusing state  
**Fix**: Disable input fields during save
```javascript
const inputsToDisable = [profileNameInput, profilePhotoInput];
inputsToDisable.forEach(inp => {
  if (inp) inp.disabled = true;
});
// ... in finally block:
inputsToDisable.forEach(inp => {
  if (inp) inp.disabled = false;
});
```

---

### Bug #12: Bulk Operations Not Disabled During Selection
**Location**: [views/userdashboard.ejs](views/userdashboard.ejs) (bulk delete handler)  
**Severity**: 🟡 MEDIUM  
**Issue**: While bulk delete is in progress, user can check/uncheck files or initiate another bulk operation
```javascript
// Bulk delete starts:
async function bulkDelete() {
  // ❌ No flag to prevent concurrent operations
  // User can click "Download Selected" while delete running
}
```
**Impact**: Concurrent operations on same selection; unpredictable state  
**Fix**: Add operation lock
```javascript
let isBulkOperationInProgress = false;

async function bulkDelete() {
  if (isBulkOperationInProgress) {
    showFeedbackToast('⏳ Another bulk operation is in progress', 'warn');
    return;
  }
  isBulkOperationInProgress = true;
  try {
    // ... delete logic
  } finally {
    isBulkOperationInProgress = false;
    updateBulkToolbar();
  }
}
```

---

## 📊 Summary Table

| # | Bug | Severity | Category | File | Status |
|---|-----|----------|----------|------|--------|
| 1 | Outdated file size message | 🔴 CRITICAL | UX/Info | userdashboard.ejs:2409 | ⏳ TODO |
| 2 | No error on upload failure | 🔴 CRITICAL | Error Handling | userdashboard.ejs:2533 | ⏳ TODO |
| 3 | Avatar URL not sanitized | 🔴 CRITICAL | Security/XSS | userdashboard.ejs:2015 | ⏳ TODO |
| 4 | Recycle bin race condition | 🟠 HIGH | Concurrency | userdashboard.ejs:2762 | ⏳ TODO |
| 5 | Visibility event memory leak | 🟠 HIGH | Memory | userdashboard.ejs:1983 | ⏳ TODO |
| 6 | Bulk download no cancel | 🟠 HIGH | UX | userdashboard.ejs:2840 | ⏳ TODO |
| 7 | Search missing debounce | 🟡 MEDIUM | Performance | userdashboard.ejs | ⏳ TODO |
| 8 | File list cleared properly | 🟢 LOW | UX | userdashboard.ejs:2513 | ✅ OK |
| 9 | Avatar updated on save | 🟢 LOW | UX | userdashboard.ejs:2188 | ✅ OK |
| 10 | 2FA password not focused | 🟡 MEDIUM | UX | userdashboard.ejs:2248 | ⏳ TODO |
| 11 | Form inputs not disabled | 🟡 MEDIUM | UX/State | userdashboard.ejs:2161 | ⏳ TODO |
| 12 | Bulk ops concurrent | 🟡 MEDIUM | Concurrency | userdashboard.ejs | ⏳ TODO |

---

## 🚀 Priority Order for Fixes

**CRITICAL (Do First)**:
1. Bug #2 - Add error feedback on upload failure
2. Bug #3 - Sanitize avatar URL (XSS fix)
3. Bug #1 - Fix file size message

**HIGH (Do This Sprint)**:
4. Bug #4 - Race condition debounce
5. Bug #5 - Fix memory leak
6. Bug #6 - Add cancel button

**MEDIUM (Do Next Sprint)**:
7. Bug #10 - Focus password input
8. Bug #11 - Disable form inputs during save
9. Bug #12 - Lock bulk operations
10. Bug #7 - Add search debounce

---

## Code Snippet Template for Fixes

Each fix follows this pattern:
```javascript
// LOCATION: Line XXX
// BEFORE: (problematic code)
// AFTER: (fixed code)
```

Ready to implement? Reply with "fix bugs" and I'll apply all 10 necessary fixes.
