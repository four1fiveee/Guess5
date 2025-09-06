# Game Outcomes Handling Guide

## Overview

The Guess5 smart contract is designed to handle all possible game outcomes, ensuring fair and automatic fund distribution regardless of how the game ends.

## Supported Game Outcomes

### 1. **Player Wins** (Fee Applied)
- **Player1**: Player 1 solves the word first
- **Player2**: Player 2 solves the word first

**Payout Logic:**
- Winner receives: `2 * stake - fee` (95% of total pot)
- Fee wallet receives: `fee` (5% of total pot)
- Loser receives: `0`

### 2. **Winner Tie** (Gas Fee Only)
- **WinnerTie**: Both players solve the word correctly

**Payout Logic:**
- Both players receive: `stake - 0.0001 SOL` (refund minus gas fee)
- Fee wallet receives: `0.0002 SOL` (gas fee from both players)
- Reason: Both players demonstrated skill, only gas fee charged

### 3. **Losing Tie** (Fee Applied)
- **LosingTie**: Neither player solves the word correctly

**Payout Logic:**
- Both players receive: `stake - fee` (95% of their stake)
- Fee wallet receives: `fee * 2` (5% from each player)
- Reason: Both players failed, platform collects fee from both

### 4. **Timeout** (Gas Fee Only)
- **Timeout**: Game deadline passes without completion

**Payout Logic:**
- Both players receive: `stake - 0.0001 SOL` (refund minus gas fee)
- Fee wallet receives: `0.0002 SOL` (gas fee from both players)
- Reason: Game didn't complete, only gas fee charged

### 5. **Error/Abandoned** (Gas Fee Only)
- **Error**: Game encounters technical issues or is abandoned

**Payout Logic:**
- Both players receive: `stake - 0.0001 SOL` (refund minus gas fee)
- Fee wallet receives: `0.0002 SOL` (gas fee from both players)
- Reason: Technical issues, only gas fee charged

## Smart Contract Instructions

### 1. `create_match`
Creates a new match with:
- Player addresses
- Stake amount
- Fee percentage (capped at 5%)
- Deadline slot
- Results attestor (who can settle)

### 2. `deposit`
Players deposit their stake into the match vault:
- Validates player authorization
- Prevents double deposits
- Tracks deposit status

### 3. `settle_match`
Results attestor settles the match with one of the predefined outcomes:
- Only attestor can call this
- Only predefined results allowed
- Automatic fund distribution

### 4. `refund_timeout`
Anyone can call after deadline if both players deposited:
- Automatic refunds for timeouts
- No fee collection
- Prevents locked funds

### 5. `refund_partial_deposit`
Anyone can call after deadline if only one player deposited:
- Refunds the player who deposited
- Marks match as error
- Prevents partial fund locks

## Fee Structure

### When Fees Are Applied
- **Player1 Win**: 5% fee to platform
- **Player2 Win**: 5% fee to platform
- **LosingTie**: 5% fee from each player (10% total)

### When Only Gas Fees Are Applied
- **WinnerTie**: 0.0001 SOL gas fee from each player
- **Timeout**: 0.0001 SOL gas fee from each player
- **Error**: 0.0001 SOL gas fee from each player

## Security Features

### 1. **Non-Custodial Design**
- Players never lose control of their funds
- Each match has isolated vault
- No central fund custody

### 2. **Attestor Limitations**
- Can only choose predefined outcomes
- Cannot set arbitrary amounts
- Cannot redirect funds

### 3. **Timeout Protection**
- Automatic refunds after deadline
- Anyone can trigger refunds
- No funds can be locked indefinitely

### 4. **Partial Deposit Handling**
- Handles cases where only one player deposits
- Automatic refunds for incomplete matches
- Prevents fund locks

## Backend Integration

### Match Creation
```typescript
const result = await smartContractService.createMatch({
  player1: "player1_pubkey",
  player2: "player2_pubkey", 
  stakeLamports: 100000000, // 0.1 SOL
  feeBps: 500, // 5%
  deadlineSlot: currentSlot + 1000
});
```

### Match Settlement
```typescript
const result = await smartContractService.settleMatch({
  matchId: "match_id",
  result: "Player1", // or "Player2", "WinnerTie", "LosingTie", "Timeout", "Error"
  resultsAttestor: attestorKeypair
});
```

### Timeout Refund
```typescript
const result = await smartContractService.refundTimeout("match_id");
```

### Partial Deposit Refund
```typescript
const result = await smartContractService.refundPartialDeposit("match_id");
```

## Testing Coverage

The smart contract includes comprehensive tests for:

1. **Match Creation**: Validates all parameters
2. **Player Deposits**: Tests both players depositing
3. **Player1 Win**: Tests winner payout and fee collection
4. **Player2 Win**: Tests winner payout and fee collection
5. **Winner Tie**: Tests no-fee refund to both players
6. **Losing Tie**: Tests no-fee refund to both players
7. **Timeout Refund**: Tests automatic refunds after deadline
8. **Partial Deposit**: Tests refund when only one player deposits

## Error Handling

### Common Error Scenarios
1. **Invalid Player**: Non-match participant tries to deposit
2. **Double Deposit**: Player tries to deposit twice
3. **Unauthorized Settlement**: Non-attestor tries to settle
4. **Deadline Not Passed**: Refund called before deadline
5. **Invalid Partial State**: Refund called when both players deposited

### Error Codes
- `FeeTooHigh`: Fee exceeds 5% limit
- `StakeTooLow`: Stake below minimum (0.001 SOL)
- `InvalidDeadline`: Deadline in the past
- `MatchNotActive`: Match already settled/refunded
- `DeadlinePassed`: Operation after deadline
- `InvalidPlayer`: Unauthorized player
- `AlreadyDeposited`: Player already deposited
- `NotAllDeposited`: Settlement before both players deposit
- `UnauthorizedAttestor`: Non-attestor settlement attempt
- `DeadlineNotPassed`: Refund before deadline
- `InvalidPartialDeposit`: Invalid partial deposit state

## Monitoring and Events

### On-Chain Events
- `MatchCreated`: New match created
- `DepositMade`: Player deposit confirmed
- `MatchSettled`: Match settled with result
- `MatchRefunded`: Timeout/error refund processed

### Key Metrics to Monitor
- Match creation success rate
- Deposit success rate
- Settlement success rate
- Timeout refund frequency
- Partial deposit frequency
- Fee collection rate
- Average match duration

## Best Practices

### 1. **Deadline Management**
- Set reasonable deadlines (1000+ slots)
- Monitor for approaching deadlines
- Proactively trigger refunds if needed

### 2. **Attestor Security**
- Use multisig for production
- Store keys securely
- Monitor attestor activity

### 3. **Error Handling**
- Implement retry logic for failed transactions
- Monitor for stuck matches
- Have manual intervention procedures

### 4. **User Experience**
- Provide clear status updates
- Explain different outcome types
- Show transparent fee structure

## Conclusion

The smart contract provides comprehensive handling of all possible game outcomes, ensuring:
- **Fairness**: All outcomes are handled appropriately
- **Transparency**: All operations are on-chain
- **Security**: No funds can be locked or stolen
- **Automation**: Minimal manual intervention required
- **Flexibility**: Supports all game scenarios

This design eliminates custodial risks while providing a robust, fair, and transparent gaming experience.
