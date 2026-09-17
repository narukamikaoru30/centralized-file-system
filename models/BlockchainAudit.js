const mongoose = require('mongoose');

/**
 * BlockchainAudit Model
 * Tracks audit events that have been queued or recorded on the blockchain
 */

const blockchainAuditSchema = new mongoose.Schema(
    {
        eventType: {
            type: Number, // 0=upload, 1=download, 2=share, 3=delete, 4=login, 5=role_change
            required: true,
            index: true
        },
        eventName: {
            type: String,
            enum: ['upload', 'download', 'share', 'delete', 'login', 'role_change'],
            required: true
        },
        fileHash: {
            type: String
            // null for non-file events like login
        },
        fileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'File'
        },
        actor: {
            type: String, // User email or blockchain address
            required: true,
            index: true
        },
        details: {
            type: String,
            maxlength: 1000
        },
        transactionHash: {
            type: String,
            index: true
        },
        blockNumber: {
            type: Number
        },
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'failed'],
            default: 'pending',
            index: true
        },
        retryCount: {
            type: Number,
            default: 0
        },
        lastRetryAt: {
            type: Date
        },
        errorMessage: {
            type: String
        },
        confirmedAt: {
            type: Date
        },
        metadata: {
            type: mongoose.Schema.Types.Mixed
        }
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
blockchainAuditSchema.index({ status: 1, createdAt: -1 });
blockchainAuditSchema.index({ eventType: 1, createdAt: -1 });
blockchainAuditSchema.index({ actor: 1, createdAt: -1 });
blockchainAuditSchema.index({ fileHash: 1, createdAt: -1 });

/**
 * Get all pending audit events
 */
blockchainAuditSchema.statics.getPendingEvents = async function(limit = 100) {
    return this.find({ status: 'pending' }).limit(limit).sort({ createdAt: 1 });
};

/**
 * Get failed audit events
 */
blockchainAuditSchema.statics.getFailedEvents = async function(limit = 100) {
    return this.find({ status: 'failed' }).limit(limit).sort({ createdAt: 1 });
};

/**
 * Get audit events by actor (for compliance)
 */
blockchainAuditSchema.statics.getEventsByActor = async function(actor, limit = 100) {
    return this.find({ actor, status: 'confirmed' })
        .limit(limit)
        .sort({ createdAt: -1 });
};

/**
 * Get audit events by file (for file history)
 */
blockchainAuditSchema.statics.getEventsByFile = async function(fileHash, limit = 100) {
    return this.find({ fileHash, status: 'confirmed' })
        .limit(limit)
        .sort({ createdAt: -1 });
};

/**
 * Mark audit event as confirmed
 */
blockchainAuditSchema.methods.markConfirmed = async function(txHash, blockNumber) {
    this.status = 'confirmed';
    this.transactionHash = txHash;
    this.blockNumber = blockNumber;
    this.confirmedAt = new Date();
    return this.save();
};

/**
 * Mark audit event as failed
 */
blockchainAuditSchema.methods.markFailed = async function(error) {
    this.status = 'failed';
    this.retryCount += 1;
    this.lastRetryAt = new Date();
    this.errorMessage = error.message || error;
    return this.save();
};

module.exports = mongoose.model('BlockchainAudit', blockchainAuditSchema);
