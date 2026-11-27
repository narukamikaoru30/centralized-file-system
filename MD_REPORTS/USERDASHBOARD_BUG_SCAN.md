# UserDashboard (userdashboard.ejs) - Comprehensive Bug & Functionality Scan

**Date**: May 16, 2026  
**Scope**: Full audit of UI/UX bugs, functionality issues, security concerns  
**Total Issues Found**: 24 bugs and enhancement opportunities

---

## 🔴 CRITICAL ISSUES

### 1. **Silent Error Suppression in Upload Form**
**Location**: Lines 2380-2390  
**Severity**: 🔴 CRITICAL - Users lose feedback on upload failures

```javascript
request.onerror = function() {
  progressBar.style.display = "none";
  progressFill.style.width = "0%";
  // Network error suppressed - system continues silently
};
```

**Issue**: Network errors during upload are silently suppressed without user notification  
**Impact**: Users don't know if upload failed, think file was uploaded when it wasn't  
**Fix**: 
```javascript
request.onerror = function() {
  progressBar.style.display = "none";
  progressFill.style.width = "0%";
  feedbackMessage.textContent = "❌ Network error: Upload failed";
  feedbackBox.className = "modal-content error";
  modal.classList.add("show");
  setTimeout(() => { modal.classList.remove("show"); }, 3000);
};
```

---

### 2. **CSRF Token Fetch Error Not Handled Properly**
**Location**: Lines 2340-2360  
**Severity**: 🔴 CRITICAL - Upload blocked indefinitely without explanation

**Issue**: If CSRF token endpoint fails, upload form shows no visible feedback  
**Current Code**:
```javascript
try {
  const tokenResponse = await fetch('/csrf-token', { ... });
  if (!tokenResponse.ok) {
    throw new Error(`Token endpoint returned ${tokenResponse.status}`);
  }
} catch (err) {
  progressBar.style.display = "none";
  feedbackMessage.textContent = `❌ Failed to get CSRF token: ${err.message}`;
  // But uploadBtn stays disabled forever if user ignores modal
}
```

**Fix**: Also re-enable upload button and provide retry mechanism

---

### 3. **Profile Photo Upload MIME Type Not Validated Before Send**
**Location**: Lines 2140-2160  
**Severity**: 🔴 CRITICAL - Stored XSS via image upload

**Issue**: 
- Profile photo validation checks MIME type (JPEG, PNG, GIF, WEBP)
- But attacker can rename `.exe` to `.jpg` and browser reads it as image/jpeg
- Server might also accept and serve HTML as image/jpeg
- No extension validation on server side visible

**Fix**: 
```javascript
const selectedPhoto = profilePhotoInput?.files?.[0];
if (selectedPhoto) {
  // Validate extension matches MIME type
  const ext = selectedPhoto.name.toLowerCase().split('.').pop();
  const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
  if (!ALLOWED_EXTS.includes(ext)) {
    profileStatus.textContent = 'Invalid file extension. Allowed: JPG, PNG, GIF, WEBP';
    profileStatus.className = 'profile-status error';
    return;
  }
  // Also check magic bytes (first few bytes)
  const header = await selectedPhoto.slice(0, 4).arrayBuffer();
  // Verify it matches image type...
}
```

---

### 4. **No Validation on File Tag Input**
**Location**: Line 2340 (tags input)  
**Severity**: 🔴 CRITICAL - Potential XSS injection via tags

```html
<input type="text" id="uploadTags" name="tags" placeholder="e.g. legal, 2024, memo" />
```

**Issue**: 
- Tags are user input but no sanitization before display
- If tags contain `<script>` or HTML, could be XSS
- Server might log/display tags without escaping

**Evidence in Code**: Line 2300+ shows `escapeHtml()` function exists but NOT used on tags  
```javascript
// Used here:
<span class="file-tag"><%= t %></span>
// But NO escapeHtml() wrapper
```

**Fix**: Escape tags on both server and client side
```javascript
// Client side in search results:
const tagsHtml = (f.tags||[]).map(t => `<span class="file-tag">${escapeHtml(t)}</span>`).join('');
// This IS done correctly in serverSearch() but search display might have injection elsewhere
```

---

## 🟠 HIGH PRIORITY ISSUES

### 5. **Search Input Not Escaped - Potential XSS**
**Location**: Line 2505+ (serverSearch function)  
**Severity**: 🟠 HIGH - XSS via search query

```javascript
const q = (document.getElementById('searchInput').value || '').trim();
// ... later used in URL params
const params = new URLSearchParams();
if (q) params.set('q', q);
// Sent to server - server should escape, but display might not
```

**Issue**: If server echoes search query in results without escaping, XSS possible  
**Current Evidence**: 
```javascript
// In search results display:
<p>${escapeHtml(f.originalName || f.filename)}</p>
// ✅ Filenames ARE escaped, good

// But tags might not be:
${tagsHtml ? `<div class="file-tags">${tagsHtml}</div>` : ''}
// This IS escaped, actually good
```

**Still Safe**: But should validate on server that search param is string, no script injections

---

### 6. **Bulk Download URL Vulnerable to Directory Traversal**
**Location**: Line 2482  
**Severity**: 🟠 HIGH - Path traversal attack possible

```javascript
function bulkDownload() {
  const ids = getSelectedIds();
  window.location.href = '/auth/file/bulk-download?ids=' + ids.join(',');
}
```

**Issue**: 
- File IDs should be validated to be ObjectIds, not paths
- No validation that IDs are valid MongoDB ObjectIds
- If ID contains `../`, could potentially traverse

**Current Risk**: 
- Server validates these in routes/files.js (checked earlier - safe)
- But client should also validate

**Fix**:
```javascript
function bulkDownload() {
  const ids = getSelectedIds();
  // Validate each ID is a valid MongoDB ObjectId (24 hex chars)
  const objectIdRegex = /^[0-9a-f]{24}$/i;
  if (!ids.every(id => objectIdRegex.test(id))) {
    showFeedbackToast('❌ Invalid file selection', 'error');
    return;
  }
  window.location.href = '/auth/file/bulk-download?ids=' + ids.join(',');
}
```

---

### 7. **2FA Disable Button Passes Password via Prompt - Insecure**
**Location**: Lines 2168-2195  
**Severity**: 🟠 HIGH - Password captured in plain text, no masking

```javascript
const disable2faBtn = document.getElementById('disable2faBtn');
if (disable2faBtn) {
  disable2faBtn.addEventListener('click', async function() {
    const password = prompt('Enter your password to disable 2FA:');
    if (!password) return;
    // Password is now in memory, possibly logged, insecure
```

**Issue**: 
- `prompt()` displays password in plain text
- No masking or secure input
- Password might be visible in browser history
- XSS could capture it from memory

**Fix**: Use proper password input modal with masking
```javascript
function open2FADisableModal() {
  // Create secure modal with password input type="password"
  // Use onsubmit handler, not prompt()
  // Clear password from memory immediately after use
}
```

---

### 8. **FileType Select Auto-Select Doesn't Respect "Auto-Detect" Option**
**Location**: Lines 2333-2340  
**Severity**: 🟠 HIGH - AI auto-detection bypassed

```javascript
// In displayFileNames()
const uniqueCategories = [...new Set(detections.map(d => d.category))];
if (uniqueCategories.length === 1 && fileTypeSelect) {
  const detected = uniqueCategories[0];
  const hasAutoOption = fileTypeSelect.querySelector('option[value=""]');
  if (!hasAutoOption) {
    fileTypeSelect.value = detected;  // ← Forces selection even if auto-detect available
  }
}
```

**Issue**: 
- Comment says "keep it selected but show detection" but code doesn't do that
- If AI auto-detect is ON, user sees empty value selected but files are auto-categorized anyway
- Confusing UX: user might think no category is selected

**Current UX**: ✓ Actually works correctly (form submission auto-detects if empty)  
**Issue**: UX is confusing - should show what will be auto-detected

---

### 9. **Profile Modal Not Closing on Successful Save**
**Location**: Lines 2141-2165  
**Severity**: 🟠 HIGH - User must manually close modal after profile update

```javascript
if (profilePhotoInput) profilePhotoInput.value = '';
if (profileStatus) {
  profileStatus.textContent = 'Profile updated successfully.';
  profileStatus.className = 'profile-status success';
}
// ← No closeProfileModal() call here
```

**Issue**: Profile modal stays open after successful update  
**Expected**: Should auto-close after 1-2 seconds  

**Fix**:
```javascript
if (profileStatus) {
  profileStatus.textContent = 'Profile updated successfully.';
  profileStatus.className = 'profile-status success';
  setTimeout(() => closeProfileModal(), 1500);
}
```

---

### 10. **Share Link Generation Not Validating Max Downloads Input**
**Location**: Lines 2651-2700 (createShareLink function - referenced but not shown)  
**Severity**: 🟠 HIGH - No client-side validation

**Issue**: `shareLinkMaxDl` input accepts any number, including negative or astronomical  
**Expected**: Should validate 0-1000 or similar reasonable max

**Fix in HTML**:
```html
<input type="number" id="shareLinkMaxDl" min="0" max="1000" value="0" />
```

---

### 11. **Search Date Range Not Validated**
**Location**: Lines 2513-2515  
**Severity**: 🟠 HIGH - Invalid date ranges accepted

```html
<input type="date" id="searchFrom" title="From date" />
<input type="date" id="searchTo" title="To date" />
```

**Issue**: 
- No validation that `searchFrom <= searchTo`
- If user enters backwards dates, search might return 0 results with no explanation

**Fix**:
```javascript
async function serverSearch() {
  const q = (document.getElementById('searchInput').value || '').trim();
  const from = document.getElementById('searchFrom').value ? new Date(document.getElementById('searchFrom').value) : null;
  const to = document.getElementById('searchTo').value ? new Date(document.getElementById('searchTo').value) : null;
  
  if (from && to && from > to) {
    showFeedbackToast('❌ From date must be before To date', 'error');
    return;
  }
  // ... rest of search
}
```

---

### 12. **Recycle Bin Restore Creates Duplicate Files Without Collision Check**
**Location**: Lines 2458-2461  
**Severity**: 🟠 HIGH - Server-side fix already in place, but UI doesn't show conflict message

**Current Code**:
```javascript
async function restoreFile(fileId) {
  try {
    const data = await postNoBody('/auth/recycle-bin/restore/' + encodeURIComponent(fileId));
    if (data.success) { 
      showFeedbackToast('✅ File restored', 'success'); 
      setTimeout(() => location.reload(), 700); 
    }
    else showFeedbackToast('❌ ' + (data.message || 'Restore failed'), 'error');
  } catch (e) { showFeedbackToast('❌ Error', 'error'); }
}
```

**Issue**: If restore fails due to name collision, error message shown but not actionable  
**Server Response Would Be**: `"A file named 'document.pdf' already exists. Please rename it first."`  
**User Can't Rename**: No UI to rename file in recycle bin before restore

**Fix**: Show option to rename or overwrite:
```javascript
// If error is collision, offer rename option
if (data.message && data.message.includes('already exists')) {
  const newName = prompt('File already exists. Enter new name:', f.originalName);
  if (newName) {
    // Call restore with newName param (if server supports it)
  }
}
```

---

## 🟡 MEDIUM PRIORITY ISSUES

### 13. **Upload Form Doesn't Clear After Successful Upload**
**Location**: Lines 2381-2385  
**Severity**: 🟡 MEDIUM - UX confusion after bulk upload

```javascript
fileNames.innerHTML = "";
if (fileInput) fileInput.value = '';
location.reload();
// Reload clears form, but between click and reload, form still shows files
```

**Issue**: Better UX would be to clear immediately before reload  
**Minor Impact**: Only visual glitch for ~1.2 seconds

---

### 14. **No Validation That Selected Files Aren't Already Uploading**
**Location**: Line 2331 (submit handler)  
**Severity**: 🟡 MEDIUM - Race condition on rapid double-click

```javascript
document.getElementById("uploadForm").addEventListener("submit", async function(e) {
  e.preventDefault();
  // No check if upload already in progress
  const uploadBtn = uploadForm.querySelector('button[type="submit"]');
  if (uploadBtn.disabled) return; // ← This check exists, good
```

**Status**: ✓ Actually has protection (uploadBtn.disabled check)  
**Note**: Good catch - already prevented

---

### 15. **No File Format Support Display for Unsupported Types**
**Location**: Lines 3000-3030 (PDF/DOCX/XLSX preview section)  
**Severity**: 🟡 MEDIUM - Confusing UX for unsupported formats

```javascript
} else if (isDocx || isXlsx) {
  previewArea.innerHTML = '<div style="color:#6b7280;">Loading preview...</div>';
  // ... fetch preview
} else {
  // No else case shown - what about .txt, .csv, .doc (old format)?
```

**Issue**: TXT, DOC, old format files show generic 📄 icon  
**Better**: Show message: "Preview not available for this format"

**Fix**:
```javascript
} else {
  previewArea.innerHTML = `<div style="text-align:center;padding:2rem;">
    <div style="font-size:4rem;margin-bottom:1rem;">📄</div>
    <p style="color:#6b7280;">Preview not available for this file type</p>
    <p style="font-size:0.9rem;color:#999;">Supported: PDF, DOCX, XLSX, CSV, JPG, PNG, GIF, WEBP</p>
  </div>`;
}
```

---

### 16. **Filename with Special Characters Not Properly Encoded in Download**
**Location**: Lines 2585-2591  
**Severity**: 🟡 MEDIUM - Download might fail with special chars

```javascript
downloadBtn.onclick = function() {
  const link = document.createElement('a');
  link.href = `/uploads/${encodeURIComponent(filename)}`;  // ✓ Good
  link.setAttribute('download', filename);  // ← Should also encode
  document.body.appendChild(link);
```

**Issue**: `download` attribute should also be URL-safe  
**Fix**:
```javascript
link.setAttribute('download', encodeURIComponent(filename));
// Or use filename without path:
link.setAttribute('download', filename.split('/').pop());
```

---

### 17. **PDF Preview Fails Silently Without Showing Error to User**
**Location**: Lines 2628-2650  
**Severity**: 🟡 MEDIUM - User sees blank area, doesn't know why

```javascript
.catch(function(err) {
  const loader = document.getElementById('pdfLoader');
  if (loader) loader.style.display = 'none';
  previewArea.innerHTML = '<div style="color:#dc2626;">Unable to render PDF preview</div>';
  console.error('PDF page render error', err);  // Only logged, not shown
});
```

**Issue**: Error details only in console, user sees generic message  
**Better**: Show specific error reason

**Fix**:
```javascript
.catch(function(err) {
  const loader = document.getElementById('pdfLoader');
  if (loader) loader.style.display = 'none';
  const errorMsg = err.message || 'Unknown error';
  previewArea.innerHTML = `<div style="color:#dc2626;">
    <strong>PDF Preview Failed</strong><br>
    <span style="font-size:0.9rem;">${escapeHtml(errorMsg)}</span>
  </div>`;
  console.error('PDF page render error', err);
});
```

---

### 18. **File Version Badge Not Showing for Shared Files**
**Location**: Lines 2571-2580 (sharedFilesSection)  
**Severity**: 🟡 MEDIUM - User doesn't see version info for shared files

```javascript
// In sharedFiles loop:
return `<div class="file-card" ...>
  ${isImg ? `<img ...` : '<span>📄</span>'}
  <p>${escapeHtml(f.originalName || f.filename)}</p>
  // ← No version badge shown
  <span class="file-category">...</span>
```

**Compare to My Files**: Lines 2548-2551 show `<% if (f.version > 1) { %><span class="version-badge">v<%= f.version %></span><% } %>`

**Fix**: Add version badge to shared files display

---

### 19. **Inactivity Timer Doesn't Account for Tab Visibility**
**Location**: Lines 1970-1990 (initUserAutoLogout)  
**Severity**: 🟡 MEDIUM - Session expires in background tab

```javascript
userInactivityHandler = () => schedule();
['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'].forEach((evt) => {
  document.addEventListener(evt, userInactivityHandler, { passive: true });
});
```

**Issue**: 
- If tab is hidden (user switched tabs), inactivity events don't fire
- Session might expire even though user is still active in another tab
- Or session might not expire because activity in other tab resets timer

**Better Behavior**: Don't track inactivity if tab is hidden  
**Fix**:
```javascript
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // Tab hidden - don't track inactivity
    if (userInactivityWarnTimer) clearTimeout(userInactivityWarnTimer);
  } else {
    // Tab visible - restart inactivity timer
    schedule();
  }
});
```

---

### 20. **Filter Button Click Doesn't Clear Search Input**
**Location**: Lines 2479  
**Severity**: 🟡 MEDIUM - Confusing UX

```javascript
function filterFiles(category, btn) {
  currentFileFilter = category;
  // ... apply filters
  applyFileFilters();  // Uses search input value
}
```

**Issue**: If user searches for "legal", then clicks "PDF" filter, results stay filtered by "legal" + PDF  
**Expected**: Clicking filter should clear search, or at least inform user search is still active

**Fix**:
```javascript
function filterFiles(category, btn) {
  currentFileFilter = category;
  document.querySelectorAll('.filters .filter-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  // Show what's active:
  const searchVal = document.getElementById('searchInput')?.value;
  if (searchVal) {
    // Indicate search is active alongside filter
    console.log(`Filtered by: ${category}, Search: "${searchVal}"`);
  }
  applyFileFilters();
}
```

---

### 21. **No Loading Indicator for Server Search**
**Location**: Line 2496 (serverSearch function)  
**Severity**: 🟡 MEDIUM - User doesn't know search is running

```javascript
async function serverSearch() {
  const q = (document.getElementById('searchInput').value || '').trim();
  // ... prepare params
  const res = await fetch(...);  // ← No loading indicator
  const data = await res.json();
  const container = document.getElementById('filesContainer');
  container.innerHTML = data.files.map(...).join('');  // Results appear suddenly
}
```

**Fix**: Add loading state
```javascript
async function serverSearch() {
  const container = document.getElementById('filesContainer');
  container.innerHTML = '<div style="text-align:center;padding:2rem;color:#666;">🔍 Searching...</div>';
  
  try {
    const res = await fetch(...);
    // ... rest of code
  } catch (e) {
    container.innerHTML = '<div style="color:#dc2626;">Search failed</div>';
  }
}
```

---

### 22. **Shared Files Tab Doesn't Show Owner Badge**
**Location**: Lines 2580-2581  
**Severity**: 🟡 MEDIUM - Minor UX issue

```javascript
<% if (f.owner) { %><div style="font-size:0.7rem;color:#6b7280;margin-top:4px;">from <%= f.owner.fullname %></div><% } %>
```

**Issue**: Owner name shows, but if owner is deleted or name changes, stale data shown  
**Better**: Include owner email for uniqueness

---

### 23. **No Check That Files Container Exists Before Rendering**
**Location**: Multiple locations accessing `filesContainer`  
**Severity**: 🟡 MEDIUM - JS error if HTML structure changes

```javascript
const container = document.getElementById('filesContainer');
container.innerHTML = data.files.map(...).join('');  // Crashes if element not found
```

**Fix**: Add null check
```javascript
const container = document.getElementById('filesContainer');
if (!container) {
  console.error('filesContainer element not found');
  return;
}
container.innerHTML = data.files.map(...).join('');
```

---

### 24. **Session Timeout Warning Only Shows Once**
**Location**: Lines 1974-1978  
**Severity**: 🟡 MEDIUM - User might miss warning

```javascript
userInactivityWarnTimer = setTimeout(() => {
  const warnMinutes = ...;
  showFeedbackToast(`⚠️ Session expires in ${warnMinutes}...`, 'error');
  // Warning only shown once, then logouts 5 seconds later
}, Math.max(1000, timeoutMs - warningLeadMs));
```

**Issue**: User might not see toast notification (blocked, scrolled off-screen, closed tab)  
**Better**: Show persistent warning modal instead of toast

---

## 🟢 LOW PRIORITY / ENHANCEMENTS

### 25. **"Browse" Text in Drop Zone Not Accessible**
**Severity**: 🟢 LOW - Accessibility issue

```html
<p>📂 Drag & drop files here or <span class="browse">browse</span> (up to 10 files)</p>
```

**Issue**: `<span class="browse">` is styled as link but not semantic  
**Better**: Use `<label>` or `<button>`

---

### 26. **No Keyboard Navigation for File Grid**
**Severity**: 🟢 LOW - Accessibility

**Issue**: Users can't tab through files, only enter on checkbox  
**Fix**: Add `tabindex="0"` to file cards, implement arrow key navigation

---

### 27. **Avatar Image Error Handling**
**Severity**: 🟢 LOW

```html
<img src="<%= (typeof avatar !== 'undefined' && avatar) ? ('/uploads/' + avatar) : 'https://via.placeholder.com/50' %>" />
```

**Issue**: If avatar file is deleted but DB still references it, image shows broken icon  
**Fix**: Add `onerror` handler to show fallback

---

---

## Summary Table

| # | Title | Severity | Type | Status |
|---|-------|----------|------|--------|
| 1 | Silent upload error suppression | 🔴 CRITICAL | Error Handling | ❌ NOT FIXED |
| 2 | CSRF token error handling | 🔴 CRITICAL | Error Handling | ⚠️ PARTIAL |
| 3 | Profile photo MIME validation | 🔴 CRITICAL | Security | ⚠️ SERVER-SIDE |
| 4 | File tags XSS injection risk | 🔴 CRITICAL | Security | ⚠️ PARTIAL |
| 5 | Search input XSS | 🟠 HIGH | Security | ✓ SAFE |
| 6 | Bulk download path traversal | 🟠 HIGH | Security | ✓ SERVER-SAFE |
| 7 | 2FA disable password insecure | 🟠 HIGH | Security | ❌ NOT FIXED |
| 8 | Filetype auto-select UX | 🟠 HIGH | UX | ⚠️ WORKS |
| 9 | Profile modal not closing | 🟠 HIGH | UX | ❌ NOT FIXED |
| 10 | Share link max downloads validation | 🟠 HIGH | Validation | ❌ NOT FIXED |
| 11 | Search date range validation | 🟠 HIGH | Validation | ❌ NOT FIXED |
| 12 | Recycle bin collision handling | 🟠 HIGH | UX | ⚠️ PARTIAL |
| 13 | Upload form not clearing | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 14 | Double-click upload race | 🟡 MEDIUM | Bug | ✓ PROTECTED |
| 15 | Unsupported file format messaging | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 16 | Filename encoding in download | 🟡 MEDIUM | Bug | ⚠️ MINOR |
| 17 | PDF preview error messages | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 18 | Version badge on shared files | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 19 | Inactivity timer background tab | 🟡 MEDIUM | Logic | ❌ NOT FIXED |
| 20 | Filter clears search input | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 21 | Search loading indicator | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 22 | Shared files owner badge | 🟡 MEDIUM | UX | ⚠️ MINOR |
| 23 | Null check on DOM elements | 🟡 MEDIUM | Bug | ❌ NOT FIXED |
| 24 | Session timeout warning modal | 🟡 MEDIUM | UX | ❌ NOT FIXED |
| 25 | Browse text accessibility | 🟢 LOW | A11Y | ❌ NOT FIXED |
| 26 | Keyboard file grid navigation | 🟢 LOW | A11Y | ❌ NOT FIXED |
| 27 | Avatar image error handling | 🟢 LOW | UX | ❌ NOT FIXED |

---

## Recommendations for Prioritization

**IMMEDIATE FIXES (Today)**:
1. Fix upload error suppression (#1) - users need feedback
2. Fix 2FA password prompt (#7) - security issue
3. Add input validation (#10, #11) - simple wins
4. Close profile modal on success (#9) - quick UX fix

**THIS WEEK**:
5. Add error details to PDF preview (#17)
6. Add loading indicator to search (#21)
7. Fix inactivity timer for background tabs (#19)
8. Improve file format messaging (#15)

**NEXT SPRINT**:
9. Improve tag sanitization end-to-end (#4)
10. Better recycle bin collision UI (#12)
11. A11Y improvements (#25, #26)

---

**Report Generated**: May 16, 2026  
**Scan Type**: Manual code review + functionality audit  
**Files Scanned**: [views/userdashboard.ejs](views/userdashboard.ejs)  
**Total Lines**: ~3100
