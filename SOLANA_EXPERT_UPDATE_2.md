# Solana Expert Update #2 - On-Chain Check Implementation & 502 Error Fix

## Test Results (Match ID: `453a07fe-c576-4d52-b66a-67197a383a6f`)

### What Happened:
1. **Player signed successfully** - Frontend logs show:
   - `✅ Proposal signed successfully`
   - Signature was submitted to backend

2. **502 Bad Gateway Error** - After signing, when frontend tried to fetch match status:
   - `GET https://guess5.onrender.com/api/match/status/453a07fe-c576-4d52-b66a-67197a383a6f?wallet=... net::ERR_FAILED 502 (Bad Gateway)`
   - CORS errors also appeared (secondary issue)

3. **No execution logs** - Backend logs did not show:
   - "⚙️ All required signatures collected"
   - "🚀 Executing proposal in background"
   - Any execution attempts

### Root Cause:
The on-chain check I added (per your recommendation) was **blocking the response**:
- `signProposalHandler` was calling `squadsVaultService.checkProposalStatus()` without a timeout
- This RPC call was taking too long or hanging
- Render's 30-second timeout was being hit, causing 502 Bad Gateway
- The endpoint never returned a response, so execution logic never ran

## Implementation Details

### What I Implemented (Per Your Recommendation):

1. **On-Chain State as Source of Truth** (`signProposalHandler`):
   ```typescript
   // Check on-chain proposal status before calculating needsSignatures
   const proposalStatus = await squadsVaultService.checkProposalStatus(
     matchRow.squadsVaultAddress,
     proposalIdString
   );
   
   if (proposalStatus) {
     onChainSignerCount = proposalStatus.signers.length;
     onChainNeedsSignatures = proposalStatus.needsSignatures;
     // Use on-chain state as source of truth
     if (onChainNeedsSignatures !== undefined && onChainNeedsSignatures !== null) {
       newNeedsSignatures = onChainNeedsSignatures;
     }
   }
   ```

2. **Fallback to Database** - If on-chain check fails, use database calculation

### The Problem:
- The `checkProposalStatus()` call was **synchronous and blocking**
- No timeout was set, so if the RPC call hung, the entire endpoint would hang
- Render's 30-second timeout would kill the request with 502 Bad Gateway
- This prevented the response from being sent, so execution never triggered

## Fix Applied

### Added Timeout to On-Chain Check:
```typescript
// Add 2-second timeout to prevent endpoint from hanging
// This check is for verification only - we'll use database state if it times out
const proposalStatus = await Promise.race([
  squadsVaultService.checkProposalStatus(
    matchRow.squadsVaultAddress,
    proposalIdString
  ),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('On-chain check timeout')), 2000)
  ),
]) as any;
```

### Behavior Now:
1. **Try on-chain check** (with 2-second timeout)
2. **If successful** - Use on-chain state as source of truth
3. **If timeout/fails** - Fall back to database calculation (safe, but may not reflect latest on-chain state)
4. **Response is sent immediately** - No blocking, prevents 502 errors

## Current Status

### What's Working:
- ✅ On-chain check is attempted (when RPC is responsive)
- ✅ Timeout prevents blocking (2 seconds max)
- ✅ Fallback to database state if check fails
- ✅ Response is sent immediately (no 502 errors)

### What's Still Unknown:
1. **Did execution actually trigger?** - We need to check backend logs for:
   - "⚙️ All required signatures collected"
   - "🚀 Executing proposal in background"
   - Execution attempts and results

2. **On-chain signature count** - We need to verify:
   - How many signatures are actually on-chain for this match
   - Whether fee wallet auto-approval worked
   - Whether threshold (2) was met

3. **Vault balance** - We need to check:
   - Did funds actually leave the vault?
   - Were players and fee wallet paid?

## Questions for Expert Review

1. **Is 2 seconds enough for on-chain check?**
   - Should we increase it, or is falling back to database state acceptable?
   - The trade-off is: longer timeout = more accurate but risk of 502 errors

2. **Should on-chain check be async/background?**
   - Currently it's in the request path (with timeout)
   - Should we move it to background and use database state immediately?
   - Then update database later when on-chain check completes?

3. **Execution not triggering - what to check?**
   - If on-chain check times out, we use database state
   - But if database says `needsSignatures === 0`, should execution trigger?
   - Or should we require successful on-chain check before executing?

4. **Fee wallet auto-approval verification:**
   - How can we verify if `rpc.proposalApprove` actually submitted the transaction?
   - Should we check the returned signature to confirm it's on-chain?
   - Or trust the SDK and proceed with execution?

## Next Steps

1. **Run diagnostic script** for match `453a07fe-c576-4d52-b66a-67197a383a6f`:
   ```bash
   npx ts-node backend/scripts/check-proposal-on-chain.ts 453a07fe-c576-4d52-b66a-67197a383a6f
   ```
   This will show:
   - On-chain proposal status and signatures
   - Vault balance
   - Comparison with database state

2. **Check backend logs** for:
   - Fee wallet auto-approval attempts
   - Execution attempts
   - On-chain check results

3. **Verify on-chain state:**
   - How many signatures are on-chain?
   - Is proposal status "Approved" or "ExecuteReady"?
   - Did execution transaction occur?

## Code Changes Summary

**File:** `backend/src/controllers/matchController.ts`

**Change:** Added timeout to on-chain check in `signProposalHandler` (lines 10280-10322)

**Before:**
```typescript
const proposalStatus = await squadsVaultService.checkProposalStatus(...);
```

**After:**
```typescript
const proposalStatus = await Promise.race([
  squadsVaultService.checkProposalStatus(...),
  new Promise((_, reject) => 
    setTimeout(() => reject(new Error('On-chain check timeout')), 2000)
  ),
]) as any;
```

**Impact:**
- Prevents 502 Bad Gateway errors
- Allows response to be sent even if RPC is slow
- Falls back to database state if on-chain check fails
- Trade-off: May use slightly stale database state if RPC times out

## Request for Expert Guidance

1. **Is the timeout approach correct?** Or should we handle on-chain checks differently?

2. **Should execution trigger based on database state** if on-chain check times out? Or should we require successful on-chain verification?

3. **How to verify fee wallet auto-approval worked?** Should we check the returned signature, or trust the SDK?

4. **What's the best practice for on-chain checks in request handlers?** Should they be:
   - Synchronous with timeout (current approach)
   - Background/async (update database later)
   - Cached (check periodically, not on every request)

Thank you for your continued guidance!

