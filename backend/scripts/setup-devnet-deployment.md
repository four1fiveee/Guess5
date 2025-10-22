# Devnet Deployment Setup Guide

## Prerequisites Installation

### 1. Install Solana CLI (Windows)

**Option A: PowerShell Installation**
```powershell
# Run as Administrator
cmd /c "curl https://release.solana.com/v1.18.4/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install-init.exe --silent --show-error"
C:\solana-install-init.exe v1.18.4
```

**Option B: Manual Download**
1. Visit: https://github.com/solana-labs/solana/releases/latest
2. Download `solana-install-init-x86_64-pc-windows-msvc.exe`
3. Run the installer

### 2. Install Rust (if not installed)
```powershell
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
# Restart terminal after installation
```

### 3. Install Anchor Framework
```powershell
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install latest
avm use latest
```

### 4. Verify Installation
```powershell
solana --version
anchor --version
```

## Devnet Configuration

### 1. Set Solana to Devnet
```powershell
solana config set --url https://api.devnet.solana.com
```

### 2. Create a New Wallet (if needed)
```powershell
solana-keygen new --outfile ~/.config/solana/id.json
```

### 3. Get Devnet SOL
```powershell
solana airdrop 2
```

### 4. Check Balance
```powershell
solana balance
```

## Smart Contract Deployment

### 1. Navigate to Smart Contract Directory
```powershell
cd backend/smart-contract
```

### 2. Build the Contract
```powershell
anchor build
```

### 3. Deploy to Devnet
```powershell
anchor deploy --provider.cluster devnet
```

### 4. Note the Program ID
The deployment will output a Program ID like: `7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU`

### 5. Generate Results Attestor
```powershell
solana-keygen new --outfile ~/.config/solana/results-attestor.json
```

### 6. Get Results Attestor Public Key
```powershell
solana-keygen pubkey ~/.config/solana/results-attestor.json
```

## Environment Variables Setup

### Backend (Render) - Add These Variables:
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

### Frontend (Vercel) - Add These Variables:
```env
# Smart Contract Integration
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
```

## Testing the Deployment

### 1. Run Smart Contract Tests
```powershell
cd backend/smart-contract
anchor test
```

### 2. Test Backend Integration
```powershell
# Test match creation
curl -X POST https://api.guess5.io/api/matches/create \
  -H "Content-Type: application/json" \
  -d '{"entryFee": 0.001}'
```

### 3. Monitor on Solana Explorer
Visit: https://explorer.solana.com/?cluster=devnet
Search for your Program ID to see the deployed contract

## Next Steps After Devnet Testing

1. **Test thoroughly** with small amounts (0.001 SOL)
2. **Verify all game outcomes** work correctly
3. **Monitor for 24-48 hours**
4. **When ready for mainnet**, repeat the process with:
   - `solana config set --url https://api.mainnet-beta.solana.com`
   - `anchor deploy --provider.cluster mainnet-beta`
   - Update environment variables to use mainnet URLs

## Troubleshooting

### Common Issues:
1. **"solana not found"**: Restart terminal after installation
2. **"anchor not found"**: Make sure Rust is installed and avm is configured
3. **Insufficient funds**: Run `solana airdrop 2` to get devnet SOL
4. **Build errors**: Make sure you're in the correct directory (`backend/smart-contract`)

### Getting Help:
- Solana Docs: https://docs.solana.com/cli/install-solana-cli-tools
- Anchor Docs: https://www.anchor-lang.com/docs/installation
- Solana Explorer: https://explorer.solana.com/




















