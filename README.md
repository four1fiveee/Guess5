# Guess5

A Wordle-style, head-to-head staking game built with Next.js, Express, and Solana (Anchor).
**Theme inspired by the included logo.**

---

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- PostgreSQL
- Redis
- Solana CLI
- Anchor CLI

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd Guess5

# Install dependencies
cd frontend && npm install && cd ..
cd backend && npm install && cd ..
```

### 2. Environment Setup

```bash
# Copy environment template
cp backend/env.example backend/.env

# Edit backend/.env with your configuration
# - Database URL
# - Redis URL  
# - Fee wallet private key
```

### 3. Deploy Smart Contract

```bash
cd backend/guess5-escrow
anchor build
anchor deploy --provider.cluster devnet
```

### 4. Test Integration

```bash
cd backend
node test-smart-contract.js
```

### 5. Start Development

```bash
# Backend
cd backend
npm run dev

# Frontend (new terminal)
cd frontend
npm run dev
```

---

## 📋 Project Structure

- `/frontend` — Next.js app (TypeScript, Tailwind CSS)
- `/backend` — Express API (TypeScript, PostgreSQL, Redis)
- `/backend/guess5-escrow` — Solana smart contract (Anchor, Rust)

---

## 🎮 How to Play

1. Connect your Phantom wallet
2. Choose a lobby ($1, $5, $20)
3. Wait for an opponent
4. Play Guess5 (Wordle-style, 5-letter words, 7 tries, 15s per guess)
5. Winner takes 95% of the pot, house takes 5%. Tie = refund.

---

## 🛠 Tech Stack

- **Frontend:** Next.js, TypeScript, Tailwind CSS, @solana/wallet-adapter
- **Backend:** Express, TypeScript, PostgreSQL, Redis, Socket.IO
- **Smart Contract:** Solana, Anchor (Rust)
- **Deployment:** Render (backend), Vercel (frontend)

---

## 🚀 Production Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for detailed deployment instructions.

**Current Program ID:** `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`

---

## 🔧 Development

- All code is commented for clarity
- Smart contract uses non-custodial escrow system
- Backend handles matchmaking and game state
- Frontend provides real-time game interface

---

## 📄 License

MIT License - see LICENSE file for details 