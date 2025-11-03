# Smart Contract Deployment Commands

## Prerequisites
Make sure you have the following installed in your WSL Ubuntu environment:
- Node.js (v18 or higher)
- Rust (latest stable)
- Solana CLI tools
- Anchor CLI

## Step 1: Install Dependencies

```bash
# Navigate to the smart contract directory
cd backend/smart-contract

# Install Node.js dependencies
npm install

# Install Rust dependencies (if not already installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source ~/.cargo/env

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Install Anchor CLI
npm install -g @coral-xyz/anchor-cli@0.31.2
```

## Step 2: Generate New Program Keypair

```bash
# Navigate to smart contract directory
cd backend/smart-contract

# Generate new program keypair
solana-keygen new -o target/deploy/guess5_escrow-keypair.json --force
# Press Enter when prompted for passphrase (leave empty)

# Get the new program ID
solana address -k target/deploy/guess5_escrow-keypair.json
```

**IMPORTANT**: Copy the program ID that gets printed - you'll need it for the next steps.

## Step 3: Update Program ID in Source Code

```bash
# Update the program ID in the Rust source code
sed -i "s/GUESS5ESCROW1111111111111111111111111111/YOUR_NEW_PROGRAM_ID_HERE/g" programs/guess5-escrow/src/lib.rs

# Update the program ID in Anchor.toml
sed -i "s/GUESS5ESCROW1111111111111111111111111111/YOUR_NEW_PROGRAM_ID_HERE/g" Anchor.toml
```

Replace `YOUR_NEW_PROGRAM_ID_HERE` with the actual program ID from Step 2.

## Step 4: Set Up Solana Configuration

```bash
# Set Solana cluster to devnet
solana config set --url devnet

# Create a new keypair for deployment (if you don't have one)
solana-keygen new -o ~/.config/solana/id.json --force
# Press Enter when prompted for passphrase (leave empty)

# Set as default keypair
solana config set --keypair ~/.config/solana/id.json

# Check your balance (should be 0 initially)
solana balance

# Request airdrop for deployment
solana airdrop 2
```

## Step 5: Build the Smart Contract

```bash
# Navigate to smart contract directory
cd backend/smart-contract

# Clean any previous builds
anchor clean

# Build the program
anchor build

# Verify the build was successful
ls -la target/deploy/
```

## Step 6: Deploy to Devnet

```bash
# Deploy the program to devnet
anchor deploy --provider.cluster devnet

# Verify deployment
solana program show YOUR_NEW_PROGRAM_ID_HERE
```

Replace `YOUR_NEW_PROGRAM_ID_HERE` with your actual program ID.

## Step 7: Run Tests

```bash
# Run the test suite
anchor test --provider.cluster devnet

# If tests pass, you should see output like:
# ✓ Creates a match successfully
# ✓ Player1 deposits successfully  
# ✓ Player2 deposits successfully and match becomes active
# ✓ Settles match with Player1 winning
# ✓ Handles timeout refund correctly
```

## Step 8: Update Backend Configuration

```bash
# Navigate to backend directory
cd ../

# Create or update .env file with the new program ID
echo "SMART_CONTRACT_PROGRAM_ID=YOUR_NEW_PROGRAM_ID_HERE" >> .env
echo "RESULTS_ATTESTOR_PUBKEY=YOUR_RESULTS_ATTESTOR_PUBKEY" >> .env
echo "DEFAULT_FEE_BPS=500" >> .env
echo "DEFAULT_DEADLINE_BUFFER_SLOTS=1000" >> .env

# Generate a results attestor keypair
solana-keygen new -o results-attestor-keypair.json --force
# Press Enter when prompted for passphrase (leave empty)

# Get the results attestor public key
solana address -k results-attestor-keypair.json

# Update .env with the results attestor public key
sed -i "s/YOUR_RESULTS_ATTESTOR_PUBKEY/ACTUAL_RESULTS_ATTESTOR_PUBKEY/g" .env
```

## Step 9: Test Backend Integration

```bash
# Install backend dependencies
npm install

# Build the backend
npm run build

# Start the backend server
npm run dev
```

## Step 10: Verify Everything Works

```bash
# Test the smart contract integration
curl -X POST http://localhost:4000/api/match/create \
  -H "Content-Type: application/json" \
  -d '{
    "player1": "PLAYER1_WALLET_ADDRESS",
    "player2": "PLAYER2_WALLET_ADDRESS", 
    "entryFee": 0.1
  }'
```

## Troubleshooting

### If deployment fails:
```bash
# Check your SOL balance
solana balance

# Request more SOL if needed
solana airdrop 2

# Check if program already exists
solana program show YOUR_PROGRAM_ID

# If it exists, you may need to upgrade instead of deploy
anchor upgrade target/deploy/guess5_escrow.so --provider.cluster devnet
```

### If tests fail:
```bash
# Check the program is deployed correctly
solana program show YOUR_PROGRAM_ID

# Verify the program ID matches in all files
grep -r "YOUR_PROGRAM_ID" programs/guess5-escrow/src/
grep -r "YOUR_PROGRAM_ID" Anchor.toml
```

### If backend integration fails:
```bash
# Check environment variables
cat .env

# Verify the program ID is correct
node -e "console.log(process.env.SMART_CONTRACT_PROGRAM_ID)"

# Test Solana connection
node -e "
const { Connection } = require('@solana/web3.js');
const conn = new Connection('https://api.devnet.solana.com');
conn.getVersion().then(console.log);
"
```

## Success Indicators

✅ **Deployment successful** when you see: `Program deployed successfully`
✅ **Tests passing** when you see: `All tests passed`
✅ **Backend working** when you can create matches via API
✅ **Smart contract working** when deposits and settlements execute correctly

## Next Steps

Once everything is working on devnet:
1. Test with small amounts (0.001 SOL)
2. Verify all match scenarios work
3. Test timeout and refund functionality
4. When ready, deploy to mainnet using the same process but with `--provider.cluster mainnet`





