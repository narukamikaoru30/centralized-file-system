const { expect } = require('chai');
const {
  MAX_OTP_ATTEMPTS,
  OTP_TTL_MS,
  generateOnboardingOtp,
  createPendingOnboarding,
  verifyOnboardingOtp
} = require('../utils/onboardingOtp');
const mailer = require('../utils/mailer');

describe('Email onboarding OTP', () => {
  it('loads the configured mailer and exposes the onboarding sender', () => {
    expect(mailer).to.be.a('function');
    expect(mailer.sendOnboardingOtp).to.be.a('function');
  });

  it('accepts the MAIL_* settings documented in the environment example', () => {
    const config = mailer.resolveMailConfig({
      MAIL_HOST: 'smtp.example.com',
      MAIL_PORT: '465',
      MAIL_USER: 'mailer@example.com',
      MAIL_PASS: 'test-password',
      MAIL_FROM: 'noreply@example.com'
    });

    expect(config).to.include({
      host: 'smtp.example.com',
      port: 465,
      user: 'mailer@example.com',
      pass: 'test-password',
      from: 'noreply@example.com'
    });
  });

  it('generates six-digit codes and verifies only the matching code', () => {
    const code = generateOnboardingOtp();
    const pending = createPendingOnboarding({ email: 'person@example.com' }, code);

    expect(code).to.match(/^\d{6}$/);
    expect(verifyOnboardingOtp(code, pending.codeHash)).to.equal(true);
    expect(verifyOnboardingOtp(code === '000000' ? '000001' : '000000', pending.codeHash)).to.equal(false);
  });

  it('sets a bounded verification lifetime and attempt policy', () => {
    const startedAt = Date.now();
    const pending = createPendingOnboarding({ email: 'person@example.com' }, '123456');

    expect(pending.expiresAt).to.be.within(startedAt + OTP_TTL_MS - 100, startedAt + OTP_TTL_MS + 100);
    expect(pending.attempts).to.equal(0);
    expect(MAX_OTP_ATTEMPTS).to.equal(5);
  });
});
