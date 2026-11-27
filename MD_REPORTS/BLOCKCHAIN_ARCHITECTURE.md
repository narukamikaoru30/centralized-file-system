# Blockchain Integration - File Reference & Architecture

Quick reference for all blockchain-related files and their purposes.

## Directory Structure

```
centralized-file-system/
├── contracts/
│   └── FileRegistry.sol              # Solidity smart contract (~550 lines)
├── config/
│   └── blockchain.js                 # Configuration, ABI, helpers
├── utils/
│   ├── blockchainManager.js          # Web3 provider & contract interaction
│   ├── blockchainTransactionQueue.js # Transaction batching & retry logic
│   ├── blockchainAPI.js              # High-level blockchain API
│   └── blockchainVerify.js           # Verification & repair utilities
├── models/
│   ├── File.js                       # Updated with blockchain fields
│   ├── BlockchainSync.js             # Tracks file sync status
│   └── BlockchainAudit.js            # Audit events on blockchain
├── routes/
│   └── blockchain.js                 # REST API endpoints
├── scripts/
│   ├── deploy-contract.js            # Deployment automation
│   └── blockchain-migrate.js         # Migrate existing files to blockchain
├── hardhat.config.js                 # Smart contract build config
├── .env.example                      # Updated with blockchain config
└── server.js                         # Updated with blockchain integration
```

---

## Core Components

### 1. Smart Contract: `contracts/FileRegistry.sol`

**Purpose:** Immutable on-chain file registry on Polygon

**Key Functions:**
```solidity
registerFileHash(bytes32 fileHash, address owner, string filename, uint256 fileSize)
    → Register new file on blockchain
    
transferOwnership(bytes32 fileHash, address newOwner)
    → Transfer file ownership
    
grantPermission(bytes32 fileHash, address user, uint8 permissionType)
    → Allow user access (permission types: READ, WRITE, TRANSFER, DELETE, SHARE)
    
revokePermission(bytes32 fileHash, address user)
    → Remove all permissions
    
hasPermission(bytes32 fileHash, address user, uint8 permissionType)
    → Check if user has permission
    
recordAuditEvent(uint8 eventType, bytes32 fileHash, address actor, string details)
    → Log event immutably (event types: UPLOAD, DOWNLOAD, SHARE, DELETE, LOGIN, ROLE_CHANGE)
    
getFileMetadata(bytes32 fileHash) → (owner, createdAt, fileSize, filename)
    → Retrieve file info from blockchain
    
fileExists(bytes32 fileHash) → bool
    → Check if file registered
```

**Events Emitted:**
- `FileRegistered` - File added to blockchain
- `OwnershipTransferred` - File ownership changed
- `PermissionGranted` - User granted access
- `PermissionRevoked` - User access removed
- `AuditEventRecorded` - Event logged immutably

### 2. Configuration: `config/blockchain.js`

**Purpose:** Contract ABI, network config, helper functions

**Exports:**
```javascript
FILE_REGISTRY_ABI              // Contract interface (JSON)
BLOCKCHAIN_CONFIG              // Network, RPC, gas settings
getUserBlockchainAddress()     // Email → Ethereum address mapping
isValidAddress()               // Address validation
toBytes32()                    // Hash conversion utility
```

**Key Config Values:**
```javascript
network: 'polygon-mainnet'
rpcUrl: https://polygon-rpc.com
chainId: 137
contractAddress: process.env.FILEREGISTRY_ADDRESS
walletPrivateKey: process.env.WALLET_PRIVATE_KEY
confirmationBlocks: 2
gasLimit: 500000
```

### 3. Web3 Manager: `utils/blockchainManager.js`

**Purpose:** ethers.js interaction layer

**Class: BlockchainManager**
```javascript
constructor()                           // Initialize provider & contract
isReady()                              // Check if initialized
registerFileHash()                     // Queue file registration
grantPermission()                      // Queue permission grant
revokePermission()                     // Queue permission revoke
transferOwnership()                    // Queue ownership transfer
recordAuditEvent()                     // Queue audit event
hasPermission()                        // Check permission (read-only)
getFileMetadata()                      // Get file info (read-only)
fileExists()                           // Check if file exists (read-only)
getNetworkStatus()                     // Get network & signer info
```

**Singleton:** `getBlockchainManager()` returns singleton instance

**Gas Handling:**
- Estimates gas per transaction
- Applies 20% buffer for safety
- Retries on failure with backoff

### 4. Transaction Queue: `utils/blockchainTransactionQueue.js`

**Purpose:** Batch & retry transactions, prevent nonce conflicts

**Class: BlockchainTransactionQueue**
```javascript
constructor(blockchainManager)         // Initialize with manager
enqueueTransaction(tx)                 // Add to queue
startProcessing()                      // Begin batch processing
stopProcessing()                       // Stop queue
processBatch()                         // Process ~10 transactions
executeTransaction(tx)                 // Execute single transaction
getStatus()                            // Queue stats
getPendingTransactions()               // Get queued items
cleanupFailedTransactions(ageInHours)  // Remove old failures
retryTransaction(transactionId)        // Manual retry
getTransactionDetails(id)              // Get transaction info
```

**Features:**
- Batches transactions (10 per batch)
- Processes every 5 seconds
- Retries up to 3 times with exponential backoff
- Tracks gas costs
- Monitors transaction status

### 5. High-Level API: `utils/blockchainAPI.js`

**Purpose:** Database + blockchain operations combined

**Class: BlockchainAPI**
```javascript
registerFile(file, ownerEmail)              // Register file & track sync
grantPermission(fileHash, userEmail, type)  // Grant & queue
revokePermission(fileHash, userEmail)       // Revoke & queue
recordAudit(eventType, fileHash, actor...)  // Audit & queue
getFileSyncStatus(fileId)                   // Get sync state
getFileAuditHistory(fileHash)               // Get confirmed audits
getUserAuditHistory(userEmail)              // Get user's audits
getPendingOperations()                      // Queue stats
verifyFile(fileHash)                        // Check blockchain state
checkPermission(fileHash, userEmail, type)  // Permission check
getBlockchainStatus()                       // Overall status
retrySyncOperation(syncId)                  // Retry failed sync
processQueue()                              // Manual queue processing
stop()                                      // Graceful shutdown
```

**Singleton:** `getBlockchainAPI()` returns singleton

### 6. Verification Utility: `utils/blockchainVerify.js`

**Purpose:** Verify file state, detect issues, repair

**Class: BlockchainVerifier**
```javascript
verifyFile(fileId)              // Check single file vs blockchain
verifyAllFiles(limit)           // Batch verification
repairSync(fileId)              // Mark for retry
getReport()                     // Sync statistics
getFailedSyncs(limit)           // Failed registrations
getFailedAudits(limit)          // Failed audit events
cleanupOldAudits(daysOld)       // Remove old records
```

### 7. Models

#### `models/File.js` (Updated)
Added fields:
```javascript
blockchainHash       // String - Hash registered on-chain
blockchainTxHash     // String - Registration transaction hash
blockchainSynced     // Boolean - Sync completion flag
blockchainRegisteredAt // Date - When registered on-chain
```

#### `models/BlockchainSync.js`
Tracks file → blockchain sync status
```javascript
fileId              // ObjectId ref to File
fileHash            // String - Content hash
transactionHash     // String - On-chain tx
blockNumber         // Number - Confirmation block
status              // 'pending'|'confirmed'|'failed'
retryCount          // Number - Retry attempts
errorMessage        // String - Last error
gasUsed             // String - Gas consumed
transactionFee      // String - Fee paid
confirmedAt         // Date - Confirmation time

Methods:
markConfirmed(blockNumber, txHash, gasUsed)
markFailed(error)
resetForRetry()
```

#### `models/BlockchainAudit.js`
Audit events stored before sending to blockchain
```javascript
eventType           // Number - 0-5 event type
eventName           // String - 'upload'|'download'|etc
fileHash            // String - File content hash
fileId              // ObjectId - File reference
actor               // String - User email/address
details             // String - Event details
transactionHash     // String - On-chain tx
blockNumber         // Number - Confirmation block
status              // 'pending'|'confirmed'|'failed'
retryCount          // Number - Retry attempts
metadata            // Mixed - Additional data

Methods:
getEventsByActor(email, limit)
getEventsByFile(fileHash, limit)
markConfirmed(txHash, blockNumber)
markFailed(error)
```

### 8. Routes: `routes/blockchain.js`

**REST Endpoints** (all require authentication, some admin-only):

**Status & Health:**
```
GET  /api/blockchain/status        → Overall status (admin)
GET  /api/blockchain/network       → Network details (admin)
GET  /api/blockchain/queue         → Queue status (admin)  
GET  /api/blockchain/health        → Health check (public)
```

**Verification:**
```
GET  /api/blockchain/verify/report      → Stats (admin)
GET  /api/blockchain/verify/file/:id    → Single file (admin)
POST /api/blockchain/verify/all         → Batch verify (superadmin)
```

**Failed Operations:**
```
GET  /api/blockchain/failed-syncs   → Failed files (admin)
GET  /api/blockchain/failed-audits  → Failed audits (admin)
POST /api/blockchain/sync/retry/:id → Retry (admin)
```

**Manual Operations:**
```
POST /api/blockchain/queue/process  → Process queue (superadmin)
POST /api/blockchain/cleanup        → Clean audits (superadmin)
```

**User Endpoints:**
```
GET  /api/blockchain/file/:id/history   → File audit history
GET  /api/blockchain/user/history       → User's audit history
```

---

## Data Flow

### File Upload Flow

```
User Uploads File
    ↓
Express Route (routes/files.js POST /upload)
    ↓
File saved to MongoDB + SHA-256 hash computed
    ↓
blockchainAPI.registerFile() called
    ↓
BlockchainSync record created (status='pending')
    ↓
Transaction enqueued to blockchainTransactionQueue
    ↓
Queue processes every 5 seconds (batch of 10)
    ↓
blockchainManager.registerFileHash() executes
    ↓
Web3 contract call with gas estimation
    ↓
Transaction sent to Polygon RPC
    ↓
Wait for confirmation (2 blocks)
    ↓
BlockchainSync marked as 'confirmed'
    ↓
File model updated: blockchainSynced=true
    ↓
Events visible on PolygonScan
```

### File Sharing Flow

```
User Shares File with Another User
    ↓
Express Route (routes/files.js POST /share)
    ↓
File record updated in MongoDB (sharedWith array)
    ↓
blockchainAPI.grantPermission() called
    ↓
Transaction enqueued
    ↓
blockchainManager.grantPermission() executes
    ↓
Smart contract function called: grantPermission()
    ↓
User email converted to blockchain address
    ↓
Permission bit flag set for user
    ↓
PermissionGranted event emitted
    ↓
BlockchainAudit record marked 'confirmed'
```

### Audit Event Flow

```
Login / Role Change / File Operation
    ↓
Express Route records event
    ↓
blockchainAPI.recordAudit() called
    ↓
BlockchainAudit record created (status='pending')
    ↓
Transaction queued (lower priority than file ops)
    ↓
Queue processes and calls recordAuditEvent()
    ↓
Smart contract logs immutably on blockchain
    ↓
AuditEventRecorded event emitted
    ↓
Audit record marked 'confirmed'
    ↓
User can query full audit trail
```

---

## Environment Variables

**Required:**
```env
POLYGON_RPC_URL=https://polygon-rpc.com
WALLET_PRIVATE_KEY=0x...
FILEREGISTRY_ADDRESS=0x...
ENABLE_BLOCKCHAIN=true
```

**Optional:**
```env
BLOCKCHAIN_NETWORK=polygon-mainnet
BLOCKCHAIN_BATCH_SIZE=10
BLOCKCHAIN_PROCESS_INTERVAL=5000
BLOCKCHAIN_MAX_RETRIES=3
BLOCKCHAIN_GAS_LIMIT=500000
BLOCKCHAIN_CONFIRMATION_BLOCKS=2
```

---

## Deployment Checklist

- [ ] Smart contract compiled with Hardhat
- [ ] Wallet created with private key
- [ ] Wallet funded with MATIC (testnet or mainnet)
- [ ] `.env` updated with all blockchain variables
- [ ] Smart contract deployed (`deploy-contract.js`)
- [ ] Contract address verified on PolygonScan
- [ ] `npm install` run to install ethers dependency
- [ ] Server started (`npm start`)
- [ ] Blockchain health check passes
- [ ] Migration script executed (`blockchain-migrate.js`)
- [ ] Test file upload → blockchain confirmed
- [ ] Test file share → permission set on-chain
- [ ] Admin dashboard shows blockchain status
- [ ] All API endpoints tested and working

---

## Performance Characteristics

**Transaction Processing:**
- Batch size: 10 transactions
- Processing interval: 5 seconds
- Estimated throughput: ~120 transactions/minute
- Gas per transaction: ~95,000-120,000 units
- Cost per transaction: ~$0.29 (Polygon mainnet)

**Latency:**
- Enqueue to processing: <5 seconds
- Processing to blockchain: <30 seconds
- Blockchain confirmation: ~30-60 seconds (2 blocks)
- Total user experience delay: None (async operation)

**Storage:**
- BlockchainSync: ~1KB per file
- BlockchainAudit: ~500B per event
- File model additions: ~100B per file

---

## Monitoring & Alerts

**Key Metrics to Monitor:**
- Queue depth (should stay <1000)
- Failed transaction count
- Gas costs per transaction
- Signer wallet balance
- Blockchain network status
- Transaction confirmation time

**Alert Conditions:**
- Queue depth > 5000 (backlog)
- Failed sync rate > 5%
- Wallet balance < 0.5 MATIC
- No transactions for 1 hour (stuck)
- Network latency > 60 seconds

---

## Rollback Procedures

If blockchain integration fails:

1. **Stop processing:** `blockchainAPI.stop()`
2. **Disable in .env:** `ENABLE_BLOCKCHAIN=false`
3. **Restart server:** System continues without blockchain
4. **Resume later:** Set `ENABLE_BLOCKCHAIN=true` and restart
5. **Fix issues:** Check logs and `BlockchainSync` failed records
6. **Retry:** `POST /api/blockchain/sync/retry/:fileId` for each failure

---

## Future Enhancements

- [ ] Batch audit events to reduce gas costs
- [ ] Implement smart contract upgradability (Proxy pattern)
- [ ] Add multi-signature wallet support
- [ ] Implement Gnosis Safe for additional security
- [ ] Add cost tracking & billing integration
- [ ] Implement layer-2 optimization (Polygon mumbai)
- [ ] Add IPFS integration for file content storage
- [ ] Create mobile app for Web3 wallet integration
- [ ] Add API rate limiting based on gas costs
- [ ] Implement cross-chain functionality

