# Escrow System Security Verification

## ✅ Backend Signer Private Key Security

### Current Implementation
- **Location**: `backend/src/utils/escrowSigning.ts`
- **Environment Variables Used**:
  - `BACKEND_SIGNER_PRIVATE_KEY` (primary)
  - `RESULTS_ATTESTOR_PRIVATE_KEY` (fallback)
  - `FEE_WALLET_PRIVATE_KEY` (fallback)

### Security Checks
✅ **Private key is NEVER exposed to frontend**
- Only used server-side in `createSignedResult()` function
- Frontend only receives the signed payload (match_id, winner, result_type) and signature
- Signature is verified on-chain using Ed25519 program

✅ **Private key stored in environment variables**
- Should be stored in Render secrets (not in code)
- Never logged or exposed in error messages
- Only accessed via `getBackendSignerPrivateKey()` which reads from `process.env`

### Recommendations
- [ ] Verify `BACKEND_SIGNER_PRIVATE_KEY` is set in Render environment variables
- [ ] Ensure private key is NOT in any committed files or documentation
- [ ] Use separate key for production vs devnet (different `BACKEND_SIGNER_PUBKEY` values)

## ✅ Result Type Tampering Prevention

### On-Chain Verification
The Anchor program verifies:
1. **Message format**: `match_id:{id},winner:{pubkey},result_type:{type}`
2. **Signature verification**: Uses Solana's `ed25519_program` syscall
3. **Backend public key**: Hardcoded in program as `RESULTS_ATTESTOR_PUBKEY`

### Frontend Protection
✅ Players cannot tamper with result types because:
- Backend determines result type based on game outcome
- Frontend only receives the backend-signed result
- On-chain verification rejects any tampered signatures

### Test Cases
- [ ] Test: Frontend sends tampered result_type → Should be rejected by on-chain verification
- [ ] Test: Frontend sends wrong match_id → Should be rejected
- [ ] Test: Frontend sends wrong winner → Should be rejected

## ✅ Edge Cases Handled

### 1. Single Player Deposit
**Anchor Program**: `refund_if_only_one_paid()` instruction
- ✅ Requires: `clock.unix_timestamp >= escrow.timeout_at`
- ✅ Requires: `GameStatus::Pending`
- ✅ Refunds 100% to the paying player
- ✅ Sets status to `Settled`

**Backend**: Should call this after timeout if only one player paid

### 2. Both Deposit But No Result
**Anchor Program**: `settle()` instruction handles timeout
- ✅ Can settle if: `result_type == Unresolved` AND `timeout_at < now`
- ✅ Full refund to both players (no fee)
- ✅ Sets status to `Settled`

### 3. Draw Scenarios
**Anchor Program**: `settle()` handles different result types
- ✅ `DrawFullRefund`: 100% refund each, 0% fee
- ✅ `DrawPartialRefund`: 95% refund each, 5% fee
- ✅ `Unresolved` (timeout): 100% refund each, 0% fee

### 4. Double Settlement Prevention
**Anchor Program**: `settle()` checks
- ✅ Requires: `GameStatus::Active` (not `Settled`)
- ✅ Sets status to `Settled` at the end
- ✅ Second call will fail with `InvalidGameStatus` error

### 5. Invalid Signature Rejection
**Anchor Program**: `submit_result()` verifies
- ✅ Uses `ed25519_program` syscall for on-chain verification
- ✅ Rejects if signature doesn't match backend public key
- ✅ Rejects if message format is wrong

## ✅ Database Persistence

### Match Data Stored
- ✅ `escrowAddress`: PDA address for the escrow
- ✅ `escrowStatus`: PENDING, INITIALIZED, ACTIVE, SETTLED
- ✅ `escrowResultSubmittedAt`: Timestamp when result was submitted
- ✅ `escrowResultSubmittedBy`: Player who submitted the result

### Backend Crash Recovery
- ✅ Match data persists in PostgreSQL
- ✅ Escrow address is deterministic (derived from match_id)
- ✅ Can query escrow state on-chain after restart
- ✅ Settlement can be retried if backend crashes

## 🔧 Remaining Squads Code (Backward Compatibility)

### Files Still Using Squads
- `backend/src/controllers/matchController.ts` - Many references for old matches
- `backend/src/services/squadsVaultService.ts` - Stub file (should not cause build errors)

### Recommendation
The stub file should be safe, but if it's causing TypeScript errors, we can:
1. Add `@ts-nocheck` at the top (already present)
2. Ensure all methods return proper types
3. Consider moving to a separate `legacy` folder if needed

## 📋 Testing Checklist

### End-to-End Flow
- [ ] Create match → Escrow address derived
- [ ] Player A deposits → Escrow balance updates
- [ ] Player B deposits → Game becomes Active
- [ ] Play game → Backend determines winner
- [ ] Backend signs result → Signature created
- [ ] Player submits result → On-chain verification passes
- [ ] Settle called → Funds distributed (95% winner, 5% fee)

### Edge Cases
- [ ] Only one player deposits → Timeout refund works
- [ ] Both deposit but never play → Timeout refund works
- [ ] Draw (both tied) → Full or partial refund works
- [ ] Tampered signature → Rejected by on-chain verification
- [ ] Backend crash → Match data persists, can retry settlement

### Security Tests
- [ ] Private key not exposed to frontend
- [ ] Result type cannot be tampered
- [ ] Double settlement prevented
- [ ] Invalid signatures rejected

