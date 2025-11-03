# Guess5 Backend

This is the Express backend for the Guess5 game.

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and set your database and Solana/Anchor config.
3. Start PostgreSQL and run the migration:
   ```bash
   npm run migrate
   ```

## Run

```bash
npm run dev
```

## Features
- REST API for match and guess
- Socket.IO for real-time updates
- Calls Anchor client for escrow and payout
- PostgreSQL for matches, guesses, transactions 