const bcrypt = require('bcrypt');

async function ensureDefaultSuperAdmin(options = {}) {
  const {
    User,
    logger,
    env = process.env,
    nodeEnv = process.env.NODE_ENV || 'development'
  } = options;

  const seedEnabled = env.ENABLE_DEFAULT_SUPERADMIN_SEED === 'true';
  if (!seedEnabled) {
    logger && logger.info && logger.info('Default Super Admin seed is disabled');
    return { created: false, updated: false, reason: 'disabled' };
  }

  const superAdminEmail = (env.DEFAULT_SUPERADMIN_EMAIL || '').trim();
  const superAdminPassword = env.DEFAULT_SUPERADMIN_PASSWORD || '';

  if (!superAdminEmail || !superAdminPassword) {
    logger && logger.warn && logger.warn('Super Admin seed skipped: DEFAULT_SUPERADMIN_EMAIL and DEFAULT_SUPERADMIN_PASSWORD must be set.');
    return { created: false, updated: false, reason: 'missing-credentials' };
  }

  if (nodeEnv === 'production' && superAdminPassword.length < 12) {
    logger && logger.error && logger.error('Super Admin seed blocked: DEFAULT_SUPERADMIN_PASSWORD must be at least 12 characters in production.');
    return { created: false, updated: false, reason: 'weak-password' };
  }

  const existingSuperAdmin = await User.findOne({ role: 'super_admin' });

  if (!existingSuperAdmin) {
    const hashedPassword = await bcrypt.hash(superAdminPassword, 12);
    const superAdmin = await User.create({
      fullname: 'Default Super Admin',
      email: superAdminEmail,
      password: hashedPassword,
      role: 'super_admin'
    });

    logger && logger.info && logger.info(`Default Super Admin created: ${superAdmin.email}`);
    return { created: true, updated: false, user: superAdmin };
  }

  const needsUpdate = existingSuperAdmin.email !== superAdminEmail || existingSuperAdmin.fullname !== 'Default Super Admin' || existingSuperAdmin.active === false || existingSuperAdmin.status !== 'active';
  if (!needsUpdate) {
    const samePassword = await bcrypt.compare(superAdminPassword, existingSuperAdmin.password || '');
    if (samePassword) {
      logger && logger.info && logger.info('Super Admin already matches configured credentials');
      return { created: false, updated: false, user: existingSuperAdmin };
    }
  }

  existingSuperAdmin.fullname = 'Default Super Admin';
  existingSuperAdmin.email = superAdminEmail;
  existingSuperAdmin.password = await bcrypt.hash(superAdminPassword, 12);
  existingSuperAdmin.role = 'super_admin';
  existingSuperAdmin.active = true;
  existingSuperAdmin.status = 'active';
  existingSuperAdmin.suspendedReason = '';
  existingSuperAdmin.suspendedUntil = null;
  existingSuperAdmin.failedLoginAttempts = 0;
  existingSuperAdmin.lockUntil = null;
  await existingSuperAdmin.save();

  logger && logger.info && logger.info(`Super Admin credentials synchronized to ${superAdminEmail}`);
  return { created: false, updated: true, user: existingSuperAdmin };
}

module.exports = { ensureDefaultSuperAdmin };
