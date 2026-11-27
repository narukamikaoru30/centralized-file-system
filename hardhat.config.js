require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/**
 * Hardhat Configuration
 * Compiles and deploys FileRegistry.sol to Polygon Mainnet
 */

module.exports = {
    solidity: {
        version: '0.8.19',
        settings: {
            optimizer: {
                enabled: true,
                runs: 200
            }
        }
    },
    networks: {
        'polygon-mainnet': {
            url: process.env.BLOCKCHAIN_RPC_URL || process.env.POLYGON_RPC_URL,
            accounts: process.env.WALLET_PRIVATE_KEY ? [process.env.WALLET_PRIVATE_KEY] : [],
            chainId: 137
        },
        'polygon-amoy': {
            url: process.env.BLOCKCHAIN_RPC_URL || process.env.POLYGON_AMOY_RPC_URL,
            accounts: process.env.WALLET_PRIVATE_KEY ? [process.env.WALLET_PRIVATE_KEY] : [],
            chainId: 80002
        }
    },
    paths: {
        sources: './contracts',
        artifacts: './artifacts',
        cache: './cache'
    },
    etherscan: {
        apiKey: process.env.POLYGONSCAN_API_KEY || ''
    }
};
