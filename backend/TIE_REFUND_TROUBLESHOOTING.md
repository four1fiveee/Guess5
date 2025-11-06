# Tie Refund Proposal Troubleshooting Guide

## Issue: `proposalId: null` in Frontend

When a tie occurs, the frontend should receive a `proposalId` for the refund proposal, but it's showing `null`.

## Diagnostic Steps

### 1. Check Backend Logs

Look for these log messages in your Render backend logs:

#### ✅ Success Logs:
```
🔄 Attempting to create tie refund proposal
✅ Tie refund proposal created: { matchId: '...', proposalId: '...' }
```

#### ❌ Error Logs:
```
❌ Failed to create tie refund proposal: { error: '...' }
❌ vaultTransactionCreate failed for tie refund
❌ Error creating payout proposal: ...
```

### 2. Verify Match Status

Check if the match has the required fields:

**Required Fields:**
- `winner === 'tie'`
- `isCompleted === true`
- `squadsVaultAddress` exists
- `player1Result` and `player2Result` exist
- Both results have `won === false` (losing tie)

**API Call:**
```bash
GET /api/match/status/{matchId}?wallet={walletAddress}
```

Check response for:
- `tieRefundProposalId` or `payoutProposalId`
- `proposalStatus`
- `needsSignatures`

### 3. Check Squads Vault Service

The proposal creation happens in `squadsVaultService.proposeTieRefund()`. Common issues:

#### Issue: Invalid Vault Address
**Error**: `Invalid vaultAddress PublicKey format`
**Solution**: Verify `squadsVaultAddress` is a valid Solana public key

#### Issue: Multisig Account Not Found
**Error**: `Failed to fetch multisig account for transaction index`
**Solution**: 
- Verify the vault exists on-chain
- Check the vault address is correct
- Ensure the vault was created successfully

#### Issue: Transaction Creation Failed
**Error**: `vaultTransactionCreate failed`
**Possible Causes**:
- Insufficient SOL in fee wallet
- Network connection issues
- Invalid program ID
- Transaction index mismatch

### 4. Check Environment Variables

Verify these are set correctly:

```bash
SOLANA_NETWORK=https://api.devnet.solana.com
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
FEE_WALLET_ADDRESS=...
FEE_WALLET_PRIVATE_KEY=...
```

### 5. Manual Proposal Creation

If automatic creation fails, you can manually trigger it:

**Endpoint**: `POST /api/match/fix-tie-proposal/:matchId`

**Request:**
```bash
curl -X POST https://guess5.onrender.com/api/match/fix-tie-proposal/{matchId}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Tie refund proposal created successfully",
  "proposalId": "1",
  "needsSignatures": 1
}
```

## Common Issues & Solutions

### Issue 1: Proposal Creation Never Triggers

**Symptom**: No logs about proposal creation attempts

**Check:**
1. Is `match.isCompleted === true`?
2. Is `match.winner === 'tie'`?
3. Does `match.squadsVaultAddress` exist?
4. Are both player results present?

**Solution**: Ensure match completion logic sets these fields correctly

### Issue 2: Proposal Creation Fails Silently

**Symptom**: Logs show attempt but no success/error

**Check:**
1. Look for caught exceptions in try-catch blocks
2. Check if `proposalResult.success` is false
3. Verify error messages in logs

**Solution**: Check backend logs for detailed error messages

### Issue 3: Proposal Created But Not Saved

**Symptom**: Logs show success but `proposalId` is still null

**Check:**
1. Verify database save operation succeeds
2. Check if `matchRepository.save()` throws errors
3. Verify proposal ID is being set on match object

**Solution**: Ensure all match updates are saved to database

### Issue 4: Frontend Not Receiving Proposal ID

**Symptom**: Backend has proposal but frontend shows null

**Check:**
1. Verify `/api/match/status/:matchId` returns `tieRefundProposalId`
2. Check frontend is reading from correct field: `matchData.payoutProposalId || matchData.tieRefundProposalId`
3. Ensure frontend is polling the correct endpoint

**Solution**: Check match status endpoint response structure

## Debugging Commands

### Check Match Status:
```bash
curl "https://guess5.onrender.com/api/match/status/{matchId}?wallet={walletAddress}"
```

### Check Match in Database:
```sql
SELECT 
  id, 
  winner, 
  is_completed, 
  squads_vault_address,
  payout_proposal_id,
  tie_refund_proposal_id,
  proposal_status,
  needs_signatures
FROM matches 
WHERE id = '{matchId}';
```

### Check Vault Balance:
```bash
# Using Solana CLI
solana balance {vaultAddress} --url devnet
```

## Enhanced Logging

The code now includes enhanced logging at these points:

1. **Before Proposal Creation**:
   ```
   🔄 Attempting to create tie refund proposal
   ```

2. **In Squads Service**:
   ```
   🔄 Proposing tie refund via Squads
   📍 Derived vault PDA for tie refund
   📊 Fetched multisig transaction index
   📝 Creating vault transaction for tie refund
   ```

3. **On Success**:
   ```
   ✅ Tie refund proposal created
   ✅ System signature added to tie refund proposal
   ```

4. **On Error**:
   ```
   ❌ Failed to create tie refund proposal
   ❌ vaultTransactionCreate failed for tie refund
   ```

## Next Steps

1. **Check Backend Logs**: Look for the enhanced error messages
2. **Verify Match Data**: Ensure all required fields are present
3. **Test Manual Creation**: Use the fix endpoint to manually create proposal
4. **Check Network**: Verify Devnet connection and program ID
5. **Check Vault**: Ensure vault exists and has funds

## Quick Fix Endpoint

If automatic creation fails, use this endpoint to manually create the proposal:

```
POST /api/match/fix-tie-proposal/:matchId
```

This endpoint:
- Verifies the match is a tie
- Checks if proposal already exists
- Creates the tie refund proposal
- Saves it to the database
- Returns the proposal ID

---

**Note**: After fixing the issue, the frontend should automatically pick up the proposal ID on the next poll (every 3 seconds).


