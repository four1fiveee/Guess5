# Proposal Management Implementation

## Overview

This document describes the implementation of comprehensive proposal management features to prevent proposal proliferation, track versioning, and maintain database health.

## Features Implemented

### 1. ✅ Proposal Proliferation Prevention

**Service**: `backend/src/services/proposalManagementService.ts`

**Function**: `createOrReuseProposal()`

**How it works**:
1. Checks if match already has a valid proposal
2. If not, searches for existing Active proposals in the vault (indices 0-20)
3. Reuses existing proposal if found and valid
4. Only creates new proposal if none exists

**Benefits**:
- Prevents creating duplicate proposals
- Reuses valid Active proposals instead of creating new ones
- Reduces on-chain bloat and transaction costs

### 2. ✅ TransactionIndex Tracking

**Database Schema**:
- `payoutProposalTransactionIndex` - Already exists in Match model
- `tieRefundProposalTransactionIndex` - Already exists in Match model
- `proposalAttemptCount` - **NEW** field added to track versioning

**Migration**: `backend/src/db/migrations/1734000000001-AddProposalAttemptCount.ts`

**Usage**:
- Tracks how many proposal creation attempts have been made
- Helps debug proposal creation issues
- Provides audit trail for proposal lifecycle

### 3. ✅ Database Indexes

**Migration**: `backend/src/db/migrations/1734000000000-AddProposalManagementIndexes.ts`

**Indexes Created**:
1. `IDX_match_proposal_transaction` - Composite index on (id, payoutProposalTransactionIndex)
2. `IDX_match_tie_refund_transaction` - Composite index on (id, tieRefundProposalTransactionIndex)
3. `IDX_match_proposal_attempt_count` - Index on proposalAttemptCount
4. `IDX_match_proposal_status` - Index on proposalStatus
5. `IDX_match_vault_transaction` - Composite index on (squadsVaultAddress, payoutProposalTransactionIndex)

**Benefits**:
- Faster lookups for proposal queries
- Better uniqueness checking
- Improved performance for vault-based queries

### 4. ✅ Enhanced Logging

**Logging Events**:
- `PROPOSAL_REUSED` - When an existing proposal is reused
- `PROPOSAL_CREATED` - When a new proposal is created
- `PROPOSAL_ARCHIVED` - When an old proposal is archived

**Log Format**:
```typescript
{
  event: 'PROPOSAL_REUSED' | 'PROPOSAL_CREATED' | 'PROPOSAL_ARCHIVED',
  matchId: string,
  vaultAddress: string,
  proposalId: string,
  transactionIndex: string,
  attemptCount: number,
  timestamp: string,
  // ... additional context
}
```

**Benefits**:
- Complete audit trail of proposal operations
- Easier debugging and troubleshooting
- Better observability

### 5. ✅ Background Cleanup Job

**Service**: `backend/src/services/proposalCleanupService.ts`

**Function**: `archiveOldProposals()`

**Criteria for Archiving**:
- Proposal is older than 7 days (configurable)
- Proposal status is ACTIVE but not Approved
- No recent activity (no new signatures in last 3 days)

**What it does**:
- Checks on-chain status of old proposals
- Archives proposals that don't exist on-chain
- Archives finalized proposals (Executed/Cancelled)
- Marks proposals as ARCHIVED (not deleted, for audit trail)

**Scheduling**: Runs daily via cron service

**Benefits**:
- Prevents database bloat
- Keeps proposal status accurate
- Maintains audit trail

## Integration Points

### Proposal Creation

The `createOrReuseProposal()` function should be integrated into proposal creation flows:

```typescript
import { createOrReuseProposal } from '../services/proposalManagementService';

// Instead of directly calling squadsService.proposeWinnerPayout()
const result = await createOrReuseProposal(
  matchId,
  vaultAddress,
  async (transactionIndex: bigint) => {
    return await squadsService.proposeWinnerPayout(
      vaultAddress,
      winner,
      winnerAmount,
      feeWallet,
      feeAmount,
      vaultPda
    );
  }
);
```

### Current Integration Status

⚠️ **Note**: The proposal creation code in `matchController.ts` (lines 4466-4531) still uses direct proposal creation. This should be updated to use `createOrReuseProposal()` for full benefit.

**Recommended Update**:
Replace direct calls to `squadsService.proposeWinnerPayout()` and `squadsService.proposeTieRefund()` with `createOrReuseProposal()` wrapper.

## Database Migrations

### Migration Order

1. `1734000000001-AddProposalAttemptCount.ts` - Adds proposalAttemptCount column
2. `1734000000000-AddProposalManagementIndexes.ts` - Adds indexes

**To Run**:
```bash
npm run migration:run
```

## Configuration

### Cleanup Service Configuration

Default values in `proposalCleanupService.ts`:
- `maxAgeDays`: 7 days (proposals older than this are candidates)
- `inactivityDays`: 3 days (no activity threshold)

Can be adjusted by modifying the function call in `cronService.ts`.

## Monitoring

### Key Metrics to Track

1. **Proposal Reuse Rate**: How often proposals are reused vs created
2. **Proposal Attempt Count**: Average attempts per match
3. **Cleanup Statistics**: Number of proposals archived per day
4. **Index Performance**: Query performance improvements

### Log Queries

```sql
-- Find matches with high attempt counts (potential issues)
SELECT id, "proposalAttemptCount", "payoutProposalId", "proposalStatus"
FROM "match"
WHERE "proposalAttemptCount" > 3
ORDER BY "proposalAttemptCount" DESC;

-- Find archived proposals
SELECT COUNT(*) FROM "match" WHERE "proposalStatus" = 'ARCHIVED';

-- Find proposals that were reused
SELECT COUNT(*) FROM "match" 
WHERE "proposalAttemptCount" > 1 
AND "proposalStatus" IN ('ACTIVE', 'APPROVED');
```

## Testing Recommendations

1. **Test Proposal Reuse**:
   - Create a match and proposal
   - Try to create another proposal for same match
   - Verify it reuses the existing one

2. **Test Cleanup**:
   - Create old proposals (manually set old dates)
   - Run cleanup job
   - Verify proposals are archived

3. **Test Indexes**:
   - Run queries that use the new indexes
   - Verify performance improvements

## Future Enhancements

1. **Proposal Versioning UI**: Show attempt count in admin dashboard
2. **Automatic Retry Logic**: Use attempt count to determine retry strategy
3. **Proposal Health Dashboard**: Monitor proposal lifecycle metrics
4. **Smart Indexing**: Add more composite indexes based on query patterns

## Files Modified/Created

### New Files
- `backend/src/services/proposalManagementService.ts`
- `backend/src/services/proposalCleanupService.ts`
- `backend/src/db/migrations/1734000000000-AddProposalManagementIndexes.ts`
- `backend/src/db/migrations/1734000000001-AddProposalAttemptCount.ts`

### Modified Files
- `backend/src/models/Match.ts` - Added proposalAttemptCount field
- `backend/src/services/cronService.ts` - Added cleanup job scheduling

### Integration Needed
- `backend/src/controllers/matchController.ts` - Update proposal creation to use createOrReuseProposal()

