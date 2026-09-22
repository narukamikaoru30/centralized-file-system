const { expect } = require('chai');
const {
  generateRecoveryCodes,
  hashRecoveryCode,
  isTotpReplay,
  normalizeTotpToken,
  normalizeTotpSecret,
  createTotp
} = require('../routes/auth');
const User = require('../models/User');

describe('2FA security helpers', () => {
  it('generates 8 unique recovery codes', () => {
    const codes = generateRecoveryCodes();

    expect(codes).to.have.length(8);
    expect(new Set(codes).size).to.equal(8);
    codes.forEach(code => {
      expect(code).to.match(/^[A-Z0-9]{8}$/);
    });
  });

  it('hashes recovery codes consistently', () => {
    expect(hashRecoveryCode('ABC12345')).to.equal(hashRecoveryCode('abc12345'));
  });

  it('sanitizes incoming TOTP tokens', () => {
    expect(normalizeTotpToken(123456)).to.equal('123456');
    expect(normalizeTotpToken(' 123456 ')).to.equal('123456');
    expect(normalizeTotpToken(null)).to.equal('');
  });

  it('normalizes the stored base32 secret and validates generated codes', () => {
    const secret = normalizeTotpSecret(' jbsw y3dp ehpk 3pxp ');
    const totp = createTotp(secret, 'test@example.com');
    const token = totp.generate();

    expect(secret).to.equal('JBSWY3DPEHPK3PXP');
    expect(totp.validate({ token, window: 1 })).to.not.equal(null);
  });

  it('blocks replay in the same 30 second window', () => {
    const step = Math.floor(Date.now() / 30000);
    const token = '123456';
    const user = {
      totpLastUsedWindow: step,
      totpLastUsedCodeHash: hashRecoveryCode(token)
    };

    expect(isTotpReplay(user, token)).to.equal(true);
    expect(isTotpReplay(user, '654321')).to.equal(false);
  });

  it('does not serialize password or 2FA secrets', () => {
    const user = new User({
      fullname: 'Security Test',
      email: 'security-test@example.com',
      password: 'hashed-password',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      recoveryCodes: ['hashed-recovery-code']
    });
    const serialized = user.toJSON();

    expect(serialized).to.not.have.property('password');
    expect(serialized).to.not.have.property('totpSecret');
    expect(serialized).to.not.have.property('recoveryCodes');
  });
});
