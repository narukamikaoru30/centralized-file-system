const {
  createSession,
  getSession,
  setSessionFlash,
  consumeSessionFlash,
  SESSION_COOKIE_NAME,
  parseCookies
} = require("./sessionStore");

function setSessionCookie(res, sid) {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(sid)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secureCookie}`
  );
}

function clearSessionCookie(res) {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`
  );
}

function resolveSessionId(req) {
  const cookies = parseCookies(req.headers.cookie || "");
  const sid = cookies[SESSION_COOKIE_NAME];
  if (!sid) return null;
  return getSession(sid) ? sid : null;
}

function ensureSessionId(req, res) {
  const existingSid = resolveSessionId(req);
  if (existingSid) return existingSid;
  const sid = createSession();
  setSessionCookie(res, sid);
  return sid;
}

function pushFlash(req, res, type, message) {
  if (!type || !message) return;
  if (req.sessionId && req.setFlash) {
    req.setFlash(type, message);
    return;
  }
  const sid = ensureSessionId(req, res);
  setSessionFlash(sid, { type, message });
}

function pullFlash(req) {
  if (req.consumeFlash) {
    return req.consumeFlash();
  }
  const sid = resolveSessionId(req);
  if (!sid) return null;
  return consumeSessionFlash(sid);
}

function isAjaxRequest(req) {
  return req.xhr
    || (req.headers["x-requested-with"] || "").toLowerCase() === "xmlhttprequest"
    || (req.headers.accept || "").includes("application/json");
}

module.exports = {
  setSessionCookie,
  clearSessionCookie,
  resolveSessionId,
  ensureSessionId,
  pushFlash,
  pullFlash,
  isAjaxRequest
};
