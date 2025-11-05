# Environment Variables Review & Cleanup
## Based on Official Squads Protocol v4 Documentation

**Reference**: [Squads Protocol v4 README](https://github.com/Squads-Protocol/v4/blob/main/README.md)

## ✅ Critical Issues to Fix

### 1. **SQUADS_PROGRAM_ID Case Sensitivity** ⚠️ CRITICAL

**Current (WRONG):**
```bash
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pcf  # lowercase 'cf'
```

**Should Be:**
```bash
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf  # uppercase 'Cf'
```

**Same for Frontend:**
```bash
NEXT_PUBLIC_SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
```

**Impact**: PublicKey validation may fail or cause unexpected behavior. Solana addresses are case-sensitive.

### 2. **NEXT_PUBLIC_SOLANA_NETWORK Has Extra Space** ⚠️

**Current (WRONG):**
```bash
NEXT_PUBLIC_SOLANA_NETWORK= https://api.devnet.solana.com  # Space after '='
```

**Should Be:**
```bash
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com  # No space
```

---

## 🗑️ Variables That Can Be REMOVED

### Backend (Render) - Safe to Remove:

1. **`AUTOMATED_SIGNER_PUBKEY=`** (empty)
   - ❌ **REMOVE**: Only used in deprecated `multisigVaultService.ts`
   - The current system uses `squadsVaultService.ts` which doesn't need this

2. **`CO_SIGNER_PUBKEY=`** (empty)
   - ❌ **REMOVE**: Only used in deprecated `multisigVaultService.ts`

3. **`RECOVERY_KEY_PUBKEY=`** (empty)
   - ❌ **REMOVE**: Only used in deprecated `multisigVaultService.ts`

4. **`MULTISIG_PROGRAM_ID=`** (empty)
   - ❌ **REMOVE**: Not used anywhere. The code uses `SQUADS_PROGRAM_ID` instead

5. **`SYSTEM_PUBLIC_KEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`**
   - ❌ **REMOVE**: Not used in codebase. The system uses `FEE_WALLET_ADDRESS` instead

6. **`KMS_KEY_ID=22932a23-e55f-4ee4-b44a-8d828c7306b1`**
   - ❌ **REMOVE**: Duplicate of `AWS_KMS_KEY_ID`. Use only `AWS_KMS_KEY_ID`

### Frontend (Vercel) - Safe to Remove:

1. **`NEXT_PUBLIC_BACKEND_URL=https://your-render-backend-url.onrender.com`**
   - ❌ **REMOVE**: This is a placeholder. Use `NEXT_PUBLIC_API_URL` instead

---

## ✅ Variables That Are CORRECT

### Backend (Render):
- ✅ `SOLANA_NETWORK=https://api.devnet.solana.com` - Correct
- ✅ `SQUADS_NETWORK=devnet` - Correct (informational)
- ✅ `SQUADS_PROGRAM_ID` - Correct once fixed (uppercase 'Cf')
- ✅ `FEE_WALLET_ADDRESS` - Correct
- ✅ `FEE_WALLET_PRIVATE_KEY` - Correct (keep secure!)
- ✅ `DATABASE_URL` - Correct
- ✅ `REDIS_*` variables - Correct
- ✅ `AWS_*` variables - Correct (for KMS)
- ✅ `CORS_ORIGIN` - Correct
- ✅ `FRONTEND_URL` - Correct
- ✅ `PORT` - Correct
- ✅ `NODE_ENV=production` - Correct
- ✅ `DEFAULT_DEADLINE_BUFFER_SLOTS` - Correct
- ✅ `DEFAULT_FEE_BPS` - Correct

### Frontend (Vercel):
- ✅ `NEXT_PUBLIC_API_URL=https://guess5.onrender.com` - Correct
- ✅ `NEXT_PUBLIC_SOLANA_NETWORK` - Correct once space removed
- ✅ `NEXT_PUBLIC_SQUADS_PROGRAM_ID` - Correct once case fixed
- ✅ `NEXT_PUBLIC_FEE_WALLET_ADDRESS` - Correct
- ✅ `NEXT_PUBLIC_SYSTEM_PUBLIC_KEY` - Keep if used in frontend (verify usage)

---

## 📝 Recommended Cleaned-Up Configuration

### Backend (Render) - Cleaned:

```bash
# Solana Configuration
SOLANA_NETWORK=https://api.devnet.solana.com
SQUADS_NETWORK=devnet
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf

# Wallet Configuration
FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
FEE_WALLET_PRIVATE_KEY=27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe

# Database
DATABASE_URL="postgresql://guess5_user:nxf1TsMfS4XwW5Ix59zMDxm8kJC7CBpD@dpg-d21t6nqdbo4c73ek2in0-a.ohio-postgres.render.com/guess5?sslmode=require"

# AWS KMS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=YOUR_AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=YOUR_AWS_SECRET_ACCESS_KEY
AWS_KMS_KEY_ID=22932a23-e55f-4ee4-b44a-8d828c7306b1

# Redis Configuration
REDIS_MM_DB=0
REDIS_MM_HOST=redis-11146.c93.us-east-1-3.ec2.redns.redis-cloud.com
REDIS_MM_PASSWORD=3Mf1K0nIyy14xddWcdfqQUs3x7LkGVXv
REDIS_MM_PORT=11146
REDIS_MM_TLS=true
REDIS_MM_USER=default
REDIS_OPS_DB=0
REDIS_OPS_HOST=redis-10650.c9.us-east-1-2.ec2.redns.redis-cloud.com
REDIS_OPS_PASSWORD=ld7as3NRJEaMO4BdBWzvZ5oggnZMZoui
REDIS_OPS_PORT=10650
REDIS_OPS_TLS=true
REDIS_OPS_USER=default

# Application Configuration
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://guess5.io
CORS_ORIGIN=https://guess5.io
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
DEFAULT_FEE_BPS=500
```

### Frontend (Vercel) - Cleaned:

```bash
NEXT_PUBLIC_API_URL=https://guess5.onrender.com
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
NEXT_PUBLIC_SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
NEXT_PUBLIC_FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
NEXT_PUBLIC_SYSTEM_PUBLIC_KEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
```

---

## 🔍 Verification Steps

After updating variables:

1. **Check Program ID Format:**
   ```bash
   # Should be exactly: SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
   # Note the uppercase 'Cf' at the end
   ```

2. **Verify No Extra Spaces:**
   ```bash
   # Should NOT have spaces after '='
   NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
   ```

3. **Test Backend:**
   - Check logs for: "✅ Using Squads program ID from environment"
   - Verify program ID matches: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`

4. **Test Frontend:**
   - Check browser console for program ID logs
   - Verify connection to Devnet works

---

## 📚 Official Documentation Reference

According to [Squads Protocol v4 README](https://github.com/Squads-Protocol/v4/blob/main/README.md):

**Program Addresses:**
- Solana Mainnet-beta: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- Solana Devnet: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (Same as Mainnet)
- Eclipse Mainnet: `eSQDSMLf3qxwHVHeTr9amVAGmZbRLY2rFdSURandt6f`

**Important**: Both Mainnet and Devnet use the **same program ID**, which is exactly what your configuration should use (with correct case).

---

## Summary

### Must Fix:
1. ✅ Fix `SQUADS_PROGRAM_ID` case: `...pcf` → `...pCf`
2. ✅ Fix `NEXT_PUBLIC_SOLANA_NETWORK` space: remove space after `=`
3. ✅ Fix `NEXT_PUBLIC_SQUADS_PROGRAM_ID` case: `...pcf` → `...pCf`

### Can Remove:
- `AUTOMATED_SIGNER_PUBKEY` (empty)
- `CO_SIGNER_PUBKEY` (empty)
- `RECOVERY_KEY_PUBKEY` (empty)
- `MULTISIG_PROGRAM_ID` (empty)
- `SYSTEM_PUBLIC_KEY` (duplicate/unused)
- `KMS_KEY_ID` (duplicate of `AWS_KMS_KEY_ID`)
- `NEXT_PUBLIC_BACKEND_URL` (placeholder)

### Keep:
- All AWS KMS variables
- All Redis variables
- All application configuration
- `SQUADS_PROGRAM_ID` (once fixed)
- `FEE_WALLET_*` variables
