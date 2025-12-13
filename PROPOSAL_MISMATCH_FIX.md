# Proposal Mismatch Fix - Detailed Analysis

## Problem Summary

When a user tried to sign a proposal, they encountered a "Stale proposal detected" error. The issue involved three different proposal IDs:

1. **User signed**: `5d7PQcUSjPSZrVdr6p3au4oJZr9sEFA83P7pRKo3CRyN`
2. **Database had**: `6EB3mjVpPxyTdBWe5JDwosQoroCn2VpR778XgmPsVuxk` (different from what user signed)
3. **Backend suggested**: `R2W2ektTyYSPBiKFnj9H7favUjfNHrYX3u9rJSG6Ajt` (also different)

## Root Cause Analysis

### On-Chain Status (from Squads MCP)
- The vault has multiple Active proposals at transaction indices 1, 2, 3, 4
- All proposals are in "Active" status with only 1 signature (need 2 signatures to be Approved)
- None of the proposals are in "Approved" status yet

### Database Status (from Render Postgres)
- Current `payoutProposalId`: `6EB3mjVpPxyTdBWe5JDwosQoroCn2VpR778XgmPsVuxk`
- Status: `ACTIVE`
- Signers: `["2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"]` (1 signature)
- Needs signatures: 1

### The Bug

The `findAndSyncApprovedProposal` function had a critical flaw:

1. **It only searched for "Approved" proposals** with 2+ signatures
2. **It ignored the proposal the user actually signed** - even if that proposal existed on-chain
3. When proposals are still "Active" (waiting for signatures), the function would:
   - Not find the signed proposal (because it's not Approved)
   - Search for an Approved proposal (which doesn't exist yet)
   - Return null or find a different proposal
   - Show an error to the user

### Why This Happened

The mismatch occurred because:
1. A proposal was created and stored in the database
2. The frontend cached this proposal ID
3. A new proposal was created (possibly due to a retry or error recovery)
4. The database was updated to the new proposal ID
5. The frontend still had the old proposal ID cached
6. When the user signed the old proposal, the backend couldn't find it because it was looking for "Approved" proposals only

## The Fix

### Changes Made

1. **Added `checkProposalExists` function**:
   - Checks if a specific proposal ID exists on-chain
   - Returns its status, signers, and needsSignatures count
   - Handles errors gracefully

2. **Enhanced `findAndSyncApprovedProposal` function**:
   - Now accepts an optional `signedProposalId` parameter
   - **First checks if the signed proposal exists** on-chain
   - If it exists, syncs the database to that proposal (even if it's not Approved yet)
   - Only searches for Approved proposals if the signed proposal doesn't exist

3. **Updated sign-proposal endpoint**:
   - Passes the `signedProposalId` to `findAndSyncApprovedProposal`
   - Allows the backend to sync to the exact proposal the user signed

### How It Works Now

1. User signs a proposal → Backend extracts proposal ID from signed transaction
2. Backend compares with database proposal ID
3. If mismatch detected:
   - **First**: Check if the signed proposal exists on-chain
   - **If exists**: Sync database to that proposal and continue
   - **If not exists**: Search for valid proposal (Approved or most recent Active)
4. User can now sign even if proposals are still Active (not yet Approved)

## Benefits

1. **Handles stale frontend data**: If user signs an old proposal that still exists, we sync to it
2. **Prevents unnecessary errors**: No longer requires proposals to be Approved before syncing
3. **Better user experience**: Users can sign proposals even if the database was updated
4. **Backward compatible**: All existing calls to `findAndSyncApprovedProposal` still work (parameter is optional)

## Enhanced Fix (v2)

Based on feedback, additional improvements were made:

### 1. Executed/Cancelled Proposal Detection ✅
- Added `isFinalizedStatus()` helper to detect Executed/Cancelled/Rejected proposals
- `checkProposalExists()` now returns `valid: false` for finalized proposals
- Returns clear error: "Proposal is executed/cancelled and cannot be signed"
- New error status: `SIGNED_FINALIZED_PROPOSAL` (non-retryable)

### 2. Better Error Handling ✅
- Distinguishes between:
  - `SIGNED_WRONG_PROPOSAL` - Stale proposal, can retry after refresh
  - `SIGNED_FINALIZED_PROPOSAL` - Proposal already executed/cancelled, cannot retry
- Frontend can now show appropriate messages based on error type

### 3. Validation Flow ✅
```
if (signedProposalId !== dbProposalId) {
  const onChainProposal = await checkProposalExists(signedProposalId);
  
  if (onChainProposal && !onChainProposal.valid) {
    // Proposal is Executed/Cancelled - return error
    return { status: 'SIGNED_FINALIZED_PROPOSAL', retryable: false };
  } else if (onChainProposal && onChainProposal.valid) {
    // Safe to sync to this proposal
    await syncDatabaseToProposal(matchId, signedProposalId, onChainProposal);
    return { status: 'SYNCED_TO_SIGNED_PROPOSAL' };
  }
  // Continue with finding valid proposal...
}
```

## Remaining Recommendations (Future Improvements)

### 1. Proposal Proliferation Prevention ⚠️
**Issue**: Multiple proposals being created unnecessarily
**Solution**: 
- Add `createOrReuseProposal()` function
- Check if latest Active proposal exists before creating new one
- Only create new proposal if last one is Executed or invalid

### 2. TransactionIndex Tracking ⚠️
**Issue**: Not tracking transactionIndex in database
**Solution**:
- Add `transactionIndex` column to match table
- Use this as canonical reference (more reliable than proposalId string)
- Helps with de-duplication and debugging

### 3. Additional Enhancements 💡
- **Proposal versioning**: Track `attemptCount` to see how many retries
- **DB indexing**: Index `matchId + transactionIndex` for uniqueness
- **Logging**: Log every proposal re-sync event
- **Background cleanup**: Archive old unapproved proposals

## Testing Recommendations

1. Test signing with stale proposal ID (frontend has old ID, DB has new ID)
2. Test signing with non-existent proposal ID
3. Test signing with current proposal ID (should work normally)
4. Test signing with Executed proposal (should return `SIGNED_FINALIZED_PROPOSAL`)
5. Test signing with Cancelled proposal (should return `SIGNED_FINALIZED_PROPOSAL`)
6. Verify database syncs correctly in all cases

## Frontend Recommendation

While the backend now handles stale proposals better, the frontend should still:
1. **Refresh match status before signing** to get the latest proposal ID
2. **Show a warning** if the proposal ID changed after refresh
3. **Handle errors appropriately**:
   - `SIGNED_WRONG_PROPOSAL` → Refresh and retry
   - `SIGNED_FINALIZED_PROPOSAL` → Show error, don't retry

