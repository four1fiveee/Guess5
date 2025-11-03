# Squads Integration Fixes - Summary

## Changes Made (Commit: 37ed13ef)

### 1. Auto-Approve System Signature ✅
- **File**: `backend/src/services/squadsVaultService.ts`
- **Changes**:
  - System automatically signs proposals immediately after creation
  - Both `proposeWinnerPayout()` and `proposeTieRefund()` now auto-approve with system keypair
  - Updated `needsSignatures` from 2 to 1 (system already signed, only 1 player needed)

### 2. Player Approval Endpoints ✅
- **File**: `backend/src/controllers/multisigController.ts`
- **Endpoints Created**:
  - `GET /api/multisig/proposals/:matchId` - Get proposal details
  - `POST /api/multisig/proposals/:matchId/approve` - Player approval endpoint
  - `POST /api/multisig/cleanup-stuck-matches` - Cleanup old stuck matches

### 3. Cleanup for Stuck Matches ✅
- Automatically removes matches older than 12 hours that are completed but have no proposal
- Prevents players from getting stuck on results page

## Next Steps Required

### 1. Register Multisig Routes
Add to your Express server routes file:
```typescript
import { getProposal, approveProposal, cleanupStuckMatches } from './controllers/multisigController';

router.get('/api/multisig/proposals/:matchId', getProposal);
router.post('/api/multisig/proposals/:matchId/approve', approveProposal);
router.post('/api/multisig/cleanup-stuck-matches', cleanupStuckMatches);
```

### 2. Fix Vercel Frontend Directory
The frontend directory structure needs to be verified. Check Vercel project settings for the correct root directory path.

### 3. Delete Stuck Match
The match `aebc06bb-30ef-465f-8fc1-eae608ecae39` needs to be deleted. Use:
```bash
# Via HTTP endpoint (once routes registered):
POST https://guess5.onrender.com/api/multisig/cleanup-stuck-matches
```

Or run the cleanup script on Render.

## How 2-of-3 Multisig Works Now

1. **System proposes and auto-signs** (1 signature)
2. **Player signs via frontend/Phantom** (2 signatures = executed)
3. **Either player in a tie can sign** to reach 2-of-3

Players interact via frontend using Squads SDK (`@sqds/multisig`) to sign proposals with their Phantom wallet.

