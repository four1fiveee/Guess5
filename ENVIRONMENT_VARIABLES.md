## Environment Variables – Guess5.io (Slim Set)

This document lists the **minimum environment variables** you should keep configured for the new simplified escrow architecture. Anything not listed here is either legacy or optional and can usually be removed from Render / Vercel once the new flow is fully live.

---

## Backend (Render)

### Core runtime
- **NODE_ENV**: `production` in production, `development` locally.
- **PORT**: HTTP port for the backend (Render usually sets this; app falls back to `4000`).
- **DATABASE_URL**: Postgres connection string for the Guess5 database.
- **FRONTEND_URL**: Public URL of the frontend (e.g. `https://guess5.io`).

### Solana RPC & network
- **SOLANA_NETWORK**: Cluster identifier or URL. Common values:
  - `https://api.devnet.solana.com` (current default)
  - `devnet`, `mainnet-beta` (used together with Helius)
- **HELIUS_API_KEY** (optional but recommended): Helius API key. When set, backend uses
  `https://<network>.helius-rpc.com/?api-key=…` for premium RPC (via `solanaConnection.ts`).

### Escrow program & signing
- **SMART_CONTRACT_PROGRAM_ID**: Public key of the **simplified MatchEscrow program**.
- **BACKEND_SIGNER_PRIVATE_KEY**: Base58-encoded Ed25519 private key used to sign
  `MatchResult` structs off-chain.
- **BACKEND_SIGNER_PUBKEY**: Corresponding public key. The on-chain program will verify this
  key using the Ed25519 syscall.

### Fees & payouts
- **FEE_WALLET_ADDRESS**: Solana address that receives platform fees.
- **FEE_WALLET_PRIVATE_KEY**: Base58-encoded private key for the fee wallet; used for
  payouts and any house-fee transfers.
- **DEFAULT_FEE_BPS**: Default fee in basis points (e.g. `500` = 5%). Used by backend
  helpers and should match your on-chain fee logic.

### Redis / real-time infra
- **REDIS_MM_HOST**, **REDIS_MM_PORT**, **REDIS_MM_USER**, **REDIS_MM_PASSWORD**, **REDIS_MM_DB**, **REDIS_MM_TLS**: Matchmaking Redis instance.
- **REDIS_OPS_HOST**, **REDIS_OPS_PORT**, **REDIS_OPS_USER**, **REDIS_OPS_PASSWORD**, **REDIS_OPS_DB**, **REDIS_OPS_TLS**: Operational Redis instance (metrics, background jobs, etc.).

### Admin & security
- **ADMIN_USERNAME**: Admin panel username.
- **ADMIN_PASSWORD**: Admin panel password.
- **ADMIN_SECRET**: Secret used by admin auth middleware.
- **RECAPTCHA_SECRET** (production strongly recommended): ReCaptcha secret for abuse protection.

### Optional / legacy (safe to phase out once new escrow is fully live)
- **RESULTS_ATTESTOR_PUBKEY**: Older name for the backend result signer. New contract should
  use **BACKEND_SIGNER_PUBKEY** instead.
- **RESULTS_ATTESTOR_PRIVATE_KEY**: Legacy private key for results attestor (replace with
  `BACKEND_SIGNER_PRIVATE_KEY`).
- **SQUADS_PROGRAM_ID**, **SQUADS_NETWORK**: Legacy Squads multisig config. Not needed once all
  matches use the new `MatchEscrow` program.
- **CORS_ADDITIONAL_ORIGINS**: Comma-separated list of extra allowed origins if you need to
  temporarily allow more frontends.
- **SOLANA_RPC_URL**: Used only in a small number of places; prefer `SOLANA_NETWORK` + Helius.

---

## Frontend (Vercel)

### Core
- **NEXT_PUBLIC_API_URL**: Base URL of the backend (e.g. `https://guess5.onrender.com`).

### Solana & program
- **NEXT_PUBLIC_SOLANA_NETWORK**: Solana RPC URL or cluster for wallets and clients
  (e.g. `https://api.devnet.solana.com`).
- **NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID**: Public key of the simplified `MatchEscrow`
  program (must match `SMART_CONTRACT_PROGRAM_ID` on the backend).

### Signing / system keys
- **NEXT_PUBLIC_BACKEND_SIGNER_PUBKEY**: Public key of the backend result signer used by the
  contract (must match `BACKEND_SIGNER_PUBKEY`).
- **NEXT_PUBLIC_FEE_WALLET_ADDRESS**: Public fee wallet address (mirrors
  `FEE_WALLET_ADDRESS`).

### Optional / legacy
- **NEXT_PUBLIC_RESULTS_ATTESTOR_PUBKEY**, **NEXT_PUBLIC_SYSTEM_PUBLIC_KEY**: Legacy names for
  result attestor/system keys; safe to remove once frontend is updated to rely only on
  `NEXT_PUBLIC_BACKEND_SIGNER_PUBKEY`.

---

## What to Remove From Dashboards (After Migration)

Once the simplified escrow contract and integrations are fully live, you can safely delete
from Render / Vercel any variables **not mentioned** above, plus the “Optional / legacy”
entries, to keep your environment lean and easier to reason about.


