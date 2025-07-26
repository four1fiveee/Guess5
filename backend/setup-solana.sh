#!/bin/bash

echo "🚀 Setting up Solana integration for Guess5 backend..."

# Install dependencies
echo "📦 Installing Solana dependencies..."
npm install

# Create wallets directory
echo "🔑 Creating wallet configuration..."
mkdir -p wallets

# Generate program authority keypair (if not exists)
if [ ! -f "wallets/program-authority.json" ]; then
    echo "🔐 Generating program authority keypair..."
    node -e "
    const { Keypair } = require('@solana/web3.js');
    const fs = require('fs');
    const keypair = Keypair.generate();
    fs.writeFileSync('wallets/program-authority.json', JSON.stringify(Array.from(keypair.secretKey)));
    console.log('Program Authority Public Key:', keypair.publicKey.toString());
    "
fi

# Generate fee wallet keypair (if not exists)
if [ ! -f "wallets/fee-wallet.json" ]; then
    echo "💰 Generating fee wallet keypair..."
    node -e "
    const { Keypair } = require('@solana/web3.js');
    const fs = require('fs');
    const keypair = Keypair.generate();
    fs.writeFileSync('wallets/fee-wallet.json', JSON.stringify(Array.from(keypair.secretKey)));
    console.log('Fee Wallet Public Key:', keypair.publicKey.toString());
    console.log('⚠️  IMPORTANT: Fund this wallet with SOL for fees!');
    "
fi

echo "✅ Solana setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Fund the fee wallet with SOL (for devnet testing)"
echo "2. Update FEE_WALLET_ADDRESS in config if needed"
echo "3. Deploy your smart contract to devnet"
echo "4. Test with real transactions!" 