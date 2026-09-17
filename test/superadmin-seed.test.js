const { expect } = require('chai');
const { ensureDefaultSuperAdmin } = require('../utils/superAdminSeed');

describe('Super admin seed', () => {
  it('updates an existing super admin to match the configured environment credentials', async () => {
    const existing = {
      _id: 'super-1',
      role: 'super_admin',
      email: 'old@example.com',
      password: 'old-hash',
      fullname: 'Old Super Admin',
      active: false,
      status: 'inactive',
      saveCalls: 0,
      async save() {
        this.saveCalls += 1;
        return this;
      }
    };

    const User = {
      findOne: async (query) => {
        if (query && query.role === 'super_admin') return existing;
        return null;
      },
      create: async () => {
        throw new Error('create should not be called when a super admin already exists');
      }
    };

    const logger = {
      info() {},
      warn() {},
      error() {}
    };

    await ensureDefaultSuperAdmin({
      User,
      logger,
      env: {
        ENABLE_DEFAULT_SUPERADMIN_SEED: 'true',
        DEFAULT_SUPERADMIN_EMAIL: 'new@example.com',
        DEFAULT_SUPERADMIN_PASSWORD: 'SuperAdmin@2026!'
      }
    });

    expect(existing.email).to.equal('new@example.com');
    expect(existing.password).to.not.equal('old-hash');
    expect(existing.active).to.equal(true);
    expect(existing.status).to.equal('active');
    expect(existing.fullname).to.equal('Default Super Admin');
    expect(existing.saveCalls).to.equal(1);
  });
});
