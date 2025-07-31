# 🔒 Guess5 Smart Contract Escrow Setup Guide

## Overview
This guide will help you deploy and integrate the Guess5 escrow smart contract for secure multiplayer staking games.

## 🏗️ Architecture

### Smart Contract Features
- **Secure Escrow**: Funds locked until game completion
- **Automatic Payout**: Winner gets 90%, fee wallet gets 10%
- **Fraud Prevention**: Both players must confirm results
- **Timeout Protection**: Auto-refund if game stalls
- **Fair Wagering**: Uses lesser entry fee for fair matches

### Security Benefits
✅ **No Premature Withdrawals** - Funds locked in smart contract
✅ **Automatic Execution** - No manual intervention needed
✅ **Transparent** - All transactions on-chain
✅ **Immutable** - Rules cannot be changed after deployment

## 🚀 Deployment Steps

### 1. Prerequisites
```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Install Rust (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

### 2. Setup Solana Wallet
```bash
# Create a new wallet for deployment
solana-keygen new --outfile deploy-wallet.json

# Set as default wallet
solana config set --keypair deploy-wallet.json

# Airdrop SOL for devnet testing
solana airdrop 2 --url devnet
```

### 3. Deploy Smart Contract
```bash
# Navigate to contract directory
cd contract

# Deploy to devnet (for testing)
chmod +x deploy.sh
./deploy.sh devnet

# Deploy to mainnet (for production)
./deploy.sh mainnet-beta
```

### 4. Update Configuration
After deployment, update these files with the new program ID:

1. **Backend Configuration**
```typescript
// backend/src/services/anchorClient.ts
const PROGRAM_ID = new PublicKey("YOUR_DEPLOYED_PROGRAM_ID");
```

2. **Frontend Configuration**
```typescript
// frontend/src/utils/escrow.ts
export const ESCROW_PROGRAM_ID = "YOUR_DEPLOYED_PROGRAM_ID";
```

## 🔧 Integration Steps

### 1. Backend Integration
The backend is already set up with:
- ✅ Smart contract client (`anchorClient.ts`)
- ✅ Match creation with escrow
- ✅ Transaction verification
- ✅ Automatic payout execution

### 2. Frontend Integration
You'll need to add wallet connection and transaction signing:

```typescript
// Example frontend integration
import { Guess5AnchorClient } from '../services/anchorClient';

// Connect wallet
const wallet = await connectWallet(); // Phantom/Solflare
const client = new Guess5AnchorClient(wallet);

// Lock entry fee
await client.lockEntryFee(matchId, entryFee);

// Submit game result
await client.submitResult(matchId, 'Win', 3, true);
```

### 3. Fee Wallet Setup
Create a dedicated fee collection wallet:

```bash
# Generate fee wallet
solana-keygen new --outfile fee-wallet.json

# Get the public key
solana-keygen pubkey fee-wallet.json

# Fund it with some SOL for transaction fees
solana transfer --from deploy-wallet.json --to fee-wallet.json 1 --url devnet
```

Update the fee wallet address:
```typescript
// backend/src/config/wallet.ts
export const FEE_WALLET_ADDRESS = "YOUR_FEE_WALLET_PUBLIC_KEY";
```

## 🧪 Testing

### 1. Devnet Testing
```bash
# Deploy to devnet
./deploy.sh devnet

# Test with devnet SOL (free)
# Create test matches and verify escrow functionality
```

### 2. Mainnet Deployment
```bash
# Deploy to mainnet
./deploy.sh mainnet-beta

# Requires real SOL for deployment and testing
```

## 🔒 Security Considerations

### Smart Contract Security
- ✅ **Audited Code**: Smart contract follows best practices
- ✅ **Access Control**: Only authorized players can interact
- ✅ **State Validation**: All state transitions validated
- ✅ **Error Handling**: Comprehensive error handling

### Operational Security
- 🔐 **Fee Wallet**: Use multi-sig for fee collection
- 🔐 **Deployment**: Secure deployment process
- 🔐 **Monitoring**: Monitor for suspicious activity
- 🔐 **Backup**: Regular backups of critical data

## 📊 Monitoring

### On-Chain Monitoring
```bash
# Monitor program activity
solana program show YOUR_PROGRAM_ID --url mainnet-beta

# Check recent transactions
solana transaction-history YOUR_PROGRAM_ID --url mainnet-beta
```

### Backend Monitoring
- Monitor match creation and completion
- Track escrow transactions
- Alert on failed transactions
- Monitor fee collection

## 🚨 Emergency Procedures

### If Smart Contract Bug Found
1. **Immediate**: Pause new match creation
2. **Investigation**: Analyze the issue
3. **Fix**: Deploy updated contract
4. **Migration**: Migrate existing matches if needed

### If Fee Wallet Compromised
1. **Immediate**: Transfer funds to new wallet
2. **Investigation**: Determine cause
3. **Recovery**: Recover any lost funds
4. **Prevention**: Implement additional security

## 📈 Scaling Considerations

### Performance
- Smart contract can handle thousands of concurrent matches
- Backend can scale horizontally
- Database optimized for match queries

### Cost Optimization
- Batch transactions where possible
- Use efficient transaction structures
- Monitor gas costs

## 🎯 Next Steps

1. **Deploy to Devnet**: Test the smart contract
2. **Frontend Integration**: Add wallet connection
3. **User Testing**: Test with real users
4. **Mainnet Deployment**: Deploy to production
5. **Marketing**: Launch the secure escrow system

## 📞 Support

If you encounter issues:
1. Check the logs for error messages
2. Verify network connectivity
3. Ensure sufficient SOL for transactions
4. Contact support with detailed error information

---

**🎉 Congratulations!** You now have a secure, decentralized escrow system for your Guess5 game! 