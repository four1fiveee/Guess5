# Manual Sync and Execute Guide

## Current State for Match `15dcfba1-b4a5-4896-b563-937fa04d45f5`

### On-Chain Status ✅
- **Transaction Index 02**: `Approved` with 2/2 signatures
  - Fee wallet: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
  - Player: `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
- **Threshold**: 2 of 3 ✅ (met)
- **Status**: Not executed yet

### Database Status ❌
- **Proposal Status**: `ACTIVE` (should be `APPROVED`)
- **Proposal Signers**: Only fee wallet recorded
- **Desynced**: Database doesn't reflect on-chain state

## 🔄 How to Trigger Sync

### Option 1: Via GET Endpoint (Automatic Sync)
The `getMatchStatusHandler` automatically runs sync when called:

```bash
curl -X GET "https://guess5.onrender.com/api/match/status/15dcfba1-b4a5-4896-b563-937fa04d45f5"
```

This should:
1. Call `syncProposalIfNeeded()` for the stored proposal ID
2. If not found, call `findAndSyncApprovedProposal()` to search transaction indices
3. Update database to `APPROVED` with both signers

### Option 2: Via Admin Endpoint (Manual Execution)
If sync works but execution doesn't trigger automatically:

```bash
# Requires admin authentication
curl -X POST "https://guess5.onrender.com/api/admin/execute-proposal/15dcfba1-b4a5-4896-b563-937fa04d45f5" \
  -H "Authorization: Bearer <admin-token>"
```

This will:
1. Sync proposal status (if needed)
2. Execute the proposal immediately
3. Update database with execution signature

### Option 3: Via Script (Local Development)
Use the manual script:

```bash
cd backend
node scripts/manual-sync-and-execute.js 15dcfba1-b4a5-4896-b563-937fa04d45f5
```

## ⚙️ Expected Flow After Sync

1. **Database Updates**:
   - `proposalStatus`: `ACTIVE` → `APPROVED`
   - `proposalSigners`: `["feeWallet"]` → `["feeWallet", "player"]`
   - `needsSignatures`: `1` → `0`

2. **Execution Monitor**:
   - Picks up `APPROVED` status
   - Calls `executeProposal()` with fixed parameters (`feePayer` + `member`)
   - Executes transaction on-chain

3. **Database Updates After Execution**:
   - `proposalStatus`: `APPROVED` → `EXECUTED`
   - `proposalExecutedAt`: Timestamp populated
   - `proposalTransactionId`: Transaction signature saved

4. **Frontend Updates**:
   - Stops showing "Signing..." / "Verifying..."
   - Shows "Payout sent" or completion status
   - Updates to reflect executed state

## 🔍 Verification Steps

### Check Database Sync
```sql
SELECT 
  "proposalStatus",
  "proposalSigners",
  "proposalExecutedAt",
  "proposalTransactionId"
FROM match
WHERE id = '15dcfba1-b4a5-4896-b563-937fa04d45f5';
```

### Check On-Chain Status
Use Squads MCP:
```javascript
GET_PROPOSALS(multisigAddress: "Rje9HaHCpEMZ2iEcx73FMZYrTHBhNz2uuGd8EgB6HwX")
```

Look for Transaction Index 02 - should show `Approved` → `Executed`

### Check Execution Transaction
If `proposalTransactionId` is populated:
```bash
solana transaction <SIGNATURE> --output json
```

Verify:
- Fee payer is `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
- Instruction is from Squads multisig program
- Transaction succeeded

## 🐛 Troubleshooting

### If Sync Doesn't Work
1. Check Render logs for `syncProposalIfNeeded` errors
2. Verify vault address matches on-chain multisig
3. Check if proposal ID in DB matches on-chain proposal PDA

### If Execution Fails
1. Check Render logs for `rpc.vaultTransactionExecute` errors
2. Verify `feePayer` and `member` parameters are correct
3. Check fee wallet has sufficient SOL for transaction fees
4. Verify proposal is actually `Approved` on-chain (not just in DB)

### If Frontend Doesn't Update
1. Clear browser cache / localStorage
2. Check API response matches database state
3. Verify frontend polling is working
4. Check for CORS or network errors in browser console

## ✅ Success Criteria

- [ ] Database shows `proposalStatus: 'APPROVED'` with 2 signers
- [ ] Execution monitor attempts execution
- [ ] Execution succeeds (transaction signature returned)
- [ ] Database shows `proposalStatus: 'EXECUTED'` with `proposalExecutedAt` populated
- [ ] Frontend shows completion status
- [ ] On-chain proposal status is `Executed`

