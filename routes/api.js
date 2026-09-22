// routes/api.js
// API v1 routes — analytics, export, system health, push, AI feedback
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const os = require('os');
const fs = require('fs').promises;
const path = require('path');
const { requireActor } = require('../middleware/authMiddleware');
const { requireActive, requireRole } = require('../middleware/roleMiddleware');
const Report = require('../models/Report');
const File = require('../models/File');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Message = require('../models/Message');
const PushSubscription = require('../models/PushSubscription');
const { recordFeedback, loadFeedbackWeights, CONFIDENCE_THRESHOLD } = require('../ai/fileCategorizer');
const { getVapidPublicKey } = require('../utils/pushNotify');
const logger = require('../utils/logger');

const ADMIN_ROLES = ['admin', 'super_admin'];

// ─── Analytics Dashboard API ────────────────────────────────────

// GET /api/v1/analytics/summary
router.get(
  '/analytics/summary',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(ADMIN_ROLES, { mode: 'json' }),
  async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [
        totalFiles,
        totalUsers,
        recentUploads,
        recentDeletes,
        recentDownloads,
        totalStorageAgg,
        actionsByDay,
        topUploaders,
        filesByType,
        filesByBranch
      ] = await Promise.all([
        File.countDocuments({ deleted: { $ne: true } }),
        User.countDocuments({ status: 'active' }),
        Report.countDocuments({ action: 'Uploaded', date: { $gte: since } }),
        Report.countDocuments({ action: 'Deleted', date: { $gte: since } }),
        Report.countDocuments({ action: 'Downloaded', date: { $gte: since } }),
        File.aggregate([
          { $match: { deleted: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$sizeBytes' } } }
        ]),
        Report.aggregate([
          { $match: { date: { $gte: since } } },
          { $group: {
            _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, action: '$action' },
            count: { $sum: 1 }
          }},
          { $sort: { '_id.date': 1 } }
        ]),
        Report.aggregate([
          { $match: { action: 'Uploaded', date: { $gte: since } } },
          { $group: { _id: '$user', count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 }
        ]),
        File.aggregate([
          { $match: { deleted: { $ne: true } } },
          { $group: { _id: '$filetype', count: { $sum: 1 }, totalSize: { $sum: '$sizeBytes' } } },
          { $sort: { count: -1 } }
        ]),
        File.aggregate([
          { $match: { deleted: { $ne: true } } },
          { $group: { _id: '$branch', count: { $sum: 1 }, totalSize: { $sum: '$sizeBytes' } } },
          { $sort: { count: -1 } }
        ])
      ]);

      const totalStorage = totalStorageAgg.length > 0 ? totalStorageAgg[0].total : 0;

      // Transform actionsByDay into chart-friendly format
      const dailyActions = {};
      for (const item of actionsByDay) {
        const date = item._id.date;
        if (!dailyActions[date]) dailyActions[date] = {};
        dailyActions[date][item._id.action] = item.count;
      }

      return res.json({
        success: true,
        data: {
          overview: {
            totalFiles,
            totalUsers,
            totalStorageBytes: totalStorage,
            totalStorageMB: Math.round(totalStorage / (1024 * 1024) * 100) / 100
          },
          period: { days, since },
          activity: {
            uploads: recentUploads,
            deletes: recentDeletes,
            downloads: recentDownloads,
            dailyActions
          },
          topUploaders,
          filesByType,
          filesByBranch
        }
      });
    } catch (err) {
      logger.error('Analytics summary error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// GET /api/v1/analytics/user-activity
router.get(
  '/analytics/user-activity',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(ADMIN_ROLES, { mode: 'json' }),
  async (req, res) => {
    try {
      const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [activeUsers, newUsers, loginActivity] = await Promise.all([
        User.countDocuments({ lastOnline: { $gte: since } }),
        User.countDocuments({ createdAt: { $gte: since } }),
        Report.aggregate([
          { $match: { action: { $in: ['Login', 'Logout'] }, date: { $gte: since } } },
          { $group: {
            _id: { date: { $dateToString: { format: '%Y-%m-%d', date: '$date' } }, action: '$action' },
            count: { $sum: 1 }
          }},
          { $sort: { '_id.date': 1 } }
        ])
      ]);

      return res.json({
        success: true,
        data: { activeUsers, newUsers, loginActivity, period: { days, since } }
      });
    } catch (err) {
      logger.error('User activity analytics error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// ─── Export Reports ─────────────────────────────────────────────

// GET /api/v1/reports/export?format=csv|json&days=30&action=Uploaded
router.get(
  '/reports/export',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(ADMIN_ROLES, { mode: 'json' }),
  async (req, res) => {
    try {
      const format = (req.query.format || 'csv').toLowerCase();
      // 🔐 Fix #2: Validate days and limit exports
      const days = Math.min(90, Math.max(1, parseInt(req.query.days) || 30));
      const limit = Math.min(5000, 10000);  // Hard cap at 5000 to prevent OOM
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const filter = { date: { $gte: since } };
      if (req.query.action) filter.action = req.query.action;
      if (req.query.branch) filter.branch = req.query.branch;

      const reports = await Report.find(filter)
        .sort({ date: -1 })
        .limit(limit)
        .lean();

      if (format === 'csv') {
        const { Parser } = require('json2csv');
        const fields = ['filename', 'action', 'date', 'user', 'branch', 'ipAddress', 'userAgent', 'fileSize', 'duration'];
        const parser = new Parser({ fields });
        const csv = parser.parse(reports);

        // 🔐 Fix #6: Sanitize filename to prevent header injection
        const safeFilename = `reports_${new Date().toISOString().slice(0, 10)}.csv`.replace(/[^a-zA-Z0-9._-]/g, '_');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
        return res.send(csv);
      }

      // JSON export
      const safeFilename = `reports_${new Date().toISOString().slice(0, 10)}.json`.replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
      return res.json({ success: true, count: reports.length, data: reports });
    } catch (err) {
      logger.error('Report export error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// ─── System Health ──────────────────────────────────────────────

// GET /api/v1/health
router.get(
  '/health',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(ADMIN_ROLES, { mode: 'json' }),
  async (req, res) => {
    try {
      const dbState = mongoose.connection.readyState; // 0=disconnected,1=connected,2=connecting,3=disconnecting
      const dbNames = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };

      // DB ping
      let dbPingMs = null;
      if (dbState === 1) {
        const start = Date.now();
        await mongoose.connection.db.admin().ping();
        dbPingMs = Date.now() - start;
      }

      // Memory
      const memUsage = process.memoryUsage();

      // Uptime
      const uptimeSeconds = process.uptime();

      // Disk (uploads directory size)
      const uploadsDir = path.join(__dirname, '..', 'uploads');
      let uploadsDirSize = 0;
      let uploadsFileCount = 0;
      try {
        const files = await fs.readdir(uploadsDir);
        uploadsFileCount = files.length;
        const stats = await Promise.all(files.map(file =>
          fs.stat(path.join(uploadsDir, file)).catch(() => null)
        ));
        uploadsDirSize = stats.reduce((total, stat) => total + (stat ? stat.size : 0), 0);
      } catch (_) {}

      // Counts
      const [totalFiles, totalUsers, totalMessages] = await Promise.all([
        File.countDocuments({ deleted: { $ne: true } }),
        User.countDocuments(),
        Message.countDocuments()
      ]);

      return res.json({
        success: true,
        data: {
          status: dbState === 1 ? 'healthy' : 'degraded',
          database: {
            state: dbNames[dbState] || 'unknown',
            pingMs: dbPingMs
          },
          server: {
            uptimeSeconds: Math.floor(uptimeSeconds),
            uptimeHuman: formatUptime(uptimeSeconds),
            nodeVersion: process.version,
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname()
          },
          memory: {
            rss: memUsage.rss,
            heapUsed: memUsage.heapUsed,
            heapTotal: memUsage.heapTotal,
            rssMB: Math.round(memUsage.rss / (1024 * 1024) * 100) / 100,
            heapUsedMB: Math.round(memUsage.heapUsed / (1024 * 1024) * 100) / 100
          },
          systemMemory: {
            totalMB: Math.round(os.totalmem() / (1024 * 1024)),
            freeMB: Math.round(os.freemem() / (1024 * 1024)),
            usagePercent: Math.round((1 - os.freemem() / os.totalmem()) * 100)
          },
          storage: {
            uploadsDirSizeBytes: uploadsDirSize,
            uploadsDirSizeMB: Math.round(uploadsDirSize / (1024 * 1024) * 100) / 100,
            uploadsFileCount
          },
          counts: { files: totalFiles, users: totalUsers, messages: totalMessages },
          timestamp: new Date().toISOString()
        }
      });
    } catch (err) {
      logger.error('Health check error', { error: err.message });
      return res.status(500).json({ success: false, data: { status: 'error', error: err.message } });
    }
  }
);

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

// ─── Web Push Subscription ──────────────────────────────────────

// GET /api/v1/push/vapid-key
router.get('/push/vapid-key', (req, res) => {
  const key = getVapidPublicKey();
  if (!key) return res.status(503).json({ success: false, message: 'Push notifications not configured' });
  return res.json({ success: true, vapidPublicKey: key });
});

// POST /api/v1/push/subscribe
router.post(
  '/push/subscribe',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
    try {
      const { subscription } = req.body;
      if (!subscription || !subscription.endpoint || !subscription.keys) {
        return res.status(400).json({ success: false, message: 'Invalid subscription object' });
      }

      // Upsert subscription
      await PushSubscription.findOneAndUpdate(
        { 'subscription.endpoint': subscription.endpoint },
        { user: req.actor._id, subscription },
        { upsert: true, new: true }
      );

      return res.json({ success: true, message: 'Subscribed to push notifications' });
    } catch (err) {
      logger.error('Push subscribe error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// POST /api/v1/push/unsubscribe
router.post(
  '/push/unsubscribe',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
    try {
      const { endpoint } = req.body;
      if (!endpoint) return res.status(400).json({ success: false, message: 'Missing endpoint' });

      await PushSubscription.findOneAndDelete({ 'subscription.endpoint': endpoint, user: req.actor._id });
      return res.json({ success: true, message: 'Unsubscribed from push notifications' });
    } catch (err) {
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// ─── AI Categorizer Feedback ────────────────────────────────────

// POST /api/v1/ai/feedback
router.post(
  '/ai/feedback',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(['user', 'admin', 'super_admin'], { mode: 'json' }),
  async (req, res) => {
    try {
      const { fileId, originalCategory, correctedCategory, confidence, filename, mimeType, branch } = req.body;
      if (!fileId || !originalCategory || !correctedCategory) {
        return res.status(400).json({ success: false, message: 'Missing required fields: fileId, originalCategory, correctedCategory' });
      }

      const feedback = await recordFeedback({
        fileId,
        userId: req.actor._id,
        originalCategory,
        correctedCategory,
        confidence,
        filename,
        mimeType,
        branch
      });

      logger.info('AI categorization feedback recorded', {
        userId: req.actor._id,
        fileId,
        from: originalCategory,
        to: correctedCategory
      });

      return res.json({ success: true, message: 'Feedback recorded', data: feedback });
    } catch (err) {
      logger.error('AI feedback error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

// GET /api/v1/ai/feedback-stats
router.get(
  '/ai/feedback-stats',
  requireActor({ mode: 'json' }),
  requireActive({ mode: 'json' }),
  requireRole(ADMIN_ROLES, { mode: 'json' }),
  async (req, res) => {
    try {
      const CategoryFeedback = require('../models/CategoryFeedback');
      const [byCategory, recentFeedback, totalCount] = await Promise.all([
        CategoryFeedback.aggregate([
          { $group: { _id: { from: '$originalCategory', to: '$correctedCategory' }, count: { $sum: 1 } } },
          { $sort: { count: -1 } }
        ]),
        CategoryFeedback.find().sort({ date: -1 }).limit(20).populate('user', 'fullname email'),
        CategoryFeedback.countDocuments()
      ]);

      return res.json({
        success: true,
        data: {
          totalFeedback: totalCount,
          confidenceThreshold: CONFIDENCE_THRESHOLD,
          corrections: byCategory,
          recent: recentFeedback
        }
      });
    } catch (err) {
      logger.error('AI feedback stats error', { error: err.message });
      return res.status(500).json({ success: false, message: 'Server error' });
    }
  }
);

module.exports = router;
