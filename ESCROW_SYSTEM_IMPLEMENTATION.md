# Escrow System Implementation Summary

## Overview

This document describes the new escrow-based system that replaces the Squads multisig vault system. The escrow system provides a simpler, more reliable way to handle match deposits and payouts.

## What Was Built

### 1. Anchor Program (`backend/programs/game-escrow/`)

A new Solana Anchor program with the following instructions:

- **`initialize_match`**: Creates a new escrow account for a match (called by Player A)
- **`deposit`**: Allows either player to deposit their entry fee
- **`submit_result`**: Allows a player to approve a game result (with backend signature verification)
- **`settle`**: Distributes funds based on game outcome (can be called by anyone after result or timeout)
- **`refund_if_only_one_paid`**: Refunds a single player if only they deposited (after timeout)

### 2. Backend Services

- **`escrowService.ts`**: Main service for interacting with the escrow program
- **`escrowSigning.ts`**: Utility for creating and verifying Ed25519 signatures for result verification
- **`escrowController.ts`**: Express controller for escrow endpoints
- **`escrowRoutes.ts`**: API routes for escrow operations

### 3. Database Changes

- Added new fields to `Match` model:
  - `escrowAddress`: PDA address for the escrow account
  - `escrowStatus`: Status of the escrow (PENDING, INITIALIZED, ACTIVE, SETTLED, REFUNDED)
  - `escrowResultSubmittedAt`: When result was submitted
  - `escrowResultSubmittedBy`: Which player submitted the result
  - `escrowBackendSignature`: Backend signature for result verification

- Migration: `018_add_escrow_fields.ts` adds these fields to the database

### 4. Frontend Components

- **`EscrowDeposit.tsx`**: Component for players to deposit entry fees

## API Endpoints

### POST `/api/escrow/initialize`
Initialize escrow for a new match
```json
{
  "matchId": "uuid",
  "playerA": "pubkey",
  "playerB": "pubkey",
  "entryFee": 0.1
}
```

### POST `/api/escrow/deposit-transaction`
Get a deposit transaction for a player
```json
{
  "matchId": "uuid",
  "playerPubkey": "pubkey",
  "entryFee": 0.1
}
```

### POST `/api/escrow/submit-result`
Submit game result (called by player to approve)
```json
{
  "matchId": "uuid",
  "playerPubkey": "pubkey",
  "winner": "pubkey or null",
  "resultType": "Win" | "DrawFullRefund" | "DrawPartialRefund"
}
```

### POST `/api/escrow/settle`
Settle a match (can be called by backend or player)
```json
{
  "matchId": "uuid"
}
```

### GET `/api/escrow/state/:matchId`
Get current escrow state

### GET `/api/escrow/signed-result/:matchId`
Get backend-signed result for a match

## Flow

### Match Creation
1. Player A creates a match → `initialize_match` is called
2. Escrow PDA is created and stored in database

### Deposit
1. Player A deposits → `deposit` instruction
2. Player B deposits → `deposit` instruction
3. When both deposit, game status becomes `Active`

### Game Completion
1. Backend determines winner/result
2. Backend signs result with Ed25519
3. Player calls `submit_result` to approve (with backend signature)
4. Backend or anyone calls `settle` to distribute funds

### Payout Rules
- **Win**: Winner gets 95% of pot, 5% platform fee
- **DrawFullRefund**: Both players get 100% refund (same time/moves)
- **DrawPartialRefund**: Both players get 95% refund, 5% fee (both lost)
- **Timeout**: Full refund to both players

## Environment Variables

Add these to your `.env`:

```bash
# Backend signer (for result verification)
BACKEND_SIGNER_PUBKEY=<your_backend_pubkey>
BACKEND_SIGNER_PRIVATE_KEY=<your_backend_private_key>

# Or use existing fee wallet
FEE_WALLET_ADDRESS=<fee_wallet_pubkey>
FEE_WALLET_PRIVATE_KEY=<fee_wallet_private_key>
```

## Migration Notes

1. **Squads fields are deprecated but kept** for backward compatibility
2. **New matches should use escrow system**
3. **Existing Squads matches** can continue to use the old system
4. **Referral system is unchanged** and continues to work

## Next Steps

1. Deploy the Anchor program to devnet/mainnet
2. Update program ID in `backend/src/config/environment.ts` if needed
3. Run database migration: `npm run migrate`
4. Update frontend to use `EscrowDeposit` component instead of `MultisigVaultDeposit`
5. Test the full flow on devnet before mainnet deployment

## Testing

See `backend/programs/game-escrow/tests/` for Anchor tests (to be created).

## Notes

- The escrow system is simpler than Squads and doesn't require multisig proposals
- Players must sign to approve results (non-custodial)
- Backend signs results for verification
- Timeout handling is built-in (10 minutes)
- Funds can never be locked forever

