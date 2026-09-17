/**
 * Deployment Script for FileRegistry Contract
 * Run: npx hardhat run scripts/deploy-contract.js --network polygon-mainnet
 */

const hre = require('hardhat');
const fs = require('fs');
const path = require('path');

async function main() {
    console.log('🚀 Deploying FileRegistry contract to Polygon...');

    try {
        // Get deployer account
        const [deployer] = await hre.ethers.getSigners();
        console.log(`📝 Deploying with account: ${deployer.address}`);

        // Get account balance
        const balance = await hre.ethers.provider.getBalance(deployer.address);
        console.log(`💰 Account balance: ${hre.ethers.formatEther(balance)} MATIC`);

        // Check if we have enough balance
        if (balance === 0n) {
            throw new Error('Insufficient balance. Please fund the account with MATIC.');
        }

        // Deploy FileRegistry contract
        console.log('\n📦 Compiling FileRegistry...');
        const FileRegistry = await hre.ethers.getContractFactory('FileRegistry');

        console.log('🔧 Deploying...');
        const contract = await FileRegistry.deploy();

        console.log('⏳ Waiting for deployment confirmation...');
        await contract.waitForDeployment();

        const deploymentAddress = await contract.getAddress();
        console.log(`✅ FileRegistry deployed to: ${deploymentAddress}`);

        // Get deployment transaction
        const deploymentTx = contract.deploymentTransaction();
        if (deploymentTx) {
            console.log(`📋 Transaction hash: ${deploymentTx.hash}`);
            const receipt = await deploymentTx.wait();
            console.log(`📍 Block number: ${receipt.blockNumber}`);
        }

        // Save deployment info
        const deploymentInfo = {
            contractAddress: deploymentAddress,
            deployedAt: new Date().toISOString(),
            deployer: deployer.address,
            network: hre.network.name,
            chainId: (await hre.ethers.provider.getNetwork()).chainId
        };

        const deploymentPath = path.join(__dirname, '../.deployment.json');
        fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));
        console.log(`\n💾 Deployment info saved to .deployment.json`);

        // Update config/blockchain.js with contract address
        const blockchainConfigPath = path.join(__dirname, '../config/blockchain.js');
        let configContent = fs.readFileSync(blockchainConfigPath, 'utf-8');

        // Update the BLOCKCHAIN_CONFIG contractAddress
        configContent = configContent.replace(
            /contractAddress: process\.env\.FILEREGISTRY_ADDRESS \|\| null/,
            `contractAddress: process.env.FILEREGISTRY_ADDRESS || '${deploymentAddress}'`
        );

        fs.writeFileSync(blockchainConfigPath, configContent);
        console.log('✅ Updated config/blockchain.js with contract address');

        // Update .env file
        const envPath = path.join(__dirname, '../.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf-8');

            if (envContent.includes('FILEREGISTRY_ADDRESS=')) {
                envContent = envContent.replace(
                    /FILEREGISTRY_ADDRESS=.*/,
                    `FILEREGISTRY_ADDRESS=${deploymentAddress}`
                );
            } else {
                envContent += `\nFILEREGISTRY_ADDRESS=${deploymentAddress}`;
            }

            fs.writeFileSync(envPath, envContent);
            console.log('✅ Updated .env file with contract address');
        }

        console.log('\n🎉 Deployment successful!');
        console.log(`\n📌 Next steps:`);
        console.log(`1. Copy the contract address: ${deploymentAddress}`);
        console.log(`2. Add to .env: FILEREGISTRY_ADDRESS=${deploymentAddress}`);
        console.log(`3. Verify on PolygonScan: https://polygonscan.com/address/${deploymentAddress}`);
        console.log(`4. Run: npm start`);

        return deploymentAddress;
    } catch (error) {
        console.error('\n❌ Deployment failed:');
        console.error(error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
