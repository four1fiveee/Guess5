# Guess5 Non-Custodial Escrow System

This smart contract implements a non-custodial escrow system for the Guess5 word game, eliminating the need for the platform to hold player funds.

## Architecture Overview

### Key Features

1. **Non-Custodial**: Players deposit directly into match-specific vault PDAs
2. **Transparent**: All match parameters and payouts are on-chain
3. **Automatic**: Built-in timeout and refund mechanisms
4. **Secure**: Only the results attestor can settle matches, and only with predefined outcomes

### Smart Contract Components

#### Match Account (PDA)
- Stores match parameters (players, stake, fee, deadline)
- Immutable once created
- Contains vault PDA reference

#### Vault Account (PDA)
- Holds player deposits
- Tracks deposit status for each player
- Automatically distributes funds on settlement

#### Instructions

1. **`create_match`**: Creates match and vault PDAs
2. **`deposit`**: Players deposit stake into vault
3. **`settle_match`**: Results attestor settles with winner enum
4. **`refund_timeout`**: Anyone can trigger refunds after deadline

## Deployment

### Prerequisites

1. Install Anchor framework
2. Install Solana CLI tools
3. Configure wallet and RPC endpoint

### Build and Deploy

```bash
# Build the program
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet (when ready)
anchor deploy --provider.cluster mainnet
```

### Environment Variables

Add these to your backend environment:

```env
# Smart Contract Configuration
SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
RESULTS_ATTESTOR_PUBKEY=YourResultsAttestorPubkey
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000
```

## Integration with Backend

### Database Migration

Run the migration to add smart contract fields:

```bash
npm run migration:run
```

### Service Integration

The backend now includes:

- `SmartContractService`: Low-level smart contract interactions
- `NonCustodialMatchService`: High-level match management
- Updated `Match` model with smart contract fields

### Flow Changes

#### Old Flow (Custodial)
1. Players pay to fee wallet
2. Backend verifies payments
3. Backend creates payout transactions
4. Fee wallet signs and sends payouts

#### New Flow (Non-Custodial)
1. Backend creates match on-chain
2. Players deposit to match vault PDA
3. Backend verifies on-chain deposits
4. Results attestor settles match
5. Smart contract distributes funds automatically

## Security Considerations

### Results Attestor
- Only the results attestor can settle matches
- Can only choose from predefined outcomes (P1, P2, Tie)
- Cannot set arbitrary amounts or recipients
- Should be a 2-of-3 multisig for production

### Timeout Protection
- Automatic refunds if deadline passes
- Anyone can trigger timeout refunds
- No funds can be locked indefinitely

### Fee Limits
- Maximum fee is capped at 10% (1000 basis points)
- Default fee is 5% (500 basis points)
- Fees are calculated on-chain, not off-chain

## Testing

Run the test suite:

```bash
anchor test
```

The tests cover:
- Match creation
- Player deposits
- Match settlement
- Timeout refunds
- Error conditions

## Monitoring

### On-Chain Events

The contract emits events for:
- `MatchCreated`: New match created
- `DepositMade`: Player deposit confirmed
- `MatchSettled`: Match settled with result
- `MatchRefunded`: Timeout refund processed

### Backend Monitoring

Monitor these metrics:
- Match creation success rate
- Deposit success rate
- Settlement success rate
- Timeout refund frequency
- Smart contract balance

## Migration Strategy

### Phase 1: Parallel Operation
- Deploy smart contract
- Run both systems in parallel
- Test with small amounts

### Phase 2: Gradual Migration
- Route new matches to smart contract
- Keep existing matches on old system
- Monitor performance and security

### Phase 3: Full Migration
- Route all matches to smart contract
- Deprecate old custodial system
- Remove legacy code

## Troubleshooting

### Common Issues

1. **PDA Derivation Errors**: Ensure match parameters are consistent
2. **Insufficient Funds**: Check player balances before deposits
3. **Deadline Issues**: Verify slot calculations
4. **Attestor Errors**: Ensure results attestor is properly configured

### Debug Commands

```bash
# Check program account
solana account <PROGRAM_ID>

# Check match account
solana account <MATCH_PDA>

# Check vault account
solana account <VAULT_PDA>

# View transaction logs
solana logs <TRANSACTION_SIGNATURE>
```

## Future Enhancements

1. **Multi-token Support**: Support for SPL tokens
2. **Tournament Mode**: Multi-player tournaments
3. **Staking Rewards**: Additional rewards for stakers
4. **Governance**: Community governance for parameters
5. **Cross-chain**: Support for other blockchains







