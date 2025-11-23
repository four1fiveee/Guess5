# Fund Flow Analysis for Match 3975ec64-0551-444f-a8a5-c0515664f65e

## Match Summary
- **Match ID**: 3975ec64-0551-444f-a8a5-c0515664f65e
- **Outcome**: Losing Tie (Both players failed to solve)
- **Entry Fee**: 0.0392 SOL per player
- **Total Entry Fees**: 0.0784 SOL

## Entry Fee Deposits

### Player 1
- **Wallet**: (Not explicitly shown in logs, but match has player1)
- **Entry Fee Paid**: 0.0392 SOL
- **Deposit Transaction**: (Player 1 deposit TX not shown in logs, but confirmed via balance check)

### Player 2  
- **Wallet**: F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8
- **Entry Fee Paid**: 0.0392 SOL
- **Deposit Transaction**: 3UXoRDFzg7UanCQGJiH28cBWdBBBUrW3DV82eJQBsMgbWHsQaMn79ijbdUSX8VvSc8Qo42fSvMdZ3ZpUz1zSUZ3e
- **Confirmed**: ✅ (Logs show "✅ Player 2 deposit confirmed" with balanceSOL: 0.0784)

## Vault Information
- **Multisig Address**: fbUyCcHkJNxZETtcfMPr6hmDDAy7XixQFNpZmA6TBo8
- **Vault PDA**: DkxNAb1vC5yzSSMiPk9zDop71PLxnAQxESZTFMqJk9Ey
- **Vault Balance**: 0.0784 SOL (confirmed in logs)
- **Rent Exempt Reserve**: 0.00249864 SOL

## Tie Refund Proposal

### Proposal Details
- **Proposal ID**: DXVjA7h3znAYDnAFwt2fVpuUT6wCyGgshmPTxqeaCFqb
- **Transaction PDA**: B7HcERLFsxeb9t2gL7TJ7XPpdBXAqXJxycFb2CmeXcck
- **Status**: Approved (but NOT ExecuteReady)
- **Signers**: 
  - 2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt (Fee Wallet)
  - F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8 (Player 2)
- **Threshold**: 2
- **Current Signatures**: 2
- **Needs Signatures**: 0

### Refund Calculation (Losing Tie)
- **Refund per player**: 0.0392 SOL × 95% = 0.03724 SOL
- **Total refund amount**: 0.07448 SOL (both players)
- **Platform fee**: 0.0392 SOL × 5% × 2 = 0.00392 SOL
- **Remaining in vault after refunds**: 0.00249864 SOL (rent reserve)

## Proposal Execution Status

### Execution Attempts
The logs show multiple execution attempts, all failing with errors:
- **Error**: "Cannot read properties of undefined (reading 'getAccountInfo')"
- **Status**: Proposal remains in "Approved" state, never transitioned to "ExecuteReady"
- **Last attempt**: Around 18:10:03 UTC on 2025-11-22

### Issue Identified
The proposal has enough signatures (2/2) but:
1. Proposal status is "Approved" but NOT "ExecuteReady"
2. VaultTransaction status shows 0 approvals (status: Active, not ExecuteReady)
3. Execution attempts fail because the proposal is not in ExecuteReady state

## Expected Fund Distribution (When Executed)

### If Proposal Executes Successfully:
1. **Player 1 Refund**: 0.03724 SOL
2. **Player 2 Refund**: 0.03724 SOL  
3. **Platform Fee**: 0.00392 SOL (should go to fee wallet: 2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt)
4. **Rent Reserve**: 0.00249864 SOL (stays in vault)
5. **Gas/Transaction Fees**: ~0.0005 SOL (estimated, paid from vault during execution)

### Current State
**⚠️ CRITICAL**: The proposal has NOT been executed yet. Funds are still in the vault:
- **Vault Balance**: 0.0784 SOL
- **Status**: Waiting for proposal to transition to ExecuteReady state

## Next Steps to Complete Fund Flow

1. **Check if proposal was eventually executed** by querying Solana Explorer for:
   - Proposal PDA: DXVjA7h3znAYDnAFwt2fVpuUT6wCyGgshmPTxqeaCFqb
   - Transaction PDA: B7HcERLFsxeb9t2gL7TJ7XPpdBXAqXJxycFb2CmeXcck

2. **If executed, trace the execution transaction** to see:
   - Exact amounts transferred to each player
   - Fee wallet payment
   - Gas costs
   - Any remaining balance in vault

3. **If not executed**, the funds remain locked in the vault until:
   - Proposal transitions to ExecuteReady state
   - Execution transaction is successfully submitted

## Solana Explorer Links

- **Deposit Transaction**: https://solscan.io/tx/3UXoRDFzg7UanCQGJiH28cBWdBBBUrW3DV82eJQBsMgbWHsQaMn79ijbdUSX8VvSc8Qo42fSvMdZ3ZpUz1zSUZ3e
- **Proposal Account**: DXVjA7h3znAYDnAFwt2fVpuUT6wCyGgshmPTxqeaCFqb
- **Vault Account**: DkxNAb1vC5yzSSMiPk9zDop71PLxnAQxESZTFMqJk9Ey
- **Multisig Account**: fbUyCcHkJNxZETtcfMPr6hmDDAy7XixQFNpZmA6TBo8

## Notes
- The proposal execution service was retrying but failing due to SDK/state transition issues
- Both players have signed the proposal (threshold met)
- The system needs to manually trigger execution or wait for automatic state transition

