# Quick Start Guide - Smart Contract Integration

## What I Fixed

✅ **Fixed Program ID mismatch** - Updated all services to use the correct program ID: `rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X`

✅ **Fixed PDA generation** - Now using proper 8-byte serialization instead of strings

✅ **Fixed account structure** - Updated instructions to match the smart contract's expected account order

✅ **Fixed signing** - Only the payer/fee wallet signs now, not the players

## What Still Needs to be Done

❌ **Program ID Mismatch Error** - The smart contract needs to be redeployed to match the source code

## Current Status

- ✅ Connection to devnet works
- ✅ Fee wallet has SOL (1.97 SOL)
- ✅ PDA generation works correctly
- ❌ Smart contract call fails with "DeclaredProgramIdMismatch" error

## Next Steps (Choose One)

### Option 1: Redeploy the Smart Contract (Recommended)

```bash
cd backend/guess5-escrow

# 1. Build the smart contract
anchor build

# 2. Generate a new program keypair
solana-keygen new -o target/deploy/guess5_escrow-keypair.json --force

# 3. Get the new program ID
NEW_PROGRAM_ID=$(solana address -k target/deploy/guess5_escrow-keypair.json)
echo "New Program ID: $NEW_PROGRAM_ID"

# 4. Update lib.rs with the new program ID
# Edit programs/guess5-escrow/src/lib.rs line 4

# 5. Update Anchor.toml with the new program ID
# Edit lines 9 and 12 in Anchor.toml

# 6. Rebuild and deploy
anchor build
anchor deploy --provider.cluster devnet

# 7. Test the integration
cd ..
node test-smart-contract-only.js
```

### Option 2: Find and Use the Existing Program ID

If you don't want to redeploy, you'll need to find the actual deployed program ID and update your source code to match it. This is more complex.

## Files Modified

- `backend/src/services/manualSolanaClient.ts` - Fixed PDA generation and account structure
- `backend/src/services/manualSolanaClient.js` - Fixed program ID and account structure
- `backend/src/services/simpleSmartContractService.js` - Fixed program ID

## Test Scripts Created

- `backend/test-smart-contract-only.js` - Tests without airdrop (recommended)
- `backend/test-integration-simple.js` - Full integration test
- `backend/debug-test.js` - Basic connection test
- `backend/find-correct-program-id.js` - Helps find the correct program ID

## Environment Variables

Make sure these are set in your `.env` file:

```
FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
FEE_WALLET_PRIVATE_KEY=27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe
PROGRAM_ID=rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X
SMART_CONTRACT_PROGRAM_ID=rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X
SOLANA_NETWORK=https://api.devnet.solana.com
```

## What the Smart Contract Does

Once working, the smart contract will:

1. **Create Match** - Both players are specified, creates escrow accounts
2. **Player Deposits** - Each player deposits their entry fee into the vault
3. **Match Activation** - Automatically activates when both players deposit
4. **Settlement** - Distributes funds to winner and fee wallet, or refunds in error cases

## Need Help?

If you get stuck:

1. Check the fee wallet has enough SOL for transactions
2. Make sure the program ID in the source code matches the deployed program
3. Run `node test-smart-contract-only.js` to see detailed error messages

Good luck! 🚀


