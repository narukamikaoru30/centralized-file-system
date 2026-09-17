const User = require("../models/User");
const SystemSettings = require("../models/SystemSettings");
const logger = require("../utils/logger");
const {
  SESSION_COOKIE_NAME,
  createSession,
  getSession,
  updateSession,
  destroySession,
  parseCookies,
  setSessionFlash,
  consumeSessionFlash
} = require("../utils/sessionStore");
const {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  verifyAccessToken,
  signAccessToken,
  setAccessCookie,
  clearAccessCookie,
  clearRefreshCookie
} = require("../utils/jwtAuth");
const {
  isAccessTokenRevoked,
  rotateRefreshToken
} = require("../utils/tokenLifecycle");

let autoLogoutCacheMinutes = 30;
let autoLogoutCacheUpdatedAt = 0;
const AUTO_LOGOUT_CACHE_TTL_MS = 30 * 1000;

async function getAutoLogoutMinutes() {
  const now = Date.now();
  if (now - autoLogoutCacheUpdatedAt < AUTO_LOGOUT_CACHE_TTL_MS) {
    return autoLogoutCacheMinutes;
  }

  try {
    const settings = await SystemSettings.findOne({ key: "global" }).select("autoLogoutMinutes").lean();
    const raw = Number.parseInt(settings && settings.autoLogoutMinutes, 10);
    autoLogoutCacheMinutes = Number.isFinite(raw) ? Math.min(120, Math.max(5, raw)) : 30;
    autoLogoutCacheUpdatedAt = now;
  } catch (err) {
    logger.warn('[SessionMiddleware] Failed to fetch logout setting from DB', { error: err.message });
    // Keep using cached value on error, still update timestamp to prevent constant retries
    autoLogoutCacheUpdatedAt = now;
  }

  return autoLogoutCacheMinutes;
}

function clearAuthCookies(res) {
  clearAccessCookie(res);
  clearRefreshCookie(res);
}

function setSessionCookie(res, sid) {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureCookie}`
  );
}

function shouldRedirectToLogin(req) {
  const accept = (req.headers.accept || "").toLowerCase();
  const requestedWith = (req.headers["x-requested-with"] || "").toLowerCase();
  const isAjax = req.xhr || requestedWith === "xmlhttprequest";
  return req.method === "GET" && accept.includes("text/html") && !isAjax;
}

function isSessionIdleExpired(session, timeoutMinutes) {
  if (!session) return false;
  const timeoutMs = Math.max(5, Number(timeoutMinutes || 30)) * 60 * 1000;
  const baseline = Number(session.lastActivityAt || session.createdAt || Date.now());
  return Date.now() - baseline > timeoutMs;
}

async function sessionMiddleware(req, res, next) {
  try {
    req.user = null;
    req.sessionId = null;
    req.setFlash = () => {};
    req.consumeFlash = () => null;

    const cookies = parseCookies(req.headers.cookie || "");
    const sid = cookies[SESSION_COOKIE_NAME];
    if (sid) {
      const session = getSession(sid);
      if (session) {
        req.sessionId = sid;
        req.session = session;
        req.setFlash = (type, message) => {
          if (!type || !message) return;
          setSessionFlash(sid, { type, message });
        };
        req.consumeFlash = () => consumeSessionFlash(sid);
      }
    }

    if (req.sessionId && req.session) {
      const autoLogoutMinutes = await getAutoLogoutMinutes();
      if (isSessionIdleExpired(req.session, autoLogoutMinutes)) {
        destroySession(req.sessionId);

        const timeoutFlashSid = createSession();
        setSessionCookie(res, timeoutFlashSid);
        setSessionFlash(timeoutFlashSid, {
          type: "error",
          message: "Session expired due to inactivity. Please log in again."
        });

        req.sessionId = timeoutFlashSid;
        req.session = getSession(timeoutFlashSid);
        req.setFlash = (type, message) => {
          if (!type || !message) return;
          setSessionFlash(timeoutFlashSid, { type, message });
        };
        req.consumeFlash = () => consumeSessionFlash(timeoutFlashSid);

        clearAuthCookies(res);

        if (req.path !== "/auth/login") {
          if (shouldRedirectToLogin(req)) {
            return res.redirect("/auth/login?reason=timeout");
          }

          const accept = (req.headers.accept || "").toLowerCase();
          const requestedWith = (req.headers["x-requested-with"] || "").toLowerCase();
          const isAjax = req.xhr || requestedWith === "xmlhttprequest" || accept.includes("application/json");
          if (isAjax) {
            return res.status(401).json({
              success: false,
              reason: "timeout",
              message: "Session expired due to inactivity. Please log in again.",
              redirect: "/auth/login?reason=timeout"
            });
          }
        }
        return next();
      }
    }

    const accessToken = cookies[ACCESS_COOKIE_NAME];
    const refreshToken = cookies[REFRESH_COOKIE_NAME];

    if (accessToken) {
      try {
        const payload = verifyAccessToken(accessToken);
        if (payload && payload.sub) {
          const revoked = await isAccessTokenRevoked(payload.jti);
          if (!revoked) {
            const user = await User.findById(payload.sub);
            if (user && user.active !== false) {
              if (req.sessionId) {
                updateSession(req.sessionId, { lastActivityAt: Date.now(), userId: String(user._id) });
              }
              req.user = user;
              return next();
            }
          }
        }
      } catch (err) {
        // Attempt refresh fallback below.
      }
    }

    if (!refreshToken) {
      return next();
    }

    const rotated = await rotateRefreshToken(req, res, refreshToken);
    if (!rotated || !rotated.userId) {
      clearAuthCookies(res);
      return next();
    }

    const rotatedUser = await User.findById(rotated.userId);
    if (!rotatedUser || rotatedUser.active === false) {
      clearAuthCookies(res);
      return next();
    }

    const signed = signAccessToken(rotatedUser);
    setAccessCookie(res, signed.token);
    if (req.sessionId) {
      updateSession(req.sessionId, { lastActivityAt: Date.now(), userId: String(rotatedUser._id) });
    }
    req.user = rotatedUser;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = sessionMiddleware;
