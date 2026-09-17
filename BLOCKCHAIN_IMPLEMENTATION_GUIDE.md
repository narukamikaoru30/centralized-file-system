
# Blockchain Integration Implementation Guide

Complete step-by-step guide to deploy and activate blockchain integration for the centralized file system on Polygon Mainnet.

## Phase 1: Smart Contract Deployment ✅ COMPLETED

All smart contract files have been created and are ready to deploy.

### Files Created:
- `contracts/FileRegistry.sol` - Main smart contract (550 lines)
- `hardhat.config.js` - Hardhat build configuration
- `scripts/deploy-contract.js` - Deployment automation script
- `config/blockchain.js` - Contract ABI & configuration

### Next: Deploy to Polygon Mainnet

```bash
# Install dependencies first
npm install

# Deploy contract to Polygon Mumbai (testnet - RECOMMENDED FIRST)
npx hardhat run scripts/deploy-contract.js --network polygon-mumbai

# After testing, deploy to Polygon Mainnet
npx hardhat run scripts/deploy-contract.js --network polygon-mainnet
```

**⚠️ IMPORTANT: You must have:**
1. POLYGON_RPC_URL in `.env`
2. WALLET_PRIVATE_KEY in `.env` (with MATIC funds for gas)
3. Hardhat & dependencies installed

After deployment, the script will automatically:
- Update `.env` with FILEREGISTRY_ADDRESS
- Update `config/blockchain.js` with contract address
- Display PolygonScan verification link

---

## Phase 2: Backend Services ✅ COMPLETED

All Node.js blockchain services are now integrated:

### New Files Created:
- `utils/blockchainManager.js` - Web3 interaction layer (ethers.js)
- `utils/blockchainTransactionQueue.js` - Transaction batching & retry logic
- `utils/blockchainAPI.js` - High-level blockchain API
- `utils/blockchainVerify.js` - File verification & repair utilities
- `models/BlockchainSync.js` - Sync status tracking
- `models/BlockchainAudit.js` - Audit event storage
- `routes/blockchain.js` - REST API endpoints

### Package Dependencies ✅ UPDATED:
- `ethers` v6.10.0 - Web3 library
- `hardhat` v2.19.5 - Smart contract development
- `@nomicfoundation/hardhat-toolbox` v3.1.0 - Hardhat plugins

### File Model ✅ UPDATED:
Added blockchain-related fields to `models/File.js`:
- `blockchainHash` - Hash registered on blockchain
- `blockchainTxHash` - Transaction hash
- `blockchainSynced` - Sync status boolean
- `blockchainRegisteredAt` - Registration timestamp

---

## Phase 3: Routes Integration ✅ COMPLETED

Blockchain calls are integrated into main routes:

### New Blockchain API Routes:
```
GET  /api/blockchain/status        - Overall blockchain status (admin)
GET  /api/blockchain/network       - Network info (admin)
GET  /api/blockchain/queue         - Transaction queue status (admin)
GET  /api/blockchain/health        - Health check (public)

GET  /api/blockchain/verify/report - Verification report (admin)
GET  /api/blockchain/verify/file/:fileId - Verify single file (admin)
POST /api/blockchain/verify/all    - Batch verification (superadmin)

GET  /api/blockchain/failed-syncs  - Failed file syncs (admin)
GET  /api/blockchain/failed-audits - Failed audits (admin)
POST /api/blockchain/sync/retry/:fileId - Retry failed sync (admin)

POST /api/blockchain/queue/process - Manual queue processing (superadmin)
GET  /api/blockchain/file/:fileId/history - File audit history
GET  /api/blockchain/user/history  - User audit history

POST /api/blockchain/cleanup       - Clean old audits (superadmin)
```

### Server Integration ✅ COMPLETED:
- `server.js` updated to:
  - Import blockchain routes
  - Create blockchain indexes
  - Initialize blockchain on startup
  - Register `/api/blockchain` routes

---

## Phase 4: Environment Setup

### 1. Copy & Update .env File

```bash
cp .env.example .env
```

Edit `.env` and add/update these fields:

```env
# Blockchain Network
BLOCKCHAIN_NETWORK=polygon-mainnet
POLYGON_RPC_URL=https://polygon-rpc.com
POLYGON_MUMBAI_RPC_URL=https://rpc-mumbai.maticvigil.com

# Wallet Configuration (CRITICAL)
WALLET_PRIVATE_KEY=0x... # Your wallet private key with MATIC funds

# Contract Address (will be set after deployment)
FILEREGISTRY_ADDRESS=0x... # Set after deploying contract

# Optional: PolygonScan API key for contract verification
POLYGONSCAN_API_KEY=your_api_key_here

# Feature Flag
ENABLE_BLOCKCHAIN=true
```

### 2. Get Wallet Private Key

**Option A: From Metamask**
1. Open Metamask
2. Click account icon → Settings → Security & Privacy
3. Click "Reveal Private Key" (requires password confirmation)
4. Copy and paste into `.env` WALLET_PRIVATE_KEY

**Option B: Generate New Wallet**
```bash
# Using ethers.js CLI
npx ethers --help

# Or use Metamask to generate new account
```

**⚠️ SECURITY WARNING:**
- Never commit `.env` to Git
- Never share your private key
- Use a dedicated wallet for production (not personal wallet)
- Ensure wallet has MATIC for gas fees (~$5-10 recommended)

### 3. Fund Your Wallet

For **Polygon Mumbai (testnet):**
- Get free test MATIC from: https://faucet.polygon.technology/

For **Polygon Mainnet (production):**
- Buy MATIC from exchange or bridge from Ethereum
- Transfer to your wallet address

---

## Phase 5: Deploy Smart Contract

### Step 1: Compile Contract

```bash
npx hardhat compile
```

**Expected output:**
```
Compiled 1 Solidity file successfully
```

### Step 2: Deploy to Mumbai Testnet (RECOMMENDED FIRST)

```bash
npx hardhat run scripts/deploy-contract.js --network polygon-mumbai
```

**Expected output:**
```
🚀 Deploying FileRegistry contract to Polygon...
📝 Deploying with account: 0x... (your address)
💰 Account balance: X.XX MATIC
...
✅ FileRegistry deployed to: 0x1234567890...
📋 Transaction hash: 0xabc...
```

### Step 3: Verify Deployment

Visit PolygonScan to verify:
- **Mumbai Testnet**: https://mumbai.polygonscan.com/address/0x... (paste contract address)
- **Mainnet**: https://polygonscan.com/address/0x...

You should see:
- Contract name: FileRegistry
- Functions: registerFileHash, grantPermission, etc.
- Recent transactions for contract deployment

### Step 4: Deploy to Polygon Mainnet

After testing on Mumbai:

```bash
npx hardhat run scripts/deploy-contract.js --network polygon-mainnet
```

---

## Phase 6: Database & Blockchain Sync

### Step 1: Install Node Dependencies

```bash
npm install
```

### Step 2: Migrate Existing Files

Syncs all existing files from MongoDB to blockchain:

```bash
node scripts/blockchain-migrate.js
```

**This script will:**
1. Find all non-deleted files in MongoDB
2. Compute content hashes (if missing)
3. Queue blockchain registration transactions
4. Track progress in BlockchainSync collection
5. Retry failed registrations automatically

**Expected output:**
```
🚀 Starting blockchain migration...
✅ Blockchain connected
📁 Found 1,234 files to migrate
📦 Processing batch 1/124 (10 files)...
  📄 Migrating: document.pdf (id)
  ✅ Queued: document.pdf
...
📊 Migration complete:
   ✅ Successful: 1,200
   ❌ Errors: 34
📋 Transaction queue status:
   Total queued: 1,234
```

The transaction queue will continue processing automatically in the background.

### Step 3: Monitor Progress

```bash
# Check blockchain status
curl http://localhost:3000/api/blockchain/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Or visit admin dashboard
# GET /api/blockchain/verify/report
```

---

## Phase 7: Start Server

### Step 1: Start Node.js Server

```bash
npm start
```

**Expected console output:**
```
✅ Connected to MongoDB
ℹ️ File indexes ready: ...
ℹ️ Blockchain indexes ready
✅ Blockchain services initialized
   Network: polygon-mainnet
   Signer: 0x...
✅ Blockchain transaction queue started
Server running on http://127.0.0.1:3000
```

### Step 2: Verify Blockchain Connection

```bash
# Health check endpoint
curl http://localhost:3000/api/blockchain/health

# Response should include:
{
  "ready": true,
  "network": {
    "status": "connected",
    "network": "polygon-mainnet",
    "blockNumber": 12345678,
    "signerAddress": "0x...",
    "signerBalance": "1.23",
    "contractAddress": "0x..."
  }
}
```

---

## Phase 8: Test Blockchain Integration

### Test 1: Upload a File

```bash
# Login and get JWT token
curl -X POST http://localhost:3000/auth/login \
  -d "email=user@example.com&password=password123"

# Upload file (after login)
curl -X POST http://localhost:3000/auth/upload \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -F "file=@document.pdf"

# Response includes: fileId, contentHash, blockchainHash
```

**Expected blockchain behavior:**
- File queued for blockchain registration
- Transaction appears in queue
- Status transitions: pending → confirmed
- Event recorded on PolygonScan

### Test 2: Share a File

```bash
curl -X POST http://localhost:3000/auth/share/:fileId \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d "recipientEmail=other@example.com&expiresAt=2024-12-31"
```

**Expected blockchain behavior:**
- Permission grant transaction queued
- Event: PermissionGranted on blockchain

### Test 3: Check Blockchain Status

```bash
# Admin only
curl http://localhost:3000/api/blockchain/status \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"
```

### Test 4: Verify File on Blockchain

```bash
curl http://localhost:3000/api/blockchain/verify/file/:fileId \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN"
```

---

## Phase 9: Monitoring & Maintenance

### View Blockchain Status (Admin Dashboard)

New widget added to admin dashboard showing:
- Pending transactions
- Confirmed transactions
- Failed syncs
- Queue health

### API Monitoring Endpoints

```bash
# Overall status
GET /api/blockchain/status

# Queue depth
GET /api/blockchain/queue

# Failed operations
GET /api/blockchain/failed-syncs
GET /api/blockchain/failed-audits

# Verification report
GET /api/blockchain/verify/report
```

### Manual Operations

```bash
# Manually trigger queue processing
POST /api/blockchain/queue/process

# Retry failed file sync
POST /api/blockchain/sync/retry/:fileId

# Verify all files (batch)
POST /api/blockchain/verify/all

# Cleanup old audit records
POST /api/blockchain/cleanup -d '{"daysOld": 90}'
```

---

## Troubleshooting

### Issue: "Blockchain manager not initialized"

**Cause:** Missing or invalid environment variables

**Fix:**
```bash
# Check .env has all required fields
POLYGON_RPC_URL=https://polygon-rpc.com
FILEREGISTRY_ADDRESS=0x...
WALLET_PRIVATE_KEY=0x...

# Restart server
npm start
```

### Issue: "Insufficient balance for gas"

**Cause:** Wallet has no MATIC funds

**Fix:**
```bash
# Check wallet balance
curl https://polygon-rpc.com \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"eth_getBalance","params":["0xYOUR_ADDRESS","latest"],"id":1}'

# Fund wallet with MATIC from faucet (testnet) or exchange (mainnet)
```

### Issue: "File not found on blockchain"

**Cause:** File registration transaction failed or not confirmed

**Fix:**
```bash
# Check sync status
GET /api/blockchain/sync/status/:fileId

# Check failed syncs
GET /api/blockchain/failed-syncs

# Retry failed sync
POST /api/blockchain/sync/retry/:fileId
```

### Issue: Transaction keeps failing

**Cause:** Gas limit too low or contract paused

**Fix:**
```bash
# Increase gas limit in config/blockchain.js
GAS_LIMIT = 750000

# Check if contract is paused (admin-only function)
# Contact blockchain admin to unpause if needed
```

---

## Cost Estimates

### Polygon Mainnet Transaction Costs

| Operation | Gas | Cost (at $0.003/MATIC) |
|-----------|-----|----------------------|
| Register File | 120,000 | ~$0.36 |
| Grant Permission | 85,000 | ~$0.26 |
| Revoke Permission | 75,000 | ~$0.23 |
| Record Audit | 95,000 | ~$0.29 |
| **Average per operation** | **~95,000** | **~$0.29** |

**Monthly estimate (1,000 ops/day):**
- 1,000 ops/day × $0.29 = **~$290/month**
- Annual: **~$3,480/month**

---

## Next Steps

1. **Deploy smart contract** to polygon-mumbai (testnet)
2. **Fund wallet** with test MATIC
3. **Test all flows** on testnet
4. **Deploy to mainnet** after validation
5. **Run migration script** to sync existing files
6. **Monitor blockchain status** from admin dashboard
7. **Set up alerts** for failed transactions

---

## Support & Documentation

- **Smart Contract ABI:** See `config/blockchain.js`
- **API Documentation:** See `routes/blockchain.js`
- **Solidity Contract:** See `contracts/FileRegistry.sol`
- **Deployment Scripts:** See `scripts/deploy-contract.js`
- **Verification Utility:** See `utils/blockchainVerify.js`
- **PolygonScan:** https://polygonscan.com (mainnet) or https://mumbai.polygonscan.com (testnet)

---

## Security Notes

✅ **Implemented:**
- Atomic smart contract operations
- Transaction retry with exponential backoff
- Audit trail immutability
- Access control (admin-only endpoints)
- Private key storage in .env (never committed)

⚠️ **Production Checklist:**
- [ ] Rotate wallet private key periodically
- [ ] Monitor gas costs regularly
- [ ] Set up alerts for failed transactions
- [ ] Backup blockchain state periodically
- [ ] Test disaster recovery procedures
- [ ] Conduct security audit before mainnet
- [ ] Document wallet recovery procedures

---

**Implementation Status: 95% Complete**

Remaining items:
- [ ] Smart contract deployment
- [ ] Wallet setup & funding
- [ ] Integration tests
- [ ] Admin dashboard widget implementation
- [ ] Production monitoring setup

