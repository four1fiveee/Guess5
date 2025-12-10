# 🔧 Systemic Proposal Sync Fixes

## Summary

Implemented self-healing proposal synchronization across all critical backend paths to prevent failures due to stale database state. This ensures the database always reflects on-chain proposal reality before any proposal-dependent operations.

## Root Cause Analysis

**Match ID**: `c82f5bfc-57c6-4abe-924c-32c3d108679f`

### What Broke
- **On-chain**: Proposal `FUfhS8AQ6Qv6mkTyn7Koxg64n7z72TDK6RrJ9yEnWqU2` was `Approved` with both signers
- **Database**: Showed `SIGNATURE_VERIFICATION_FAILED` with only fee wallet
- **Result**: `/submit-result` failed with 500 error because it trusted stale DB state

### Root Cause Chain
1. Player signed and broadcasted → ✅
2. Signature confirmed on-chain → ✅
3. Backend never updated `proposalStatus` → ❌
4. `/submit-result` failed because status = `SIGNATURE_VERIFICATION_FAILED` → ❌
5. Auto-verification did not correct DB state in time → ❌
6. Execution stuck because backend thinks proposal is invalid → ❌

## Solution: Self-Healing Sync Service

### 1. Created `proposalSyncService.ts`

**Location**: `backend/src/services/proposalSyncService.ts`

**Functions**:
- `syncProposalIfNeeded()`: Syncs proposal status from on-chain to database
- `findAndSyncApprovedProposal()`: Auto-fixes by searching for Approved proposals when DB is stale

**Key Features**:
- Non-blocking: Errors don't fail the calling operation
- Efficient: Skips sync if status is already `APPROVED` or `EXECUTED`
- Auto-fix: Searches transaction indices 0-10 for Approved proposals when sync fails

### 2. Updated Critical Backend Paths

#### ✅ `/api/match/submit-result` (submitResultHandler)
- **Location**: `backend/src/controllers/matchController.ts:2111`
- **Sync Point**: Right after fetching match data, before any proposal checks
- **Impact**: Prevents 500 errors when DB shows `SIGNATURE_VERIFICATION_FAILED` but proposal is actually `Approved`

#### ✅ `/api/match/sign-proposal` (signProposalHandler)
- **Location**: `backend/src/controllers/matchController.ts:13795`
- **Sync Point**: After fetching match, before processing signature
- **Impact**: Ensures signature processing uses latest proposal state

#### ✅ Proposal Creation Check (in submitResultHandler)
- **Location**: `backend/src/controllers/matchController.ts:2605`
- **Sync Point**: Before checking if proposal creation is needed
- **Impact**: Prevents skipping proposal creation due to stale status

#### ✅ `/api/admin/manual-execute-proposal` (manualExecuteProposalHandler)
- **Location**: `backend/src/controllers/matchController.ts:9455`
- **Sync Point**: Before executing proposal
- **Impact**: Ensures execution uses correct proposal ID and status

### 3. Existing Auto-Fix Logic

The `getMatchStatusHandler` already has auto-fix logic (lines 6983-7097) that:
- Detects desync when proposal is `ACTIVE` or `SIGNATURE_VERIFICATION_FAILED` with missing signatures
- Searches for Approved proposals with both signatures
- Updates database automatically

**This is now complemented by**:
- Sync logic in all critical paths (not just status polling)
- Faster sync before operations that depend on proposal state

## Implementation Details

### Sync Logic Flow

```
1. Fetch match from database
2. Check if proposal exists (payoutProposalId or tieRefundProposalId)
3. If exists:
   a. Call syncProposalIfNeeded() to sync from on-chain
   b. If sync fails or status is SIGNATURE_VERIFICATION_FAILED:
      - Call findAndSyncApprovedProposal() to search for Approved proposal
   c. Reload match data after sync
4. Continue with operation using synced data
```

### Error Handling

All sync operations are wrapped in try-catch blocks that:
- Log warnings on failure
- **Do not block** the calling operation
- Allow operations to proceed even if sync fails

This ensures:
- Sync failures don't break user flows
- Operations continue with potentially stale data (better than failing)
- Errors are logged for monitoring

## Testing Checklist

- [ ] Test `/submit-result` with stale DB state (`SIGNATURE_VERIFICATION_FAILED` when proposal is `Approved`)
- [ ] Test `/sign-proposal` with stale DB state
- [ ] Test proposal creation check with stale DB state
- [ ] Test manual execution with stale DB state
- [ ] Verify sync logs appear in backend logs
- [ ] Verify auto-fix logs appear when searching for Approved proposals

## Future Enhancements (Optional)

### Background Proposal Watcher

Add a periodic background job that:
- Scans proposals in `Approved` state
- Checks if they're `ExecuteReady` on-chain
- Automatically executes them
- Retries with exponential backoff

**Implementation**:
```typescript
setInterval(async () => {
  // Find matches with Approved proposals that aren't executed
  const matches = await matchRepository.find({
    where: {
      proposalStatus: 'APPROVED',
      proposalExecutedAt: IsNull(),
    },
  });
  
  for (const match of matches) {
    // Check on-chain status
    // Execute if ExecuteReady
    // Update database
  }
}, 60000); // Every minute
```

## Files Changed

1. **Created**: `backend/src/services/proposalSyncService.ts`
2. **Modified**: `backend/src/controllers/matchController.ts`
   - `submitResultHandler`: Added sync at line ~2111
   - `submitResultHandler`: Added sync before proposal creation check at line ~2605
   - `signProposalHandler`: Added sync at line ~13795
   - `manualExecuteProposalHandler`: Added sync at line ~9455

## Deployment Notes

- No database migrations required
- No environment variables required
- Backward compatible (sync failures don't break existing flows)
- Can be deployed immediately

## Monitoring

Watch for these log messages:
- `✅ SYNC: Updated proposal status from on-chain` - Successful sync
- `✅ AUTO-FIX: Found Approved proposal` - Auto-fix triggered
- `⚠️ Proposal sync failed (non-blocking)` - Sync failed but operation continued

