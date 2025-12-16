# Systematic Replacement of All Squads Calls

This file documents the systematic replacement of all Squads calls with escrow checks.

## Strategy:
1. Wrap all `proposeWinnerPayout` calls with escrow check
2. Wrap all `proposeTieRefund` calls with escrow check  
3. Replace `executeProposal` with `settleMatch` for escrow matches
4. Skip `approveProposal`/`checkProposalStatus` for escrow (not needed)

## Helper function already added:
```typescript
function getMatchSystem(match: any): 'escrow' | 'squads' | null
```

## Pattern for replacement:
```typescript
// OLD:
const proposalResult = await squadsVaultService.proposeWinnerPayout(...);

// NEW:
const matchSystem = getMatchSystem(match);
if (matchSystem === 'escrow') {
  // Escrow settlement handled separately
  return;
} else if (matchSystem === 'squads') {
  const proposalResult = await squadsVaultService.proposeWinnerPayout(...);
}
```

