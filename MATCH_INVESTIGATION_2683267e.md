# 🔍 Match Investigation Report: 2683267e-43b5-4808-bb2f-64515553b62d

## Summary

**Status**: ❌ **CRITICAL DESYNC ISSUE**

The match shows a severe proposal desync where:
- Frontend signed proposal `FBrpHr2ukYGgtFex17hxSgsfsSjVir6grMHSDinCkg33`
- Database references different proposal `CKwSdd5fXJwv1V4RUCLKdtwR15sXbQjzXeyd8CPkJBXR`
- Database shows `SIGNATURE_VERIFICATION_FAILED` status
- `/submit-result` returns 500 error

## Database State

```json
{
  "id": "2683267e-43b5-4808-bb2f-64515553b62d",
  "payoutProposalId": "CKwSdd5fXJwv1V4RUCLKdtwR15sXbQjzXeyd8CPkJBXR",
  "proposalStatus": "SIGNATURE_VERIFICATION_FAILED",
  "proposalSigners": "[\"2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt\"]",
  "needsSignatures": null,
  "proposalExecutedAt": null,
  "proposalTransactionId": null,
  "squadsVaultAddress": "4odMNCtoEd1NtQ6bytCtFng9veCQsLM3yBeboENujs64",
  "isCompleted": true,
  "winner": "F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8",
  "updatedAt": "2025-12-10T22:09:46.62851Z"
}
```

## Frontend State

**Initial Sign Response**:
```json
{
  "success": true,
  "status": "VERIFYING_ON_CHAIN",
  "proposalId": "FBrpHr2ukYGgtFex17hxSgsfsSjVir6grMHSDinCkg33",
  "proposalStatus": "ACTIVE",
  "proposalSigners": ["2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"],
  "needsSignatures": 1,
  "broadcastSignature": "3xhEbEtbvTJun4eaZ1ELakWCjKku7W7baKMTqv8tiKij9qkA6K6Sdggzteup8kqMDVVRzQohWY4BYZD8X9soyUdu"
}
```

**Later Polling**:
```json
{
  "payoutProposalId": null,
  "proposalStatus": "PENDING",
  "proposalSigners": []
}
```

## On-Chain State (Squads Multisig)

**Multisig**: `4odMNCtoEd1NtQ6bytCtFng9veCQsLM3yBeboENujs64`
**Transaction Index**: `04` (current)

**Proposals**:
1. **Transaction Index 01**: `Approved` with both signers ✅
   - Fee wallet: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
   - Player: `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`

2. **Transaction Index 02**: `Active` with only fee wallet
   - Fee wallet: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`

3. **Transaction Index 03**: `Active` (no signers)

4. **Transaction Index 04**: `Active` (no signers)

## Root Cause Analysis

### Issue 1: Proposal ID Mismatch
- **Frontend signed**: `FBrpHr2ukYGgtFex17hxSgsfsSjVir6grMHSDinCkg33`
- **Database has**: `CKwSdd5fXJwv1V4RUCLKdtwR15sXbQjzXeyd8CPkJBXR`
- **On-chain Approved**: Transaction index `01` (different PDA)

**Hypothesis**: Multiple proposals were created, and the database is pointing to the wrong one.

### Issue 2: Database Status Mismatch
- Database shows `SIGNATURE_VERIFICATION_FAILED`
- On-chain shows transaction index `01` is `Approved` with both signatures
- Our sync fixes should have caught this, but may not have run yet

### Issue 3: submit-result 500 Error
- Frontend shows 500 error on `/api/match/submit-result`
- This likely happened because:
  1. Database shows `SIGNATURE_VERIFICATION_FAILED`
  2. Our sync logic in `submit-result` should have fixed this
  3. But sync may have failed or not run

## Expected Behavior (With Our Fixes)

1. **submit-result sync**: Should detect `SIGNATURE_VERIFICATION_FAILED` and search for Approved proposal
2. **Auto-fix**: Should find transaction index `01` (Approved) and update database
3. **Status polling**: Should show correct proposal ID and status

## Current Behavior

1. ❌ Database still shows `SIGNATURE_VERIFICATION_FAILED`
2. ❌ Frontend polling shows `PENDING` and `null` proposal ID
3. ❌ submit-result returns 500 error

## Next Steps

1. **Verify sync logic ran**: Check logs for sync attempts in `submit-result`
2. **Check proposal PDA mapping**: Determine which transaction index corresponds to which PDA
3. **Manual fix**: Use `fix-wrong-proposal.ts` script to update database to transaction index `01`
4. **Verify execution**: Check if transaction index `01` is `ExecuteReady` and execute if needed

## Key Findings

### Proposal Mapping
- **Database Proposal**: `CKwSdd5fXJwv1V4RUCLKdtwR15sXbQjzXeyd8CPkJBXR` = Transaction Index `03`
  - Status: `Active` (no signers)
  - This is the WRONG proposal
  
- **On-Chain Approved Proposal**: Transaction Index `01`
  - Status: `Approved` with both signers ✅
  - Fee wallet: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
  - Player: `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
  - This is the CORRECT proposal that should be in the database

- **Frontend Signed Proposal**: `FBrpHr2ukYGgtFex17hxSgsfsSjVir6grMHSDinCkg33` = Transaction Index `02` (likely)
  - Status: `Active` (only fee wallet signed)
  - This is a DIFFERENT proposal that the frontend signed

### Root Cause

**Multiple proposals were created**:
- Transaction Index `01`: Approved ✅ (correct)
- Transaction Index `02`: Active (only fee wallet)
- Transaction Index `03`: Active (no signers) ❌ (database has this)
- Transaction Index `04`: Active (no signers)

**Why sync didn't work**:
1. Database shows `SIGNATURE_VERIFICATION_FAILED` status
2. Our sync logic in `submit-result` should have detected this and searched for Approved proposal
3. Sync logic searches transaction indices 0-10, so it should have found transaction index `01`
4. **BUT**: No sync logs found, meaning sync logic didn't run or failed silently

**Why submit-result returned 500**:
- Database shows `SIGNATURE_VERIFICATION_FAILED`
- Sync logic should have fixed this before validation
- But sync didn't run or didn't update the database
- Handler likely failed validation check

## Recommendations

1. **Immediate**: Use `findAndSyncApprovedProposal` service to manually sync database to transaction index `01`
2. **Short-term**: Verify sync logic is being called in `submit-result` handler and add more logging
3. **Long-term**: 
   - Add logging to track when sync logic runs
   - Add logging to track which transaction index is found
   - Ensure sync logic updates database even if proposal creation check fails

