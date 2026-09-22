require('dotenv').config();
const { enforceEnv } = require('./utils/envValidator');
enforceEnv();

const express = require("express");
const bodyParser = require("body-parser");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");
const path = require("path");
const crypto = require("crypto");
const fs = require("fs");
const http = require('http');
const connectDB = require("./config/mongo"); // ✅ MongoDB connection
const User = require("./models/User");
const File = require("./models/File");
const ShareLink = require("./models/ShareLink");
const Notification = require("./models/Notification");
const AuditLog = require("./models/AuditLog");
const SystemSettings = require("./models/SystemSettings");
const RefreshToken = require("./models/RefreshToken");
const RevokedToken = require("./models/RevokedToken");
const bcrypt = require("bcrypt");
const sessionMiddleware = require("./middleware/sessionMiddleware");
const { encrypt, decrypt, generateSecureToken } = require("./utils/encryption");
const logger = require('./utils/logger');
const { initPush } = require('./utils/pushNotify');
const { loadFeedbackWeights } = require('./ai/fileCategorizer');
const { globalErrorHandler } = require('./utils/errorHandler');
const { cleanupUploadFiles } = require('./utils/fileCleanup');
const { buildAdminFileActivityPayloads } = require('./utils/fileAccessNotifications');
const { getObjectBuffer, objectExists } = require('./utils/objectStorage');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || "127.0.0.1";
const NODE_ENV = process.env.NODE_ENV || "development";

const allowedCorsOrigins = new Set(
  String(process.env.CORS_ORIGINS || "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean)
);

app.get("/healthz", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use(helmet({
  contentSecurityPolicy: false,
  frameguard: { action: "deny" },
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  noSniff: true
}));

app.use((req, res, next) => {
  const origin = req.get("Origin");
  if (!origin) return next();

  const requestOrigin = `${req.protocol}://${req.get("host")}`;
  if (origin !== requestOrigin && !allowedCorsOrigins.has(origin)) {
    return res.status(403).json({ success: false, message: "Origin not allowed" });
  }

  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-CSRF-Token, X-Requested-With");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

// Security Headers Middleware (similar to helmet)
app.use((req, res, next) => {
  // Generate nonce for CSP
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "DENY");
  
  // Prevent MIME type sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  
  // Enable XSS filter
  res.setHeader("X-XSS-Protection", "1; mode=block");
  
  // Control referrer information
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  
  // Permissions Policy
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
  
  // Content Security Policy
  // NOTE: 'unsafe-inline' is used for script-src because the EJS dashboards
  // rely heavily on inline <script> blocks and onclick handlers.
  // To tighten later: add nonce attrs to <script> tags, convert onclick to
  // addEventListener, then switch to nonce-based CSP.
  res.setHeader("Content-Security-Policy", [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net`,
    `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com`,
    `font-src 'self' https://cdn.jsdelivr.net https://fonts.gstatic.com`,
    `img-src 'self' data: blob: https://via.placeholder.com`,
    `connect-src 'self' ws: wss:`,
    `frame-ancestors 'self'`
  ].join('; '));

  // HSTS in production
  if (NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  
  next();
});

if (NODE_ENV === "production") {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
    if (req.secure || forwardedProto === "https") return next();
    const host = req.headers.host;
    if (!host) return res.status(400).send("Bad Request");
    return res.redirect(301, `https://${host}${req.originalUrl}`);
  });
}

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // ✅ Add JSON support
app.use((req, res, next) => {
  if (req.body) mongoSanitize.sanitize(req.body);
  if (req.params) mongoSanitize.sanitize(req.params);
  if (req.query) mongoSanitize.sanitize(req.query);
  next();
});
app.use(sessionMiddleware);
app.use(express.static(path.join(__dirname, "public")));

// CSRF Protection
const { csrfProtection, csrfTokenEndpoint } = require("./middleware/csrfMiddleware");
app.use(csrfProtection({
  ignorePaths: [
    "/auth/login",          // Login form POST (no session yet)
    "/auth/register",       // Registration form POST (no session yet)
    "/auth/forgot-password", // Password reset request
    "/auth/reset-password/", // Password reset with token
    "/auth/refresh",        // JWT refresh (uses refresh token cookie)
    "/auth/2fa/verify",     // 2FA verification during login
    "/auth/invite/accept",  // Invitation acceptance
    "/auth/upload",         // Multipart upload handled post-multer
    "/socket.io"            // WebSocket connections
  ]
}));

// CSRF token endpoint for AJAX requests
app.get("/csrf-token", csrfTokenEndpoint);

// Security headers - prevent caching of authenticated pages
app.use((req, res, next) => {
  // For dashboard routes, prevent browser caching
  if (req.path.includes('/dashboard') || req.path.startsWith('/admin') || req.path.startsWith('/superadmin')) {
    res.set({
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, private',
      'Pragma': 'no-cache',
      'Expires': '0',
      'Surrogate-Control': 'no-store'
    });
  }
  next();
});

// Structured request logger via winston
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`, {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip
  });
  next();
});

async function notifyAdminsOfFileActivity({ actor, fileRecord, req, action }) {
  if (!actor || !fileRecord) return;

  try {
    const adminUsers = await User.find({
      role: { $in: ['admin', 'super_admin'] },
      status: 'active'
    }).select('_id');

    const payloads = buildAdminFileActivityPayloads({
      actor,
      fileRecord,
      admins: adminUsers,
      action
    });

    if (!payloads.length) return;

    const notifications = payloads.map(payload => ({
      message: payload.message,
      type: payload.action === 'download' ? 'download' : 'general',
      owner: payload.owner,
      relatedFile: payload.relatedFile,
      relatedUser: payload.relatedUser,
      metadata: payload.metadata
    }));

    await Notification.insertMany(notifications);
    await AuditLog.create({
      user: actor._id,
      action: action === 'download' ? 'file_downloaded' : 'file_viewed',
      details: payloads[0].message,
      targetUser: fileRecord.owner,
      ip: req.ip || '',
      userAgent: (req.get('user-agent') || '').slice(0, 300)
    });
  } catch (err) {
    logger.error('File activity notification failed', { error: err.message, stack: err.stack });
  }
}

//Upload view - require authentication + ownership check
app.get('/uploads/:filename', async (req, res) => {
  try {
    // Check if user is authenticated
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const requestedFilename = req.params.filename;

    const safeFilename = path.basename(requestedFilename);
    if (!safeFilename || safeFilename !== requestedFilename) {
      return res.status(400).json({ success: false, message: 'Invalid filename' });
    }

    if (!(await objectExists(safeFilename))) {
      return res.status(404).json({ success: false, message: 'File not found' });
    }

    const fileBuffer = await getObjectBuffer(safeFilename);

    const isDownload = req.query.download === '1' || req.query.download === 'true' || req.query.mode === 'download' || req.query.action === 'download';
    const action = isDownload ? 'download' : 'view';

    // Admins and super_admins can access all files
    if (req.user.role === 'admin' || req.user.role === 'super_admin') {
      await notifyAdminsOfFileActivity({ actor: req.user, fileRecord: await File.findOne({ filename: requestedFilename, deleted: { $ne: true } }), req, action });
      return res.send(fileBuffer);
    }

    // Regular users can only access their own files or their own avatar
    if (req.user.avatar === requestedFilename) {
      return res.send(fileBuffer);
    }

    // Check ownership or shared access
    const fileRecord = await File.findOne({
      filename: requestedFilename,
      deleted: { $ne: true },
      $or: [
        { owner: req.user._id },
        { sharedWith: req.user._id }
      ]
    });
    if (!fileRecord) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    await notifyAdminsOfFileActivity({ actor: req.user, fileRecord, req, action });
    res.send(fileBuffer);
  } catch (err) {
    logger.error('Upload file access error:', err.message);
    res.status(500).json({ success: false, message: 'Error accessing file' });
  }
});


app.set("view engine", "ejs");

// create HTTP server and attach socket.io
const server = http.createServer(app);
const { initSocketIO } = require('./utils/socketHandlers');
const io = initSocketIO(server, app);

// Public share link download (no auth required)
app.get('/share/:token', async (req, res) => {
  try {
    // **FIX: Check limit BEFORE incrementing to prevent race condition**
    const link = await ShareLink.findOne({
      token: req.params.token,
      expiresAt: { $gt: new Date() }
    }).populate('file');

    if (!link || !link.file) {
      return res.status(404).send('Share link not found or expired');
    }

    // Check download limit BEFORE incrementing
    if (link.maxDownloads > 0 && link.downloadCount >= link.maxDownloads) {
      return res.status(410).send('Download limit reached');
    }

    // Now safely increment counter - use atomic operation
    const updated = await ShareLink.findByIdAndUpdate(
      link._id,
      { $inc: { downloadCount: 1 } },
      { new: true }
    );

    // Path traversal guard
    const uploadsBase = path.resolve(__dirname, 'uploads');
    const filePath = path.resolve(uploadsBase, link.file.filename);
    if (!filePath.startsWith(uploadsBase + path.sep)) {
      return res.status(400).send('Invalid file reference');
    }
    if (!fs.existsSync(filePath)) {
      return res.status(404).send('File no longer exists');
    }

    res.download(filePath, link.file.originalName || link.file.filename);
  } catch (err) {
    logger.error('[Share Link Download] Error:', { error: err.message });
    res.status(500).send('Error processing share link');
  }
});


// Routes
const authRoutes = require("./routes/auth");
const dashboardRoutes = require("./routes/dashboard");
const fileRoutes = require("./routes/files");
const profileRoutes = require("./routes/profile");
const adminRoutes = require("./routes/admin");
const superAdminRoutes = require("./routes/superadmin");
const messagesRoutes = require("./routes/messages");
const notificationsRoutes = require("./routes/notifications");
const apiRoutes = require("./routes/api");
const blockchainRoutes = require("./routes/blockchain");
app.use("/auth", authRoutes);
app.use("/auth", dashboardRoutes);
app.use("/auth", fileRoutes);
app.use("/auth", profileRoutes);
app.use("/admin", adminRoutes);
app.use("/superadmin", superAdminRoutes);
app.use("/messages", messagesRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/api/v1", apiRoutes);
app.use("/api/blockchain", blockchainRoutes);

// Resolve the generic dashboard link used by shared account pages.
app.get("/dashboard", (req, res) => {
  const account = req.user || req.session?.user;
  if (!account) return res.redirect("/auth/login");
  if (account.totpEnabled && req.session?.is2FAComplete !== true) {
    return res.redirect("/auth/2fa/verify");
  }

  if (account.role === "super_admin") return res.redirect("/auth/super");
  if (account.role === "admin") return res.redirect("/auth/admin");
  return res.redirect("/auth/user");
});

// Default route → show landing page
app.get("/", (req, res) => {
  res.render("landing");
});

// Aliases for cleaner URLs
app.get("/login", (req, res) => {
  res.redirect("/auth/login");
});

app.get("/register", (req, res) => {
  res.redirect("/auth/register");
});

// Connect MongoDB and then create Super Admin
connectDB().then(async () => {
  await ensureFileIndexes();
  await ensureTokenIndexes();
  await ensureBlockchainIndexes();
  await createDefaultSuperAdmin();
  startTokenCleanupJob();
  startRecycleBinCleanupJob();
  // Load AI categorizer feedback weights from DB
  try { await loadFeedbackWeights(); logger.info('AI feedback weights loaded'); } catch (_) {}
  // Initialize Web Push
  initPush();
  // Initialize Blockchain
  initBlockchain();
});

async function ensureFileIndexes() {
  try {
    await File.createIndexes();
    const indexes = await File.collection.indexes();
    const indexNames = indexes.map((idx) => idx.name);
    console.log("ℹ️ File indexes ready:", indexNames.join(", "));
  } catch (err) {
    console.warn("⚠️ Unable to verify File indexes:", err.message);
  }
}

async function ensureTokenIndexes() {
  try {
    await normalizeTokenTtlIndexes();
    await RefreshToken.createIndexes();
    await RevokedToken.createIndexes();
    console.log("ℹ️ Token lifecycle indexes ready");
  } catch (err) {
    console.warn("⚠️ Unable to verify token lifecycle indexes:", err.message);
  }
}

async function ensureBlockchainIndexes() {
  try {
    const BlockchainSync = require('./models/BlockchainSync');
    const BlockchainAudit = require('./models/BlockchainAudit');
    await BlockchainSync.createIndexes();
    await BlockchainAudit.createIndexes();
    console.log("ℹ️ Blockchain indexes ready");
  } catch (err) {
    console.warn("⚠️ Unable to verify blockchain indexes:", err.message);
  }
}

async function normalizeTokenTtlIndexes() {
  const collections = [RefreshToken.collection, RevokedToken.collection];

  for (const collection of collections) {
    const indexes = await collection.indexes();
    const expiresIndex = indexes.find((idx) => idx && idx.name === "expiresAt_1");
    if (!expiresIndex) continue;
    const hasTtl = typeof expiresIndex.expireAfterSeconds === "number";
    if (hasTtl) continue;
    await collection.dropIndex("expiresAt_1");
  }
}

// Auto-create Super Admin
async function createDefaultSuperAdmin() {
  try {
    const seedEnabled = process.env.ENABLE_DEFAULT_SUPERADMIN_SEED === "true";
    if (!seedEnabled) {
      console.log("ℹ️ Default Super Admin seed is disabled (set ENABLE_DEFAULT_SUPERADMIN_SEED=true to enable).");
      return;
    }

    const superAdminEmail = (process.env.DEFAULT_SUPERADMIN_EMAIL || "").trim();
    const superAdminPassword = process.env.DEFAULT_SUPERADMIN_PASSWORD || "";

    if (!superAdminEmail || !superAdminPassword) {
      console.warn("⚠️ Super Admin seed skipped: DEFAULT_SUPERADMIN_EMAIL and DEFAULT_SUPERADMIN_PASSWORD must be set.");
      return;
    }

    if (NODE_ENV === "production" && superAdminPassword.length < 12) {
      logger.error("Super Admin seed blocked: DEFAULT_SUPERADMIN_PASSWORD must be at least 12 characters in production.");
      return;
    }

    const existingSuperAdmin = await User.findOne({ role: "super_admin" });

    if (NODE_ENV === "production" && existingSuperAdmin) {
      console.log("ℹ️ Super Admin already exists, skipping creation.");
      console.warn("⚠️ ENABLE_DEFAULT_SUPERADMIN_SEED is still true in production. Disable it after initial provisioning.");
      return;
    }

    if (!existingSuperAdmin) {
      const hashedPassword = await bcrypt.hash(superAdminPassword, 12);
      const superAdmin = new User({
        fullname: "Default Super Admin",
        email: superAdminEmail,
        password: hashedPassword,
        role: "super_admin"
      });
      await superAdmin.save();
      console.log(`✅ Default Super Admin created: ${superAdminEmail}`);
    } else {
      console.log("ℹ️ Super Admin already exists, skipping creation.");
    }
  } catch (err) {
    logger.error("Error creating Super Admin:", err.message);
  }
}

// Scheduled cleanup for expired tokens (runs every 6 hours)
function startTokenCleanupJob() {
  const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

  async function runCleanup() {
    try {
      const now = new Date();
      const revokedResult = await RevokedToken.deleteMany({ expiresAt: { $lt: now } });
      const refreshResult = await RefreshToken.deleteMany({ expiresAt: { $lt: now } });
      const total = (revokedResult.deletedCount || 0) + (refreshResult.deletedCount || 0);
      if (total > 0) {
        console.log(`[Token Cleanup] Purged ${revokedResult.deletedCount} revoked + ${refreshResult.deletedCount} expired refresh tokens`);
      }
    } catch (err) {
      logger.error("[Token Cleanup] Error:", err.message);
    }
  }

  // Run once on startup, then every 6 hours
  runCleanup();
  setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  console.log("ℹ️ Token cleanup job scheduled (every 6 hours)");
}

// Scheduled cleanup for recycle bin (runs every 12 hours)
function startRecycleBinCleanupJob() {
  const CLEANUP_INTERVAL_MS = 12 * 60 * 60 * 1000;
  const { cleanupUploadFiles } = require('./utils/fileCleanup');

  async function runRecycleBinCleanup() {
    try {
      const settings = await SystemSettings.findOne({});
      const days = (settings && settings.recycleBinDays) || 30;
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const expiredFiles = await File.find({ deleted: true, deletedAt: { $lt: cutoff } });
      if (!expiredFiles.length) return;

      let successCount = 0;
      let failureCount = 0;
      const failures = [];

      for (const file of expiredFiles) {
        try {
          const allFilenames = [file.filename, ...file.versions.map(v => v.filename)];
          
          // Use cleanup utility with proper logging
          const filesToClean = allFilenames.map(fn => ({ filename: fn }));
          const cleanup = await cleanupUploadFiles(filesToClean, `recycle-bin-cleanup-${file._id}`);
          
          if (cleanup.failed.length) {
            logger.warn(`[Recycle Bin Cleanup] Failed to delete ${cleanup.failed.length} version file(s) for ${file._id}`, cleanup.failed);
            failureCount += cleanup.failed.length;
            failures.push({ fileId: file._id.toString(), details: cleanup.failed });
          } else {
            // Only delete from DB if all files were successfully cleaned
            await File.findByIdAndDelete(file._id);
            successCount++;
          }
        } catch (err) {
          logger.error(`[Recycle Bin Cleanup] Error processing file ${file._id}`, { error: err.message });
          failureCount++;
          failures.push({ fileId: file._id.toString(), error: err.message });
        }
      }
      
      if (successCount > 0 || failures.length > 0) {
        console.log(`[Recycle Bin Cleanup] Deleted ${successCount} file(s)${failures.length ? `, ${failures.length} failure(s)` : ''}`);
        if (failures.length) {
          logger.warn('[Recycle Bin Cleanup] Cleanup failures:', failures);
        }
      }
    } catch (err) {
      logger.error("[Recycle Bin Cleanup] Error:", err.message);
    }
  }

  runRecycleBinCleanup();
  setInterval(runRecycleBinCleanup, CLEANUP_INTERVAL_MS);
  console.log("ℹ️ Recycle bin cleanup job scheduled (every 12 hours)");
}

// Initialize Blockchain Services
function initBlockchain() {
  if (String(process.env.ENABLE_BLOCKCHAIN).toLowerCase() !== 'true') {
    logger.info('Blockchain integration disabled by ENABLE_BLOCKCHAIN');
    return;
  }

  try {
    const { getBlockchainAPI } = require('./utils/blockchainAPI');
    const { getBlockchainManager } = require('./utils/blockchainManager');

    const blockchainManager = getBlockchainManager();
    const blockchainAPI = getBlockchainAPI();

    if (!blockchainManager.isReady()) {
      logger.warn('⚠️ Blockchain manager not initialized. Check BLOCKCHAIN_CONFIG and POLYGON_RPC_URL');
      return;
    }

    logger.info('✅ Blockchain services initialized');
    logger.info(`   Network: ${blockchainManager.provider.network.name}`);
    logger.info(`   Signer: ${blockchainManager.signer?.address}`);

    // Start transaction queue processing
    blockchainAPI.queue.startProcessing();
    logger.info('✅ Blockchain transaction queue started');

    // Optional: Verify blockchain connectivity periodically
    const verifyInterval = setInterval(async () => {
      try {
        const status = await blockchainManager.getNetworkStatus();
        if (status.status !== 'connected') {
          logger.warn('⚠️ Blockchain connection check failed', status);
        }
      } catch (error) {
        logger.error('Blockchain connectivity check error:', error.message);
      }
    }, 60000); // Every minute

    // Cleanup on shutdown
    process.on('exit', () => {
      clearInterval(verifyInterval);
      blockchainAPI.queue.stopProcessing();
      logger.info('Blockchain queue stopped on exit');
    });
  } catch (error) {
    logger.error('Blockchain initialization failed:', error.message);
    logger.warn('Blockchain features disabled. File system will continue to operate normally.');
  }
}

function startServer(initialPort, host) {
  const maxPortRetries = NODE_ENV === "production" ? 0 : 10;
  const basePort = Number(initialPort);

  const tryListen = (attempt) => {
    const currentPort = basePort + attempt;

    const onListening = () => {
      server.removeListener("error", onError);
      if (attempt > 0) {
        console.log(`⚠️ Port ${basePort} was busy. Server started on http://${host}:${currentPort}`);
      } else {
        console.log(`Server running on http://${host}:${currentPort}`);
      }
    };

    const onError = (err) => {
      server.removeListener("listening", onListening);
      if (err && err.code === "EADDRINUSE" && attempt < maxPortRetries) {
        const nextPort = currentPort + 1;
        console.warn(`⚠️ Port in use. Retrying on ${host}:${nextPort}...`);
        setTimeout(() => tryListen(attempt + 1), 100);
        return;
      }

      logger.error("Server failed to start:", err && err.message ? err.message : err);
      process.exit(1);
    };

    server.once("listening", onListening);
    server.once("error", onError);
    server.listen(currentPort, host);
  };

  tryListen(0);
}

// Global error handler (centralized JSON format) — must be registered before server starts
app.use(globalErrorHandler);

startServer(PORT, HOST);

// Process-level error handlers (log via winston)
process.on('uncaughtException', (err) => {
  logger.error('UNCAUGHT EXCEPTION', { stack: err && err.stack ? err.stack : String(err) });
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('UNHANDLED REJECTION', { reason: reason && reason.stack ? reason.stack : String(reason) });
});
