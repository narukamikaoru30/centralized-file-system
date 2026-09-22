const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const jwt = require("jsonwebtoken");

const ACCESS_COOKIE_NAME = "cfs_jwt";
const REFRESH_COOKIE_NAME = "cfs_refresh";

const ACCESS_TTL_SECONDS = Number(process.env.JWT_TTL_SECONDS || 15 * 60);
const REFRESH_TTL_SECONDS = Number(process.env.JWT_REFRESH_TTL_SECONDS || 7 * 24 * 60 * 60);
const JWT_ISSUER = process.env.JWT_ISSUER || "centralized-file-system";
const JWT_AUDIENCE = process.env.JWT_AUDIENCE || "centralized-file-system-web";
const JWT_CLOCK_TOLERANCE_SECONDS = Number(process.env.JWT_CLOCK_TOLERANCE_SECONDS || 90);
const JWT_ALGORITHM = "RS256";
const ACTIVE_KID = process.env.JWT_ACTIVE_KID || "local-dev-key-1";

let cachedKeyset = null;

function normalizeMultiline(value) {
  return String(value || "").replace(/\\n/g, "\n").trim();
}

function readPemFromPath(maybePath) {
  const raw = String(maybePath || "").trim();
  if (!raw) return "";
  const resolved = path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
  if (!fs.existsSync(resolved)) return "";
  return fs.readFileSync(resolved, "utf8").trim();
}

function readPemFromValueOrPath(value, pathValue) {
  const fromValue = normalizeMultiline(value);
  if (fromValue) return fromValue;
  return readPemFromPath(pathValue);
}

function parsePublicKeysFromEnv() {
  const raw = String(process.env.JWT_PUBLIC_KEYS_JSON || "").trim();
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const map = {};
    for (const [kid, val] of Object.entries(parsed)) {
      if (!kid || !val) continue;
      map[kid] = String(val).includes("BEGIN") ? normalizeMultiline(val) : readPemFromPath(val);
    }
    return map;
  } catch {
    return {};
  }
}

function ensureKeyset() {
  if (cachedKeyset) return cachedKeyset;

  const privateKey = readPemFromValueOrPath(process.env.JWT_PRIVATE_KEY, process.env.JWT_PRIVATE_KEY_PATH);
  const publicFromSingle = readPemFromValueOrPath(process.env.JWT_PUBLIC_KEY, process.env.JWT_PUBLIC_KEY_PATH);
  const publicMapFromJson = parsePublicKeysFromEnv();

  const publicKeys = {
    ...publicMapFromJson,
    ...(publicFromSingle ? { [ACTIVE_KID]: publicFromSingle } : {})
  };

  if (privateKey && publicKeys[ACTIVE_KID]) {
    cachedKeyset = { privateKey, publicKeys };
    return cachedKeyset;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT key material is missing in production. Configure RS256 keys and ACTIVE_KID.");
  }

  const generated = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" }
  });

  cachedKeyset = {
    privateKey: generated.privateKey,
    publicKeys: {
      [ACTIVE_KID]: generated.publicKey
    }
  };

  console.warn("⚠️ Using ephemeral in-memory JWT RSA keys (development only).");
  return cachedKeyset;
}

function decodeAccessTokenUnsafe(token) {
  if (!token) return null;
  const decoded = jwt.decode(token);
  if (!decoded || typeof decoded !== "object") return null;
  return decoded;
}

function signAccessToken(user) {
  const { privateKey } = ensureKeyset();
  const jwtId = crypto.randomUUID();

  const token = jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
      email: user.email
    },
    privateKey,
    {
      algorithm: JWT_ALGORITHM,
      keyid: ACTIVE_KID,
      expiresIn: ACCESS_TTL_SECONDS,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: jwtId
    }
  );

  const payload = decodeAccessTokenUnsafe(token);
  return { token, payload };
}

function verifyAccessToken(token) {
  if (!token) throw new Error("Missing token");

  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded !== "object") {
    throw new Error("Malformed token");
  }

  const header = decoded.header || {};
  if (header.alg !== JWT_ALGORITHM) {
    throw new Error("Invalid token algorithm");
  }

  const kid = header.kid;
  if (!kid) {
    throw new Error("Missing key identifier");
  }

  const { publicKeys } = ensureKeyset();
  const verificationKey = publicKeys[kid];
  if (!verificationKey) {
    throw new Error("Unknown key identifier");
  }

  return jwt.verify(token, verificationKey, {
    algorithms: [JWT_ALGORITHM],
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    clockTolerance: JWT_CLOCK_TOLERANCE_SECONDS
  });
}

function setCookie(res, name, value, maxAgeSeconds, sameSite = "Lax") {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAgeSeconds}${secureCookie}`
  );
}

function setAccessCookie(res, token) {
  setCookie(res, ACCESS_COOKIE_NAME, token, ACCESS_TTL_SECONDS, "Lax");
}

function setRefreshCookie(res, refreshToken) {
  setCookie(res, REFRESH_COOKIE_NAME, refreshToken, REFRESH_TTL_SECONDS, "Lax");
}

function clearAccessCookie(res) {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${ACCESS_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`
  );
}

function clearRefreshCookie(res) {
  const secureCookie = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.append(
    "Set-Cookie",
    `${REFRESH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie}`
  );
}

module.exports = {
  ACCESS_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ACCESS_TTL_SECONDS,
  REFRESH_TTL_SECONDS,
  JWT_ISSUER,
  JWT_AUDIENCE,
  JWT_CLOCK_TOLERANCE_SECONDS,
  JWT_ALGORITHM,
  signAccessToken,
  verifyAccessToken,
  decodeAccessTokenUnsafe,
  setAccessCookie,
  setRefreshCookie,
  clearAccessCookie,
  clearRefreshCookie
};
