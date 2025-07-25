# Guess5

A Wordle-style, head-to-head staking game built with Next.js, Express, and Solana (Anchor).
**Theme inspired by the included logo.**

---

## Monorepo Structure

- `/frontend` — Next.js app (TypeScript, Tailwind CSS)
- `/backend` — Express API (TypeScript, PostgreSQL, Anchor client)
- `/contract` — Solana smart contract (Anchor, Rust)

---

## Quick Start

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd Guess5
# Install all dependencies
cd frontend && npm install && cd ..
cd backend && npm install && cd ..
cd contract && npm install && cd ..
```

### 2. Environment Variables

- Copy `.env.example` in each folder to `.env` and fill in values as needed.

### 3. Database

- Start PostgreSQL locally (see backend/.env.example for config).
- Run migrations:
  ```bash
  cd backend
  npm run migrate
  ```

### 4. Start All Services

- **Contract (local test validator):**
  ```bash
  cd contract
  anchor test
  ```
- **Backend:**
  ```bash
  cd backend
  npm run dev
  ```
- **Frontend:**
  ```bash
  cd frontend
  npm run dev
  ```

---

## How to Play

1. Connect your Phantom wallet.
2. Choose a lobby ($1, $5, $20).
3. Wait for an opponent.
4. Play Guess5 (Wordle-style, 5-letter words, 7 tries, 15s per guess).
5. Winner takes 90% of the pot, loser 10%. Tie = refund.

---

## Tech Stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS, @solana/wallet-adapter
- **Backend:** Express, TypeScript, PostgreSQL, Socket.IO, Anchor client
- **Smart Contract:** Solana, Anchor (Rust)

---

## Logo & Theme

- The UI uses colors from `/logo/logo.png`.

---

## For Developers

- All code is commented for clarity.
- See each folder’s README for more details. 