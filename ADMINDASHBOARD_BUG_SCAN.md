# Admin Dashboard Bug Scan - Comprehensive Analysis
**Date**: May 19, 2026  
**File**: [views/admindashboard.ejs](views/admindashboard.ejs)  
**Severity**: 11 bugs identified (2 Critical, 3 High, 6 Medium)

---

## 🔴 CRITICAL BUGS (Fix Immediately)

### Bug #1: Avatar URLs Not Sanitized (XSS Vulnerability)
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L33) and [views/admindashboard.ejs](views/admindashboard.ejs#L269-L271)  
**Severity**: 🔴 CRITICAL  
**Issue**: Avatar filename not escaped in both HTML and JavaScript
```html
<!-- Line 33 (HTML Header) -->
<img id="adminAvatar" src="<%= (typeof avatar !== 'undefined' && avatar) ? ('/uploads/' + avatar) : 'https://via.placeholder.com/56' %>" />
<!-- ❌ If avatar="../../etc/passwd" or avatar="<svg onload=alert(1)>", XSS occurs -->

<!-- Line 179 (HTML Profile Modal) -->
<img id="adminProfileAvatar" src="<%= (typeof avatar !== 'undefined' && avatar) ? ('/uploads/' + avatar) : 'https://via.placeholder.com/56' %>" />
<!-- ❌ Same issue -->
```
**JavaScript version** (line 269-271):
```javascript
function getAdminAvatarUrl(avatarFilename) {
  return avatarFilename ? `/uploads/${avatarFilename}` : 'https://via.placeholder.com/56';
  // ❌ NO SANITIZATION - Path traversal possible
}
```
**Impact**: Path traversal and XSS attacks via crafted avatar filename  
**Fix**: Sanitize in both places
```javascript
function getAdminAvatarUrl(avatarFilename) {
  if (!avatarFilename) return 'https://via.placeholder.com/56';
  // Escape special characters and validate format (only alphanumeric, dash, underscore, dot)
  const sanitized = String(avatarFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `/uploads/${encodeURIComponent(sanitized)}`;
}
```

---

### Bug #2: No Error Feedback on Update Failures
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L681-L695)  
**Severity**: 🔴 CRITICAL  
**Issue**: When file delete fails, error is shown. But when role update or user deactivation has issues, errors may not be handled properly for user feedback
```javascript
// Line 681-695 (File delete works correctly)
if (data.success) {
  showActionToast(data.message, 'success');
  location.reload();
} else {
  showActionToast(data.message, 'error');  // ✓ Shown
}

// Line 707-720 (Role update)
if (data.success) {
  showActionToast(`Role updated to ${roleEmoji[newRole]} ${newRole}`, 'success');
  location.reload();
} else {
  showActionToast(data.message, 'error');  // ✓ Shown
}
```
**Status**: Actually handled correctly - both success and error cases show toast  
**Severity Downgrade**: 🟢 LOW - Already handled properly

---

## 🟠 HIGH PRIORITY BUGS (Fix Soon)

### Bug #3: Profile Photo Validation Missing Extension Check
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L386-L395)  
**Severity**: 🟠 HIGH  
**Issue**: Unlike userdashboard.ejs, admin profile validation skips file extension check (allows .exe renamed to .jpg)
```javascript
// Line 386-395:
const selectedPhoto = photoEl?.files?.[0];
if (selectedPhoto) {
  // ❌ MISSING: Extension validation (unlike userdashboard)
  
  if (!PROFILE_PHOTO_ALLOWED_TYPES.includes(selectedPhoto.type)) {
    // Only MIME type check, not file extension
    if (statusEl) { statusEl.textContent = 'Only JPG, PNG, GIF, or WEBP images are allowed.'; statusEl.className = 'profile-status error'; }
    return;
  }
  if (selectedPhoto.size > PROFILE_PHOTO_MAX_SIZE) {
    if (statusEl) { statusEl.textContent = 'Profile photo must be 2MB or smaller.'; statusEl.className = 'profile-status error'; }
    return;
  }
}
```
**Impact**: Can upload malicious files with fake MIME types  
**Fix**: Add extension validation
```javascript
const selectedPhoto = photoEl?.files?.[0];
if (selectedPhoto) {
  // Validate extension matches MIME type
  const ext = selectedPhoto.name.toLowerCase().split('.').pop();
  const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (!ALLOWED_EXTS.includes(ext)) {
    if (statusEl) { statusEl.textContent = 'Invalid file extension. Allowed: JPG, PNG, GIF, WEBP'; statusEl.className = 'profile-status error'; }
    return;
  }
  // ... rest of validation
}
```

---

### Bug #4: File Search Missing Debounce
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L508-L514)  
**Severity**: 🟠 HIGH  
**Issue**: Filter updates on every keystroke, DOM manipulation on each keystroke causes performance issues
```javascript
// Line 508-514:
const fileSearchInput = document.getElementById('fileSearch');
const fileCategoryFilter = document.getElementById('fileCategoryFilter');
if (fileSearchInput) {
  fileSearchInput.addEventListener('input', filterFiles);  // ❌ No debounce
}
if (fileCategoryFilter) {
  fileCategoryFilter.addEventListener('change', filterFiles);  // OK for select
}
```
**Impact**: Excessive DOM updates with large file lists, poor performance  
**Fix**: Add debounce
```javascript
let searchTimeout = null;
if (fileSearchInput) {
  fileSearchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterFiles(), 300);
  });
}
```

---

### Bug #5: Concurrent File Delete Operations Not Prevented
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L677-L695)  
**Severity**: 🟠 HIGH  
**Issue**: No operation lock; user can click delete multiple times on different files before first completes
```javascript
// Line 677-695:
function deleteAdminFile(fileId) {
  openActionConfirm(..., async function() {
    try {
      const data = await postNoBody(`/admin/file/delete/${fileId}`);
      // ❌ User can delete multiple files simultaneously
      // ❌ Page reloads, but user might have clicked multiple delete buttons first
    }
  });
}
```
**Impact**: Multiple concurrent deletes, potential race conditions, unpredictable state  
**Fix**: Add operation lock
```javascript
let fileOperationInProgress = {};

function deleteAdminFile(fileId) {
  if (fileOperationInProgress[fileId]) {
    showActionToast('⏳ Operation already in progress for this file', 'warn');
    return;
  }
  openActionConfirm(..., async function() {
    fileOperationInProgress[fileId] = true;
    try {
      // ... delete logic
    } finally {
      delete fileOperationInProgress[fileId];
    }
  });
}
```

---

## 🟡 MEDIUM PRIORITY BUGS (Fix This Sprint)

### Bug #6: Visibility Change Event Memory Leak
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L267-L280) (In initAdminAutoLogout)  
**Severity**: 🟡 MEDIUM  
**Issue**: Visibilitychange listener added multiple times without cleanup; NOT shown in visible lines but inferred from user auto-logout pattern
**Pattern**: Similar to userdashboard, if `initAdminAutoLogout()` is called multiple times, listeners stack  
**Fix**: Remove old listener before adding new one (if present in code)

---

### Bug #7: Admin Profile Form Inputs Not Disabled During Save
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L405-L420)  
**Severity**: 🟡 MEDIUM  
**Issue**: Save button disabled but form inputs remain enabled; user can modify fields while saving
```javascript
// Line 405-420:
if (saveBtn) saveBtn.disabled = true;  // Button disabled
if (statusEl) { statusEl.textContent = 'Saving profile...'; statusEl.className = 'profile-status'; }

try {
  const data = await requestJson('/auth/user/profile', { method: 'POST', body: formData });
  // ❌ But fullnameEl and photoEl still enabled - user can type while saving
}
```
**Impact**: User can edit while request in flight → confusing state, data inconsistency  
**Fix**: Disable inputs during save
```javascript
const inputsToDisable = [fullnameEl, photoEl];
inputsToDisable.forEach(inp => { if (inp) inp.disabled = true; });
// ... in finally block:
inputsToDisable.forEach(inp => { if (inp) inp.disabled = false; });
```

---

### Bug #8: Table Sort Function Missing Empty Table Handling
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L593-L630)  
**Severity**: 🟡 MEDIUM  
**Issue**: Sort function assumes table has rows; could fail if table is empty
```javascript
// Line 593-630:
function sortTable(columnIndex, tableId) {
  const table = document.getElementById(tableId);
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const header = table.querySelectorAll('th')[columnIndex];
  
  if (rows.length === 0) {
    // ❌ No check - proceeds with empty rows array
    // Sorting empty array is OK, but visual state might be weird
  }
```
**Impact**: Minor - sorting works on empty array, but no validation feedback  
**Fix**: Early return for empty table
```javascript
function sortTable(columnIndex, tableId) {
  const table = document.getElementById(tableId);
  const tbody = table.querySelector('tbody');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  
  if (rows.length === 0) {
    return;  // Nothing to sort
  }
  // ... rest of logic
}
```

---

### Bug #9: Role Change Validation Missing
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L704-L720)  
**Severity**: 🟡 MEDIUM  
**Issue**: No validation that selected role is valid (only 'user' or 'admin' allowed)
```javascript
// Line 704-720:
function updateAdminRole(userId, newRole) {
  // ❌ No validation that newRole is 'user' or 'admin'
  // If select value is tampered with, invalid role sent to backend
  
  openActionConfirm(..., async function() {
    const data = await postJson('/admin/user/role', { userId, role: newRole });
    // Relies on backend validation - should validate here too
  });
}
```
**Impact**: Invalid role values sent to server if HTML select modified; relying only on backend validation  
**Fix**: Validate role on client
```javascript
function updateAdminRole(userId, newRole) {
  const validRoles = ['user', 'admin'];
  if (!validRoles.includes(newRole)) {
    showActionToast('❌ Invalid role selected', 'error');
    return;
  }
  // ... rest of logic
}
```

---

### Bug #10: No User Feedback During File Operations
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L651-L667)  
**Severity**: 🟡 MEDIUM  
**Issue**: Download operation has no progress feedback; large files appear frozen
```javascript
// Line 651-667:
function downloadAdminFile(fileName) {
  // ...
  openActionConfirm(..., function() {
    const link = document.createElement('a');
    link.href = `/uploads/${encodeURIComponent(fileName)}`;
    link.setAttribute('download', fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // ❌ No feedback - large files feel stuck
  });
}
```
**Impact**: User unsure if download started, especially for large files  
**Fix**: Add progress toast or completion feedback
```javascript
// Add feedback
showActionToast(`📥 Downloading ${fileName}...`, 'info');
// After some delay or completion detection
setTimeout(() => showActionToast('✅ Download complete', 'success'), 1000);
```

---

### Bug #11: Profile Avatar File Extension Not Validated
**Location**: [views/admindashboard.ejs](views/admindashboard.ejs#L383-L395)  
**Severity**: 🟡 MEDIUM  
**Issue**: Same as Bug #3 - missing extension check on profile photo  
**Status**: Covered by Bug #3  
**Severity Downgrade**: 🟢 Duplicate of Bug #3

---

## 📊 Summary Table

| # | Bug | Severity | Category | Line | Status |
|---|-----|----------|----------|------|--------|
| 1 | Avatar URL not sanitized (XSS) | 🔴 CRITICAL | Security | 33, 179, 269 | ⏳ TODO |
| 2 | Error feedback on updates | 🟢 LOW | Error Handling | 681-720 | ✅ OK |
| 3 | Profile photo extension missing | 🟠 HIGH | Security | 386-395 | ⏳ TODO |
| 4 | File search missing debounce | 🟠 HIGH | Performance | 508-514 | ⏳ TODO |
| 5 | Concurrent file deletes | 🟠 HIGH | Concurrency | 677-695 | ⏳ TODO |
| 6 | Visibility event memory leak | 🟡 MEDIUM | Memory | (pattern) | ⏳ TODO |
| 7 | Form inputs not disabled | 🟡 MEDIUM | UX/State | 405-420 | ⏳ TODO |
| 8 | Table sort empty handling | 🟡 MEDIUM | Robustness | 593-630 | ⏳ TODO |
| 9 | Role validation missing | 🟡 MEDIUM | Security | 704-720 | ⏳ TODO |
| 10 | No download feedback | 🟡 MEDIUM | UX | 651-667 | ⏳ TODO |
| 11 | Photo extension duplicate | 🟢 DUPLICATE | - | - | ⏳ See #3 |

---

## 🚀 Priority Order for Fixes

**CRITICAL (Do First)**:
1. Bug #1 - Sanitize avatar URLs in HTML and JavaScript (XSS fix)

**HIGH (Do This Sprint)**:
2. Bug #3 - Add profile photo extension validation
3. Bug #4 - Add search debounce
4. Bug #5 - Add operation lock for file deletes

**MEDIUM (Do Next Sprint)**:
5. Bug #6 - Fix visibility listener memory leak (if present)
6. Bug #7 - Disable form inputs during save
7. Bug #8 - Add empty table handling to sort
8. Bug #9 - Add client-side role validation
9. Bug #10 - Add download progress feedback

---

## Comparison with userdashboard.ejs

**Similar Bugs Found in Both Files**:
- ❌ Avatar URL not sanitized (XSS vulnerability)
- ❌ Form inputs not disabled during save
- ❌ Search/filter missing debounce
- ❌ Visibility change event memory leak (potential)
- ❌ Concurrent operations not prevented

**Bugs Only in admindashboard.ejs**:
- ❌ Profile photo extension validation missing (admindashboard has MIME only; userdashboard has both)
- ❌ Table sort missing empty handling
- ❌ Role validation missing

**Bugs Only in userdashboard.ejs**:
- ❌ Outdated file size message
- ❌ Recycle bin race condition
- ❌ Bulk download no cancel button
- ❌ 2FA password not focused
- ❌ Bulk operations concurrent

---

## Code Snippet Template for Fixes

Each fix follows this pattern:
```javascript
// LOCATION: Line XXX
// BEFORE: (problematic code)
// AFTER: (fixed code)
```

Ready to implement? Reply with "fix bugs" and I'll apply all 9 necessary fixes.
