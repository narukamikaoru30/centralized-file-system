const { getBlockchainManager } = require('./blockchainManager');
const BlockchainTransactionQueue = require('./blockchainTransactionQueue');
const BlockchainSync = require('../models/BlockchainSync');
const BlockchainAudit = require('../models/BlockchainAudit');
const logger = require('./logger');

/**
 * Blockchain API
 * Higher-level functions that combine blockchain operations with database updates
 */

class BlockchainAPI {
    constructor() {
        if (String(process.env.ENABLE_BLOCKCHAIN).toLowerCase() !== 'true') {
            this.manager = null;
            this.queue = null;
            return;
        }

        this.manager = getBlockchainManager();
        this.queue = new BlockchainTransactionQueue(this.manager);
        this.queue.startProcessing();
    }

    /**
     * Register a file on blockchain and track sync status
     */
    async registerFile(file, ownerEmail) {
        try {
            if (!file.contentHash) {
                throw new Error('File must have contentHash');
            }

            // Create blockchain sync record
            const syncRecord = new BlockchainSync({
                fileId: file._id,
                fileHash: file.contentHash,
                status: 'pending'
            });

            await syncRecord.save();

            // Queue the blockchain transaction
            await this.queue.enqueueTransaction({
                type: 'registerFileHash',
                params: {
                    fileHash: file.contentHash,
                    owner: ownerEmail,
                    filename: file.filename,
                    fileSize: file.sizeBytes
                },
                model: syncRecord,
                priority: 2 // Higher priority for file registrations
            });

            logger.info(`[BlockchainAPI] File registration queued: ${file._id}`);

            return {
                syncId: syncRecord._id,
                status: 'queued'
            };
        } catch (error) {
            logger.error('[BlockchainAPI] File registration failed:', error.message);
            throw error;
        }
    }

    /**
     * Grant permission and queue blockchain transaction
     */
    async grantPermission(fileHash, userEmail, permissionType = 0) {
        try {
            // Queue the blockchain transaction
            const txId = await this.queue.enqueueTransaction({
                type: 'grantPermission',
                params: {
                    fileHash,
                    user: userEmail,
                    permissionType
                },
                priority: 2
            });

            logger.info(`[BlockchainAPI] Permission grant queued for ${userEmail} on ${fileHash}`);

            return {
                transactionId: txId,
                status: 'queued'
            };
        } catch (error) {
            logger.error('[BlockchainAPI] Permission grant failed:', error.message);
            throw error;
        }
    }

    /**
     * Revoke permission and queue blockchain transaction
     */
    async revokePermission(fileHash, userEmail) {
        try {
            // Queue the blockchain transaction
            const txId = await this.queue.enqueueTransaction({
                type: 'revokePermission',
                params: {
                    fileHash,
                    user: userEmail
                },
                priority: 2
            });

            logger.info(`[BlockchainAPI] Permission revoke queued for ${userEmail} on ${fileHash}`);

            return {
                transactionId: txId,
                status: 'queued'
            };
        } catch (error) {
            logger.error('[BlockchainAPI] Permission revoke failed:', error.message);
            throw error;
        }
    }

    /**
     * Record audit event and queue blockchain transaction
     */
    async recordAudit(eventType, fileHash, actorEmail, details, fileId = null) {
        try {
            // Create audit record in database
            const auditRecord = new BlockchainAudit({
                eventType,
                eventName: this.getEventName(eventType),
                fileHash,
                fileId,
                actor: actorEmail,
                details,
                status: 'pending'
            });

            await auditRecord.save();

            // Queue the blockchain transaction
            await this.queue.enqueueTransaction({
                type: 'recordAuditEvent',
                params: {
                    eventType,
                    fileHash,
                    actor: actorEmail,
                    details
                },
                model: auditRecord,
                priority: 1 // Lower priority for audit events
            });

            logger.info(`[BlockchainAPI] Audit event queued: ${eventType} by ${actorEmail}`);

            return {
                auditId: auditRecord._id,
                status: 'queued'
            };
        } catch (error) {
            logger.error('[BlockchainAPI] Audit recording failed:', error.message);
            // Don't throw - audit failures shouldn't break user flows
            logger.warn('[BlockchainAPI] Continuing despite audit failure');
        }
    }

    /**
     * Get event name from event type
     */
    getEventName(eventType) {
        const eventNames = {
            0: 'upload',
            1: 'download',
            2: 'share',
            3: 'delete',
            4: 'login',
            5: 'role_change'
        };
        return eventNames[eventType] || 'unknown';
    }

    /**
     * Get blockchain sync status for a file
     */
    async getFileSyncStatus(fileId) {
        try {
            const sync = await BlockchainSync.findOne({ fileId });
            return sync || { status: 'not_synced' };
        } catch (error) {
            logger.error('[BlockchainAPI] Sync status retrieval failed:', error.message);
            throw error;
        }
    }

    /**
     * Get audit history for a file
     */
    async getFileAuditHistory(fileHash, limit = 50) {
        try {
            const audits = await BlockchainAudit.getEventsByFile(fileHash, limit);
            return audits;
        } catch (error) {
            logger.error('[BlockchainAPI] Audit history retrieval failed:', error.message);
            throw error;
        }
    }

    /**
     * Get audit history for a user
     */
    async getUserAuditHistory(userEmail, limit = 50) {
        try {
            const audits = await BlockchainAudit.getEventsByActor(userEmail, limit);
            return audits;
        } catch (error) {
            logger.error('[BlockchainAPI] User audit history retrieval failed:', error.message);
            throw error;
        }
    }

    /**
     * Get pending blockchain operations
     */
    async getPendingOperations() {
        try {
            const pendingFiles = await BlockchainSync.getPendingTransactions(50);
            const pendingAudits = await BlockchainAudit.getPendingEvents(50);
            const queueStatus = this.queue.getStatus();

            return {
                pendingFileSync: pendingFiles.length,
                pendingAuditEvents: pendingAudits.length,
                queueStatus,
                queuedTransactions: this.queue.getPendingTransactions().length
            };
        } catch (error) {
            logger.error('[BlockchainAPI] Failed to get pending operations:', error.message);
            throw error;
        }
    }

    /**
     * Verify file on blockchain
     */
    async verifyFile(fileHash) {
        try {
            const exists = await this.manager.fileExists(fileHash);
            if (exists) {
                const metadata = await this.manager.getFileMetadata(fileHash);
                return {
                    exists: true,
                    metadata
                };
            }
            return { exists: false };
        } catch (error) {
            logger.error('[BlockchainAPI] File verification failed:', error.message);
            throw error;
        }
    }

    /**
     * Check user permission
     */
    async checkPermission(fileHash, userEmail, permissionType) {
        try {
            const hasAccess = await this.manager.hasPermission(fileHash, userEmail, permissionType);
            return hasAccess;
        } catch (error) {
            logger.error('[BlockchainAPI] Permission check failed:', error.message);
            throw error;
        }
    }

    /**
     * Get blockchain status
     */
    async getBlockchainStatus() {
        try {
            const networkStatus = await this.manager.getNetworkStatus();
            const pendingOps = await this.getPendingOperations();

            return {
                network: networkStatus,
                operations: pendingOps
            };
        } catch (error) {
            logger.error('[BlockchainAPI] Status retrieval failed:', error.message);
            throw error;
        }
    }

    /**
     * Retry failed sync operation
     */
    async retrySyncOperation(syncId) {
        try {
            const sync = await BlockchainSync.findById(syncId);
            if (!sync) {
                throw new Error('Sync record not found');
            }

            if (sync.status !== 'failed') {
                throw new Error('Can only retry failed operations');
            }

            await sync.resetForRetry();
            logger.info(`[BlockchainAPI] Sync operation requeued: ${syncId}`);

            return { status: 'queued' };
        } catch (error) {
            logger.error('[BlockchainAPI] Sync retry failed:', error.message);
            throw error;
        }
    }

    /**
     * Manually process queue
     */
    async processQueue() {
        try {
            await this.queue.processBatch();
            return this.queue.getStatus();
        } catch (error) {
            logger.error('[BlockchainAPI] Queue processing failed:', error.message);
            throw error;
        }
    }

    /**
     * Stop the transaction queue
     */
    stop() {
        this.queue.stopProcessing();
    }
}

// Singleton instance
let instance = null;

function getBlockchainAPI() {
    if (!instance) {
        instance = new BlockchainAPI();
    }
    return instance;
}

module.exports = {
    BlockchainAPI,
    getBlockchainAPI
};
