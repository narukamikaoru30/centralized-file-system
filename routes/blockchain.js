/**
 * Blockchain API Routes
 * REST endpoints for blockchain operations and monitoring
 */

const express = require('express');
const router = express.Router();
const { getBlockchainAPI } = require('../utils/blockchainAPI');
const BlockchainVerifier = require('../utils/blockchainVerify');
const logger = require('../utils/logger');
const { requireAuth } = require('../middleware/authMiddleware');
const { requireRole } = require('../middleware/roleMiddleware');
const asyncHandler = require('../utils/asyncHandler');

const blockchainAPI = getBlockchainAPI();
const verifier = new BlockchainVerifier();

/**
 * GET /api/blockchain/status
 * Get overall blockchain status and statistics
 * Admin only
 */
router.get(
    '/status',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const status = await blockchainAPI.getBlockchainStatus();
        res.json(status);
    })
);

/**
 * GET /api/blockchain/network
 * Get blockchain network information
 * Admin only
 */
router.get(
    '/network',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const networkStatus = await blockchainAPI.manager.getNetworkStatus();
        res.json(networkStatus);
    })
);

/**
 * GET /api/blockchain/queue
 * Get transaction queue status
 * Admin only
 */
router.get(
    '/queue',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const queueStatus = blockchainAPI.queue.getStatus();
        const pendingTx = blockchainAPI.queue.getPendingTransactions();

        res.json({
            status: queueStatus,
            pendingTransactions: pendingTx.slice(0, 20) // First 20
        });
    })
);

/**
 * GET /api/blockchain/verify/report
 * Get verification report
 * Admin only
 */
router.get(
    '/verify/report',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const report = await verifier.getReport();
        res.json(report);
    })
);

/**
 * GET /api/blockchain/verify/file/:fileId
 * Verify a specific file on blockchain
 * Admin only
 */
router.get(
    '/verify/file/:fileId',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const result = await verifier.verifyFile(req.params.fileId);
        res.json(result);
    })
);

/**
 * POST /api/blockchain/verify/all
 * Verify all files (batch)
 * Admin only
 */
router.post(
    '/verify/all',
    requireAuth,
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
        const limit = req.body.limit || 100;
        const results = await verifier.verifyAllFiles(limit);

        res.json({
            message: 'Verification complete',
            ...results
        });
    })
);

/**
 * GET /api/blockchain/failed-syncs
 * Get failed file syncs
 * Admin only
 */
router.get(
    '/failed-syncs',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const limit = req.query.limit || 50;
        const failed = await verifier.getFailedSyncs(limit);

        res.json({
            count: failed.length,
            syncs: failed
        });
    })
);

/**
 * GET /api/blockchain/failed-audits
 * Get failed audit events
 * Admin only
 */
router.get(
    '/failed-audits',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const limit = req.query.limit || 50;
        const failed = await verifier.getFailedAudits(limit);

        res.json({
            count: failed.length,
            audits: failed
        });
    })
);

/**
 * POST /api/blockchain/sync/retry/:fileId
 * Retry failed file sync
 * Admin only
 */
router.post(
    '/sync/retry/:fileId',
    requireAuth,
    requireRole('admin', 'super_admin'),
    asyncHandler(async (req, res) => {
        const result = await verifier.repairSync(req.params.fileId);
        res.json(result);
    })
);

/**
 * POST /api/blockchain/queue/process
 * Manually trigger queue processing
 * Super admin only
 */
router.post(
    '/queue/process',
    requireAuth,
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
        const queueStatus = await blockchainAPI.processQueue();
        res.json({
            message: 'Queue processed',
            status: queueStatus
        });
    })
);

/**
 * GET /api/blockchain/file/:fileId/history
 * Get audit history for a file
 */
router.get(
    '/file/:fileId/history',
    requireAuth,
    asyncHandler(async (req, res) => {
        const File = require('../models/File');
        const file = await File.findById(req.params.fileId);

        if (!file) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Check access permission
        if (file.owner.toString() !== req.user._id.toString() && req.user.role === 'user') {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const history = await blockchainAPI.getFileAuditHistory(file.contentHash, 100);

        res.json({
            fileId: file._id,
            filename: file.filename,
            fileHash: file.contentHash,
            auditEvents: history
        });
    })
);

/**
 * GET /api/blockchain/user/history
 * Get audit history for current user
 */
router.get(
    '/user/history',
    requireAuth,
    asyncHandler(async (req, res) => {
        const history = await blockchainAPI.getUserAuditHistory(req.user.email, 50);

        res.json({
            userEmail: req.user.email,
            auditEvents: history
        });
    })
);

/**
 * POST /api/blockchain/cleanup
 * Cleanup old audit records
 * Super admin only
 */
router.post(
    '/cleanup',
    requireAuth,
    requireRole('super_admin'),
    asyncHandler(async (req, res) => {
        const daysOld = req.body.daysOld || 90;
        const result = await verifier.cleanupOldAudits(daysOld);

        logger.info(`Cleaned up blockchain audit records older than ${daysOld} days`);

        res.json({
            message: `Cleaned up ${result.deletedCount} audit records`,
            deletedCount: result.deletedCount
        });
    })
);

/**
 * GET /api/blockchain/health
 * Simple health check for blockchain service
 */
router.get(
    '/health',
    asyncHandler(async (req, res) => {
        const isReady = blockchainAPI.manager.isReady();
        const networkStatus = await blockchainAPI.manager.getNetworkStatus();

        res.json({
            ready: isReady,
            network: networkStatus
        });
    })
);

module.exports = router;
