# Diagnosis Report: Match 58c6d3a8-a418-41bc-9038-d35fc45ae2e1

## Summary
The match is **stuck in "Processing Payout..."** because:
1. **Database state mismatch**: `needsSignatures` is `2` even though both players have signed
2. **Execution not triggered**: Backend requires `needsSignatures === 0` to trigger execution
3. **Frontend shows EXECUTING**: Frontend is polling but backend never updates status

## Current Database State (from API)
```json
{
  "proposalStatus": null,
  "needsSignatures": 2,
  "proposalSigners": ["2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt", "F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8"],
  "proposalExecutedAt": null,
  "proposalTransactionId": "CnGHcJz7t2NiQgbAdrhrLjjUZuyXnGcwAA7gv9HjSWybBrUFyPHUATzBnAemizaiPbW5HnVcBA7rrsiEuX7NFAa",
  "squadsVaultAddress": "Dk216dgsLCxHdrqABq7thPUixGGikx31FVffdmM5Jn6B",
  "payoutProposalId": "ELpZCiAd6tFpNruajH1BrN2VT3EFXSh4M24A9Taap6XR"
}
```

## Issues Identified

### 1. Database State Mismatch
- **Problem**: `needsSignatures` is `2` but `proposalSigners` array has 2 signers
- **Expected**: `needsSignatures` should be `0` when both players have signed
- **Root Cause**: The `signProposalHandler` background task may have failed to update `needsSignatures` correctly

### 2. Proposal Status is NULL
- **Problem**: `proposalStatus` is `null` instead of `EXECUTING` or `READY_TO_EXECUTE`
- **Expected**: Should be `EXECUTING` when both players have signed
- **Impact**: Frontend can't determine correct state to display

### 3. Execution Not Triggered
- **Problem**: Backend execution logic requires `needsSignatures === 0` to trigger
- **Current State**: `needsSignatures === 2`, so execution never starts
- **Location**: `backend/src/controllers/matchController.ts:13433` checks `if (newNeedsSignatures === 0)`

## Backend Logs Analysis

### Sign Request (23:48:29)
- ✅ POST `/sign-proposal` succeeded (status 200)
- ✅ Transaction confirmed on-chain
- ⚠️ No execution attempt logs found for this matchId

### Status Requests
- Multiple GET `/api/match/status/58c6d3a8...` requests
- All returning 200, but status never updates

### Execution Attempts (Other Matches)
- Multiple execution attempts for other matches
- All failing with: `Simulation failed: {"InstructionError":[0,{"Custom":101}]}`
- Error code 101 is a Squads program validation error

## On-Chain Status Check Needed

To verify if both signatures are actually on-chain:
```bash
node backend/src/scripts/check-onchain-proposal-status.js \
  Dk216dgsLCxHdrqABq7thPUixGGikx31FVffdmM5Jn6B \
  ELpZCiAd6tFpNruajH1BrN2VT3EFXSh4M24A9Taap6XR
```

## Recommended Fixes

### Immediate Fix (Manual)
1. Update database to correct state:
   ```sql
   UPDATE "match" 
   SET "needsSignatures" = 0,
       "proposalStatus" = 'READY_TO_EXECUTE'
   WHERE id = '58c6d3a8-a418-41bc-9038-d35fc45ae2e1'
     AND "proposalExecutedAt" IS NULL;
   ```

2. Trigger execution via reconciliation worker or status check

### Long-term Fix (Code)
1. **Fix `needsSignatures` calculation** in `signProposalHandler`:
   - Ensure `newNeedsSignatures` is correctly calculated as `threshold - signerCount`
   - Add verification that DB update actually persisted the correct value

2. **Add execution retry logic**:
   - If `needsSignatures === 0` but `proposalStatus` is not `EXECUTING` or `EXECUTED`, trigger execution
   - Add this check in `getMatchStatusHandler` fallback logic

3. **Improve error handling**:
   - Log when `needsSignatures` calculation doesn't match signer count
   - Add database state validation after updates

## Next Steps

1. ✅ **Check on-chain proposal status** - Verify both signatures are actually on-chain
2. ✅ **Check transaction signature** - Verify the approval transaction succeeded
3. ⏳ **Fix database state** - Update `needsSignatures` and `proposalStatus`
4. ⏳ **Trigger execution** - Manually trigger or wait for reconciliation worker
5. ⏳ **Verify execution** - Check if execution transaction exists on-chain

