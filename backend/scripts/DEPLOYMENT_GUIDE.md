# Guess5 Smart Contract Devnet Deployment Guide

## Overview

This guide provides multiple approaches to deploy your Guess5 smart contract to the Solana devnet. The smart contract handles all game outcomes including edge cases as described in the game documentation.

## Prerequisites

### Required Software
- **Solana CLI**: For blockchain interaction
- **Anchor Framework**: For smart contract development and deployment
- **Rust**: For compiling the smart contract
- **Node.js**: For running deployment scripts

### Installation Commands

#### 1. Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Restart terminal after installation
```

#### 2. Install Solana CLI
```bash
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"
```

#### 3. Install Anchor Framework
```bash
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

## Deployment Options

### Option 1: Automated Deployment Script (Recommended)

#### For Linux/WSL:
```bash
cd backend/scripts
node deploy-devnet.js
```

#### For Windows:
```cmd
cd backend\scripts
deploy-devnet-windows.bat
```

#### For Windows PowerShell:
```powershell
cd backend\scripts
.\deploy-devnet-windows.ps1
```

### Option 2: Manual Step-by-Step Deployment

#### Step 1: Setup Devnet Configuration
```bash
# Set devnet RPC
solana config set --url https://api.devnet.solana.com

# Check wallet
solana config get

# Create wallet if needed
solana-keygen new --outfile ~/.config/solana/id.json

# Get devnet SOL
solana airdrop 2
```

#### Step 2: Build Smart Contract
```bash
cd backend/smart-contract
anchor build
```

#### Step 3: Deploy to Devnet
```bash
anchor deploy --provider.cluster devnet
```

#### Step 4: Generate Results Attestor
```bash
solana-keygen new --outfile ~/.config/solana/results-attestor.json
solana-keygen pubkey ~/.config/solana/results-attestor.json
```

### Option 3: Simplified Setup (Environment Only)

If you're having build issues, use this to set up the environment:

```bash
cd backend/scripts
node deploy-devnet-simple.js
```

This will:
- Configure devnet
- Generate results attestor
- Create environment configuration
- Skip the build step

## Environment Configuration

### Backend Environment Variables (Render)

Add these to your Render backend environment:

```env
# Smart Contract Configuration
SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
RESULTS_ATTESTOR_PUBKEY=YourResultsAttestorPubkey
RESULTS_ATTESTOR_PRIVATE_KEY=YourResultsAttestorPrivateKey
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000

# Solana Network Configuration
SOLANA_NETWORK=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet
```

### Frontend Environment Variables (Vercel)

Add these to your Vercel frontend environment:

```env
# Smart Contract Integration
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
```

## Smart Contract Features

### Game Outcomes Handled

1. **Player Wins** (Fee Applied)
   - Player1 wins: 95% to winner, 5% fee to platform
   - Player2 wins: 95% to winner, 5% fee to platform

2. **Winner Tie** (Gas Fee Only)
   - Both players solve correctly: refund minus gas fee

3. **Losing Tie** (Fee Applied)
   - Neither player solves: 95% refund to each, 5% fee from each

4. **Timeout** (Gas Fee Only)
   - Game deadline passes: refund minus gas fee

5. **Error/Abandoned** (Gas Fee Only)
   - Technical issues: refund minus gas fee

### Edge Cases Handled

- **Partial Deposits**: Only one player deposits
- **Double Deposits**: Prevented by smart contract
- **Unauthorized Settlement**: Only attestor can settle
- **Deadline Validation**: Automatic refunds after deadline
- **Insufficient Funds**: Minimum stake requirements

## Troubleshooting

### Common Build Issues

#### 1. Solana Toolchain Missing
```bash
# Install Solana toolchain
sh -c "$(curl -sSfL https://release.solana.com/v1.18.4/install)"

# Or use Windows installer
# Download from: https://github.com/solana-labs/solana/releases/latest
```

#### 2. Rust Not Found
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env
```

#### 3. Anchor Not Found
```bash
# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

#### 4. WSL Build Issues
If you're having persistent issues in WSL:
- Use the Windows deployment scripts instead
- Or run the simplified setup script

### Deployment Issues

#### 1. Insufficient Funds
```bash
# Check balance
solana balance

# Request airdrop
solana airdrop 2
```

#### 2. Network Connection Issues
```bash
# Check RPC endpoint
solana config get

# Set devnet
solana config set --url https://api.devnet.solana.com
```

#### 3. Program ID Mismatch
- Ensure the program ID in `Anchor.toml` matches the deployed contract
- Update environment variables with the correct program ID

## Testing

### 1. Smart Contract Tests
```bash
cd backend/smart-contract
anchor test
```

### 2. Integration Testing
- Test match creation with small amounts (0.001 SOL)
- Test player deposits
- Test all game outcomes
- Test timeout scenarios
- Test error handling

### 3. Monitoring
Monitor your contract on Solana Explorer:
```
https://explorer.solana.com/?cluster=devnet
```

## Security Considerations

### 1. Results Attestor
- Store the private key securely
- Consider multisig setup for production
- Monitor attestor activity

### 2. Testing
- Always test with small amounts first
- Test all edge cases thoroughly
- Monitor for unexpected behavior

### 3. Production Deployment
- Gradual rollout with small amounts
- Comprehensive testing before mainnet
- Have rollback procedures ready

## Next Steps After Deployment

1. **Update Environment Variables**: Add the generated values to Render and Vercel
2. **Run Database Migration**: `npm run migration:run`
3. **Test Integration**: Create test matches with small amounts
4. **Monitor System**: Watch for errors and performance issues
5. **User Testing**: Test with real users and gather feedback
6. **Mainnet Preparation**: When ready, repeat process for mainnet

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review the error messages carefully
3. Check Solana and Anchor documentation
4. Ensure all prerequisites are properly installed
5. Try the simplified setup script if build issues persist

## Files Created

- `.env.devnet`: Environment configuration
- `~/.config/solana/results-attestor.json`: Results attestor keypair
- `target/deploy/`: Built smart contract binaries

## Important Notes

- **Never share private keys**
- **Test thoroughly before mainnet**
- **Monitor the system continuously**
- **Keep backups of all configuration**
- **Document any customizations**

---

**Remember**: Start with devnet testing, then gradually move to mainnet with small amounts before full production deployment.


