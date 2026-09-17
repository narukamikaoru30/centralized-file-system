const mongoose = require('mongoose');

/**
 * BlockchainSync Model
 * Tracks the synchronization status of files between MongoDB and blockchain
 */

const blockchainSyncSchema = new mongoose.Schema(
    {
        fileId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'File',
            required: true,
            unique: true
        },
        fileHash: {
            type: String,
            required: true
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
        gasUsed: {
            type: String
        },
        transactionFee: {
            type: String // in MATIC or wei
        },
        confirmedAt: {
            type: Date
        }
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
blockchainSyncSchema.index({ status: 1, createdAt: -1 });
blockchainSyncSchema.index({ fileHash: 1 });

/**
 * Get all pending transactions
 */
blockchainSyncSchema.statics.getPendingTransactions = async function(limit = 100) {
    return this.find({ status: 'pending' }).limit(limit).sort({ createdAt: 1 });
};

/**
 * Get all failed transactions
 */
blockchainSyncSchema.statics.getFailedTransactions = async function(limit = 100) {
    return this.find({ status: 'failed' }).limit(limit).sort({ createdAt: 1 });
};

/**
 * Mark transaction as confirmed
 */
blockchainSyncSchema.methods.markConfirmed = async function(blockNumber, txHash, gasUsed) {
    this.status = 'confirmed';
    this.blockNumber = blockNumber;
    this.transactionHash = txHash;
    this.gasUsed = gasUsed;
    this.confirmedAt = new Date();
    return this.save();
};

/**
 * Mark transaction as failed and increment retry count
 */
blockchainSyncSchema.methods.markFailed = async function(error) {
    this.status = 'failed';
    this.retryCount += 1;
    this.lastRetryAt = new Date();
    this.errorMessage = error.message || error;
    return this.save();
};

/**
 * Reset retry count (for manual retry)
 */
blockchainSyncSchema.methods.resetForRetry = async function() {
    this.status = 'pending';
    this.retryCount = 0;
    this.lastRetryAt = null;
    this.errorMessage = null;
    return this.save();
};

module.exports = mongoose.model('BlockchainSync', blockchainSyncSchema);
