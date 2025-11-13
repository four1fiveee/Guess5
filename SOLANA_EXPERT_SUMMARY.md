# Solana Squads Multisig Vault Execution Issue - Expert Consultation

## Objective
We are building a 2-player game where both players deposit SOL into a Squads Protocol 2-of-3 multisig vault. When the game ends (timeout or completion), we need to:
1. Create a proposal to transfer funds from the vault to players (winner payout or tie refund)
2. Collect signatures from both players (2 signatures required for 2-of-3 multisig)
3. Execute the proposal to release funds from the vault to players and fee wallet

## Architecture
- **Multisig Configuration**: 2-of-3 multisig (Player 1, Player 2, Fee Wallet)
- **Network**: Solana Devnet
- **Squads SDK**: `@sqds/multisig` (latest version)
- **Vault Structure**: Each match has its own multisig vault created via `vaultTransactionCreate`

## Current Flow

### 1. Proposal Creation (`proposeTieRefund` or `proposeWinnerPayout`)
- Creates a Squads transaction proposal using `transactions.vaultTransactionCreate`
- Transaction includes:
  - Transfers from vault PDA to players (if vault has funds)
  - Top-up transfers from fee wallet to players (if vault balance is insufficient)
- Proposal is created with `transactionIndex` fetched from on-chain multisig account
- Returns `proposalId` (which is the `transactionIndex`)

### 2. Signature Collection (`signProposalHandler`)
- Frontend calls `/api/match/sign-proposal` with signed approval transaction
- Backend verifies the signature and updates database
- When 2 signatures are collected (threshold met), backend attempts auto-execution

### 3. Proposal Execution (`executeProposal`)
- Uses `transactions.vaultTransactionExecute` to execute the proposal
- Executor is the fee wallet keypair
- Checks proposal status before execution (Approved vs ExecuteReady)
- Builds execution transaction with priority fees
- Sends transaction via `connection.sendRawTransaction`

## The Problem

### Symptoms
1. **Proposals are created successfully** - We see `proposalId` returned
2. **Signatures are collected successfully** - Both players sign, database shows 2 signatures
3. **Execution attempts are made** - Backend logs show execution attempts
4. **Execution fails with "Simulation failed"** - `SendTransactionError: Simulation failed`
5. **Funds are NOT released** - Vault balance remains unchanged, players don't receive funds
6. **Vault balance is often 0** - Even though players deposited, vault shows 0 balance

### Error Details
- Error: `SendTransactionError: Simulation failed`
- Simulation error details are not being captured in logs (we just added better logging)
- Execution transaction simulation fails before it's even sent to the network
- The proposal shows as "Approved" with 2 signatures, but execution fails

### Key Observations
1. **Vault Balance Issue**: Vault balance is 0 even after player deposits. This suggests:
   - Deposits might not be going to the correct vault PDA
   - Or vault PDA derivation is incorrect
   - Or funds are being transferred somewhere else

2. **Top-up Instructions**: When vault balance is 0, proposals include top-up instructions from fee wallet:
   ```typescript
   SystemProgram.transfer({
     fromPubkey: this.config.systemPublicKey, // Fee wallet
     toPubkey: playerKey,
     lamports: Number(player1TopUpBig),
   })
   ```
   These instructions are included in the proposal transaction.

3. **Signature Flow**: 
   - Players sign approval transactions via frontend (Phantom wallet)
   - Backend receives signed transactions and verifies them
   - When threshold is met, backend attempts execution with fee wallet keypair

4. **Execution Transaction**: 
   - Uses `transactions.vaultTransactionExecute` from Squads SDK
   - Executor is fee wallet keypair
   - Transaction includes priority fees via `ComputeBudgetProgram.setComputeUnitPrice`

## What We've Tried

1. **Blockhash Management**: 
   - Fetch fresh blockhash immediately before building transaction
   - Check block height before sending
   - Retry with fresh blockhash on failures

2. **Priority Fees**: 
   - Added `ComputeBudgetProgram.setComputeUnitPrice` with 50,000 microLamports
   - Increased fees with exponential backoff on retries

3. **Proposal Status Checks**: 
   - Check both Proposal and VaultTransaction account status
   - Execute from "Approved" state (Squads docs say this is allowed)
   - Wait for ExecuteReady transition (removed blocking wait)

4. **Transaction Structure**: 
   - Build transaction once with priority fee included
   - Avoid multiple rebuilds that could corrupt structure
   - Use `skipPreflight: false` for better error detection

5. **Error Handling**: 
   - Improved error logging to capture simulation details
   - Check transaction status after confirmation timeouts
   - Retry with fresh blockhash on block height exceeded errors

## Questions for Solana Expert

1. **Vault Balance Issue**: 
   - Why would vault balance be 0 after player deposits?
   - How should we verify that deposits are going to the correct vault PDA?
   - Should we check the vault PDA balance before creating proposals?

2. **Proposal Execution**:
   - What causes "Simulation failed" errors in Squads proposal execution?
   - Are there specific account requirements or state transitions needed?
   - Should the executor (fee wallet) be a member of the multisig? (It is - it's one of the 3 signers)

3. **Top-up Instructions**:
   - When vault balance is 0, we include top-up transfers from fee wallet in the proposal
   - These are regular `SystemProgram.transfer` instructions
   - Should these be signed by the fee wallet? How does Squads handle instructions that require additional signers?

4. **Signature Collection**:
   - Players sign approval transactions via frontend
   - Backend verifies and stores signatures in database
   - When threshold is met, backend executes with fee wallet
   - Is this the correct flow? Should execution happen differently?

5. **Transaction Structure**:
   - We're using `transactions.vaultTransactionExecute` from Squads SDK
   - Are there any specific requirements for the execution transaction?
   - Should we be using a different method or approach?

6. **Common Pitfalls**:
   - What are common mistakes when executing Squads proposals?
   - Are there account ownership issues we should check?
   - Should we verify the proposal transaction message matches what was originally proposed?

## Technical Details

### Proposal Creation Code
```typescript
const { transactionMessage, transactionIndex } = await transactions.vaultTransactionCreate({
  connection: this.connection,
  blockhash: blockhash2,
  feePayer: this.config.systemPublicKey,
  multisigPda: multisigAddress,
  transactionMessage: transactionMessage, // Contains transfer instructions
  programId: this.programId,
});
```

### Execution Code
```typescript
const baseTx = await transactions.vaultTransactionExecute({
  connection: this.connection,
  blockhash: latestBlockhash.blockhash,
  feePayer: executor.publicKey,
  multisigPda: multisigAddress,
  transactionIndex,
  member: executor.publicKey,
  programId: this.programId,
});
```

### Multisig Configuration
- Threshold: 2
- Members: [Player1, Player2, FeeWallet]
- Program ID: Squads Protocol program ID (same for devnet/mainnet per docs)

## Expected Behavior
1. Players deposit SOL to vault deposit address
2. Vault balance increases
3. Game ends, proposal is created with transfer instructions
4. Both players sign the proposal
5. Backend executes proposal with fee wallet
6. Funds are transferred from vault to players
7. If vault balance insufficient, top-up from fee wallet completes the transfers

## Actual Behavior
1. Players deposit SOL (appears successful)
2. Vault balance shows 0 (unexpected)
3. Proposal is created with top-up instructions
4. Both players sign (confirmed in database)
5. Execution fails with "Simulation failed"
6. Funds never leave vault or fee wallet

## Environment
- Solana Network: Devnet
- Squads SDK: `@sqds/multisig` (latest)
- Node.js: 18.19.1
- Fee Wallet: Has sufficient balance (4+ SOL)

