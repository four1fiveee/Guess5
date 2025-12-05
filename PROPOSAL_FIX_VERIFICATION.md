# Proposal Fix Verification Guide

## ✅ What Was Fixed

1. **Backend now verifies on-chain before updating DB**
   - Location: `backend/src/controllers/matchController.ts` (line ~12567)
   - Change: Backend throws error if on-chain verification fails
   - Impact: Prevents DB/chain divergence bugs

2. **Transaction signatures are now stored**
   - Location: `backend/src/controllers/matchController.ts` (line ~12869)
   - Change: `proposalTransactionId` is stored when broadcasting
   - Impact: Enables re-broadcast and monitoring

3. **Admin monitoring endpoint added**
   - Location: `backend/src/controllers/matchController.ts` (line ~10620)
   - Route: `GET /api/match/admin/check-proposal-mismatches`
   - Impact: Real-time visibility into DB/chain mismatches

## 🧪 Immediate Verification Checklist

### 1. Smoke Test: Sign Flow End-to-End

**From frontend:**
1. Click the sign button
2. Watch network tab: verify `POST /api/match/sign-proposal` is sent and returns `200` + `{ txSig }`
3. Confirm backend logs show `sendRawTransaction` + `confirmTransaction`
4. Confirm UI updates only after backend `200`

**If any step fails:**
- Capture request/response and server logs
- Check CORS headers in network tab
- Verify backend is receiving the request

### 2. Programmatic Check: Verify On-Chain Signer

**Run the verification script:**
```bash
cd backend
node scripts/verify-signer-onchain.js <matchId> [walletAddress]
```

**Example:**
```bash
node scripts/verify-signer-onchain.js 5e5187ad-712e-4ef8-9ce9-93883d322427 F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8
```

**Expected output:**
- ✅ MATCH: DB and on-chain signers are in sync
- ✅ VERIFIED: Wallet signature is confirmed on-chain and in DB

### 3. Endpoint Behavior Test: Timeout & Fallback

**Test the status endpoint:**
```bash
# Should not see 504s
curl https://guess5.onrender.com/api/match/status/<matchId>
```

**Expected:**
- Response within 5 seconds
- No 504 Gateway Timeout errors
- If RPC is slow, should fallback to PDA brute-force (0-50) without hanging

### 4. Admin Monitoring Endpoint

**Check for mismatches:**
```bash
curl https://guess5.onrender.com/api/match/admin/check-proposal-mismatches
```

**Expected response:**
```json
{
  "success": true,
  "totalChecked": 10,
  "mismatchesFound": 0,
  "mismatches": [],
  "allChecked": [...],
  "timestamp": "2025-12-05T..."
}
```

## 🔁 Reconciliation for Existing Mismatches

### Run Reconciliation Script

**Dry run (no changes):**
```bash
cd backend
node scripts/reconcile-proposal-mismatches.js
```

**Apply fixes:**
```bash
cd backend
node scripts/reconcile-proposal-mismatches.js --fix
```

**What it does:**
1. Finds proposals with signers in DB that aren't on-chain
2. Removes unconfirmed signers from DB
3. Recalculates `needsSignatures` based on on-chain state
4. Updates `proposalStatus` based on on-chain state

### Manual SQL Check

```sql
-- Find suspicious proposals
SELECT 
  id,
  "payoutProposalId",
  "tieRefundProposalId",
  "proposalStatus",
  "proposalSigners",
  "needsSignatures",
  "proposalExecutedAt"
FROM "match"
WHERE 
  ("proposalStatus" IN ('EXECUTING', 'ACTIVE', 'READY_TO_EXECUTE', 'APPROVED'))
  AND ("payoutProposalId" IS NOT NULL OR "tieRefundProposalId" IS NOT NULL)
  AND "proposalSigners" IS NOT NULL
  AND "proposalExecutedAt" IS NULL
  AND "updatedAt" > NOW() - INTERVAL '7 days'
ORDER BY "updatedAt" DESC;
```

## 📈 Monitoring & Alerts

### Key Metrics to Track

1. **DB/Chain Divergence**
   - Alert: DB shows `EXECUTING` but on-chain status is not `ExecuteReady` for > 5 minutes
   - Check: Run `check-proposal-mismatches` endpoint every 5 minutes
   - Action: Auto-reconcile or alert admin

2. **Sign-Proposal Failures**
   - Track: `POST /api/match/sign-proposal` 4xx/5xx rates
   - Alert: If failure rate > 10% in 5-minute window
   - Check: CORS preflight failures in webserver logs

3. **RPC Latency**
   - Track: RPC query latency / 5s timeout rate
   - Alert: If timeout rate > 20%
   - Action: Consider RPC provider switch or fallback

### Admin Dashboard

**Endpoint:** `GET /api/match/admin/check-proposal-mismatches`

**Response includes:**
- Total proposals checked
- Number of mismatches found
- Detailed mismatch information (DB vs on-chain)
- All checked proposals with sync status

## ✨ Hardening Recommendations

### Already Implemented

✅ **Transaction signature storage** - Stored in `proposalTransactionId`  
✅ **On-chain verification before DB update** - Enforced in `signProposalHandler`  
✅ **TTL cache for PDA discovery** - 30s cache in `getMatchStatusHandler`  
✅ **PDA brute-force fallback** - Range 0-50 with timeout protection  

### Recommended Next Steps

1. **Store raw signed tx bytes (transient)**
   - Add Redis store with 5-minute TTL
   - Enables re-broadcast if initial broadcast fails
   - Security: Clear after use, never log

2. **Idempotent proposal creation**
   - Derive PDAs deterministically from match ID + counter
   - Prevents duplicate proposals even under race conditions

3. **Client-side retry with backoff**
   - Frontend: Retry `POST /api/match/sign-proposal` with exponential backoff
   - Show clear UI state: `pending`, `failed`, `confirmed`
   - Max 3 retries with 1s, 2s, 4s delays

4. **Background reconciliation job**
   - Run `reconcile-proposal-mismatches.js` every 15 minutes
   - Auto-fix minor mismatches (missing in DB but on-chain)
   - Alert for critical mismatches (missing on-chain but in DB)

## 🚀 Deployment Checklist

- [ ] Backend changes pushed to Render
- [ ] Frontend changes pushed to Vercel
- [ ] Run verification script on a test match
- [ ] Check admin endpoint returns correct data
- [ ] Monitor logs for first 10 sign attempts
- [ ] Verify no CORS errors in network tab
- [ ] Confirm transaction signatures are stored
- [ ] Run reconciliation script on production data (dry-run first)

## 📝 Notes

- **CORS:** Already configured in `app.ts` and route handlers
- **Error Handling:** Backend throws error if on-chain verification fails
- **Frontend:** Only updates UI after backend confirms success
- **Monitoring:** Admin endpoint provides real-time visibility

