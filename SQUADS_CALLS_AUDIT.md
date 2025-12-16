# Comprehensive Squads Calls Audit

## Found 39 Squads Service Calls in matchController.ts

### Category 1: Match Creation/Status (CRITICAL - Must Fix)
These are called during match creation or status checking and MUST use escrow for new matches:

1. **Line 5058**: `squadsVaultService.createMatchVault()` - ✅ FIXED (replaced with `escrowService.deriveMatchEscrowAddress()`)
2. **Line 5190**: `squadsVaultService.createMatchVault()` - ✅ FIXED (replaced with `escrowService.deriveMatchEscrowAddress()`)

### Category 2: Payout/Refund Operations (For OLD Matches Only)
These are for completed matches that already have Squads vaults. They should:
- Check if match has `escrowAddress` → use escrow settlement
- Check if match has `squadsVaultAddress` → use Squads (backward compatibility)

**Winner Payouts:**
- Line 3050: `squadsVaultService.proposeWinnerPayout()`
- Line 4047: `squadsVaultService.proposeWinnerPayout()`
- Line 4470: `squadsService.proposeWinnerPayout()`
- Line 4624: `squadsService.proposeWinnerPayout()`
- Line 5527: `squadsVaultService.proposeWinnerPayout()`
- Line 5979: `squadsVaultService.proposeWinnerPayout()`
- Line 6086: `squadsVaultService.proposeWinnerPayout()`
- Line 9914: `squadsVaultService.proposeWinnerPayout()`

**Tie Refunds:**
- Line 3614: `squadsVaultService.proposeTieRefund()`
- Line 4215: `squadsVaultService.proposeTieRefund()`
- Line 4515: `squadsService.proposeTieRefund()`
- Line 4659: `squadsService.proposeTieRefund()`
- Line 5567: `squadsVaultService.proposeTieRefund()`
- Line 6237: `squadsVaultService.proposeTieRefund()`
- Line 6370: `squadsVaultService.proposeTieRefund()`
- Line 9882: `squadsVaultService.proposeTieRefund()`

### Category 3: Proposal Execution (For OLD Matches Only)
- Line 288: `squadsVaultService.executeProposal()`
- Line 6668: `squadsVaultService.approveProposal()`
- Line 6725: `squadsVaultService.checkProposalStatus()`
- Line 6811: `squadsVaultService.executeProposal()`
- Line 6937: `squadsVaultService.executeProposal()`
- Line 9601: `squadsVaultService.executeProposal()`
- Line 15439: `squadsVaultService.executeProposalImmediately()`

### Category 4: Utility Functions (May Need Update)
- Line 5234: `squadsService.checkProposalStatus()`
- Line 5258: `squadsService.approveProposal()`
- Line 8717: `squadsVaultService.deriveVaultPda()`
- Line 12158: `squadsVaultService.verifyDeposit()`
- Line 15176: `squadsVaultService.checkProposalStatus()`

## Action Plan

### Immediate Fixes (Breaking for New Matches)
✅ DONE: Match creation calls (createMatchVault)

### Next: Add Escrow Support to Payout/Refund Operations
For each payout/refund operation, add logic:
```typescript
if (match.escrowAddress) {
  // Use escrow settlement
  await escrowService.settleMatch(...)
} else if (match.squadsVaultAddress) {
  // Use Squads (old matches)
  await squadsVaultService.proposeWinnerPayout(...)
}
```

### Then: Update Utility Functions
- `deriveVaultPda` → should check for escrow first
- `verifyDeposit` → should check escrow deposits
- `checkProposalStatus` → should check escrow status

