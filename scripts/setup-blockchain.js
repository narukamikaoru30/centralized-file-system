#!/usr/bin/env node

/**
 * Blockchain Quick Setup Helper
 * Helps configure wallet and deploy to testnet
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      resolve(answer);
    });
  });
}

async function main() {
  console.log('\n========================================');
  console.log('  Blockchain Setup Helper');
  console.log('========================================\n');

  console.log('This helper will configure your wallet for blockchain deployment.\n');

  const proceed = await question('Continue? (y/n): ');
  if (proceed.toLowerCase() !== 'y') {
    console.log('Setup cancelled.');
    process.exit(0);
  }

  console.log('\n--- STEP 1: Wallet Configuration ---\n');
  console.log('You have two options:\n');
  console.log('1. Use Metamask (RECOMMENDED)');
  console.log('   - Install Metamask extension');
  console.log('   - Create/import wallet');
  console.log('   - Export private key from Settings > Security & Privacy\n');
  console.log('2. Use a test account (for development only)');
  console.log('   - Limited functionality');
  console.log('   - Not suitable for production\n');

  const walletType = await question('Which option? (1/2): ');

  let privateKey;
  if (walletType === '1') {
    privateKey = await question('Paste your Metamask private key (0x...): ');
  } else {
    console.log('\n⚠️  Test wallet option coming soon.\n');
    process.exit(0);
  }

  // Validate private key format
  if (!privateKey.startsWith('0x') || privateKey.length !== 66) {
    console.log('\n❌ Invalid private key format. Should be 0x followed by 64 hex characters.\n');
    process.exit(1);
  }

  console.log('\n--- STEP 2: Network Selection ---\n');
  console.log('1. Mumbai Testnet (RECOMMENDED for testing)');
  console.log('   - Free testnet MATIC from faucet');
  console.log('   - https://faucet.polygon.technology/\n');
  console.log('2. Polygon Mainnet (Production)');
  console.log('   - Requires real MATIC (~$1-2 per deployment)\n');

  const network = await question('Which network? (1/2): ');
  const networkName = network === '2' ? 'polygon-mainnet' : 'polygon-mumbai';

  console.log('\n--- STEP 3: Updating Configuration ---\n');

  // Read .env
  const envPath = path.join(__dirname, '..', '.env');
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Update WALLET_PRIVATE_KEY
  envContent = envContent.replace(
    /WALLET_PRIVATE_KEY=.*/,
    `WALLET_PRIVATE_KEY=${privateKey}`
  );

  // Update BLOCKCHAIN_NETWORK
  envContent = envContent.replace(
    /BLOCKCHAIN_NETWORK=.*/,
    `BLOCKCHAIN_NETWORK=${networkName}`
  );

  // Update ENABLE_BLOCKCHAIN
  envContent = envContent.replace(
    /ENABLE_BLOCKCHAIN=.*/,
    'ENABLE_BLOCKCHAIN=true'
  );

  fs.writeFileSync(envPath, envContent);
  console.log('✅ Updated .env file');

  console.log('\n--- STEP 4: Fund Wallet (if using testnet) ---\n');
  if (networkName === 'polygon-mumbai') {
    console.log('1. Go to: https://faucet.polygon.technology/');
    console.log('2. Select "Mumbai Testnet"');
    console.log('3. Paste your wallet address (from Metamask)');
    console.log('4. Request MATIC (wait for confirmation)\n');

    const funded = await question('Ready to deploy? (y/n): ');
    if (funded.toLowerCase() !== 'y') {
      console.log('Remember to fund wallet before deploying.');
      process.exit(0);
    }
  }

  console.log('\n--- STEP 5: Deploying Contract ---\n');
  console.log(`Deploying to ${networkName}...\n`);

  // Note: We'd run the actual deployment here, but that requires child_process
  console.log('Next steps:');
  console.log(`\n  npx hardhat run scripts/deploy-contract.js --network ${networkName}\n`);
  console.log('For details, see: BLOCKCHAIN_DEPLOYMENT_GUIDE.md\n');

  rl.close();
}

main().catch(console.error);
