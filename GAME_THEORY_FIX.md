# Game Theory Fix - Timeout Penalty

## Problem Identified

**Critical Game Theory Flaw**: Players could game the system by refusing to submit results:

1. **Loser Gaming**: A losing player could refuse to submit, forcing timeout to get 100% refund instead of losing
2. **Tie Gaming**: Both players in a tie could refuse to submit to get 100% refund instead of 95% refund (DrawPartialRefund)

### Previous Behavior
- **Timeout (Unresolved)**: 100% refund to both players (0% fee) ❌
- **DrawPartialRefund**: 95% refund to each player (5% fee) ✅
- **DrawFullRefund**: 100% refund to each player (0% fee) ✅

This created perverse incentives where players would prefer timeout over submitting results.

## Solution Implemented

**Timeout Penalty**: Timeout now charges a **10% penalty fee** (higher than normal 5% fee) to disincentivize gaming:

- **Timeout (Unresolved)**: 90% refund to each player, 10% penalty fee ✅
- **DrawPartialRefund**: 95% refund to each player, 5% fee ✅
- **DrawFullRefund**: 100% refund to each player, 0% fee ✅

### Rationale
- **10% penalty** is higher than normal 5% fee, making timeout the worst option
- Players now have incentive to submit results rather than wait for timeout
- Loser still loses (can't game timeout for full refund)
- Tie players get better refund by submitting (95%) vs timeout (90%)

## Code Changes

**Location**: `backend/programs/game-escrow/src/lib.rs`

1. **Fee calculation** (line ~325): Timeout now calculates 10% penalty fee
2. **Settlement logic** (line ~494): Timeout refunds 90% per player and transfers 10% to fee wallet

## Impact

✅ **Prevents gaming**: Players can't profit from refusing to submit
✅ **Maintains fairness**: Legitimate timeouts still get refund (just with penalty)
✅ **Incentivizes cooperation**: Players are better off submitting results

## Testing Required

- [ ] Test timeout scenario: Both players don't submit → should get 90% refund each, 10% fee
- [ ] Test tie scenario: Both players submit tie → should get 95% refund each, 5% fee
- [ ] Verify timeout is worse than tie (90% < 95%)
- [ ] Verify timeout is worse than win (loser gets 0%, not 90%)

