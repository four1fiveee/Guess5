# Environment Variables Quick Fix Guide
## Action Items Based on Official Squads Documentation

**Reference**: [Squads Protocol v4 README](https://github.com/Squads-Protocol/v4/blob/main/README.md)

---

## 🚨 CRITICAL FIXES (Do These First!)

### 1. Fix Program ID Case (Backend - Render)
**Current (WRONG):**
```
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pcf
```

**Change To:**
```
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
```
**Note**: Change lowercase `cf` to uppercase `Cf` at the end

### 2. Fix Program ID Case (Frontend - Vercel)
**Current (WRONG):**
```
NEXT_PUBLIC_SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pcf
```

**Change To:**
```
NEXT_PUBLIC_SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
```

### 3. Fix Network URL Space (Frontend - Vercel)
**Current (WRONG):**
```
NEXT_PUBLIC_SOLANA_NETWORK= https://api.devnet.solana.com
```

**Change To:**
```
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
```
**Note**: Remove the space after the `=`

---

## 🗑️ REMOVE These Variables (They're Not Used)

### Backend (Render) - Safe to Delete:

1. `AUTOMATED_SIGNER_PUBKEY=` (empty - only used in deprecated code)
2. `CO_SIGNER_PUBKEY=` (empty - only used in deprecated code)
3. `RECOVERY_KEY_PUBKEY=` (empty - only used in deprecated code)
4. `MULTISIG_PROGRAM_ID=` (empty - code uses `SQUADS_PROGRAM_ID` instead)
5. `SYSTEM_PUBLIC_KEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt` (unused - use `FEE_WALLET_ADDRESS` instead)
6. `KMS_KEY_ID=22932a23-e55f-4ee4-b44a-8d828c7306b1` (duplicate - use `AWS_KMS_KEY_ID` instead)

### Frontend (Vercel) - Safe to Delete:

1. `NEXT_PUBLIC_BACKEND_URL=https://your-render-backend-url.onrender.com` (placeholder - use `NEXT_PUBLIC_API_URL` instead)

---

## ✅ Confirmed from Official Docs

According to the [Squads Protocol v4 README](https://github.com/Squads-Protocol/v4/blob/main/README.md):

**Program Addresses:**
- ✅ **Mainnet**: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- ✅ **Devnet**: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (Same as Mainnet!)

**Your configuration is correct** - you just need to fix the case (uppercase `Cf` instead of lowercase `cf`).

---

## 📋 Final Cleaned Configuration

### Backend (Render) - Keep These:
```
SOLANA_NETWORK=https://api.devnet.solana.com
SQUADS_NETWORK=devnet
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
FEE_WALLET_PRIVATE_KEY=27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe
DATABASE_URL=...
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_KMS_KEY_ID=22932a23-e55f-4ee4-b44a-8d828c7306b1
REDIS_MM_* (all Redis variables)
REDIS_OPS_* (all Redis variables)
NODE_ENV=production
PORT=10000
FRONTEND_URL=https://guess5.io
CORS_ORIGIN=https://guess5.io
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
DEFAULT_FEE_BPS=500
```

### Frontend (Vercel) - Keep These:
```
NEXT_PUBLIC_API_URL=https://guess5.onrender.com
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
NEXT_PUBLIC_SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
NEXT_PUBLIC_FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
NEXT_PUBLIC_SYSTEM_PUBLIC_KEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
```

---

## ✅ Verification Checklist

After making changes:

- [ ] Backend `SQUADS_PROGRAM_ID` ends with uppercase `Cf`
- [ ] Frontend `NEXT_PUBLIC_SQUADS_PROGRAM_ID` ends with uppercase `Cf`
- [ ] Frontend `NEXT_PUBLIC_SOLANA_NETWORK` has no space after `=`
- [ ] Removed all empty/unused variables
- [ ] Removed duplicate `KMS_KEY_ID` (keep `AWS_KMS_KEY_ID`)
- [ ] Test backend logs show correct program ID
- [ ] Test frontend console shows correct program ID

---

**Quick Test**: After fixing, check your backend logs for:
```
✅ Using Squads program ID from environment
programId: SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
```

If you see the correct program ID (with uppercase `Cf`), you're good to go! 🎉

