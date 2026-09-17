const ethers = require('ethers');
const logger = require('./logger');
const { BLOCKCHAIN_CONFIG, FILE_REGISTRY_ABI, getUserBlockchainAddress, toBytes32 } = require('../config/blockchain');

/**
 * Blockchain Manager
 * Handles all Web3 interactions with FileRegistry contract on Polygon
 */

class BlockchainManager {
    constructor() {
        this.provider = null;
        this.signer = null;
        this.contract = null;
        this.initialized = false;

        this.init();
    }

    /**
     * Initialize the blockchain connection
     */
    init() {
        try {
            if (!BLOCKCHAIN_CONFIG.rpcUrl) {
                throw new Error('POLYGON_RPC_URL not configured');
            }

            if (!BLOCKCHAIN_CONFIG.walletPrivateKey) {
                throw new Error('WALLET_PRIVATE_KEY not configured');
            }

            if (!BLOCKCHAIN_CONFIG.contractAddress) {
                throw new Error('FILEREGISTRY_ADDRESS not configured');
            }

            // Create provider
            this.provider = new ethers.JsonRpcProvider(BLOCKCHAIN_CONFIG.rpcUrl, BLOCKCHAIN_CONFIG.chainId);

            // Create signer from private key
            this.signer = new ethers.Wallet(BLOCKCHAIN_CONFIG.walletPrivateKey, this.provider);

            // Create contract instance
            this.contract = new ethers.Contract(
                BLOCKCHAIN_CONFIG.contractAddress,
                FILE_REGISTRY_ABI,
                this.signer
            );

            this.initialized = true;
            logger.info('[BlockchainManager] Initialized successfully');
            logger.info(`[BlockchainManager] Connected to ${BLOCKCHAIN_CONFIG.network}`);
            logger.info(`[BlockchainManager] Signer address: ${this.signer.address}`);
            logger.info(`[BlockchainManager] Contract address: ${BLOCKCHAIN_CONFIG.contractAddress}`);
        } catch (error) {
            logger.error('[BlockchainManager] Initialization failed:', error.message);
            this.initialized = false;
        }
    }

    /**
     * Check if blockchain is initialized and ready
     */
    isReady() {
        return this.initialized && this.contract !== null;
    }

    /**
     * Register a file hash on the blockchain
     */
    async registerFileHash(fileHash, ownerEmail, filename, fileSize) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const ownerAddress = getUserBlockchainAddress(ownerEmail);
            const fileHashBytes32 = toBytes32(fileHash);

            logger.info(`[BlockchainManager] Registering file: ${filename} (${fileHash})`);
            logger.debug(`[BlockchainManager] Owner address: ${ownerAddress}`);

            // Estimate gas
            const gasEstimate = await this.contract.registerFileHash.estimateGas(
                fileHashBytes32,
                ownerAddress,
                filename,
                fileSize
            );

            // Create transaction
            const tx = await this.contract.registerFileHash(
                fileHashBytes32,
                ownerAddress,
                filename,
                fileSize,
                {
                    gasLimit: Math.ceil(gasEstimate * 1.2), // Add 20% buffer
                }
            );

            logger.info(`[BlockchainManager] File registration transaction sent: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait(BLOCKCHAIN_CONFIG.confirmationBlocks);

            logger.info(`[BlockchainManager] File registration confirmed in block ${receipt.blockNumber}`);

            return {
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                status: 'confirmed'
            };
        } catch (error) {
            logger.error('[BlockchainManager] File registration failed:', error.message);
            throw error;
        }
    }

    /**
     * Grant permission to a user
     */
    async grantPermission(fileHash, userEmail, permissionType) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const userAddress = getUserBlockchainAddress(userEmail);
            const fileHashBytes32 = toBytes32(fileHash);

            logger.info(
                `[BlockchainManager] Granting permission ${permissionType} to ${userEmail} for file ${fileHash}`
            );

            // Estimate gas
            const gasEstimate = await this.contract.grantPermission.estimateGas(
                fileHashBytes32,
                userAddress,
                permissionType
            );

            // Create transaction
            const tx = await this.contract.grantPermission(
                fileHashBytes32,
                userAddress,
                permissionType,
                {
                    gasLimit: Math.ceil(gasEstimate * 1.2),
                }
            );

            logger.info(`[BlockchainManager] Permission grant transaction sent: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait(BLOCKCHAIN_CONFIG.confirmationBlocks);

            logger.info(`[BlockchainManager] Permission granted confirmed in block ${receipt.blockNumber}`);

            return {
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                status: 'confirmed'
            };
        } catch (error) {
            logger.error('[BlockchainManager] Permission grant failed:', error.message);
            throw error;
        }
    }

    /**
     * Revoke permission from a user
     */
    async revokePermission(fileHash, userEmail) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const userAddress = getUserBlockchainAddress(userEmail);
            const fileHashBytes32 = toBytes32(fileHash);

            logger.info(
                `[BlockchainManager] Revoking permission from ${userEmail} for file ${fileHash}`
            );

            // Estimate gas
            const gasEstimate = await this.contract.revokePermission.estimateGas(
                fileHashBytes32,
                userAddress
            );

            // Create transaction
            const tx = await this.contract.revokePermission(
                fileHashBytes32,
                userAddress,
                {
                    gasLimit: Math.ceil(gasEstimate * 1.2),
                }
            );

            logger.info(`[BlockchainManager] Permission revoke transaction sent: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait(BLOCKCHAIN_CONFIG.confirmationBlocks);

            logger.info(`[BlockchainManager] Permission revoked confirmed in block ${receipt.blockNumber}`);

            return {
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                status: 'confirmed'
            };
        } catch (error) {
            logger.error('[BlockchainManager] Permission revoke failed:', error.message);
            throw error;
        }
    }

    /**
     * Transfer file ownership
     */
    async transferOwnership(fileHash, newOwnerEmail) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const newOwnerAddress = getUserBlockchainAddress(newOwnerEmail);
            const fileHashBytes32 = toBytes32(fileHash);

            logger.info(
                `[BlockchainManager] Transferring ownership of ${fileHash} to ${newOwnerEmail}`
            );

            // Estimate gas
            const gasEstimate = await this.contract.transferOwnership.estimateGas(
                fileHashBytes32,
                newOwnerAddress
            );

            // Create transaction
            const tx = await this.contract.transferOwnership(
                fileHashBytes32,
                newOwnerAddress,
                {
                    gasLimit: Math.ceil(gasEstimate * 1.2),
                }
            );

            logger.info(`[BlockchainManager] Ownership transfer transaction sent: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait(BLOCKCHAIN_CONFIG.confirmationBlocks);

            logger.info(`[BlockchainManager] Ownership transfer confirmed in block ${receipt.blockNumber}`);

            return {
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                status: 'confirmed'
            };
        } catch (error) {
            logger.error('[BlockchainManager] Ownership transfer failed:', error.message);
            throw error;
        }
    }

    /**
     * Record audit event
     */
    async recordAuditEvent(eventType, fileHash, actorEmail, details) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const actorAddress = getUserBlockchainAddress(actorEmail);
            const fileHashBytes32 = fileHash ? toBytes32(fileHash) : ethers.ZeroHash;

            logger.debug(
                `[BlockchainManager] Recording audit event ${eventType} by ${actorEmail} for file ${fileHash}`
            );

            // Estimate gas
            const gasEstimate = await this.contract.recordAuditEvent.estimateGas(
                eventType,
                fileHashBytes32,
                actorAddress,
                details || ''
            );

            // Create transaction
            const tx = await this.contract.recordAuditEvent(
                eventType,
                fileHashBytes32,
                actorAddress,
                details || '',
                {
                    gasLimit: Math.ceil(gasEstimate * 1.2),
                }
            );

            logger.debug(`[BlockchainManager] Audit event transaction sent: ${tx.hash}`);

            // Wait for confirmation
            const receipt = await tx.wait(BLOCKCHAIN_CONFIG.confirmationBlocks);

            logger.debug(`[BlockchainManager] Audit event confirmed in block ${receipt.blockNumber}`);

            return {
                transactionHash: receipt.hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed.toString(),
                status: 'confirmed'
            };
        } catch (error) {
            logger.error('[BlockchainManager] Audit event recording failed:', error.message);
            throw error;
        }
    }

    /**
     * Check if user has permission on file
     */
    async hasPermission(fileHash, userEmail, permissionType) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const userAddress = getUserBlockchainAddress(userEmail);
            const fileHashBytes32 = toBytes32(fileHash);

            const hasAccess = await this.contract.hasPermission(
                fileHashBytes32,
                userAddress,
                permissionType
            );

            return hasAccess;
        } catch (error) {
            logger.error('[BlockchainManager] Permission check failed:', error.message);
            throw error;
        }
    }

    /**
     * Get file metadata from blockchain
     */
    async getFileMetadata(fileHash) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const fileHashBytes32 = toBytes32(fileHash);

            const [owner, createdAt, fileSize, filename] = await this.contract.getFileMetadata(
                fileHashBytes32
            );

            return {
                owner,
                createdAt: createdAt.toNumber(),
                fileSize: fileSize.toNumber(),
                filename
            };
        } catch (error) {
            logger.error('[BlockchainManager] Metadata retrieval failed:', error.message);
            throw error;
        }
    }

    /**
     * Verify if file exists on blockchain
     */
    async fileExists(fileHash) {
        if (!this.isReady()) {
            throw new Error('Blockchain manager not initialized');
        }

        try {
            const fileHashBytes32 = toBytes32(fileHash);
            return await this.contract.fileExists(fileHashBytes32);
        } catch (error) {
            logger.error('[BlockchainManager] File existence check failed:', error.message);
            throw error;
        }
    }

    /**
     * Get network status
     */
    async getNetworkStatus() {
        if (!this.isReady()) {
            return { status: 'not_initialized' };
        }

        try {
            const blockNumber = await this.provider.getBlockNumber();
            const balance = await this.provider.getBalance(this.signer.address);

            return {
                status: 'connected',
                network: BLOCKCHAIN_CONFIG.network,
                blockNumber,
                signerAddress: this.signer.address,
                signerBalance: ethers.formatEther(balance),
                contractAddress: BLOCKCHAIN_CONFIG.contractAddress
            };
        } catch (error) {
            logger.error('[BlockchainManager] Network status check failed:', error.message);
            return { status: 'error', error: error.message };
        }
    }
}

// Singleton instance
let instance = null;

function getBlockchainManager() {
    if (!instance) {
        instance = new BlockchainManager();
    }
    return instance;
}

module.exports = {
    BlockchainManager,
    getBlockchainManager
};
