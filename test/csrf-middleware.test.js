const { expect } = require('chai');
const { validateCsrfRequest, generateCsrfToken } = require('../middleware/csrfMiddleware');

function makeReq(options = {}) {
  return {
    headers: options.headers || {},
    body: options.body || {},
    query: options.query || {},
    res: options.res || null
  };
}

function makeRes() {
  const state = { headers: [] };
  return {
    append(name, value) {
      state.headers.push({ name, value });
    },
    get headers() {
      return state.headers;
    }
  };
}

function makeCookieHeader(token) {
  return `cfs_csrf=${encodeURIComponent(token)}`;
}

describe('CSRF Middleware', () => {
  it('should reject when cookie token is missing', () => {
    const req = makeReq({ headers: {} });
    const result = validateCsrfRequest(req);

    expect(result.valid).to.be.false;
    expect(result.message).to.equal('CSRF token missing');
  });

  it('should reject when submitted token is missing', () => {
    const token = generateCsrfToken();
    const req = makeReq({ headers: { cookie: makeCookieHeader(token) } });
    const result = validateCsrfRequest(req);

    expect(result.valid).to.be.false;
    expect(result.message).to.equal('CSRF token missing');
  });

  it('should reject when tokens do not match', () => {
    const token = generateCsrfToken();
    const req = makeReq({
      headers: { cookie: makeCookieHeader(token), 'x-csrf-token': 'invalid-token' }
    });
    const result = validateCsrfRequest(req);

    expect(result.valid).to.be.false;
    expect(result.message).to.equal('CSRF token mismatch');
  });

  it('should reject expired tokens', () => {
    const oldToken = `${'a'.repeat(64)}.${(Date.now() - (25 * 60 * 60 * 1000)).toString(36)}`;
    const req = makeReq({
      headers: { cookie: makeCookieHeader(oldToken), 'x-csrf-token': oldToken }
    });
    const result = validateCsrfRequest(req);

    expect(result.valid).to.be.false;
    expect(result.message).to.equal('CSRF token expired');
  });

  it('should validate matching token and rotate the cookie', () => {
    const token = generateCsrfToken();
    const res = makeRes();
    const req = makeReq({
      headers: { cookie: makeCookieHeader(token), 'x-csrf-token': token },
      res
    });

    const result = validateCsrfRequest(req, res);

    expect(result.valid).to.be.true;
    expect(result).to.have.property('token').that.is.a('string');
    expect(result.token).to.not.equal(token);
    expect(res.headers).to.have.lengthOf(1);
    expect(res.headers[0].name).to.equal('Set-Cookie');
    expect(res.headers[0].value).to.include('cfs_csrf=');
  });
});
