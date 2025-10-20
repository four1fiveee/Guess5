# Program ID Mismatch Fix Guide

## The Issue
You're getting a "DeclaredProgramIdMismatch" error because the smart contract was deployed with a different program ID than what's in your current source code.

## Solution: Redeploy the Smart Contract

Since you have authority over the fee wallet and can deploy, here's how to redeploy:

### Step 1: Build the Smart Contract
```bash
cd backend/guess5-escrow
anchor build
```

### Step 2: Deploy to Devnet with Your Wallet
```bash
anchor deploy --provider.cluster devnet --provider.wallet /home/four1five/.config/solana/id.json
```

If that fails with an authority error, try:

### Step 3: Deploy as a New Program
```bash
# Generate a new program keypair
solana-keygen new -o target/deploy/guess5_escrow-keypair.json --force

# Get the new program ID
solana address -k target/deploy/guess5_escrow-keypair.json

# This will give you a NEW program ID (e.g., "ABC...xyz")
```

### Step 4: Update Your Source Code with the New Program ID

1. Open `programs/guess5-escrow/src/lib.rs`
2. Change line 4 from:
   ```rust
   declare_id!("rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X");
   ```
   To the NEW program ID you got from Step 3

3. Open `Anchor.toml`
4. Update the program ID on lines 9 and 12

### Step 5: Rebuild and Deploy
```bash
anchor build
anchor deploy --provider.cluster devnet
```

### Step 6: Update Your Backend Environment Variables
Add or update these in your backend `.env` file:
```
PROGRAM_ID=<YOUR_NEW_PROGRAM_ID>
SMART_CONTRACT_PROGRAM_ID=<YOUR_NEW_PROGRAM_ID>
```

### Step 7: Test Again
```bash
cd ..
node test-smart-contract-only.js
```

## Alternative: Use the Existing Program

If you don't want to redeploy, you need to find the actual deployed program ID and update your code to use it. However, this is more complex and I recommend redeploying instead.

## Need Help?

If you run into any issues:
1. Make sure your wallet has enough SOL for deployment
2. Make sure you're using the correct wallet file
3. Check that Anchor is properly installed

The commands above should work if run from the terminal.


