# Blockchain Integration - Quick Reference

## 🚀 Quick Start (5 minutes)

```bash
# 1. Ensure dependencies are installed
npm install --legacy-peer-deps

# 2. Update .env with your Metamask wallet
BLOCKCHAIN_NETWORK=polygon-mumbai
WALLET_PRIVATE_KEY=0xYOUR_METAMASK_PRIVATE_KEY
ENABLE_BLOCKCHAIN=true

# 3. Get testnet MATIC
# Visit: https://faucet.polygon.technology/
# Select Mumbai Testnet, paste wallet address

# 4. Deploy contract
npx hardhat run scripts/deploy-contract.js --network polygon-mumbai

# 5. Start server
npm start

# 6. Verify blockchain is working
curl http://localhost:3000/api/blockchain/health
```

## 📋 Common Commands

```bash
# Compile smart contract
npx hardhat compile

# Deploy to Mumbai testnet
npx hardhat run scripts/deploy-contract.js --network polygon-mumbai

# Deploy to Polygon mainnet
npx hardhat run scripts/deploy-contract.js --network polygon-mainnet

# Interactive wallet setup
node scripts/setup-blockchain.js

# Migrate existing files to blockchain
node scripts/blockchain-migrate.js

# Check blockchain status
curl http://localhost:3000/api/blockchain/status

# View sync report
curl http://localhost:3000/api/blockchain/report

# Verify all files
curl -X POST http://localhost:3000/api/blockchain/verify/all \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 100, "autoRepair": true}'

# View user audit history
curl http://localhost:3000/api/blockchain/user/history \
  -H "Authorization: Bearer TOKEN"

# View file audit trail
curl http://localhost:3000/api/blockchain/file/FILE_ID/history \
  -H "Authorization: Bearer TOKEN"
```

## 🔑 Key Files

| File | Purpose | Status |
|------|---------|--------|
| contracts/FileRegistry.sol | Smart contract | ✅ Compiled |
| config/blockchain.js | Network config | ✅ Ready |
| utils/blockchainManager.js | Web3 provider | ✅ Ready |
| utils/blockchainTransactionQueue.js | Transaction batching | ✅ Ready |
| utils/blockchainAPI.js | High-level API | ✅ Ready |
| utils/blockchainVerify.js | Verification utilities | ✅ Ready |
| routes/blockchain.js | REST endpoints | ✅ Ready |
| models/BlockchainSync.js | Sync tracking | ✅ Ready |
| models/BlockchainAudit.js | Audit events | ✅ Ready |
| scripts/deploy-contract.js | Deployment automation | ✅ Ready |
| scripts/blockchain-migrate.js | File migration | ✅ Ready |
| hardhat.config.js | Build configuration | ✅ Ready |
| .env | Environment variables | ⚠️ Requires wallet |

## ⚙️ Environment Variables

```bash
# Required for blockchain
BLOCKCHAIN_NETWORK=polygon-mumbai|polygon-mainnet
WALLET_PRIVATE_KEY=0x...
ENABLE_BLOCKCHAIN=true

# Auto-filled after deployment
FILEREGISTRY_ADDRESS=0x...

# Optional
POLYGONSCAN_API_KEY=...

# Defaults (usually don't change)
BLOCKCHAIN_BATCH_SIZE=10
BLOCKCHAIN_PROCESS_INTERVAL=5000
BLOCKCHAIN_MAX_RETRIES=3
BLOCKCHAIN_GAS_LIMIT=500000
BLOCKCHAIN_CONFIRMATION_BLOCKS=2
```

## 📡 API Endpoints

### Status (GET, no auth required)
- `/api/blockchain/health` - Quick health check
- `/api/blockchain/status` - Detailed status
- `/api/blockchain/network` - Network info
- `/api/blockchain/queue` - Queue status

### Admin Endpoints (POST, requires auth + admin role)
- `/api/blockchain/process` - Force process queue
- `/api/blockchain/cleanup` - Clean old audits
- `/api/blockchain/verify/all` - Verify + repair all files

### Failed Operations (GET, requires auth)
- `/api/blockchain/failed-syncs` - List failed syncs
- `/api/blockchain/failed-audits` - List failed audits

### Retry (POST, requires auth)
- `/api/blockchain/retry/:id` - Retry specific sync

### Reports (GET, requires auth)
- `/api/blockchain/report` - Sync statistics
- `/api/blockchain/file/:id` - File status
- `/api/blockchain/file/:id/history` - File audit trail
- `/api/blockchain/user/history` - User activity

## 🔐 Permission Types

```
0 = READ       (download/view)
1 = WRITE      (modify)
2 = TRANSFER   (change owner)
3 = DELETE     (remove)
4 = SHARE      (share with others)
```

## 📝 Audit Events

```
0 = UPLOAD      (file uploaded)
1 = DOWNLOAD    (file downloaded)
2 = SHARE       (file shared)
3 = DELETE      (file deleted)
4 = LOGIN       (user logged in)
5 = ROLE_CHANGE (user role changed)
```

## 🎯 Workflow

```
User Action
    ↓
File Operation (upload/download/share/delete)
    ↓
blockchainAPI.registerFile() / recordAudit()
    ↓
Create BlockchainSync/Audit record (status: pending)
    ↓
Enqueue transaction
    ↓
Queue processor (every 5s, batches 10)
    ↓
blockchainManager (estimate gas, sign transaction)
    ↓
Submit to Polygon RPC
    ↓
Wait 2 block confirmations
    ↓
Mark confirmed, record tx hash
    ↓
✅ Immutable blockchain record created
```

## ⚠️ Troubleshooting Quick Links

| Issue | Solution |
|-------|----------|
| "Insufficient balance" | Get testnet MATIC: https://faucet.polygon.technology/ |
| "Private key invalid" | Check .env WALLET_PRIVATE_KEY format (0x + 64 hex chars) |
| "Cannot find module" | Run `npm install --legacy-peer-deps` |
| "Compilation failed" | Run `npx hardhat compile` to see detailed errors |
| Queue not processing | Check `/api/blockchain/status` and `/api/blockchain/queue` |
| Failed transactions | Check `/api/blockchain/failed-syncs` and retry |

## 🌐 Network Details

### Mumbai Testnet (for testing)
- Chain ID: 80001
- RPC: https://rpc-mumbai.maticvigil.com
- Faucet: https://faucet.polygon.technology/
- Explorer: https://mumbai.polygonscan.com/
- Gas: Free (testnet)

### Polygon Mainnet (production)
- Chain ID: 137
- RPC: https://polygon-rpc.com
- Explorer: https://polygonscan.com/
- Gas: ~$0.50-1.00 per operation

## 📚 Documentation

| Document | Purpose |
|----------|---------|
| BLOCKCHAIN_IMPLEMENTATION.md | Technical architecture & details |
| BLOCKCHAIN_DEPLOYMENT_GUIDE.md | Step-by-step deployment |
| BLOCKCHAIN_COMPLETION_STATUS.md | What's done, what's next |
| BLOCKCHAIN_QUICK_REFERENCE.md | This file |

## ✅ Pre-Deployment Checklist

- [ ] Node.js 22.13.0+: `node --version`
- [ ] Dependencies: `npm install --legacy-peer-deps`
- [ ] Compilation: `npx hardhat compile` (should succeed)
- [ ] Metamask wallet created and funded with testnet MATIC
- [ ] .env configured with WALLET_PRIVATE_KEY and BLOCKCHAIN_NETWORK
- [ ] ENABLE_BLOCKCHAIN=true in .env
- [ ] Contract deployment: `npx hardhat run scripts/deploy-contract.js --network polygon-mumbai`
- [ ] Server starts: `npm start` (no blockchain errors)
- [ ] Health check passes: `curl http://localhost:3000/api/blockchain/health`

## 🆘 Quick Support

### Cannot deploy contract?
1. Ensure testnet MATIC in wallet
2. Check RPC URL is correct: `POLYGON_RPC_URL` in .env
3. Verify private key format: `0x` + 64 hex characters

### Queue not processing?
1. Check server logs for blockchain errors
2. Verify contract address in .env: `FILEREGISTRY_ADDRESS=0x...`
3. Manual process: `curl -X POST http://localhost:3000/api/blockchain/process`

### Slow transactions?
1. Reduce `BLOCKCHAIN_BATCH_SIZE` to 5
2. Increase `BLOCKCHAIN_PROCESS_INTERVAL` to 10000 (10 seconds)
3. Check Polygon gas prices on Polygonscan

### High gas costs?
1. Use Mumbai testnet for development (free)
2. Batch operations (queue does this automatically)
3. Monitor gas prices before mainnet deployment

---

**Status**: ✅ Ready to deploy
**Last Updated**: January 2025
**Version**: 1.0

For detailed information, see BLOCKCHAIN_IMPLEMENTATION.md and BLOCKCHAIN_DEPLOYMENT_GUIDE.md
