# Match Analysis: 15dcfba1-b4a5-4896-b563-937fa04d45f5

## 🔍 On-Chain Status Check

### Database Status
- **Match ID**: `15dcfba1-b4a5-4896-b563-937fa04d45f5`
- **Proposal ID**: `bPRBFrwShvyzd8p7Exox6LjmCFMRsdLNecbfrUkK7s2`
- **Vault Address**: `Rje9HaHCpEMZ2iEcx73FMZYrTHBhNz2uuGd8EgB6HwX`
- **Proposal Status**: `ACTIVE`
- **Proposal Signers**: `["2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"]` (only fee wallet)
- **Proposal Executed At**: `null`
- **Proposal Transaction ID**: `null`
- **Winner**: `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
- **Entry Fee**: `0.0367 SOL`
- **Entry Fee USD**: `null` (not stored in database)

### On-Chain Proposal Status
**Multisig**: `Rje9HaHCpEMZ2iEcx73FMZYrTHBhNz2uuGd8EgB6HwX`
**Threshold**: 2 of 3

**Proposals Found**:
1. **Transaction Index 01**: `Active` - Only fee wallet signed (`2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`)
2. **Transaction Index 02**: `Approved` ✅ - Both signers present:
   - Fee wallet: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
   - Player: `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
3. **Transaction Index 03**: `Active` - Only fee wallet signed
4. **Transaction Index 04**: `Active` - Only fee wallet signed

## 🎯 Key Findings

### 1. Proposal Status Mismatch
- **Database**: Shows `ACTIVE` with only fee wallet signature
- **On-Chain**: Transaction Index 02 is `Approved` with both signatures
- **Issue**: Database is out of sync with on-chain state

### 2. Execution Status
- **Transaction Index 02** is `Approved` with 2/2 signatures (threshold met)
- **Not Executed**: No execution transaction found
- **Expected**: Execution monitor should execute this proposal

### 3. Frontend Display Issues
- **USD Amount**: Showing $9.51 instead of $9.50
  - **Root Cause**: Frontend was calculating USD from current SOL price instead of using database `entryFeeUSD`
  - **Fix Applied**: Updated to prioritize `payoutData.entryFeeUSD` from API response
- **Status Not Updating**: Frontend shows "Signing..." and "Verifying Transaction..." but proposal is already approved on-chain

## 🔧 Fixes Applied

### 1. USD Calculation Fix (Commit: `26cd93c`)
```typescript
// Before: Calculated from current SOL price
const entryFeeUSD = solPrice && payoutData.entryFee 
  ? getExpectedEntryFeeUSD(payoutData.entryFee, solPrice) 
  : null;

// After: Use database value if available
const entryFeeUSD = payoutData.entryFeeUSD 
  ? Number(payoutData.entryFeeUSD)  // Use database value
  : (solPrice && payoutData.entryFee 
    ? getExpectedEntryFeeUSD(payoutData.entryFee, solPrice) 
    : null);
```

### 2. Console Errors
- **`ERR_CONNECTION_REFUSED` for `127.0.0.1:7242/ingest/...`**: 
  - These are debug telemetry calls trying to connect to a local service
  - Not critical - they're wrapped in `.catch(() => {})` so they fail silently
  - Can be ignored or removed if not needed

## 📊 Recommendations

### Immediate Actions
1. **Sync Database**: Update database to reflect Transaction Index 02's `Approved` status
2. **Execute Proposal**: Execution monitor should execute Transaction Index 02 (2/2 signatures, threshold met)
3. **Verify Execution**: Check if execution transaction was sent but not confirmed

### Long-Term Fixes
1. **Database Sync**: Ensure `proposalSyncService` runs for this match
2. **Entry Fee USD Storage**: Ensure `entryFeeUSD` is populated when matches are created
3. **Frontend Status**: Update frontend to show correct status based on on-chain data

## 🧪 Verification Steps

1. **Check Execution Monitor Logs**: Look for execution attempts for Transaction Index 02
2. **Verify Transaction**: If executed, check transaction signature on Solana explorer
3. **Update Database**: Sync proposal status to `APPROVED` and update signers list
4. **Test Frontend**: After sync, frontend should show correct status and USD amount

