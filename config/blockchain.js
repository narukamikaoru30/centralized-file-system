/**
 * Blockchain Configuration
 * Stores contract ABI, addresses, and RPC configuration for Polygon
 */

// Contract ABI - FileRegistry.sol interface
const FILE_REGISTRY_ABI = [
    {
        "inputs": [],
        "stateMutability": "nonpayable",
        "type": "constructor"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "bytes32", "name": "fileHash", "type": "bytes32"},
            {"indexed": false, "internalType": "uint8", "name": "eventType", "type": "uint8"},
            {"indexed": true, "internalType": "address", "name": "actor", "type": "address"},
            {"indexed": false, "internalType": "string", "name": "details", "type": "string"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "name": "AuditEventRecorded",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "bytes32", "name": "fileHash", "type": "bytes32"},
            {"indexed": true, "internalType": "address", "name": "owner", "type": "address"},
            {"indexed": false, "internalType": "string", "name": "filename", "type": "string"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "name": "FileRegistered",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "bytes32", "name": "fileHash", "type": "bytes32"},
            {"indexed": true, "internalType": "address", "name": "owner", "type": "address"},
            {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": false, "internalType": "uint8", "name": "permissionType", "type": "uint8"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "name": "PermissionGranted",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "bytes32", "name": "fileHash", "type": "bytes32"},
            {"indexed": true, "internalType": "address", "name": "owner", "type": "address"},
            {"indexed": true, "internalType": "address", "name": "user", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "name": "PermissionRevoked",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            {"indexed": true, "internalType": "bytes32", "name": "fileHash", "type": "bytes32"},
            {"indexed": true, "internalType": "address", "name": "previousOwner", "type": "address"},
            {"indexed": true, "internalType": "address", "name": "newOwner", "type": "address"},
            {"indexed": false, "internalType": "uint256", "name": "timestamp", "type": "uint256"}
        ],
        "name": "OwnershipTransferred",
        "type": "event"
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "PERMISSION_DELETE",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "PERMISSION_READ",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "PERMISSION_SHARE",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "PERMISSION_TRANSFER",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "PERMISSION_WRITE",
        "outputs": [{"internalType": "uint8", "name": "", "type": "uint8"}]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "admin",
        "outputs": [{"internalType": "address", "name": "", "type": "address"}]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "fileExists",
        "inputs": [{"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"}],
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}]
    },
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "grantPermission",
        "inputs": [
            {"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"},
            {"internalType": "address", "name": "_user", "type": "address"},
            {"internalType": "uint8", "name": "_permissionType", "type": "uint8"}
        ]
    },
    {
        "stateMutability": "view",
        "type": "function",
        "name": "hasPermission",
        "inputs": [
            {"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"},
            {"internalType": "address", "name": "_user", "type": "address"},
            {"internalType": "uint8", "name": "_permissionType", "type": "uint8"}
        ],
        "outputs": [{"internalType": "bool", "name": "", "type": "bool"}]
    },
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "recordAuditEvent",
        "inputs": [
            {"internalType": "uint8", "name": "_eventType", "type": "uint8"},
            {"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"},
            {"internalType": "address", "name": "_actor", "type": "address"},
            {"internalType": "string", "name": "_details", "type": "string"}
        ]
    },
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "registerFileHash",
        "inputs": [
            {"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"},
            {"internalType": "address", "name": "_owner", "type": "address"},
            {"internalType": "string", "name": "_filename", "type": "string"},
            {"internalType": "uint256", "name": "_fileSize", "type": "uint256"}
        ]
    },
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "revokePermission",
        "inputs": [
            {"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"},
            {"internalType": "address", "name": "_user", "type": "address"}
        ]
    },
    {
        "stateMutability": "nonpayable",
        "type": "function",
        "name": "transferOwnership",
        "inputs": [
            {"internalType": "bytes32", "name": "_fileHash", "type": "bytes32"},
            {"internalType": "address", "name": "_newOwner", "type": "address"}
        ]
    }
];

// Blockchain configuration
const BLOCKCHAIN_CONFIG = {
    // Network settings
    network: process.env.BLOCKCHAIN_NETWORK || 'polygon-mainnet',
    rpcUrl: process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
    chainId: 137, // Polygon Mainnet
    
    // Contract settings
    contractAddress: process.env.FILEREGISTRY_ADDRESS || null, // Set after deployment
    contractABI: FILE_REGISTRY_ABI,
    
    // Wallet settings
    walletPrivateKey: process.env.WALLET_PRIVATE_KEY || null,
    
    // Gas settings (Polygon has low fees, but we set reasonable limits)
    gasLimit: 500000,
    gasPrice: '50', // gwei - adjust based on network conditions
    maxPriorityFeePerGas: '30', // gwei
    maxFeePerGas: '100', // gwei
    
    // Transaction settings
    confirmationBlocks: 2,
    transactionTimeout: 60000, // 60 seconds
    
    // Retry settings
    maxRetries: 3,
    retryDelay: 2000, // milliseconds
    exponentialBackoff: true,
    
    // Permission types
    permissionTypes: {
        READ: 0,
        WRITE: 1,
        TRANSFER: 2,
        DELETE: 3,
        SHARE: 4
    },
    
    // Audit event types
    auditEvents: {
        UPLOAD: 0,
        DOWNLOAD: 1,
        SHARE: 2,
        DELETE: 3,
        LOGIN: 4,
        ROLE_CHANGE: 5
    }
};

/**
 * Convert user email to deterministic blockchain address
 * Uses keccak256 hash of email to create consistent address mapping
 */
function getUserBlockchainAddress(email) {
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(email).digest('hex');
    // Convert to Ethereum-like address (40 hex chars = 20 bytes)
    return '0x' + hash.substring(0, 40);
}

/**
 * Validate Ethereum address format
 */
function isValidAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Convert file hash to bytes32 format
 */
function toBytes32(hash) {
    if (typeof hash === 'string') {
        if (hash.startsWith('0x')) {
            return hash;
        }
        // Assume hex string
        if (hash.length === 64) {
            return '0x' + hash;
        }
    }
    throw new Error('Invalid hash format');
}

module.exports = {
    FILE_REGISTRY_ABI,
    BLOCKCHAIN_CONFIG,
    getUserBlockchainAddress,
    isValidAddress,
    toBytes32
};
