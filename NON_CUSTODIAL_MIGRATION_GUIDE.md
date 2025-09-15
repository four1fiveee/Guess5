# Non-Custodial Escrow Migration Guide

## Overview

This guide explains the transition from the current custodial escrow system to a non-custodial smart contract-based escrow system for Guess5.

## Current System Issues

### Custodial Risks
- **Fund Custody**: Your fee wallet holds all player funds
- **Single Point of Failure**: If your wallet is compromised, all funds are at risk
- **Regulatory Concerns**: Holding user funds may require additional compliance
- **Trust Requirements**: Players must trust you with their funds

### Current Flow Problems
1. Players pay entry fees to your fee wallet
2. Your backend verifies payments
3. Your backend creates payout transactions
4. Your fee wallet signs and executes all transactions

## New Non-Custodial System

### Key Benefits
- **No Fund Custody**: Players deposit directly into match-specific vaults
- **Transparent**: All match parameters and payouts are on-chain
- **Automatic**: Built-in timeout and refund mechanisms
- **Secure**: Only predefined outcomes can be settled

### Smart Contract Architecture

#### Match Account (PDA)
```rust
pub struct Match {
    pub player1: Pubkey,           // Player 1 wallet
    pub player2: Pubkey,           // Player 2 wallet  
    pub stake_lamports: u64,       // Entry fee per player
    pub fee_bps: u16,              // Fee in basis points (capped at 500 = 5%)
    pub deadline_slot: u64,        // Auto-refund deadline
    pub fee_wallet: Pubkey,        // Your fee collection wallet
    pub vault: Pubkey,             // Vault PDA for holding funds
    pub status: MatchStatus,       // Active, Settled, Refunded
    pub result: Option<MatchResult>, // P1, P2, Tie, None
    pub created_at: i64,           // Unix timestamp
    pub settled_at: Option<i64>,   // Settlement timestamp
}
```

#### Vault Account (PDA)
```rust
pub struct Vault {
    pub match_account: Pubkey,
    pub balance: u64,
    pub player1_deposited: bool,
    pub player2_deposited: bool,
}
```

### New Flow

1. **Match Creation**: Backend creates match on-chain with PDA
2. **Player Deposits**: Players deposit directly to match vault PDA
3. **Payment Verification**: Backend verifies on-chain deposits
4. **Match Settlement**: Results attestor settles with winner enum only
5. **Automatic Payout**: Smart contract distributes funds automatically

## Implementation Details

### Smart Contract Instructions

#### `create_match`
- Creates match and vault PDAs
- Sets immutable parameters
- Requires fee wallet signature

#### `deposit`
- Players deposit stake into vault
- Tracks deposit status
- Validates player authorization

#### `settle_match`
- Results attestor calls with winner enum
- Calculates payouts on-chain
- Distributes funds automatically

#### `refund_timeout`
- Anyone can call after deadline
- Refunds both players
- No fees on timeouts

### Backend Changes

#### New Services
- `SmartContractService`: Low-level smart contract interactions
- `NonCustodialMatchService`: High-level match management

#### Database Updates
- Added smart contract fields to Match model
- Migration script for new columns
- Indexes for performance

#### Configuration
- Smart contract program ID
- Results attestor keypair
- Fee and deadline parameters

## Security Features

### Non-Custodial Design
- **No Fund Control**: You never hold player funds
- **PDA Isolation**: Each match has its own vault
- **Immutable Parameters**: Match terms cannot be changed

### Attestor Security
- **Limited Authority**: Can only choose from predefined outcomes
- **No Amount Control**: Payouts calculated on-chain
- **Multisig Support**: Can use 2-of-3 multisig for production

### Timeout Protection
- **Automatic Refunds**: Built-in timeout mechanism
- **Anyone Can Trigger**: No single point of failure
- **No Locked Funds**: Funds cannot be locked indefinitely

## Migration Strategy

### Phase 1: Preparation
1. Deploy smart contract to devnet
2. Test with small amounts
3. Verify all functionality
4. Run database migration

### Phase 2: Parallel Operation
1. Deploy to mainnet
2. Run both systems in parallel
3. Route new matches to smart contract
4. Keep existing matches on old system

### Phase 3: Full Migration
1. Route all matches to smart contract
2. Monitor performance and security
3. Deprecate old custodial system
4. Remove legacy code

## Deployment Steps

### 1. Smart Contract Deployment
```bash
# Build the contract
cd backend/smart-contract
anchor build

# Deploy to devnet
anchor deploy --provider.cluster devnet

# Deploy to mainnet (when ready)
anchor deploy --provider.cluster mainnet
```

### 2. Backend Configuration
```bash
# Run database migration
npm run migration:run

# Update environment variables
SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
RESULTS_ATTESTOR_PUBKEY=YourResultsAttestorPubkey
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
```

### 3. Testing
```bash
# Run smart contract tests
cd backend/smart-contract
anchor test

# Test backend integration
npm run test
```

## Monitoring and Maintenance

### On-Chain Monitoring
- Track match creation events
- Monitor deposit confirmations
- Verify settlement transactions
- Check timeout refunds

### Backend Monitoring
- Match creation success rate
- Deposit success rate
- Settlement success rate
- Error rates and types

### Key Metrics
- Total matches created
- Total volume processed
- Average match duration
- Fee collection rate
- Timeout refund rate

## Risk Mitigation

### Smart Contract Risks
- **Audit**: Get professional audit before mainnet
- **Testing**: Comprehensive test coverage
- **Gradual Rollout**: Start with small amounts
- **Monitoring**: Real-time monitoring and alerts

### Operational Risks
- **Key Management**: Secure results attestor key
- **Backup Systems**: Keep old system as backup
- **Rollback Plan**: Ability to revert if needed
- **Support**: Clear escalation procedures

## Cost Analysis

### Smart Contract Costs
- **Deployment**: One-time cost
- **Match Creation**: ~0.002 SOL per match
- **Deposits**: ~0.0005 SOL per deposit
- **Settlement**: ~0.001 SOL per settlement

### Operational Savings
- **Reduced Risk**: No custodial liability
- **Lower Compliance**: Reduced regulatory burden
- **Better UX**: Faster, more transparent payouts
- **Scalability**: No backend bottleneck for payouts

## Timeline

### Week 1-2: Development
- Complete smart contract implementation
- Backend service integration
- Database migration
- Testing and debugging

### Week 3: Testing
- Deploy to devnet
- Run comprehensive tests
- Security review
- Performance testing

### Week 4: Deployment
- Deploy to mainnet
- Gradual rollout
- Monitor and adjust
- Full migration

## Support and Documentation

### Resources
- Smart contract README
- API documentation
- Deployment scripts
- Monitoring dashboards

### Support Channels
- Technical documentation
- Error handling guides
- Troubleshooting procedures
- Emergency contacts

## Conclusion

The non-custodial escrow system provides significant benefits in terms of security, transparency, and user trust. While the migration requires careful planning and execution, the long-term benefits far outweigh the short-term complexity.

The key to success is a gradual, well-monitored migration with proper testing and rollback capabilities. This approach minimizes risk while maximizing the benefits of the new system.














