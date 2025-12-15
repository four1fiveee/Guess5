# Environment Variables After Escrow Deployment

## 🚀 After Deploying Anchor Escrow Program to Devnet

After running `anchor deploy --provider.cluster devnet`, you'll get a new program ID. Update your environment variables as follows:

---

## 📦 Backend (Render Dashboard) Variables

### ✅ Keep These (No Changes)

```bash
ADMIN_PASSWORD=<YOUR_ADMIN_PASSWORD>
ADMIN_SECRET=<YOUR_ADMIN_SECRET>
ADMIN_USERNAME=<YOUR_ADMIN_USERNAME>
AWS_ACCESS_KEY_ID=<YOUR_AWS_ACCESS_KEY_ID>
AWS_KMS_KEY_ID=22932a23-e55f-4ee4-b44a-8d828c7306b1
AWS_REGION=us-east-1
AWS_SECRET_ACCESS_KEY=<YOUR_AWS_SECRET_ACCESS_KEY>
CORS_ORIGIN=https://guess5.io
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>/<DB_NAME>?sslmode=require"
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
DEFAULT_FEE_BPS=500
FRONTEND_URL=https://guess5.io
HELIUS_API_KEY=<YOUR_HELIUS_API_KEY>
NODE_ENV=production
PORT=10000
REDIS_MM_DB=0
REDIS_MM_HOST=redis-11146.c93.us-east-1-3.ec2.redns.redis-cloud.com
REDIS_MM_PASSWORD=<YOUR_REDIS_MM_PASSWORD>
REDIS_MM_PORT=11146
REDIS_MM_TLS=true
REDIS_MM_USER=default
REDIS_OPS_DB=0
REDIS_OPS_HOST=redis-10650.c9.us-east-1-2.ec2.redns.redis-cloud.com
REDIS_OPS_PASSWORD=<YOUR_REDIS_OPS_PASSWORD>
REDIS_OPS_PORT=10650
REDIS_OPS_TLS=true
REDIS_OPS_USER=default
SOLANA_NETWORK=https://api.devnet.solana.com
```

### 🔄 Update These (Replace with New Values)

```bash
# NEW: Escrow Program ID (get this from `anchor deploy` output)
SMART_CONTRACT_PROGRAM_ID=<NEW_PROGRAM_ID_FROM_DEPLOY>

# NEW: Backend signer for Ed25519 signature verification
# Use the same key as fee wallet OR create a dedicated backend signer keypair
BACKEND_SIGNER_PUBKEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
BACKEND_SIGNER_PRIVATE_KEY=<YOUR_BACKEND_SIGNER_PRIVATE_KEY>

# Keep fee wallet (used for payouts)
FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
FEE_WALLET_PRIVATE_KEY=<YOUR_FEE_WALLET_PRIVATE_KEY>

# Optional: Results attestor (can be same as backend signer)
RESULTS_ATTESTOR_PUBKEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
```

### ❌ Remove These (No Longer Needed - Squads Related)

```bash
# Remove these Squads-related variables:
SQUADS_NETWORK=devnet
SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
```

---

## 🌐 Frontend (Vercel Dashboard) Variables

### ✅ Keep These (No Changes)

```bash
NEXT_PUBLIC_API_URL=https://guess5.onrender.com
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
NEXT_PUBLIC_FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
NEXT_PUBLIC_SYSTEM_PUBLIC_KEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
```

### 🔄 Update These (Replace with New Values)

```bash
# NEW: Escrow Program ID (must match backend SMART_CONTRACT_PROGRAM_ID)
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=<NEW_PROGRAM_ID_FROM_DEPLOY>

# NEW: Backend signer pubkey (for signature verification display)
NEXT_PUBLIC_BACKEND_SIGNER_PUBKEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
```

### ❌ Remove These (No Longer Needed - Squads Related)

```bash
# Remove this Squads-related variable:
NEXT_PUBLIC_SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf
```

---

## 📋 Complete Variable Lists

### Backend (Render) - Final List

```bash
ADMIN_PASSWORD=<YOUR_ADMIN_PASSWORD>
ADMIN_SECRET=<YOUR_ADMIN_SECRET>
ADMIN_USERNAME=<YOUR_ADMIN_USERNAME>
AWS_ACCESS_KEY_ID=<YOUR_AWS_ACCESS_KEY_ID>
AWS_KMS_KEY_ID=22932a23-e55f-4ee4-b44a-8d828c7306b1
AWS_REGION=us-east-1
AWS_SECRET_ACCESS_KEY=<YOUR_AWS_SECRET_ACCESS_KEY>
BACKEND_SIGNER_PUBKEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
BACKEND_SIGNER_PRIVATE_KEY=<YOUR_BACKEND_SIGNER_PRIVATE_KEY>
CORS_ORIGIN=https://guess5.io
DATABASE_URL="postgresql://<DB_USER>:<DB_PASSWORD>@<DB_HOST>/<DB_NAME>?sslmode=require"
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
DEFAULT_FEE_BPS=500
FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
FEE_WALLET_PRIVATE_KEY=<YOUR_FEE_WALLET_PRIVATE_KEY>
FRONTEND_URL=https://guess5.io
HELIUS_API_KEY=<YOUR_HELIUS_API_KEY>
NODE_ENV=production
PORT=10000
REDIS_MM_DB=0
REDIS_MM_HOST=redis-11146.c93.us-east-1-3.ec2.redns.redis-cloud.com
REDIS_MM_PASSWORD=<YOUR_REDIS_MM_PASSWORD>
REDIS_MM_PORT=11146
REDIS_MM_TLS=true
REDIS_MM_USER=default
REDIS_OPS_DB=0
REDIS_OPS_HOST=redis-10650.c9.us-east-1-2.ec2.redns.redis-cloud.com
REDIS_OPS_PASSWORD=<YOUR_REDIS_OPS_PASSWORD>
REDIS_OPS_PORT=10650
REDIS_OPS_TLS=true
REDIS_OPS_USER=default
RESULTS_ATTESTOR_PUBKEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
SMART_CONTRACT_PROGRAM_ID=<NEW_PROGRAM_ID_FROM_DEPLOY>
SOLANA_NETWORK=https://api.devnet.solana.com
```

### Frontend (Vercel) - Final List

```bash
NEXT_PUBLIC_API_URL=https://guess5.onrender.com
NEXT_PUBLIC_BACKEND_SIGNER_PUBKEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
NEXT_PUBLIC_FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=<NEW_PROGRAM_ID_FROM_DEPLOY>
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
NEXT_PUBLIC_SYSTEM_PUBLIC_KEY=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
```

---

## 🔑 How to Get the New Program ID

After running `anchor deploy --provider.cluster devnet`, you'll see output like:

```
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: <your-keypair>
Deploying program "game_escrow"...
Program Id: <NEW_PROGRAM_ID_HERE>
```

**Copy the Program Id** and use it for:
- `SMART_CONTRACT_PROGRAM_ID` (backend)
- `NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID` (frontend)

---

## ⚠️ Important Notes

1. **Backend Signer Key**: You can use the same keypair as `FEE_WALLET` for simplicity, or create a dedicated backend signer keypair for better security.

2. **Program ID Consistency**: The program ID must match exactly between backend and frontend.

3. **Private Key Format**: The `BACKEND_SIGNER_PRIVATE_KEY` should be the base58-encoded private key (same format as `FEE_WALLET_PRIVATE_KEY`).

4. **Devnet vs Mainnet**: When moving to mainnet:
   - Update `SOLANA_NETWORK` to `https://api.mainnet-beta.solana.com`
   - Update `NEXT_PUBLIC_SOLANA_NETWORK` to `https://api.mainnet-beta.solana.com`
   - Deploy program to mainnet and update program IDs

5. **Squads Cleanup**: After confirming escrow system works, you can remove all Squads-related code and variables.

---

## ✅ Verification Steps

After updating variables:

1. **Backend**: Restart Render service and check logs for:
   - `✅ Environment configuration validated`
   - `✅ Helius RPC API key configured`
   - No errors about missing variables

2. **Frontend**: Redeploy Vercel and verify:
   - Escrow deposit flow works
   - Result submission works
   - No console errors about missing program ID

3. **Test**: Create a test match and verify:
   - Escrow initializes correctly
   - Deposits work
   - Result submission works
   - Settlement works

---

## 🆘 Troubleshooting

If you see errors about missing program ID:
- Verify `SMART_CONTRACT_PROGRAM_ID` matches the deployed program ID
- Check that program was deployed successfully with `solana program show <PROGRAM_ID>`
- Ensure both backend and frontend have the same program ID

If signature verification fails:
- Verify `BACKEND_SIGNER_PUBKEY` matches the public key of `BACKEND_SIGNER_PRIVATE_KEY`
- Check that message format matches between backend signing and on-chain verification
- Ensure private key is in correct format (base58)

