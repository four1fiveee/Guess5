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

---

## 🚨 Critical Issue Found - Match `bc5389b8-f13b-4d0d-a8e1-3b3a76216a86`

**Test Date:** 2025-11-14  
**Deployment:** Commit `9824779` (IDL-based vault transaction approval)

### Frontend Error
- ❌ **Error:** "Vault transaction approval is required but was not provided by backend"
- Frontend correctly identifies that backend did not provide `vaultTransaction` field

### Backend Logs Analysis

**Key Findings:**

1. **IDL Instruction Discovery Issue:**
   - Log: `"✅ Found vault transaction approve instruction:"` with `"instructionName":"proposalApprove"`
   - **Problem:** The instruction finder is incorrectly selecting `proposalApprove` instead of a vault transaction approval instruction
   - This suggests the IDL doesn't have a separate vault transaction approval instruction, OR the search pattern is too broad

2. **Program Constructor Failure:**
   - Error: `TypeError: Cannot read properties of undefined (reading '_bn')`
   - Stack trace shows error at:
     ```
     at isPublicKeyData (/opt/render/project/src/backend/node_modules/@solana/web3.js/lib/index.cjs.js:147:16)
     at new PublicKey (/opt/render/project/src/backend/node_modules/@solana/web3.js/lib/index.cjs.js:165:9)
     at translateAddress (/opt/render/project/src/backend/node_modules/@coral-xyz/anchor/dist/cjs/program/common.js:47:63)
     at new Program (/opt/render/project/src/backend/node_modules/@coral-xyz/anchor/dist/cjs/program/index.js:108:60)
     ```
   - **Root Cause:** The IDL's `metadata.address` (program ID) is likely `undefined` or not a valid PublicKey
   - Anchor's `translateAddress` tries to convert the program ID from IDL, but it's undefined

3. **Fee Wallet Approval Attempt:**
   - Log: `"📝 Now approving vault transaction (required for ExecuteReady)"`
   - Log: `"📝 Approving Squads vault transaction"`
   - Log: `"❌ Failed to build vault transaction approval instruction"`
   - Log: `"⚠️ Proposal approved but vault transaction approval failed"`
   - **Result:** Proposal is approved (2/2 signatures) but vault transaction is NOT approved (0/2 signatures)

4. **Frontend Request:**
   - Log: `GET /api/match/get-proposal-approval-transaction?matchId=bc5389b8-f13b-4d0d-a8e1-3b3a76216a86&wallet=F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
   - Log: `"❌ Failed to build vault transaction approval instruction from IDL"`
   - Response: Status 200, Content-Length 502 (likely missing `vaultTransaction` field)

### On-Chain Verification

**Match Details:**
- **Match ID:** `bc5389b8-f13b-4d0d-a8e1-3b3a76216a86`
- **Vault Address:** `9TuygV5YHxMMxrgqLLBBWzmoqis45TxmubUa4qFzpVLp`
- **Vault PDA:** `zLsFZ1MS8XoQLoUKCpo9WHey4MDJB9nW7R3a39mzmFR`
- **Proposal ID:** `1`
- **Transaction PDA:** `8V99AYAMUThWRrytpifLnJURQh5MgbbPWZBj6Q5ngkGz`
- **Proposal PDA:** `DUhfe1FNe9hTkxPy7ENzioqVRS1QjjMvg5S85WPsSbxn`

**On-Chain State:**
- **Vault Balance:** `0.285200 SOL` (should be ~0.0025 SOL if executed)
- **Transaction Account:** EXISTS (not closed - execution did not occur)
- **Transaction Status:** `undefined` (0=Active, 1=ExecuteReady, 2=Executed)
- **Executed:** `undefined`

**Conclusion:** ❌ Funds NOT released - execution did not occur

### Root Cause Analysis

**Primary Issue: IDL Program ID Missing or Invalid**

The error `Cannot read properties of undefined (reading '_bn')` occurs when Anchor tries to translate the program ID from the IDL. This suggests:

1. **IDL Structure Issue:**
   - The IDL loaded from `@sqds/multisig` may not have `metadata.address` set
   - Or the IDL structure doesn't match Anchor's expected format
   - The program ID needs to be explicitly set when creating the Program instance

2. **Instruction Discovery Issue:**
   - The search pattern `/(approve|transaction|vault|tx)/i` is matching `proposalApprove`
   - This is incorrect - we need a different instruction for vault transaction approval
   - The IDL may not have a separate vault transaction approval instruction

3. **Possible Solutions:**
   - **Option A:** Explicitly set program ID when creating Program instance (don't rely on IDL metadata)
   - **Option B:** Check if IDL has `metadata.address` and use it, otherwise use explicit program ID
   - **Option C:** The vault transaction approval might use the same `proposalApprove` instruction but with different accounts (transaction PDA instead of proposal PDA)

### Questions for Expert

1. **IDL Program ID:**
   - Should we explicitly pass the program ID to the Program constructor even though Anchor 0.30+ infers it from IDL?
   - How do we handle IDLs that don't have `metadata.address` set?

2. **Instruction Discovery:**
   - The finder is selecting `proposalApprove` - is this correct, or should we look for a different instruction name?
   - Does Squads v4 use `proposalApprove` for both proposal AND vault transaction approval, just with different account PDAs?

3. **Account Mapping:**
   - If we use `proposalApprove` for vault transaction, do we pass the transaction PDA where the proposal PDA would normally go?
   - What are the exact account names and order for vault transaction approval?

4. **IDL Loading:**
   - Should we verify the IDL has `metadata.address` before using it?
   - Should we fall back to explicit program ID if IDL metadata is missing?

### Next Steps Required

1. **Fix Program Constructor:**
   - Explicitly set program ID when creating Program instance
   - Don't rely on IDL metadata if it's missing

2. **Fix Instruction Discovery:**
   - Verify if `proposalApprove` is correct for vault transaction approval
   - If not, find the correct instruction name in the IDL
   - Log all available instructions to identify the correct one

3. **Verify Account Mapping:**
   - Ensure transaction PDA is passed correctly
   - Verify account order matches IDL expectations

4. **Add IDL Validation:**
   - Check IDL structure before using it
   - Validate that `metadata.address` exists or use explicit program ID

---

**Status:** ❌ Implementation has runtime error - IDL program ID issue preventing instruction building

---

## ✅ Expert Fix Implementation - Match `bc5389b8-f13b-4d0d-a8e1-3b3a76216a86`

**Date:** 2025-11-14  
**Expert Guidance:** Solana SDK Expert provided precise fixes

### Expert Findings

1. **Correct Instruction Name:**
   - ✅ **Correct:** `transactionApprove` (NOT `proposalApprove`)
   - ❌ **Wrong:** `proposalApprove` (only approves Proposal, NOT vault transaction)
   - The instruction exists in IDL but NOT exported by SDK v2.1.4

2. **IDL Program ID Issue:**
   - Squads IDL does NOT have `metadata.address`
   - Anchor 0.30+ infers programId from IDL metadata
   - Solution: Set `metadata.address` in IDL before creating Program

3. **Account Mapping (transactionApprove):**
   - `multisig` → multisig PDA (isMut=false, isSigner=false)
   - `transaction` → vault transaction PDA (isMut=true, isSigner=false)
   - `member` → signer public key (isMut=false, isSigner=true)
   - `systemProgram` → SystemProgram.programId (isMut=false, isSigner=false)

### Implementation Changes

**File:** `backend/src/services/vaultTransactionApproveBuilder.ts`

1. **Fixed Instruction Discovery:**
   ```typescript
   // Now looks specifically for "transactionApprove"
   const transactionApprove = idl.instructions?.find((i: any) => i.name === 'transactionApprove');
   ```

2. **Fixed Program Constructor:**
   ```typescript
   // Set programId in IDL metadata before creating Program
   const idlWithProgramId = {
     ...idl,
     metadata: {
       ...(idl as any).metadata,
       address: programId.toString(),
     },
   };
   cachedProgram = new Program<Idl>(idlWithProgramId as Idl, provider);
   ```

3. **Fixed Account Mapping:**
   ```typescript
   // Exact mapping per expert specification
   if (name === 'multisig') accountsMap[name] = multisigPubkey;
   else if (name === 'transaction') accountsMap[name] = transactionPda;
   else if (name === 'member') accountsMap[name] = signerPubkey;
   else if (name === 'systemProgram') accountsMap[name] = SystemProgram.programId;
   ```

4. **Fixed Account Flags:**
   ```typescript
   // Use IDL account flags directly
   const isWritable = acc.isMut === true;  // Only if explicitly marked
   const isSigner = acc.isSigner === true; // Only if explicitly marked
   ```

### Expected Behavior After Fix

1. **Server Startup:**
   - ✅ IDL loads successfully
   - ✅ `transactionApprove` instruction found
   - ✅ Program created with programId in metadata

2. **Fee Wallet Approval:**
   - ✅ `transactionApprove` instruction built successfully
   - ✅ Fee wallet signs vault transaction
   - ✅ Signature submitted on-chain

3. **Frontend Request:**
   - ✅ Backend returns both `transaction` and `vaultTransaction` fields
   - ✅ Frontend can sign vault transaction
   - ✅ Both signatures submitted

4. **On-Chain State:**
   - ✅ Proposal: 2/2 signatures → ExecuteReady
   - ✅ VaultTransaction: 2/2 signatures → ExecuteReady
   - ✅ Retry service executes → Funds released

### Next Test

**Test Match:** Create new match and verify:
- ✅ Backend logs show `transactionApprove` instruction built
- ✅ Fee wallet vault transaction approval signature logged
- ✅ Frontend receives `vaultTransaction` field
- ✅ On-chain: VaultTransaction has 2/2 signatures
- ✅ Execution succeeds and funds are released

---

**Status:** ✅ Expert fixes implemented - ready for testing
