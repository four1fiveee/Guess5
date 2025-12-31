# Smart Contract Deployment Instructions

## Current Program ID
`ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4`

## Deployment Steps

1. **Build the program:**
```bash
cd backend/programs/game-escrow
anchor build
```

2. **Deploy using fee wallet:**
```bash
# Option 1: Using Anchor CLI (recommended)
anchor deploy --provider.cluster devnet --provider.wallet <path-to-fee-wallet-keypair>

# Option 2: Using Solana CLI directly
solana program deploy target/deploy/game_escrow.so \
  --program-id ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4 \
  --keypair <path-to-fee-wallet-keypair> \
  --url devnet
```

3. **Verify deployment:**
```bash
solana program show ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4 --url devnet
```

## Fee Wallet
- Address: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
- Ensure it has at least 2 SOL for deployment

## Changes in This Deployment
- Close escrow account after refund to return rent to initializer
- Maximizes platform profitability by recovering rent
- Prevents fee wallet refunds for escrow matches

