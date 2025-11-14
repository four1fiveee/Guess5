# Solana Expert Update #5 - Dual Signature Requirement Implementation

## Executive Summary

**Root Cause Identified:** Squads v4 requires BOTH Proposal AND VaultTransaction to be signed separately. Previously only Proposal was signed, preventing ExecuteReady state transition.

**Status:** Implementation in progress - backend partially fixed, frontend needs update.

---

## Previous Findings (Condensed)

### Problem History
- Multiple matches tested end-to-end
- Proposal signed successfully (2/2 signatures)
- Execution failed - funds never released
- On-chain verification: VaultTransaction has 0/2 signatures
- Proposal remains in "Approved" state, never reaches "ExecuteReady"

### Fixes Attempted
1. ✅ Execution retry service (background retries every 10s)
2. ✅ Pre-execution vault top-up
3. ✅ Blockhash optimization
4. ✅ High priority fees (50000 microLamports)
5. ✅ Transaction simulation
6. ✅ ExecuteReady state handling
7. ✅ Enhanced error logging
8. ✅ Non-blocking execution

**Result:** All fixes implemented but execution still failing. Root cause: VaultTransaction not signed.

### Expert Analysis (Match `ddf4f32a-a079-46d0-a683-0b8fc2586d7a`)
- **VaultTransaction:** 0/2 signatures ❌
- **Proposal:** 2/2 signatures ✅
- **State:** Proposal Approved but NOT ExecuteReady
- **Conclusion:** Both must be signed for ExecuteReady transition

---

## Latest Implementation (2025-11-14)

### Changes Made

**Commit `ddb3774` - Initial Implementation:**
1. ✅ Backend: Added `approveVaultTransaction()` method to `SquadsVaultService`
2. ✅ Backend: Updated `approveProposal()` to auto-approve vault transaction after proposal
3. ✅ Backend: Added execution abort check if VaultTransaction not approved
4. ✅ Frontend: Updated to sign both Proposal AND VaultTransaction
5. ✅ Backend: Updated endpoint to return both transactions to frontend
6. ✅ Backend: Updated handler to accept and submit both signed transactions
7. ✅ Backend: Added ExecuteReady check in retry service to prevent infinite loops

**Commit `2b6589b` - Frontend Fix:**
- Removed non-existent `instructions.vaultTransactionApprove` fallback
- Frontend now requires backend to provide vault transaction

**Commit `929dd7c` - SDK Method Fix:**
- Changed from `vaultTransactionApprove` to `transactionApprove` (doesn't exist)
- Added fallback to generated helper approach

**Commit `c1e2efa` - Debug Logging:**
- Added logging to discover available methods in Squads SDK
- Lists all approval-related methods in `generated.instructions`

**Commit `379100c` - Fee Wallet Auto-Approval:**
- Fee wallet now automatically approves vault transaction when approving proposal
- Added vault transaction approval for fee wallet in multiple code paths

### Current Implementation Status

**Backend (`squadsVaultService.ts`):**
- ✅ `approveVaultTransaction()` method exists
- ⚠️ Uses `instructions.transactionApprove` (may not exist in SDK)
- ⚠️ Falls back to `generated.instructions.createTransactionApproveInstruction` (may not exist)
- ✅ Fee wallet auto-approves vault transaction after proposal approval

**Backend (`matchController.ts`):**
- ✅ `getProposalApprovalTransactionHandler` attempts to build vault transaction
- ⚠️ Currently fails silently - logs show "Vault transaction approve instruction builder not available"
- ✅ `signProposalHandler` accepts `signedVaultTransaction` parameter
- ✅ Submits both transactions if provided

**Frontend (`result.tsx`):**
- ✅ Requests both proposal and vault transaction from backend
- ✅ Signs both transactions with player wallet
- ⚠️ Backend not providing vault transaction (SDK method doesn't exist)
- ❌ Frontend shows error: "Vault transaction approval is required but was not provided by backend"

**Execution Retry Service:**
- ✅ Checks ExecuteReady state before attempting execution
- ✅ Prevents infinite retry loops when vault transaction not approved

---

## Latest Test Results (Match ID: `d274f004-277b-4059-abcd-1b5843bf4d4c`)

**Test Date:** 2025-11-14  
**Deployment:** Commit `929dd7c` (Use transactionApprove instead of vaultTransactionApprove)

### Frontend Behavior
- ✅ Player successfully signed proposal
- ✅ Frontend shows: `✅ Proposal transaction signed`
- ❌ **Error:** "Vault transaction approval is required but was not provided by backend"
- ❌ Frontend cannot proceed - backend not building vault transaction

### Backend Logs Analysis

**Key Findings:**
1. **Proposal Approval:** ✅ Working
   - Player signed proposal successfully
   - Fee wallet auto-approved proposal

2. **Vault Transaction Building:** ❌ FAILING
   - Log: `⚠️ Vault transaction approve instruction builder not available - trying generated helper`
   - Log: `⚠️ Vault transaction approve instruction builder not available - frontend will need to build separately`
   - **Conclusion:** Neither `instructions.transactionApprove` nor `generated.instructions.createTransactionApproveInstruction` exist in Squads SDK

3. **Fee Wallet Vault Transaction Approval:** ⚠️ UNKNOWN
   - Code exists to auto-approve vault transaction with fee wallet
   - But no logs found showing vault transaction approval attempts
   - May be failing silently or not being called

### On-Chain State (To Be Verified)

**Expected After Fix:**
- VaultTransaction: 2/2 signatures (player + fee wallet)
- Proposal: 2/2 signatures (player + fee wallet)
- Both should be ExecuteReady
- Execution should succeed
- Funds should be released

**Current State (Unknown):**
- Need to verify on-chain if vault transaction has any signatures
- Need to check if fee wallet's vault transaction approval succeeded

---

## Critical Issue: SDK Method Not Available

**Problem:** The Squads SDK (`@sqds/multisig` v2.1.4) does not provide:
- ❌ `instructions.vaultTransactionApprove`
- ❌ `instructions.transactionApprove`
- ❌ `instructions.txApprove`
- ❌ `generated.instructions.createTransactionApproveInstruction`
- ❌ `generated.instructions.createVaultTransactionApproveInstruction`

**What Exists:**
- ✅ `instructions.proposalApprove` (works for proposals)
- ✅ `rpc.proposalApprove` (works for proposals)
- ❌ No equivalent for vault transactions

**Attempted Solutions:**
1. Tried `instructions.transactionApprove` - doesn't exist
2. Tried `generated.instructions.createTransactionApproveInstruction` - doesn't exist
3. Added debug logging to list all available methods - will show in next test

---

## Next Steps Required

### Immediate Actions

1. **Check Debug Logs:**
   - After next deployment, check logs for: `🔍 Available methods in generated.instructions`
   - This will show what methods are actually available in the SDK
   - Use this to identify the correct method name or build instruction manually

2. **Manual Instruction Building:**
   - If SDK doesn't provide helper, build instruction manually using:
     - Transaction PDA (derived from multisig + transaction index)
     - Same structure as proposal approval but targeting transaction PDA
     - Need instruction discriminator from Squads program IDL

3. **Verify Fee Wallet Approval:**
   - Check if fee wallet's `approveVaultTransaction()` is being called
   - Check if it's failing silently
   - Add more logging to track vault transaction approval attempts

4. **Frontend Workaround:**
   - If backend can't build instruction, frontend may need to build it
   - Or use Squads SDK directly in frontend to build the instruction

### Questions for Expert

1. **What is the correct method/instruction to approve a VaultTransaction in Squads v4?**
   - The SDK doesn't seem to provide a helper
   - Should we build the instruction manually?
   - What is the instruction discriminator?

2. **Is there a different SDK version or module that provides vault transaction approval?**
   - Current version: `@sqds/multisig` v2.1.4
   - Should we upgrade or use a different import?

3. **Can we use the same instruction structure as proposal approval?**
   - Proposal approval uses `instructions.proposalApprove`
   - Can we reuse this structure but with transaction PDA instead of proposal PDA?

4. **Should the backend automatically approve vault transaction on behalf of the player?**
   - Currently trying to have player sign it via frontend
   - But if SDK doesn't support it, should backend handle it differently?

---

## Implementation Details

### Code Changes Summary

**Files Modified:**
1. `backend/src/services/squadsVaultService.ts`
   - Added `approveVaultTransaction()` method (lines ~2658-2778)
   - Updated `approveProposal()` to call vault transaction approval (lines ~2588-2633)
   - Added ExecuteReady check in `executeProposal()` (lines ~2800-2850)

2. `backend/src/controllers/matchController.ts`
   - Updated `getProposalApprovalTransactionHandler` to build vault transaction (lines ~9660-9720)
   - Updated `signProposalHandler` to accept and submit both transactions (lines ~9785-10150)
   - Added fee wallet vault transaction approval (lines ~10350-10380, 10430-10460)

3. `frontend/src/pages/result.tsx`
   - Updated `handleSignProposal` to sign both transactions (lines ~600-670)
   - Removed fallback that tried to use non-existent SDK method

4. `backend/src/services/executionRetryService.ts`
   - Added ExecuteReady check before retry (lines ~152-215)

### Current Code Flow

**When Player Signs Proposal:**
1. Frontend requests approval transactions from backend
2. Backend builds proposal approval transaction ✅
3. Backend attempts to build vault transaction approval ❌ (fails - method doesn't exist)
4. Frontend receives only proposal transaction
5. Frontend signs proposal transaction ✅
6. Frontend cannot sign vault transaction (not provided by backend) ❌
7. Frontend sends only proposal transaction to backend
8. Backend submits proposal transaction ✅
9. Fee wallet auto-approves proposal ✅
10. Fee wallet attempts to approve vault transaction ⚠️ (may be failing)
11. Execution attempts fail because vault transaction not fully signed ❌

**When Fee Wallet Auto-Approves:**
1. Backend calls `approveProposal()` ✅
2. Proposal is signed ✅
3. Backend calls `approveVaultTransaction()` ⚠️
4. Method tries `instructions.transactionApprove` ❌ (doesn't exist)
5. Falls back to `generated.instructions.createTransactionApproveInstruction` ❌ (doesn't exist)
6. Throws error or returns failure ⚠️
7. Vault transaction may not be signed ❌

---

## Testing Results Summary

### Match `d274f004-277b-4059-abcd-1b5843bf4d4c`
- **Status:** ❌ Failed
- **Issue:** Backend cannot build vault transaction approval instruction
- **Error:** "Vault transaction approval is required but was not provided by backend"
- **Root Cause:** SDK doesn't provide vault transaction approval method

### Previous Matches
- All showed same pattern: Proposal signed ✅, VaultTransaction not signed ❌
- On-chain verification confirms: VaultTransaction has 0/2 signatures
- Execution fails because ExecuteReady state never reached

---

## Expert Recommendations Needed

1. **How to build VaultTransaction approval instruction?**
   - SDK doesn't provide helper
   - Need instruction discriminator and account structure
   - Or identify correct SDK method/version

2. **Should we upgrade Squads SDK?**
   - Current: `@sqds/multisig` v2.1.4
   - Is there a newer version with vault transaction support?

3. **Alternative approach?**
   - Can backend sign vault transaction on player's behalf?
   - Or must player sign it themselves via frontend?

4. **Instruction structure?**
   - What accounts are required?
   - What is the instruction discriminator?
   - Can we derive it from proposal approval instruction?

---

## Next Test Plan

After implementing expert's recommendations:

1. **Verify SDK Methods:**
   - Check debug logs for available methods
   - Identify correct method or build manually

2. **Test Vault Transaction Signing:**
   - Verify fee wallet signs vault transaction
   - Verify player can sign vault transaction (if frontend updated)
   - Check on-chain: VaultTransaction should have 2/2 signatures

3. **Verify ExecuteReady State:**
   - Both Proposal and VaultTransaction should be ExecuteReady
   - Execution should succeed
   - Funds should be released

---

---

## ✅ Expert Solution Implemented (2025-11-14)

**Expert Recommendation:** Build vault transaction approval instruction from IDL using Anchor's coder since SDK doesn't provide helper.

### Implementation Complete

**New File Created:** `backend/src/services/vaultTransactionApproveBuilder.ts`
- Loads Squads IDL from `@sqds/multisig` package or on-chain
- Discovers instruction name by searching for "approve" + "transaction" patterns
- Builds instruction using Anchor's `program.coder.instruction.encode()`
- Maps accounts automatically based on IDL structure
- Logs all available instructions at startup for debugging

**Files Updated:**
1. `backend/src/services/squadsVaultService.ts` - `approveVaultTransaction()` now uses IDL builder
2. `backend/src/controllers/matchController.ts` - `getProposalApprovalTransactionHandler()` now uses IDL builder
3. `backend/src/server.ts` - Initializes IDL at startup and logs all instructions

### How It Works

1. **IDL Loading:**
   - Tries multiple paths in `node_modules/@sqds/multisig`
   - Falls back to on-chain fetch via `Program.fetchIdl()`
   - Caches IDL for performance

2. **Instruction Discovery:**
   - Searches IDL instructions for names containing "approve" + "transaction"/"vault"/"tx"
   - Logs all available instructions at startup
   - Uses first matching instruction

3. **Instruction Building:**
   - Maps account names from IDL to actual PublicKeys:
     - `multisig`/`multisigAccount` → multisig address
     - `transaction`/`vaultTransaction` → transaction PDA
     - `member`/`signer` → signer public key
     - `clock` → SYSVAR_CLOCK_PUBKEY
     - `systemProgram` → SystemProgram.programId
   - Encodes instruction data using Anchor's coder
   - Sets `isSigner` and `isWritable` from IDL account structure

4. **Usage:**
   - Backend fee wallet: Automatically signs vault transaction after proposal approval
   - Frontend player: Receives instruction to sign along with proposal approval

### Expected Behavior After Deployment

1. **Server Startup:**
   - Logs: `📋 Squads IDL Instructions:` with all available instructions
   - Logs: `🔍 Approve-related instructions:` with matching candidates
   - Logs: `✅ Squads IDL initialized`

2. **When Fee Wallet Approves:**
   - Logs: `✅ Built vault transaction approval instruction from IDL`
   - Logs: `✅ Vault transaction approved` with signature
   - On-chain: VaultTransaction should have fee wallet signature

3. **When Player Signs:**
   - Backend returns both proposal and vault transaction approval transactions
   - Frontend signs both
   - On-chain: VaultTransaction should have 2/2 signatures (player + fee wallet)

4. **Execution:**
   - Both Proposal and VaultTransaction should be ExecuteReady
   - Execution should succeed
   - Funds should be released

### Next Test

After deployment, check logs for:
1. IDL initialization logs showing all available instructions
2. Instruction name discovered for vault transaction approval
3. Successful instruction building logs
4. Vault transaction approval signatures
5. On-chain verification: VaultTransaction should have 2/2 signatures

**Status:** ✅ Implementation complete - ready for testing
