/**
 * CSRF Protection Middleware
 * Provides Cross-Site Request Forgery protection using double-submit cookie pattern
 */

const crypto = require("crypto");
const logger = require("../utils/logger");

const CSRF_COOKIE_NAME = "cfs_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_TOKEN_LENGTH = 32;
const CSRF_TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const DEBUG_CSRF = process.env.DEBUG_CSRF === "true";

function maskToken(token) {
  if (!token || typeof token !== "string") return null;
  return token.length > 8 ? `${token.slice(0, 8)}...` : token;
}

/**
 * Generate a CSRF token
 * @returns {string} - Secure random token
 */
function generateCsrfToken() {
  const token = crypto.randomBytes(CSRF_TOKEN_LENGTH).toString("hex");
  const timestamp = Date.now().toString(36);
  return `${token}.${timestamp}`;
}

/**
 * Validate CSRF token age
 * @param {string} token - CSRF token with timestamp
 * @returns {boolean}
 */
function isTokenValid(token) {
  if (!token || typeof token !== "string") return false;
  
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  
  const timestamp = parseInt(parts[1], 36);
  if (isNaN(timestamp)) return false;
  
  return (Date.now() - timestamp) < CSRF_TOKEN_MAX_AGE_MS;
}

/**
 * Set CSRF cookie
 * @param {object} res - Express response object
 * @param {string} token - CSRF token
 */
function setCsrfCookie(res, token) {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${CSRF_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=86400${secureCookie}`
  );
}

/**
 * Parse cookies from header
 * @param {string} cookieHeader - Cookie header string
 * @returns {object}
 */
function parseCookies(cookieHeader) {
  const cookies = {};
  if (!cookieHeader) return cookies;
  
  cookieHeader.split(";").forEach(cookie => {
    const [name, ...rest] = cookie.trim().split("=");
    if (name && rest.length) {
      try {
        cookies[name] = decodeURIComponent(rest.join("="));
      } catch {
        cookies[name] = rest.join("=");
      }
    }
  });
  
  return cookies;
}

function getSubmittedCsrfToken(req) {
  return req.headers[CSRF_HEADER_NAME] || req.headers[CSRF_HEADER_NAME.toLowerCase()] ||
    (req.body && req.body._csrf) ||
    (req.query && req.query._csrf);
}

function validateCsrfTokenPair(cookieToken, submittedToken) {
  if (!cookieToken || !submittedToken) {
    return { valid: false, message: "CSRF token missing" };
  }
  if (cookieToken !== submittedToken) {
    return { valid: false, message: "CSRF token mismatch" };
  }
  if (!isTokenValid(cookieToken)) {
    return { valid: false, message: "CSRF token expired" };
  }
  return { valid: true };
}

/**
 * CSRF Protection Middleware
 * - Generates and attaches CSRF token for GET/HEAD/OPTIONS requests
 * - Validates CSRF token for state-changing methods (POST, PUT, DELETE, PATCH)
 */
function csrfProtection(options = {}) {
  const ignorePaths = options.ignorePaths || [];
  const ignoreMethods = ["GET", "HEAD", "OPTIONS"];
  
  return function csrfMiddleware(req, res, next) {
    const cookies = parseCookies(req.headers.cookie || "");
    
    // Skip CSRF for certain paths (like API endpoints with their own auth)
    const shouldSkip = ignorePaths.some(p => {
      if (typeof p === "string") return req.path.startsWith(p);
      if (p instanceof RegExp) return p.test(req.path);
      return false;
    });
    
    if (shouldSkip) {
      return next();
    }
    
    // For safe methods, just ensure a token exists
    if (ignoreMethods.includes(req.method)) {
      let token = cookies[CSRF_COOKIE_NAME];
      
      // Generate new token if missing or expired
      if (!token || !isTokenValid(token)) {
        token = generateCsrfToken();
        setCsrfCookie(res, token);
      }
      
      // Attach token to response locals for templates
      res.locals.csrfToken = token;
      req.csrfToken = () => token;
      
      return next();
    }
    
    // For state-changing methods, validate the token
    const cookieToken = cookies[CSRF_COOKIE_NAME];
    const submittedToken = getSubmittedCsrfToken(req);
    const validation = validateCsrfTokenPair(cookieToken, submittedToken);

    if (!validation.valid) {
      return res.status(403).json({
        success: false,
        message: validation.message
      });
    }

    // Generate new token after successful validation (token rotation)
    const newToken = generateCsrfToken();
    setCsrfCookie(res, newToken);
    res.locals.csrfToken = newToken;
    req.csrfToken = () => newToken;

    return next();
  };
}

/**
 * Validate CSRF request after body parsing
 */
function validateCsrfRequest(req, res) {
  const cookies = parseCookies(req.headers.cookie || "");
  const cookieToken = cookies[CSRF_COOKIE_NAME];
  const submittedToken = getSubmittedCsrfToken(req);
  const validation = validateCsrfTokenPair(cookieToken, submittedToken);

  if (!validation.valid) {
    if (DEBUG_CSRF) {
      logger.warn("CSRF validation failed", {
        path: req.path,
        method: req.method,
        message: validation.message,
        cookieToken: maskToken(cookieToken),
        submittedToken: maskToken(submittedToken)
      });
    }
    return validation;
  }

  const newToken = generateCsrfToken();
  if (res) {
    setCsrfCookie(res, newToken);
    res.locals = res.locals || {};
    res.locals.csrfToken = newToken;
  }
  if (DEBUG_CSRF) {
    logger.debug("CSRF validation succeeded", {
      path: req.path,
      method: req.method,
      cookieToken: maskToken(cookieToken),
      submittedToken: maskToken(submittedToken)
    });
  }
  return { valid: true, token: newToken };
}

function csrfTokenEndpoint(req, res) {
  const token = req.csrfToken ? req.csrfToken() : generateCsrfToken();
  setCsrfCookie(res, token);
  res.json({ csrfToken: token });
}

module.exports = {
  csrfProtection,
  csrfTokenEndpoint,
  validateCsrfRequest,
  generateCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME
};
