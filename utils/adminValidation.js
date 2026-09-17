/**
 * Admin Validation & Authorization Utilities
 * Consolidates repeated role/branch validation logic used across admin routes
 */

/**
 * Build a filter for data queries based on admin role and branch assignment
 * @param {Object} admin - The admin user object (req.actor)
 * @param {string} admin.role - The admin role ('admin' or 'super_admin')
 * @param {string} admin.branch - The admin's assigned branch
 * @param {string} baseField - The field name to filter on (default: 'branch')
 * @returns {Object} MongoDB filter object
 */
function getBranchFilter(admin, baseField = 'branch') {
  if (!admin) return {};
  
  const isSuperAdmin = admin.role === 'super_admin';
  
  if (isSuperAdmin) {
    return { deleted: { $ne: true } };
  }
  
  return {
    [baseField]: admin.branch || '',
    deleted: { $ne: true }
  };
}

/**
 * Build a filter for user queries based on admin role
 * @param {Object} admin - The admin user object
 * @param {string} role - The role of users to filter (default: 'user')
 * @returns {Object} MongoDB filter object
 */
function getUserFilter(admin, role = 'user') {
  if (!admin) return {};
  
  const isSuperAdmin = admin.role === 'super_admin';
  
  if (isSuperAdmin) {
    return { role };
  }
  
  return {
    role,
    branch: admin.branch || ''
  };
}

/**
 * Build a filter for admin-only queries
 * @param {Object} admin - The admin user object
 * @returns {Object} MongoDB filter object
 */
function getAdminFilter(admin) {
  if (!admin) return {};
  
  const isSuperAdmin = admin.role === 'super_admin';
  
  if (isSuperAdmin) {
    return { role: { $in: ['admin', 'super_admin'] } };
  }
  
  return {
    role: 'admin',
    branch: admin.branch || '',
    active: { $ne: false }
  };
}

/**
 * Validate that an admin can manage a specific user
 * @param {Object} admin - The admin user object
 * @param {Object} targetUser - The target user to check
 * @returns {Object} { allowed: boolean, reason: string }
 */
function validateAdminCanManageUser(admin, targetUser) {
  if (!admin || !targetUser) {
    return { allowed: false, reason: 'Invalid admin or user object' };
  }
  
  // Super admin can manage anyone except themselves
  if (admin.role === 'super_admin') {
    if (String(admin._id) === String(targetUser._id)) {
      return { allowed: false, reason: 'Cannot manage your own account' };
    }
    if (targetUser.role === 'super_admin') {
      return { allowed: false, reason: 'Cannot manage other super admin accounts' };
    }
    return { allowed: true };
  }
  
  // Regular admin can only manage users in their branch
  if (admin.role === 'admin') {
    // Can only manage regular users
    if (targetUser.role !== 'user') {
      return { allowed: false, reason: 'Admins can only manage regular users' };
    }
    
    // Must be in same branch
    if ((targetUser.branch || '') !== (admin.branch || '')) {
      return { allowed: false, reason: 'Admins can only manage users in their assigned branch' };
    }
    
    return { allowed: true };
  }
  
  return { allowed: false, reason: 'Insufficient permissions' };
}

/**
 * Validate that an admin can manage a specific file
 * @param {Object} admin - The admin user object
 * @param {Object} file - The file object (should have branch or owner.branch)
 * @returns {Object} { allowed: boolean, reason: string }
 */
function validateAdminCanManageFile(admin, file) {
  if (!admin || !file) {
    return { allowed: false, reason: 'Invalid admin or file object' };
  }
  
  // Super admin can manage all files
  if (admin.role === 'super_admin') {
    return { allowed: true };
  }
  
  // Regular admin can only manage files from their branch
  if (admin.role === 'admin') {
    const fileBranch = file.branch || (file.owner && file.owner.branch) || '';
    if (!fileBranch || fileBranch !== (admin.branch || '')) {
      return { allowed: false, reason: 'You can only manage files from your branch' };
    }
    return { allowed: true };
  }
  
  return { allowed: false, reason: 'Insufficient permissions' };
}

/**
 * Format admin scope information for display/logging
 * @param {Object} admin - The admin user object
 * @returns {string} Human-readable scope description
 */
function formatAdminScope(admin) {
  if (!admin) return 'Unknown';
  
  if (admin.role === 'super_admin') {
    return 'Super Admin (Global Access)';
  }
  
  if (admin.role === 'admin') {
    return `Admin (${admin.branch || 'Unassigned'} Branch)`;
  }
  
  return `${admin.role} (Limited Access)`;
}

module.exports = {
  getBranchFilter,
  getUserFilter,
  getAdminFilter,
  validateAdminCanManageUser,
  validateAdminCanManageFile,
  formatAdminScope
};
