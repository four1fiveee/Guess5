#!/bin/bash

# Guess5 Escrow Smart Contract Deployment Script
echo "🚀 Deploying Guess5 Escrow Smart Contract..."

# Check if Anchor is installed
if ! command -v anchor &> /dev/null; then
    echo "❌ Anchor CLI not found. Please install Anchor first:"
    echo "   sh -c \"\$(curl -sSfL https://release.solana.com/stable/install)\""
    echo "   cargo install --git https://github.com/coral-xyz/anchor avm --locked --force"
    exit 1
fi

# Set network (devnet for testing, mainnet-beta for production)
NETWORK=${1:-devnet}
echo "🌐 Deploying to: $NETWORK"

# Build the program
echo "🔨 Building program..."
anchor build

# Use the correct program ID (the one that's actually deployed)
PROGRAM_ID="bmUnEvC6W4JDLG6vdqbTJX73wECTeUZAWgptmNuabd1"
echo "🔑 Program ID: $PROGRAM_ID"

# Update the program ID in lib.rs to match the deployed contract
echo "📝 Updating program ID in lib.rs..."
sed -i "s/declare_id!(\".*\")/declare_id!(\"$PROGRAM_ID\")/" programs/guess5/src/lib.rs

# Rebuild with correct program ID
echo "🔨 Rebuilding with correct program ID..."
anchor build

# Deploy to the network
echo "🚀 Deploying to $NETWORK..."
anchor deploy --provider.cluster $NETWORK

# Verify deployment
echo "✅ Verifying deployment..."
solana program show $PROGRAM_ID --url $NETWORK

echo "🎉 Deployment complete!"
echo "📋 Program ID: $PROGRAM_ID"
echo "🌐 Network: $NETWORK"
echo ""
echo "🔧 Next steps:"
echo "1. Update the PROGRAM_ID in backend/src/services/anchorClient.ts"
echo "2. Update the program ID in the frontend wallet integration"
echo "3. Test the escrow functionality on $NETWORK" 