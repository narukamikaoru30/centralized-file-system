# Blockchain Deployment Guide

## Overview
This guide walks through deploying the FileRegistry smart contract to Polygon network and integrating it with your centralized file system.

## Prerequisites
- Node.js 22.13.0 or higher
- npm dependencies installed (`npm install --legacy-peer-deps`)
- Metamask or compatible Web3 wallet
- Testnet MATIC tokens (for testing on Mumbai)

## Step 1: Set Up Wallet

### Option A: Create New Metamask Wallet
1. Install [Metamask](https://metamask.io/)
2. Create a new wallet
3. Save your seed phrase securely
4. Switch to Polygon Mumbai testnet network
5. Get testnet MATIC from faucet: https://faucet.polygon.technology/

### Option B: Use Existing Wallet
1. Export private key from Metamask:
   - Settings → Security & Privacy → Show Private Key
   - Copy your private key

## Step 2: Configure Environment

1. Update `.env` file with your wallet:
```bash
# Use your actual private key (keep this SECRET!)
WALLET_PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# For testing: use Mumbai testnet
BLOCKCHAIN_NETWORK=polygon-mumbai

# For production: use mainnet
BLOCKCHAIN_NETWORK=polygon-mainnet
```

2. Add optional Polygonscan API key for verification:
```bash
POLYGONSCAN_API_KEY=YOUR_API_KEY
```

## Step 3: Deploy to Mumbai Testnet (Recommended First)

```bash
# Deploy to Mumbai testnet
npx hardhat run scripts/deploy-contract.js --network polygon-mumbai
```

**Expected output:**
```
🚀 Deploying FileRegistry contract to Polygon...
📝 Deploying with account: 0x...
💰 Account balance: X.XX MATIC
📦 Compiling FileRegistry...
🔧 Deploying...
⏳ Waiting for deployment confirmation...
✅ FileRegistry deployed to: 0x...
📄 Deployment info saved to .deployment.json
✅ Updated .env with FILEREGISTRY_ADDRESS
✅ Updated config/blockchain.js with contract address
```

3. Script automatically updates:
   - `.env` → FILEREGISTRY_ADDRESS
   - `config/blockchain.js` → FILE_REGISTRY_ADDRESS

4. Verify deployment:
```bash
# Check contract on Polygonscan Mumbai
https://mumbai.polygonscan.com/address/0xYOUR_CONTRACT_ADDRESS
```

## Step 4: Test Blockchain Integration

1. Start the server:
```bash
npm start
```

2. Check blockchain health:
```bash
curl http://localhost:3000/api/blockchain/health
```

3. Monitor blockchain status:
```bash
curl http://localhost:3000/api/blockchain/status
```

## Step 5: Migrate Existing Files (Optional)

After contract deployment, optionally migrate existing files to blockchain:

```bash
node scripts/blockchain-migrate.js
```

This will:
- Find all non-synced files in MongoDB
- Register their hashes on the blockchain
- Create sync records for verification
- Show progress with batch processing

## Step 6: Deploy to Polygon Mainnet (Production)

**Prerequisites:**
- Contract tested and verified on Mumbai
- Mainnet wallet funded with MATIC
- Mainnet deployment costs: ~0.5 MATIC (~$1-2 USD)

**Deployment:**
```bash
# Switch .env to mainnet
BLOCKCHAIN_NETWORK=polygon-mainnet

# Deploy to mainnet
npx hardhat run scripts/deploy-contract.js --network polygon-mainnet
```

**Verification:**
```bash
# Check on PolygonScan mainnet
https://polygonscan.com/address/0xYOUR_CONTRACT_ADDRESS
```

## Blockchain API Endpoints

### Status & Monitoring
- `GET /api/blockchain/health` - System health check
- `GET /api/blockchain/status` - Network status
- `GET /api/blockchain/network` - Network info
- `GET /api/blockchain/queue` - Queue status

### Verification
- `GET /api/blockchain/report` - Sync report
- `GET /api/blockchain/file/:id` - File blockchain status
- `POST /api/blockchain/verify/all` - Verify all files

### Failed Operations
- `GET /api/blockchain/failed-syncs` - Failed transactions
- `GET /api/blockchain/failed-audits` - Failed audit events
- `POST /api/blockchain/retry/:id` - Retry failed sync

### Manual Control
- `POST /api/blockchain/process` - Process queue manually
- `POST /api/blockchain/cleanup` - Clean old audit logs

### User History
- `GET /api/blockchain/file/:id/history` - File audit trail
- `GET /api/blockchain/user/history` - User activity audit trail

## Troubleshooting

### "Insufficient balance" Error
- Solution: Fund wallet with Mumbai testnet MATIC
- Faucet: https://faucet.polygon.technology/

### "Private key invalid" Error
- Check .env WALLET_PRIVATE_KEY format
- Should start with `0x` and be 66 characters total
- Don't include quotes or extra spaces

### Deployment Timeout
- Increase timeout: `BLOCKCHAIN_CONFIRMATION_BLOCKS=3`
- Reduce batch size: `BLOCKCHAIN_BATCH_SIZE=5`

### "Gas limit exceeded" Error
- Increase gas limit: `BLOCKCHAIN_GAS_LIMIT=750000`
- Reduce transaction complexity
- Check Polygonscan for gas prices

## Security Best Practices

1. **Never commit .env to version control**
   - Add `.env` to `.gitignore`
   - Use `.env.example` as template

2. **Private Key Safety**
   - Store in password manager
   - Use separate wallets for dev/prod
   - Rotate keys periodically

3. **Contract Verification**
   - Always test on testnet first
   - Verify contract on Polygonscan
   - Review all transactions before mainnet

4. **Access Control**
   - Use `ENABLE_BLOCKCHAIN=false` for development
   - Restrict blockchain endpoints to admin users
   - Monitor failed transactions

## Support Resources

- [Polygon Network Docs](https://polygon.technology/)
- [Hardhat Documentation](https://hardhat.org/)
- [ethers.js API](https://docs.ethers.org/v6/)
- [Polygonscan Explorer](https://polygonscan.com/)

## Environment Variables Reference

```bash
# Network Selection
BLOCKCHAIN_NETWORK=polygon-mumbai|polygon-mainnet

# RPC Endpoints
POLYGON_RPC_URL=https://polygon-rpc.com
POLYGON_MUMBAI_RPC_URL=https://rpc-mumbai.maticvigil.com

# Contract Deployment
FILEREGISTRY_ADDRESS=0x... (auto-filled after deployment)
WALLET_PRIVATE_KEY=0x... (YOUR PRIVATE KEY)

# Transaction Settings
BLOCKCHAIN_BATCH_SIZE=10 (transactions per batch)
BLOCKCHAIN_PROCESS_INTERVAL=5000 (ms between batches)
BLOCKCHAIN_MAX_RETRIES=3 (retry attempts)
BLOCKCHAIN_GAS_LIMIT=500000 (wei)
BLOCKCHAIN_CONFIRMATION_BLOCKS=2 (confirmations required)

# Feature Control
ENABLE_BLOCKCHAIN=true|false
POLYGONSCAN_API_KEY=... (optional, for verification)
```

## Next Steps

1. ✅ Complete: Code implementation
2. ✅ Complete: Dependency installation
3. ✅ Complete: Smart contract compilation
4. 📍 Current: Wallet setup & testnet deployment
5. ⏳ Next: Production deployment to mainnet
6. ⏳ Next: Full integration testing

---

**Last Updated**: 2024
**Status**: Ready for testnet deployment
