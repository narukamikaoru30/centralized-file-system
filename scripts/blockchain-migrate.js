/**
 * Migration Script
 * Syncs existing files from MongoDB to Polygon blockchain
 * Run: node scripts/blockchain-migrate.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const File = require('../models/File');
const User = require('../models/User');
const BlockchainSync = require('../models/BlockchainSync');
const BlockchainAudit = require('../models/BlockchainAudit');
const { getBlockchainAPI } = require('../utils/blockchainAPI');
const logger = require('../utils/logger');

const BATCH_SIZE = 10;
const DELAY_BETWEEN_BATCHES = 3000; // ms

async function connectDB() {
    try {
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        logger.info('Connected to MongoDB');
    } catch (error) {
        logger.error('MongoDB connection failed:', error);
        process.exit(1);
    }
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function migrateFiles() {
    try {
        logger.info('🚀 Starting blockchain migration...');

        const blockchainAPI = getBlockchainAPI();

        // Check blockchain connectivity
        const status = await blockchainAPI.getBlockchainStatus();
        if (status.network.status !== 'connected') {
            throw new Error('Blockchain not connected: ' + JSON.stringify(status.network));
        }

        logger.info('✅ Blockchain connected');
        logger.info(`📊 Network: ${status.network.network}`);
        logger.info(`🔗 Contract: ${status.network.contractAddress}`);

        // Get all files that haven't been synced to blockchain
        const filesNotSynced = await File.find({
            blockchainSynced: false,
            deleted: false,
            contentHash: { $exists: true, $ne: '' }
        })
            .populate('owner', 'email')
            .limit(1000);

        logger.info(`📁 Found ${filesNotSynced.length} files to migrate`);

        if (filesNotSynced.length === 0) {
            logger.info('✅ All files are already synced');
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        // Process in batches
        for (let i = 0; i < filesNotSynced.length; i += BATCH_SIZE) {
            const batch = filesNotSynced.slice(i, i + BATCH_SIZE);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const totalBatches = Math.ceil(filesNotSynced.length / BATCH_SIZE);

            logger.info(
                `\n📦 Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`
            );

            for (const file of batch) {
                try {
                    const ownerEmail = file.owner?.email || 'unknown@system.local';

                    logger.debug(`  📄 Migrating: ${file.filename} (${file._id})`);

                    // Register file on blockchain
                    const result = await blockchainAPI.registerFile(file, ownerEmail);

                    logger.info(`  ✅ Queued: ${file.filename}`);
                    successCount++;
                } catch (error) {
                    logger.error(`  ❌ Failed: ${file.filename} - ${error.message}`);
                    errorCount++;
                }
            }

            // Wait between batches to avoid rate limiting
            if (i + BATCH_SIZE < filesNotSynced.length) {
                logger.info(`⏳ Waiting ${DELAY_BETWEEN_BATCHES}ms before next batch...`);
                await sleep(DELAY_BETWEEN_BATCHES);
            }
        }

        logger.info(`\n📊 Migration complete:`);
        logger.info(`   ✅ Successful: ${successCount}`);
        logger.info(`   ❌ Errors: ${errorCount}`);

        // Show queue status
        const queueStatus = blockchainAPI.queue.getStatus();
        logger.info(`\n📋 Transaction queue status:`);
        logger.info(`   Total queued: ${queueStatus.queueLength}`);
        logger.info(`   Pending: ${queueStatus.pendingCount}`);
        logger.info(`   Processing: ${queueStatus.processingCount}`);

        logger.info(
            '\n🎯 Files have been queued for blockchain registration.'
        );
        logger.info(
            '   The transaction queue will process them automatically.'
        );
        logger.info('   Monitor progress with: GET /api/blockchain/status');
    } catch (error) {
        logger.error('Migration failed:', error);
        process.exit(1);
    }
}

async function main() {
    try {
        await connectDB();
        await migrateFiles();

        // Keep the blockchain API running for a while to process the queue
        logger.info('\n⏳ Keeping queue alive for 30 seconds...');
        await sleep(30000);

        logger.info('\n✅ Migration script complete. Queue will continue in background.');
        process.exit(0);
    } catch (error) {
        logger.error('Fatal error:', error);
        process.exit(1);
    }
}

// Handle signals
process.on('SIGINT', () => {
    logger.info('\n🛑 Migration interrupted');
    process.exit(0);
});

process.on('SIGTERM', () => {
    logger.info('\n🛑 Migration terminated');
    process.exit(0);
});

main().catch(error => {
    logger.error('Unhandled error:', error);
    process.exit(1);
});
