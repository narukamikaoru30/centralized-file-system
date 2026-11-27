# Dashboard Function Testing & Verification Guide

## CRITICAL FIXES APPLIED ✅

### AdminDashboard.ejs Fixes
1. ✅ **Fixed DOMContentLoaded Structural Issue**: Moved initialization code inside listener
2. ✅ **Fixed User Status Column**: Added status badges (active=green, other=red) to both initial generation and repopulateUserTable
3. ✅ **Removed Duplicate Listener Closing**: Fixed double-closing of DOMContentLoaded

---

## REQUIRED TESTING STEPS

### Step 1: Verify Dashboard Loads Without Errors
**Action**: 
1. Open browser DevTools (F12)
2. Go to Console tab
3. Navigate to `/admin/dashboard` 
4. Look for any red error messages

**Expected Result**: No errors, clean console

**Common Errors to Watch For**:
- ❌ `Cannot read property 'innerHTML' of null` → indicates DOM not ready when code ran
- ❌ `refreshDashboardData is not defined` → function missing
- ❌ `requestJson is not defined` → `/js/requestHelpers.js` not loaded

---

### Step 2: Test Initial Dashboard Load
**Action**:
1. Open admindashboard page
2. Verify the following elements load:
   - [ ] Stats boxes (Total Files, Total Users, Active Admins, Recent Uploads)
   - [ ] Files table with headers and data
   - [ ] Users table with headers and data
   - [ ] Audit logs table with headers and data

**Expected Result**: All tables should have data and be sortable

**If Files/Users/Audit not loading**:
- Check Network tab (F12 → Network)
- Page source should have `<%- JSON.stringify(files || []) %>` populated with actual data
- If empty `[]`, backend is not passing data to EJS template

---

### Step 3: Test User Status Column
**Action**:
1. Look at Users table
2. Check Status column (4th column)
3. Verify status displays as badges:
   - Green `active` badge for active users
   - Red badge for deactivated users

**Expected Result**: 
```
| User ID | Email | Role | Status | Actions |
| xxx     | ...   | User | 🟢 active | ... |
| yyy     | ...   | User | 🔴 deactivated | ... |
```

**If Status Column Empty**:
- Check if user.status is undefined in backend response
- Verify repopulateUserTable includes status badge code (lines 848-851)

---

### Step 4: Test File Operations (DELETE)
**Action**:
1. Click "Delete" button on any file in Files table
2. Observe button state changes
3. Watch Network tab for `/admin/files/{fileId}` DELETE request
4. Verify toast notification appears

**Expected Results**:
1. Button shows "⏳ Deleting..." immediately
2. Network call made to `/admin/files/{fileId}`
3. On success: table refreshes via `refreshDashboardData()`
4. Toast shows success message

**If Delete Fails**:
- Check Network tab for 404/500 errors
- Verify `/admin/files/{fileId}` DELETE endpoint exists in routes/admin.js
- Check Console for error messages in the catch block

---

### Step 5: Test Role Change (SUPER_ADMIN ONLY)
**Action** (only if logged in as super_admin):
1. Find "Update Role" button in Users table
2. Change a user's role dropdown
3. Click "Update Role" button
4. Observe state and network calls

**Expected**:
1. Button shows "⏳ Updating..."
2. Network call to update role
3. Table refreshes
4. User role updated in table

**If Fails**:
- Check `/admin/users/{userId}/role` endpoint exists
- Verify backend returns `{ success: true, ... }`

---

### Step 6: Test Filter/Search
**Action**:
1. Type in "File Search" input
2. Select "Category Filter" dropdown
3. Observe table filtering

**Expected**: Files table should filter by name and category in real-time

**If Filter Doesn't Work**:
- Open Console for errors
- Verify `filterFiles()` function defined (it is at line 1028)
- Check if file table HTML structure matches expectation

---

### Step 7: Test Admin Profile Modal
**Action**:
1. Click avatar image in header (top right)
2. Modal should open
3. Click "Save Changes" (with no changes)
4. Observe network call to `/auth/user/profile`

**Expected**:
1. Modal opens with user data
2. POST request to `/auth/user/profile`
3. On success: profile updates, modal closes
4. Toast notification appears

**If Modal Fails to Open**:
- Check Console for errors in `openAdminProfileModal()` function
- Verify modal HTML element exists with id="adminProfileModal"

**If Save Fails**:
- Check if `/auth/user/profile` POST endpoint exists in routes/auth.js
- Verify endpoint returns `{ success: true, fullname: string, avatar: string }`

---

## BACKEND ENDPOINT VERIFICATION

### Critical Endpoints That Must Exist:

#### 1. GET `/admin/dashboard/data` 
**Purpose**: Fetch fresh dashboard data for `refreshDashboardData()` function  
**Called By**: admindashboard.js line 755  
**Expected Response**:
```json
{
  "success": true,
  "stats": {
    "totalFiles": 10,
    "totalUsers": 5,
    "activeAdmins": 2,
    "recentUploads": 3
  },
  "files": [ /* File objects */ ],
  "users": [ /* User objects */ ],
  "auditLogs": [ /* AuditLog objects */ ]
}
```

**Verify Exists**:
- Check routes/admin.js for GET /dashboard/data
- Or routes/api.js for GET /admin/dashboard/data

**If Missing**: Must create this endpoint!

---

#### 2. GET `/auth/user/profile`
**Purpose**: Fetch current user profile for modal  
**Called By**: admindashboard.js line 754 (openAdminProfileModal)  
**Expected Response**:
```json
{
  "success": true,
  "fullname": "Admin Name",
  "avatar": "filename.jpg"
}
```

**Verify Exists**:
- Check routes/auth.js for GET /user/profile

**If Missing**: May need to create or verify format matches

---

#### 3. DELETE `/admin/files/:fileId`
**Purpose**: Delete file  
**Called By**: admindashboard.js line 894 (deleteAdminFile)  
**Expected Response**:
```json
{
  "success": true,
  "message": "File deleted successfully"
}
```

---

#### 4. POST `/admin/users/:userId/role`
**Purpose**: Update user role  
**Called By**: admindashboard.js line 935 (updateAdminRole)  
**Expected Response**:
```json
{
  "success": true,
  "message": "Role updated"
}
```

---

## QUICK DIAGNOSTIC CHECKLIST

Before reporting issue fixed, verify:

- [ ] Admin dashboard loads without console errors
- [ ] Stats boxes show numbers (not 0)
- [ ] Files table loads with data
- [ ] Users table loads with data and status badges
- [ ] Audit logs table loads with dates
- [ ] User status column shows color badges
- [ ] Filter/search works
- [ ] File delete operation works (network call + table refresh)
- [ ] Profile modal opens and saves
- [ ] No pending network requests fail (all show 200/201/204 status)

---

## NEXT DEBUGGING STEPS IF STILL BROKEN

1. **Collect Full Console Output**:
   - Right-click Console → Save As → Copy all errors
   - Share exact error messages

2. **Check Network Tab**:
   - Filter by XHR (XMLHttpRequest)
   - Identify which API calls fail
   - Check response status and body

3. **Verify Backend Endpoints**:
   - Search routes/admin.js and routes/auth.js
   - Confirm endpoints exist
   - Verify response format matches expectations

4. **Test Simple Endpoint**:
   - In browser console: `fetch('/auth/user/profile').then(r => r.json()).then(console.log)`
   - See if endpoint is reachable

---

## USERDASHBOARD.EJS STATUS

**Structure Check**: ⚠️ NEEDS VERIFICATION
- DOMContentLoaded listener appears to close around line 2281
- Similar initialization code structure as admin dashboard
- Requires same testing as steps 1-7 above

**To Test UserDashboard**:
1. Apply same verification steps to `/dashboard` route
2. Look for similar DOM access errors
3. Verify `/dashboard/data` endpoint exists if used

---

**Generated**: After Critical Structural Fix
**Status**: Ready for testing
