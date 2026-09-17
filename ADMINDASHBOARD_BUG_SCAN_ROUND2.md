# Admin Dashboard - Bug Scan Round 2 (Post-Fix Analysis)

**Scan Date**: May 20, 2026  
**File**: `views/admindashboard.ejs`  
**Status**: 9 bugs fixed in Round 1 | **15 NEW BUGS IDENTIFIED** in Round 2

---

## CRITICAL BUGS (1)

### Bug #1: Multiple DOMContentLoaded Listeners Cause Conflicts
**Severity**: 🔴 CRITICAL  
**Lines**: 340, 465  
**Category**: Logic Error / Race Condition

**Issue**:
Two separate `DOMContentLoaded` event listeners initialize the page. First at line 340 (profile modal setup), second at line 465 (dashboard tables/stats). Both run in sequence and may initialize conflicting event handlers.

**Current Code**:
```javascript
// Line 340
document.addEventListener('DOMContentLoaded', function() {
  // ... profile form setup ...
});

// Line 465
document.addEventListener('DOMContentLoaded', function() {
  // ... stats/tables setup ...
});
```

**Risk**:
- Multiple event listeners cause redundant initialization
- Potential for event listener conflicts
- Hard to debug when one initialization fails
- Poor performance with multiple listeners

**Fix**:
Consolidate both DOMContentLoaded blocks into single listener. Store both setups in one event handler.

```javascript
document.addEventListener('DOMContentLoaded', function() {
  // ===== PROFILE FORM SETUP =====
  const profileForm = document.getElementById('adminProfileForm');
  if (profileForm) {
    profileForm.addEventListener('submit', async function(e) {
      // ... existing profile form code ...
    });
  }

  // ===== DASHBOARD STATS/TABLES SETUP =====
  const stats = <%- JSON.stringify(stats || {}) %>;
  document.getElementById('totalFiles').textContent = stats.totalFiles || '0';
  // ... rest of stats/tables setup ...
});
```

**Estimated Fix Time**: 10 minutes

---

## HIGH SEVERITY BUGS (4)

### Bug #2: Missing null/undefined Check on currentAdminRole
**Severity**: 🟠 HIGH  
**Lines**: 530, 521-523, 529  
**Category**: Validation Error / Potential XSS

**Issue**:
`currentAdminRole` variable initialized from EJS template without null check. If role is undefined or null, comparisons at lines 521-523 fail silently or behave unexpectedly.

**Current Code**:
```javascript
// Line 530
const currentAdminRole = '<%= role %>';

// Lines 521-523 - used without validation
if (currentAdminRole === 'super_admin') {
  return user.role === 'user' || user.role === 'admin';
}
return user.role === 'user';
```

**Risk**:
- If role is null/undefined, `currentAdminRole === 'super_admin'` returns false always
- Non-super_admin users might see or access admin functionality
- Filter logic breaks silently

**Fix**:
Add null check and default value:

```javascript
const currentAdminRole = '<%= role || "user" %>';

// Validate before use
if (!currentAdminRole || !['user', 'admin', 'super_admin'].includes(currentAdminRole)) {
  console.warn('Invalid admin role detected');
  // Show error or redirect
}
```

**Estimated Fix Time**: 5 minutes

---

### Bug #3: Location.reload() Used Instead of Data Refresh API
**Severity**: 🟠 HIGH  
**Lines**: 673, 717, 779  
**Category**: UX / Performance Issue

**Issue**:
After successful file deletion, role update, and user deactivation, page uses hard `location.reload()` instead of refreshing data via API. This causes:
- Full page reload (all assets reloaded)
- Lost scroll position
- Lost form state
- Poor user experience
- Network waste

**Current Code**:
```javascript
// Line 673 - deleteAdminFile
if (data.success) {
  showActionToast(data.message, 'success');
  location.reload();  // ❌ Hard refresh
}

// Line 717 - updateAdminRole
showActionToast(`Role updated to ${roleEmoji[newRole]} ${newRole}`, 'success');
location.reload();  // ❌ Hard refresh

// Line 779 - deactivateAdminUser
addAudit('User Deactivated', userId);
showActionToast('User deactivated', 'success');
location.reload();  // ❌ Hard refresh
```

**Risk**:
- Sluggish user experience
- Scroll position resets
- Increases server load
- May cause unsaved form data loss

**Fix**:
Create data refresh function:

```javascript
async function refreshDashboardData() {
  try {
    const response = await fetch('/admin/dashboard/data');
    const data = await response.json();
    
    // Update stats
    document.getElementById('totalFiles').textContent = data.stats.totalFiles || '0';
    document.getElementById('totalUsers').textContent = data.stats.totalUsers || '0';
    
    // Refresh tables with updated data
    repopulateFileTable(data.files);
    repopulateUserTable(data.users);
    repopulateAuditTable(data.auditLogs);
  } catch (err) {
    console.error('Failed to refresh data:', err);
    // Fallback to reload if API fails
    location.reload();
  }
}

// Then in success callbacks:
if (data.success) {
  showActionToast(data.message, 'success');
  await refreshDashboardData();  // Instead of location.reload()
}
```

**Estimated Fix Time**: 30 minutes

---

### Bug #4: User Status Column Always Empty (Never Populated)
**Severity**: 🟠 HIGH  
**Lines**: 533, 123-124  
**Category**: Data Display Error

**Issue**:
User management table has "Status" column header but cell is always empty `<td></td>`. The column should display user status (active/suspended/inactive) but no data is ever populated.

**Current Code**:
```html
<!-- Line 123-124 - Header -->
<th>Status</th>
<th>Actions</th>

<!-- Line 533 - Cell -->
<td></td>  <!-- ❌ Always empty -->
```

**Risk**:
- Misleading to users - they see Status column but no data
- Administrators can't see user status from dashboard
- Need to click elsewhere to see full user details

**Fix**:
Add status to user row data:

```javascript
// In user row generation (around line 530)
const userStatus = user.status || 'active';
const statusBadge = userStatus === 'active' 
  ? `<span class="badge badge-success">${userStatus}</span>`
  : `<span class="badge badge-danger">${userStatus}</span>`;

row.innerHTML = `
  <td>${escapeHtml(user._id)}</td>
  <td>${escapeHtml(user.email)}</td>
  <td>${roleCell}</td>
  <td>${statusBadge}</td>  <!-- ✅ Now populated -->
  <td>
    <button onclick="deactivateAdminUser(${escapeHtml(JSON.stringify(user._id))})"><i class="ri-forbid-line"></i> Deactivate</button>
    ${roleActionButton}
  </td>
`;
```

**Estimated Fix Time**: 15 minutes

---

### Bug #5: No Debounce on Role Change Button (Rapid Clicks Create Duplicate Requests)
**Severity**: 🟠 HIGH  
**Lines**: 516-517, 725  
**Category**: Concurrency / Race Condition

**Issue**:
`updateAdminRole()` button has no operation lock. User can click "Update Role" multiple times rapidly, creating duplicate API requests for same role change.

**Current Code**:
```javascript
// Line 516-517 - Button with no lock
`<button onclick="updateAdminRole(${escapeHtml(JSON.stringify(user._id))}, document.getElementById(${escapeHtml(JSON.stringify(roleSelectId))}).value)"><i class="ri-refresh-line"></i> Update Role</button>`

// No operation tracking
function updateAdminRole(userId, newRole) {
  // ... no check if operation in progress ...
  const data = await postJson('/admin/user/role', { userId, role: newRole });
}
```

**Risk**:
- Multiple identical role change requests sent to server
- Audit log records multiple redundant updates
- Potential inconsistency if backend doesn't handle idempotency

**Fix**:
Add operation lock (similar to deleteAdminFile):

```javascript
let roleChangeInProgress = {};

function updateAdminRole(userId, newRole) {
  if (roleChangeInProgress[userId]) {
    showActionToast('⏳ Role change already in progress', 'warn');
    return;
  }
  
  if (currentAdminRole !== 'super_admin') {
    showActionToast('Only Super Admin can manage user roles.', 'error');
    return;
  }
  
  const validRoles = ['user', 'admin'];
  if (!validRoles.includes(newRole)) {
    showActionToast('❌ Invalid role selected', 'error');
    return;
  }
  
  roleChangeInProgress[userId] = true;  // ✅ Lock set
  
  openActionConfirm(
    'Update Role',
    `Change role to ${newRole}?`,
    'Update',
    'primary',
    async function() {
      try {
        const data = await postJson('/admin/user/role', { userId, role: newRole });
        if (data.success) {
          addAudit('Role Updated', `${userId} → ${newRole}`);
          showActionToast(`Role updated to ${newRole}`, 'success');
          await refreshDashboardData();  // Use new refresh function
        } else {
          showActionToast(data.message, 'error');
        }
      } catch (err) {
        showActionToast(err.message || 'Role update failed', 'error');
      } finally {
        delete roleChangeInProgress[userId];  // ✅ Lock released
      }
    }
  );
}
```

**Estimated Fix Time**: 20 minutes

---

## MEDIUM SEVERITY BUGS (7)

### Bug #6: RequestJson Not Available If External Script Fails
**Severity**: 🟡 MEDIUM  
**Lines**: 696  
**Category**: Error Handling

**Issue**:
Line 696 destructures `requestJson`, `postNoBody`, `postJson` from `window.RequestHelpers` without checking if it exists. If `/js/requestHelpers.js` fails to load, page crashes.

**Current Code**:
```javascript
// Line 696 - No null check
const { requestJson, postNoBody, postJson } = window.RequestHelpers;
```

**Risk**:
- Page breaks if external script fails to load
- No error message to user
- Functions called later throw undefined errors

**Fix**:
Add existence check:

```javascript
const { requestJson, postNoBody, postJson } = window.RequestHelpers || {
  requestJson: async () => { throw new Error('Request helpers not loaded'); },
  postNoBody: async () => { throw new Error('Request helpers not loaded'); },
  postJson: async () => { throw new Error('Request helpers not loaded'); }
};

// Or better yet:
if (!window.RequestHelpers) {
  console.error('RequestHelpers library failed to load');
  showActionToast('⚠️ Dashboard functionality may be limited', 'error');
}
```

**Estimated Fix Time**: 5 minutes

---

### Bug #7: No Loading State During API Operations
**Severity**: 🟡 MEDIUM  
**Lines**: 673, 709, 717, 721, 779  
**Category**: UX / User Feedback

**Issue**:
File operations (delete, download, view) and user management (role change, deactivation) don't disable buttons or show loading spinners during async API calls. User can click buttons multiple times thinking nothing happened.

**Current Code**:
```javascript
// No loading state shown
async function deleteAdminFile(fileId) {
  // ... opens confirm modal ...
  try {
    const data = await postNoBody(`/admin/file/delete/${fileId}`);
    // ❌ No button disabled, no spinner, no visual feedback during wait
```

**Risk**:
- User confusion - seems like nothing is happening
- User clicks again, creating duplicate requests
- Poor perceived performance

**Fix**:
Show loading state in confirmation modal:

```javascript
async function deleteAdminFile(fileId) {
  if (fileOperationInProgress[fileId]) {
    showActionToast('⏳ Operation already in progress', 'warn');
    return;
  }
  
  openActionConfirm(
    'Delete File',
    'Do you want to delete this file?\n\nThis action cannot be undone.',
    'Delete',
    'danger',
    async function() {
      fileOperationInProgress[fileId] = true;
      const okBtn = document.getElementById('confirmOkBtn');
      const originalText = okBtn.textContent;
      okBtn.disabled = true;  // ✅ Disable button
      okBtn.textContent = '⏳ Deleting...';  // ✅ Show loading text
      
      try {
        const data = await postNoBody(`/admin/file/delete/${fileId}`);
        if (data.success) {
          showActionToast(data.message, 'success');
          await refreshDashboardData();
        } else {
          showActionToast(data.message, 'error');
        }
      } catch (err) {
        showActionToast(err.message || 'Delete failed', 'error');
      } finally {
        okBtn.disabled = false;
        okBtn.textContent = originalText;
        delete fileOperationInProgress[fileId];
      }
    }
  );
}
```

**Estimated Fix Time**: 25 minutes (apply to all 5 operations)

---

### Bug #8: Invalid Date Display for Audit Logs
**Severity**: 🟡 MEDIUM  
**Lines**: 572, 580  
**Category**: Data Display Error

**Issue**:
Audit log dates created using `new Date(log.date).toLocaleDateString()` without validation. If `log.date` is null/undefined/invalid, displays "Invalid Date" string.

**Current Code**:
```javascript
// Line 580
const logDate = new Date(log.date).toLocaleDateString();  // ❌ No validation
row.innerHTML = `
  <td>${escapeHtml(log.action)}</td>
  <td>${escapeHtml(log.filename)}</td>
  <td>${escapeHtml(log.user)}</td>
  <td>${escapeHtml(logDate)}</td>  // Could show "Invalid Date"
`;
```

**Risk**:
- Displays "Invalid Date" in table if data corrupted
- Confusing to users
- May indicate data quality issues

**Fix**:
Add validation:

```javascript
const logDate = log.date 
  ? new Date(log.date).toLocaleDateString()
  : 'Unknown Date';

// Or with fallback:
const logDate = (() => {
  try {
    const d = new Date(log.date);
    return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleDateString();
  } catch (e) {
    return 'Error';
  }
})();
```

**Estimated Fix Time**: 5 minutes

---

### Bug #9: No Validation on Profile Modal Open (Hardcoded Values)
**Severity**: 🟡 MEDIUM  
**Lines**: 293-297  
**Category**: State Management

**Issue**:
`openAdminProfileModal()` uses hardcoded global variables (`adminDisplayName`, `adminAvatarFile`) which may be stale. If user profile updated by another tab, modal shows outdated values.

**Current Code**:
```javascript
function openAdminProfileModal() {
  // ... uses global variables ...
  if (nameEl) nameEl.textContent = adminDisplayName;  // Could be stale
  if (profileAvatar) profileAvatar.src = getAdminAvatarUrl(adminAvatarFile);  // Could be stale
}
```

**Risk**:
- Multiple tabs open - one tab updates profile, modal in other tab shows old data
- User confused by seeing outdated info
- May attempt to update to values they think are current

**Fix**:
Fetch fresh data when opening modal:

```javascript
async function openAdminProfileModal() {
  try {
    const response = await fetch('/auth/user/profile');
    const data = await response.json();
    
    adminDisplayName = data.fullname || adminDisplayName;
    adminAvatarFile = data.avatar || adminAvatarFile;
    
    // Now update UI with fresh data
    const modal = document.getElementById('adminProfileModal');
    // ... rest of setup ...
  } catch (err) {
    console.warn('Failed to fetch current profile:', err);
    // Fall back to cached values if fetch fails
  }
}
```

**Estimated Fix Time**: 15 minutes

---

### Bug #10: Filter Button Onclick is Redundant
**Severity**: 🟡 MEDIUM  
**Lines**: 77, 543-550  
**Category**: UX / Logic Duplication

**Issue**:
File filters have:
1. Manual Filter button with `onclick="filterFiles()"` 
2. Input field with debounced event listener
3. Dropdown with change listener

The manual button is redundant since search/filter already auto-update on input/change.

**Current Code**:
```html
<!-- Line 77 -->
<button onclick="filterFiles()"><i class="ri-filter-line"></i> Filter</button>

<!-- But filters already auto-run on input/change -->
<script>
  fileSearchInput.addEventListener('input', (e) => {  // Auto-filters
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => filterFiles(), 300);
  });
  fileCategoryFilter.addEventListener('change', filterFiles);  // Auto-filters
</script>
```

**Risk**:
- Confusing UX - button does same thing as input field
- Users might click button expecting something different
- Creates maintenance confusion

**Fix**:
Remove redundant button or repurpose it:

```html
<!-- Option 1: Remove button entirely -->
<!-- <button onclick="filterFiles()">...</button> -->

<!-- Option 2: Repurpose for "Clear Filters" -->
<button onclick="clearFilters()"><i class="ri-refresh-line"></i> Clear Filters</button>

<script>
function clearFilters() {
  document.getElementById('fileSearch').value = '';
  document.getElementById('fileCategoryFilter').value = 'all';
  filterFiles();
}
</script>
```

**Estimated Fix Time**: 10 minutes

---

### Bug #11: No Avatar Error Handler (Broken Image Icon Not Set)
**Severity**: 🟡 MEDIUM  
**Lines**: 33, 179, 350  
**Category**: UX / Error Handling

**Issue**:
Avatar images have no error handler. If image fails to load, users see broken image icon with no fallback.

**Current Code**:
```html
<img id="adminAvatar" src="" class="admin-avatar" alt="Admin Avatar" />

<img id="adminProfileAvatar" src="" class="profile-avatar" alt="Admin Avatar" />
```

**JavaScript**:
```javascript
// Sets src but no error handler
if (headerAvatar) headerAvatar.src = getAdminAvatarUrl(adminAvatarFile);
```

**Risk**:
- Broken image icons in UI
- No fallback to placeholder
- Poor user experience

**Fix**:
Add error handler:

```javascript
function getAdminAvatarUrl(avatarFilename) {
  if (!avatarFilename) return 'https://via.placeholder.com/56';
  const sanitized = String(avatarFilename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return `/uploads/${encodeURIComponent(sanitized)}`;
}

// After setting src:
if (headerAvatar) {
  headerAvatar.src = getAdminAvatarUrl(adminAvatarFile);
  headerAvatar.onerror = function() {
    this.src = 'https://via.placeholder.com/56';  // ✅ Fallback on error
  };
}
```

**Estimated Fix Time**: 10 minutes

---

### Bug #12: Profile Form Not Reset on Modal Close
**Severity**: 🟡 MEDIUM  
**Lines**: 215, 285  
**Category**: State Management / UX

**Issue**:
When user closes profile modal without saving (ESC key, click outside, close button), form values remain. If they open modal again, they see their previous edits still there.

**Current Code**:
```javascript
function closeAdminProfileModal() {
  const modal = document.getElementById('adminProfileModal');
  if (modal) modal.classList.remove('show');  // Just hides modal
  // ❌ Form state never reset
}
```

**Risk**:
- User types new name, closes modal, opens again - sees the typed name
- Confuses user about what's saved vs unsaved
- May accidentally save stale form data

**Fix**:
Reset form on close:

```javascript
function closeAdminProfileModal() {
  const modal = document.getElementById('adminProfileModal');
  if (modal) {
    modal.classList.remove('show');
    // Reset form state
    const form = document.getElementById('adminProfileForm');
    if (form) form.reset();
    const statusEl = document.getElementById('adminProfileStatus');
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.className = 'profile-status';
    }
    // Reset inputs to current values
    const fullnameEl = document.getElementById('adminFullnameInput');
    if (fullnameEl) fullnameEl.value = adminDisplayName;
    const photoEl = document.getElementById('adminPhotoInput');
    if (photoEl) photoEl.value = '';
  }
}
```

**Estimated Fix Time**: 10 minutes

---

## LOW SEVERITY BUGS (3)

### Bug #13: Date Parser Doesn't Handle Timezone Issues
**Severity**: 🔵 LOW  
**Lines**: 455, 580  
**Category**: Data Display / Localization

**Issue**:
Date parsing uses `toLocaleDateString()` which applies user's locale. May show different dates depending on user timezone.

**Current Code**:
```javascript
const uploadDate = new Date(file.uploadedAt).toLocaleDateString();
const logDate = new Date(log.date).toLocaleDateString();
```

**Risk**:
- Different users see different dates for same file if timezone differs
- May show yesterday's date for file uploaded "today" in UTC
- Inconsistent across team

**Fix**:
Use consistent format or server timezone:

```javascript
const uploadDate = new Date(file.uploadedAt).toISOString().split('T')[0];  // YYYY-MM-DD
const logDate = new Date(log.date).toISOString().split('T')[0];
```

**Estimated Fix Time**: 5 minutes

---

### Bug #14: No CSRF Token in POST Requests
**Severity**: 🔵 LOW  
**Lines**: 696-779  
**Category**: Security

**Issue**:
POST/DELETE requests via `postJson`/`postNoBody` don't include CSRF token. If CSRF middleware is enabled, requests will fail.

**Current Code**:
```javascript
const data = await postJson('/admin/user/role', { userId, role: newRole });  // ❌ No CSRF
const data = await postNoBody(`/admin/file/delete/${fileId}`);  // ❌ No CSRF
```

**Note**: This depends on if `requestHelpers.js` includes CSRF handling. If it doesn't, requests will fail server-side.

**Fix**:
If not handled by requestHelpers, add manually:

```javascript
async function postJsonWithCsrf(url, data) {
  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-csrf-token': csrfToken || ''
    },
    body: JSON.stringify(data)
  });
}
```

**Estimated Fix Time**: 5 minutes (if not already handled)

---

### Bug #15: Audit Log Text Content Can Include HTML
**Severity**: 🔵 LOW  
**Lines**: 584-590  
**Category**: Data Display

**Issue**:
`addAudit()` function creates audit rows dynamically. While it uses `textContent`, the values passed might already be escaped or might contain special characters.

**Current Code**:
```javascript
function addAudit(action, target) {
  // ...
  tdAction.textContent = action;  // ✅ Safe
  tdTarget.textContent = target;  // ✅ Safe
  tdUser.textContent = '<%= fullname || "Admin" %>';  // ⚠️ Server-side rendered
  // ...
}
```

**Risk**:
- Minimal risk since using textContent
- But the fullname is hardcoded from server - should be dynamic

**Fix**:
Use dynamic values:

```javascript
function addAudit(action, target) {
  const row = document.createElement('tr');
  const today = new Date().toLocaleDateString();
  const auditTableEl = document.getElementById('auditTable');
  if (!auditTableEl) return;
  const currentIndex = auditTableEl.rows.length;
  row.style.setProperty('--row-index', currentIndex);
  
  const tdAction = document.createElement('td');
  tdAction.textContent = action;
  const tdTarget = document.createElement('td');
  tdTarget.textContent = target;
  const tdUser = document.createElement('td');
  tdUser.textContent = adminDisplayName || 'Admin';  // ✅ Dynamic
  const tdDate = document.createElement('td');
  tdDate.textContent = today;
  
  row.appendChild(tdAction);
  row.appendChild(tdTarget);
  row.appendChild(tdUser);
  row.appendChild(tdDate);
  auditTableEl.appendChild(row);
}
```

**Estimated Fix Time**: 5 minutes

---

## SUMMARY

| Category | Count | Total Time |
|----------|-------|-----------|
| 🔴 Critical | 1 | 10 min |
| 🟠 High | 4 | 70 min |
| 🟡 Medium | 7 | 85 min |
| 🔵 Low | 3 | 15 min |
| **TOTAL** | **15** | **~3 hours** |

### Priority Order for Fixing:
1. **Bug #1** (Multiple DOMContentLoaded) - 10 min - Consolidate listeners
2. **Bug #2** (currentAdminRole validation) - 5 min - Add null checks
3. **Bug #4** (Empty status column) - 15 min - Populate user status
4. **Bug #3** (location.reload) - 30 min - Create data refresh API
5. **Bug #5** (Role change debounce) - 20 min - Add operation lock
6. **Bug #7** (No loading state) - 25 min - Add button disable/spinner
7. **Bug #9** (Modal stale data) - 15 min - Fetch fresh data
8. **Bug #12** (Form not reset) - 10 min - Reset on close
9. **Bug #6** (RequestHelpers error) - 5 min - Add existence check
10. Others in order of severity...

### Bugs Already Fixed (Round 1):
- ✅ Bug #1 (XSS Avatar)
- ✅ Bug #3 (Extension validation)
- ✅ Bug #4 (Search debounce)
- ✅ Bug #5 (Concurrent deletes)
- ✅ Bug #6 (Memory leak)
- ✅ Bug #7 (Input disable)
- ✅ Bug #8 (Empty table sort)
- ✅ Bug #9 (Role validation)
- ✅ Bug #10 (Download feedback)

