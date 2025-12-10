# 🔍 Investigation Report: Missing sign-proposal POST
## Match ID: `402b4cba-5c2f-4e91-bae6-75a11028c86d`

**Investigation Date:** 2025-12-10  
**Investigation Time Range:** 19:00:00 - 20:10:00 UTC

---

## 📋 Executive Summary

**CRITICAL FINDING:** No POST request to `/api/match/sign-proposal` was found in Render logs for this match ID, despite the user confirming Phantom opened and they signed something.

**Status:** ❌ **Signature was NOT submitted to backend**

---

## 1️⃣ Database Query Results

### Match Data
- **Match ID:** `402b4cba-5c2f-4e91-bae6-75a11028c86d`
- **Player 1:** `7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU`
- **Player 2:** `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
- **Winner:** `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8` (Player 2)
- **Status:** `completed`
- **Word:** `COACH`

### Proposal Data
- **Payout Proposal ID:** `7WSfaPo3pkJH24CHYFHHvnkwCmPK5g9dQ8nJF3ttdPKK`
- **Multisig Address:** `97owQWMQ3gtuxuNEFaKEh7KcU1sAGfR81uNPq8zPtEgt`
- **Transaction Index:** `4`
- **Proposal Status:** `SIGNATURE_VERIFICATION_FAILED` ⚠️
- **Proposal Signers (DB):** `["2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"]` (Fee wallet only)
- **Needs Signatures:** `2` (threshold)
- **Current Signatures:** `1` (only fee wallet)

---

## 2️⃣ On-Chain Proposal Status (from Render logs)

### Proposal Account Status
- **Status:** `Active`
- **Transaction Index:** `4` (hex: `04`)
- **Approved Signers:** `["2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"]` (Fee wallet only)
- **Current Signatures:** `1`
- **Threshold:** `2`
- **Needs Signatures:** `1` ⚠️
- **Executed:** `false`

### Key Finding
✅ **Proposal exists on-chain**  
❌ **Player signature is MISSING** - Only fee wallet (`2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`) has signed

---

## 3️⃣ Render Backend Logs Analysis

### Search Criteria
- **Time Range:** 2025-12-10 19:00:00 - 20:10:00 UTC
- **Match ID:** `402b4cba-5c2f-4e91-bae6-75a11028c86d`
- **Proposal ID:** `7WSfaPo3pkJH24CHYFHHvnkwCmPK5g9dQ8nJF3ttdPKK`
- **Path:** `/api/match/sign-proposal`
- **Method:** `POST`

### Results
❌ **NO POST requests found** to `/api/match/sign-proposal` for this match ID

### What WAS Found
✅ Multiple GET requests to `/api/match/status/402b4cba-5c2f-4e91-bae6-75a11028c86d`:
- Player 1 (`7oFPm3Rat3WbJsRSAFovHk6KjQx11FgokA4TUMSypKCU`) polling status
- Player 2 (`F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`) polling status
- Timestamps: 19:29:47 - 19:29:58 UTC

✅ Global logger messages appearing for GET requests (not POST):
- Message: `"If you see this for POST /api/match/sign-proposal, the request reached the backend"`
- **These are false positives** - appearing on GET requests, not POST

### Expected Log Sequence (NOT FOUND)
The following logs should appear for a successful POST request but are **MISSING**:

1. ❌ `🔥 REQ - Global request logger` (POST /sign-proposal)
2. ❌ `🚚 Request reached sign-proposal route`
3. ❌ `📦 Raw parser completed for sign-proposal`
4. ❌ `🔥 POST /sign-proposal received in handler`
5. ❌ `📦 Received raw signed transaction bytes`
6. ❌ `✅ SIGN_PROPOSAL: BROADCAST TO SOLANA SUCCESS`
7. ❌ `🚀 BACKGROUND_VERIFICATION`

---

## 4️⃣ Frontend Code Analysis

### Sign Proposal Flow (`frontend/src/pages/result.tsx`)
The frontend code shows:

1. **Request URL Format:**
   ```
   POST ${apiUrl}/api/match/sign-proposal?matchId=${matchId}&wallet=${wallet}
   ```

2. **Request Body:**
   - Content-Type: `application/octet-stream`
   - Body: Raw signed transaction bytes (Uint8Array/ArrayBuffer)

3. **Retry Logic:**
   - Max retries: 3
   - Exponential backoff
   - 30-second timeout

4. **Logging:**
   - Frontend logs to `http://127.0.0.1:7242/ingest/...` (local debug endpoint)
   - Console logs for request/response

### Potential Issues
- ❓ **CORS failure** - Request blocked before reaching backend
- ❓ **Network error** - Request failed before backend
- ❓ **Wrong API URL** - Frontend sending to wrong endpoint
- ❓ **Wrong proposal signed** - User signed different proposal than expected

---

## 5️⃣ Verification Failure Analysis

### Database Status: `SIGNATURE_VERIFICATION_FAILED`
This status is set when:
1. Transaction was broadcasted to Solana ✅
2. Background verification task ran ✅
3. Signature verification failed after timeout ❌

### Code Location (`backend/src/controllers/matchController.ts:14029`)
```typescript
SET "proposalStatus" = 'SIGNATURE_VERIFICATION_FAILED'
```

This indicates:
- ✅ Backend received a signature (at some point)
- ✅ Backend broadcasted transaction
- ❌ Signature never appeared on-chain within verification timeout

---

## 6️⃣ Root Cause Analysis

### Hypothesis 1: Request Never Reached Backend ⭐ **MOST LIKELY**
**Evidence:**
- No POST logs found in Render
- No route matching logs
- No handler execution logs

**Possible Causes:**
1. **CORS preflight failure** - OPTIONS request blocked
2. **Network error** - Request failed before reaching Render
3. **Frontend error** - JavaScript error prevented fetch
4. **Wrong endpoint** - Frontend sending to different URL

### Hypothesis 2: Wrong Proposal Signed
**Evidence:**
- User confirmed Phantom opened
- User confirmed they signed something
- But no logs for this match/proposal

**Possible Causes:**
1. Frontend signed wrong proposal ID
2. Frontend sent wrong matchId in query params
3. User signed a different transaction entirely

### Hypothesis 3: Request Reached Backend But Failed Silently
**Evidence:**
- Database shows `SIGNATURE_VERIFICATION_FAILED`
- This suggests backend DID process something

**Possible Causes:**
1. Request reached backend but failed validation
2. Request reached backend but signature was invalid
3. Request reached backend but was for wrong proposal

---

## 7️⃣ Recommendations

### Immediate Actions
1. ✅ **Check browser console** for frontend errors
2. ✅ **Check Network tab** in DevTools for failed requests
3. ✅ **Verify API URL** - Confirm `NEXT_PUBLIC_API_URL` is correct
4. ✅ **Check CORS** - Verify backend CORS allows frontend origin

### Debugging Steps
1. **Add frontend logging:**
   - Log exact URL being called
   - Log request headers
   - Log response status/error

2. **Check Render logs for:**
   - CORS errors
   - 400/500 errors
   - Any POST requests (even failed ones)

3. **Verify proposal ID:**
   - Confirm frontend is using correct proposal ID
   - Check if user signed correct transaction

### Code Improvements
1. **Add request ID tracking** - Correlate frontend requests with backend logs
2. **Add CORS logging** - Log all OPTIONS requests
3. **Add error logging** - Log all failed requests with details
4. **Add frontend error reporting** - Send errors to backend for analysis

---

## 8️⃣ Next Steps

1. **User Action Required:**
   - Open browser DevTools (F12)
   - Go to Network tab
   - Try signing proposal again
   - Check for failed requests to `/api/match/sign-proposal`
   - Share screenshot of failed request details

2. **Backend Check:**
   - Verify CORS configuration allows frontend origin
   - Check for any error logs around 19:25-19:30 UTC
   - Verify API endpoint is accessible

3. **Frontend Check:**
   - Verify `NEXT_PUBLIC_API_URL` environment variable
   - Check browser console for errors
   - Verify proposal ID matches database

---

## 📊 Summary Table

| Check | Status | Details |
|-------|--------|---------|
| Proposal exists on-chain | ✅ | Transaction index 4, Active status |
| Fee wallet signed | ✅ | `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt` |
| Player signature on-chain | ❌ | Missing from proposal signers |
| POST request to backend | ❌ | No logs found |
| Request reached route | ❌ | No route matching logs |
| Request reached handler | ❌ | No handler logs |
| Transaction broadcasted | ❓ | Database suggests yes, but no logs |
| Signature verified | ❌ | Status: `SIGNATURE_VERIFICATION_FAILED` |

---

## 🎯 Conclusion

**The signed transaction was NOT successfully submitted to the backend.**

The most likely scenario is that the frontend request failed before reaching the backend, possibly due to:
- CORS issues
- Network errors
- Frontend JavaScript errors
- Wrong API endpoint

**Action Required:** Check browser DevTools Network tab and Console for errors when attempting to sign the proposal.

