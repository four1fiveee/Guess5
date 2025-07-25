# Guess5 Solana Contract

This is the Anchor (Rust) smart contract for Guess5.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set your Solana provider and wallet.

## Test

```bash
anchor test
```

## Features
- Escrow SOL for two players
- Store results and payout/refund
- Unit tests for all flows 