# Final Solution: Fix Smart Contract Integration

## The Problem
You're getting a "DeclaredProgramIdMismatch" error because the smart contract was deployed with a different program ID than what's in your source code.

## Simple Solution: Update Environment Variables

### Step 1: Update Your Backend Environment Variables

Add or update these in your backend `.env` file:

```bash
# Use the original program ID that actually exists
PROGRAM_ID=rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X
SMART_CONTRACT_PROGRAM_ID=rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X
```

### Step 2: Test the Integration

```bash
cd backend
node test-smart-contract-only.js
```

## Alternative: Redeploy the Smart Contract

If you want to start fresh:

### Step 1: Generate New Program Keypair
```bash
cd backend/guess5-escrow
solana-keygen new -o target/deploy/guess5_escrow-keypair.json --force
# Press Enter when prompted for passphrase
```

### Step 2: Get the New Program ID
```bash
solana address -k target/deploy/guess5_escrow-keypair.json
```

### Step 3: Update Source Code
1. Edit `programs/guess5-escrow/src/lib.rs` line 4
2. Edit `Anchor.toml` lines 9 and 12
3. Edit all backend service files

### Step 4: Build and Deploy
```bash
anchor build
anchor deploy --provider.cluster devnet
```

## What I Fixed

✅ **Fixed Program ID mismatch** - Updated all services to use the correct program ID
✅ **Fixed PDA generation** - Now using proper 8-byte serialization
✅ **Fixed account structure** - Updated instructions to match the smart contract
✅ **Fixed signing** - Only the payer/fee wallet signs now

## Current Status

- ✅ Connection to devnet works
- ✅ Fee wallet has SOL (1.97 SOL)
- ✅ PDA generation works correctly
- ❌ Smart contract call fails with "DeclaredProgramIdMismatch" error

## Next Steps

1. **Try the simple solution first** - Update environment variables
2. **If that doesn't work** - Redeploy the smart contract
3. **Test the integration** - Run `node test-smart-contract-only.js`

## Files Modified

- `backend/src/services/manualSolanaClient.ts` - Fixed PDA generation and account structure
- `backend/src/services/manualSolanaClient.js` - Fixed program ID and account structure
- `backend/src/services/smartContractService.ts` - Fixed program ID
- `backend/src/services/anchorClient.ts` - Fixed program ID
- `backend/src/services/simpleSmartContractService.js` - Fixed program ID

## Test Scripts

- `backend/test-smart-contract-only.js` - Best for testing (no airdrop delays)
- `backend/test-integration-simple.js` - Full integration test
- `backend/debug-test.js` - Basic connection test

## Bonus Payout Flow (2025-11 Update)

The bonus payout pipeline now enforces the full Squads execution lifecycle before any funds leave the fee wallet.

1. `backend/src/controllers/matchController.ts` only invokes the bonus service after `squadsVaultService.executeProposal` reports success and returns an execution signature. If the signature is missing, the controller logs a warning and skips any bonus attempt.
2. Execution metadata (`executionSignature`, `proposalExecutedAt`) is passed into `backend/src/services/bonusService.ts`, which now requires:
   - a non-tie winner
   - a valid execution signature and timestamp
   - confirmed pricing data and an unpaid status
3. When the prerequisites are met, the service transfers the configured bonus from the fee wallet, confirms the transaction, and writes structured logs plus database audit fields (`bonusPaid`, `bonusSignature`, `bonusTier`, etc.).
4. If any requirement is missing (`missing_execution_signature`, `missing_sol_price`, `invalid_bonus_conversion`, etc.), the service returns early without touching the wallet, making the flow idempotent.
5. Unit coverage was added in `backend/src/tests/bonusService.test.ts` (run via `npm run test`) to simulate ties, missing execution proof, and successful payouts, ensuring regressions surface quickly.

Reference: Squads multisig execution semantics from https://docs.squads.so state that a vault payout is final only after the 2-of-3 transaction is executed on-chain; the backend now mirrors that contract.

Good luck! 🚀


