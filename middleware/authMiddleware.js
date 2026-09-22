const User = require("../models/User");

function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function respondUnauthorized(req, res, options = {}) {
  const mode = options.mode || "json";
  const message = options.message || "Unauthorized";

  if (mode === "redirect") {
    // Set no-cache headers before redirect to prevent browser from caching auth state
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0'
    });
    if (req.setFlash) req.setFlash("error", message);
    return res.redirect("/auth/login");
  }

  return res.status(401).json({ success: false, message });
}

function hasCompletedTwoFA(req, actor) {
  return !actor?.totpEnabled || req.session?.is2FAComplete === true;
}

// Strict authentication check - requires JWT session (req.user)
function requireAuth(options = {}) {
  return function authMiddleware(req, res, next) {
    if (!req.user) {
      return respondUnauthorized(req, res, {
        mode: options.mode,
        message: options.message || "Please log in to access this page"
      });
    }
    if (!hasCompletedTwoFA(req, req.user)) {
      return respondUnauthorized(req, res, {
        mode: options.mode,
        message: "Complete two-factor authentication to continue"
      });
    }
    req.actor = req.user;
    req.actorEmail = req.user.email;
    return next();
  };
}

function requireActor(options = {}) {
  const emailFields = Array.isArray(options.emailFields) && options.emailFields.length
    ? options.emailFields
    : [];

  return async function actorMiddleware(req, res, next) {
    try {
      if (req.user) {
        if (!hasCompletedTwoFA(req, req.user)) {
          return respondUnauthorized(req, res, {
            mode: options.mode,
            message: "Complete two-factor authentication to continue"
          });
        }
        req.actor = req.user;
        req.actorEmail = req.user.email;
        return next();
      }

      let actorEmail = "";

      for (const fieldPath of emailFields) {
        const value = getByPath(req, fieldPath);
        if (typeof value === "string" && value.trim()) {
          actorEmail = value.trim();
          break;
        }
      }

      if (!actorEmail) {
        return respondUnauthorized(req, res, {
          mode: options.mode,
          message: options.missingEmailMessage || "Missing actor identity"
        });
      }

      const actor = await User.findOne({ email: actorEmail });
      if (!actor) {
        return respondUnauthorized(req, res, {
          mode: options.mode,
          message: options.notFoundMessage || "User not found"
        });
      }

      if (!hasCompletedTwoFA(req, actor)) {
        return respondUnauthorized(req, res, {
          mode: options.mode,
          message: "Complete two-factor authentication to continue"
        });
      }

      req.actor = actor;
      req.actorEmail = actorEmail;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = {
  requireAuth,
  requireActor
};
