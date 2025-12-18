# Signature Model Clarification

## Current Design (Simplified)

**Backend Signature is Authoritative** - Only the backend needs to sign the result data.

### Who Can Submit?
- ✅ **Backend can submit directly** (no player signature needed)
- ✅ **Any player can submit** (for transparency/approval)
- ✅ **Anyone can submit** (as long as backend signature is valid)

### Why This Works
1. **Backend signs the result data** - This proves the result is legitimate
2. **Player signature is NOT required** - Backend signature is enough
3. **Anyone can submit** - Makes it permissionless and transparent

## Benefits

✅ **Simpler**: Backend can submit directly without waiting for players
✅ **Faster**: No need to wait for player signatures
✅ **More secure**: Backend signature is the only thing that matters
✅ **Transparent**: Anyone can verify and submit valid results

## Updated Code

- `player: UncheckedAccount<'info>` - No longer requires signature
- Removed player authorization check - backend signature is enough
- Backend can submit directly using its own keypair

## Backend Submission Flow

```typescript
// Backend can submit directly:
const backendWallet = getProviderWallet(); // Fee wallet keypair
const tx = await program.methods
  .submitResult(winner, resultType, signature)
  .accounts({
    gameEscrow: escrowPDA,
    backendSigner: backendSignerPubkey,
    player: backendSignerPubkey, // Backend submits as "player"
    instructionsSysvar: instructionsSysvar,
  })
  .signers([backendWallet.payer]) // Backend signs transaction
  .rpc();
```

## Player Submission (Optional)

Players can still submit if they want transparency, but it's not required:
- Backend signature proves authenticity
- Player submission is just for visibility/approval
- Not required for settlement

