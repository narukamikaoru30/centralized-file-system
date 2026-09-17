const logger = require('./logger');

/**
 * Blockchain Transaction Queue
 * Manages transaction batching, retry logic, and gas handling
 */

class BlockchainTransactionQueue {
    constructor(blockchainManager) {
        this.blockchainManager = blockchainManager;
        this.queue = [];
        this.processing = false;
        this.batchSize = 10;
        this.processInterval = 5000; // 5 seconds between batch processing
        this.maxRetries = 3;
        this.retryDelays = [2000, 5000, 10000]; // Progressive backoff in ms
    }

    /**
     * Add a transaction to the queue
     */
    async enqueueTransaction(transaction) {
        const { type, params, model, priority = 1 } = transaction;

        if (!type || !params) {
            throw new Error('Transaction must have type and params');
        }

        const queuedTx = {
            id: Date.now() + Math.random(),
            type,
            params,
            model,
            priority,
            createdAt: new Date(),
            retries: 0,
            status: 'queued'
        };

        this.queue.push(queuedTx);
        logger.info(`[BlockchainQueue] Transaction enqueued (${type}). Queue size: ${this.queue.length}`);

        // Start processing if not already processing
        if (!this.processing) {
            this.startProcessing();
        }

        return queuedTx.id;
    }

    /**
     * Start processing the queue
     */
    startProcessing() {
        if (this.processing) return;

        this.processing = true;
        logger.info('[BlockchainQueue] Started processing transactions');

        this.processingInterval = setInterval(() => {
            this.processBatch().catch(error => {
                logger.error('[BlockchainQueue] Error processing batch:', error);
            });
        }, this.processInterval);
    }

    /**
     * Stop processing the queue
     */
    stopProcessing() {
        if (this.processingInterval) {
            clearInterval(this.processingInterval);
            this.processingInterval = null;
        }
        this.processing = false;
        logger.info('[BlockchainQueue] Stopped processing transactions');
    }

    /**
     * Process a batch of transactions
     */
    async processBatch() {
        if (this.queue.length === 0) {
            return; // Nothing to process
        }

        // Sort by priority (higher first) and creation time
        this.queue.sort((a, b) => {
            if (a.priority !== b.priority) {
                return b.priority - a.priority;
            }
            return a.createdAt - b.createdAt;
        });

        // Process batch of transactions
        const batch = this.queue.splice(0, this.batchSize);
        logger.info(`[BlockchainQueue] Processing batch of ${batch.length} transactions`);

        for (const tx of batch) {
            try {
                tx.status = 'processing';
                await this.executeTransaction(tx);
                tx.status = 'completed';
                logger.info(`[BlockchainQueue] Transaction completed (${tx.type}): ${tx.id}`);
            } catch (error) {
                logger.error(`[BlockchainQueue] Transaction failed (${tx.type}): ${error.message}`);

                if (tx.retries < this.maxRetries) {
                    // Requeue with delay
                    tx.retries++;
                    const delay = this.retryDelays[tx.retries - 1];
                    tx.status = 'queued';
                    tx.nextRetryAt = new Date(Date.now() + delay);

                    // Re-add to queue
                    this.queue.push(tx);
                    logger.info(
                        `[BlockchainQueue] Transaction requeued (${tx.type}) - retry ${tx.retries}/${this.maxRetries}`
                    );
                } else {
                    tx.status = 'failed';
                    logger.error(
                        `[BlockchainQueue] Transaction failed after ${this.maxRetries} retries: ${tx.id}`
                    );

                    // Update model if provided
                    if (tx.model && tx.model.markFailed) {
                        try {
                            await tx.model.markFailed(error);
                        } catch (updateError) {
                            logger.error('[BlockchainQueue] Error updating model:', updateError);
                        }
                    }
                }
            }
        }
    }

    /**
     * Execute a single transaction
     */
    async executeTransaction(transaction) {
        const { type, params, model } = transaction;

        logger.debug(`[BlockchainQueue] Executing transaction: ${type}`, params);

        let result;

        switch (type) {
            case 'registerFileHash':
                result = await this.blockchainManager.registerFileHash(
                    params.fileHash,
                    params.owner,
                    params.filename,
                    params.fileSize
                );
                break;

            case 'grantPermission':
                result = await this.blockchainManager.grantPermission(
                    params.fileHash,
                    params.user,
                    params.permissionType
                );
                break;

            case 'revokePermission':
                result = await this.blockchainManager.revokePermission(
                    params.fileHash,
                    params.user
                );
                break;

            case 'transferOwnership':
                result = await this.blockchainManager.transferOwnership(
                    params.fileHash,
                    params.newOwner
                );
                break;

            case 'recordAuditEvent':
                result = await this.blockchainManager.recordAuditEvent(
                    params.eventType,
                    params.fileHash,
                    params.actor,
                    params.details
                );
                break;

            default:
                throw new Error(`Unknown transaction type: ${type}`);
        }

        // Update model if provided
        if (model && model.markConfirmed && result.transactionHash) {
            await model.markConfirmed(result.blockNumber, result.transactionHash, result.gasUsed);
        }

        return result;
    }

    /**
     * Get queue status
     */
    getStatus() {
        return {
            queueLength: this.queue.length,
            processing: this.processing,
            pendingCount: this.queue.filter(tx => tx.status === 'queued').length,
            processingCount: this.queue.filter(tx => tx.status === 'processing').length
        };
    }

    /**
     * Get pending transactions
     */
    getPendingTransactions() {
        return this.queue.filter(tx => tx.status === 'queued' || tx.status === 'processing');
    }

    /**
     * Clear failed transactions after a certain time
     */
    async cleanupFailedTransactions(ageInHours = 24) {
        const cutoffTime = new Date(Date.now() - ageInHours * 60 * 60 * 1000);
        const failedCount = this.queue.filter(
            tx => tx.status === 'failed' && tx.createdAt < cutoffTime
        ).length;

        this.queue = this.queue.filter(tx => !(tx.status === 'failed' && tx.createdAt < cutoffTime));

        logger.info(`[BlockchainQueue] Cleaned up ${failedCount} failed transactions`);
        return failedCount;
    }

    /**
     * Manually retry a failed transaction
     */
    async retryTransaction(transactionId) {
        const failedTx = this.queue.find(tx => tx.id === transactionId && tx.status === 'failed');

        if (!failedTx) {
            throw new Error('Transaction not found or not in failed state');
        }

        failedTx.status = 'queued';
        failedTx.retries = 0;
        failedTx.nextRetryAt = undefined;

        logger.info(`[BlockchainQueue] Manually retrying transaction: ${transactionId}`);
        return failedTx.id;
    }

    /**
     * Get detailed transaction info
     */
    getTransactionDetails(transactionId) {
        return this.queue.find(tx => tx.id === transactionId);
    }
}

module.exports = BlockchainTransactionQueue;
