/**
 * Blockchain Verification Utility
 * Compares file state between MongoDB and Polygon blockchain
 * Helps identify and repair sync issues
 */

const File = require('../models/File');
const BlockchainSync = require('../models/BlockchainSync');
const BlockchainAudit = require('../models/BlockchainAudit');
const { getBlockchainAPI } = require('./blockchainAPI');
const logger = require('./logger');

class BlockchainVerifier {
    constructor() {
        this.blockchainAPI = getBlockchainAPI();
    }

    /**
     * Verify a single file against blockchain
     */
    async verifyFile(fileId) {
        try {
            const file = await File.findById(fileId);
            if (!file) {
                return { status: 'error', message: 'File not found in MongoDB' };
            }

            if (!file.contentHash) {
                return { status: 'warning', message: 'File has no content hash' };
            }

            // Check blockchain sync status
            const syncRecord = await BlockchainSync.findOne({ fileId });
            if (!syncRecord) {
                return { status: 'not_synced', message: 'File not registered on blockchain' };
            }

            if (syncRecord.status === 'pending') {
                return { status: 'pending', message: 'Blockchain registration pending' };
            }

            if (syncRecord.status === 'failed') {
                return {
                    status: 'failed',
                    message: `Blockchain registration failed: ${syncRecord.errorMessage}`,
                    lastRetry: syncRecord.lastRetryAt,
                    retries: syncRecord.retryCount
                };
            }

            // Verify file exists on blockchain
            try {
                const exists = await this.blockchainAPI.manager.fileExists(file.contentHash);
                if (!exists) {
                    return { status: 'error', message: 'File hash not found on blockchain' };
                }

                // Get blockchain metadata
                const metadata = await this.blockchainAPI.manager.getFileMetadata(file.contentHash);

                return {
                    status: 'verified',
                    message: 'File successfully registered on blockchain',
                    mongodb: {
                        filename: file.filename,
                        hash: file.contentHash,
                        sizeBytes: file.sizeBytes,
                        uploadedAt: file.uploadedAt
                    },
                    blockchain: {
                        owner: metadata.owner,
                        createdAt: new Date(metadata.createdAt * 1000),
                        fileSize: metadata.fileSize,
                        filename: metadata.filename
                    },
                    transactionHash: syncRecord.transactionHash,
                    blockNumber: syncRecord.blockNumber
                };
            } catch (error) {
                return {
                    status: 'error',
                    message: `Blockchain verification failed: ${error.message}`
                };
            }
        } catch (error) {
            logger.error('File verification failed:', error.message);
            throw error;
        }
    }

    /**
     * Verify all files in batch
     */
    async verifyAllFiles(limit = 100) {
        try {
            const files = await File.find({ deleted: false, contentHash: { $exists: true, $ne: '' } })
                .limit(limit);

            const results = {
                total: files.length,
                verified: 0,
                notSynced: 0,
                pending: 0,
                failed: 0,
                errors: 0,
                details: []
            };

            for (const file of files) {
                const result = await this.verifyFile(file._id);
                results.details.push({
                    fileId: file._id,
                    filename: file.filename,
                    result
                });

                switch (result.status) {
                    case 'verified':
                        results.verified++;
                        break;
                    case 'not_synced':
                        results.notSynced++;
                        break;
                    case 'pending':
                        results.pending++;
                        break;
                    case 'failed':
                        results.failed++;
                        break;
                    default:
                        results.errors++;
                }
            }

            return results;
        } catch (error) {
            logger.error('Batch verification failed:', error.message);
            throw error;
        }
    }

    /**
     * Repair a failed sync
     */
    async repairSync(fileId) {
        try {
            const syncRecord = await BlockchainSync.findOne({ fileId });
            if (!syncRecord) {
                return { status: 'error', message: 'Sync record not found' };
            }

            if (syncRecord.status === 'failed') {
                await syncRecord.resetForRetry();
                return { status: 'queued', message: 'Sync marked for retry' };
            }

            return { status: 'unchanged', message: 'Sync is not in failed state' };
        } catch (error) {
            logger.error('Repair failed:', error.message);
            throw error;
        }
    }

    /**
     * Get verification report
     */
    async getReport() {
        try {
            const totalFiles = await File.countDocuments({
                deleted: false,
                contentHash: { $exists: true, $ne: '' }
            });

            const syncedFiles = await BlockchainSync.countDocuments({
                status: 'confirmed'
            });

            const pendingSync = await BlockchainSync.countDocuments({
                status: 'pending'
            });

            const failedSync = await BlockchainSync.countDocuments({
                status: 'failed'
            });

            const notSynced = totalFiles - syncedFiles - pendingSync - failedSync;

            const pendingAudits = await BlockchainAudit.countDocuments({
                status: 'pending'
            });

            const confirmedAudits = await BlockchainAudit.countDocuments({
                status: 'confirmed'
            });

            const failedAudits = await BlockchainAudit.countDocuments({
                status: 'failed'
            });

            return {
                files: {
                    total: totalFiles,
                    synced: syncedFiles,
                    pending: pendingSync,
                    failed: failedSync,
                    notSynced: notSynced,
                    syncPercentage: ((syncedFiles / totalFiles) * 100).toFixed(2) + '%'
                },
                audits: {
                    total: pendingAudits + confirmedAudits + failedAudits,
                    confirmed: confirmedAudits,
                    pending: pendingAudits,
                    failed: failedAudits
                },
                queueStatus: this.blockchainAPI.queue.getStatus()
            };
        } catch (error) {
            logger.error('Report generation failed:', error.message);
            throw error;
        }
    }

    /**
     * Get failed syncs
     */
    async getFailedSyncs(limit = 50) {
        try {
            const failed = await BlockchainSync.getFailedTransactions(limit);
            return failed.map(sync => ({
                fileId: sync.fileId,
                fileHash: sync.fileHash,
                error: sync.errorMessage,
                retries: sync.retryCount,
                lastRetry: sync.lastRetryAt,
                createdAt: sync.createdAt
            }));
        } catch (error) {
            logger.error('Failed to get failed syncs:', error.message);
            throw error;
        }
    }

    /**
     * Get failed audits
     */
    async getFailedAudits(limit = 50) {
        try {
            const failed = await BlockchainAudit.getFailedEvents(limit);
            return failed.map(audit => ({
                auditId: audit._id,
                eventType: audit.eventName,
                actor: audit.actor,
                error: audit.errorMessage,
                retries: audit.retryCount,
                lastRetry: audit.lastRetryAt,
                createdAt: audit.createdAt
            }));
        } catch (error) {
            logger.error('Failed to get failed audits:', error.message);
            throw error;
        }
    }

    /**
     * Cleanup old audit records
     */
    async cleanupOldAudits(daysOld = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysOld);

            const result = await BlockchainAudit.deleteMany({
                status: 'confirmed',
                createdAt: { $lt: cutoffDate }
            });

            logger.info(`Cleaned up ${result.deletedCount} old audit records`);
            return { deletedCount: result.deletedCount };
        } catch (error) {
            logger.error('Cleanup failed:', error.message);
            throw error;
        }
    }
}

module.exports = BlockchainVerifier;
