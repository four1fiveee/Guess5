# Guess5 Smart Contract Deployment Guide

## Overview

This guide provides step-by-step instructions for deploying the Guess5 smart contract to Solana devnet and configuring the backend/frontend for production deployment.

## Current Status

✅ **Cleanup Complete**: Removed unnecessary files and test scripts  
✅ **Configuration Updated**: All services now use consistent Program ID: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`  
✅ **Basic Tests Pass**: Smart contract integration verified  
⚠️ **Smart Contract**: Needs to be deployed to devnet  

## Phase 1: Deploy Smart Contract to Devnet

### Prerequisites

1. **Solana CLI installed** (if not already installed):
   ```bash
   sh -c "$(curl -sSfL https://release.solana.com/v1.18.26/install)"
   ```

2. **Anchor CLI installed** (if not already installed):
   ```bash
   npm install -g @coral-xyz/anchor-cli
   ```

3. **Set Solana to devnet**:
   ```bash
   solana config set --url devnet
   ```

### Deploy Smart Contract

1. **Navigate to smart contract directory**:
   ```bash
   cd backend/guess5-escrow
   ```

2. **Build the smart contract**:
   ```bash
   anchor build
   ```

3. **Deploy to devnet**:
   ```bash
   anchor deploy --provider.cluster devnet
   ```

4. **Verify deployment**:
   ```bash
   solana program show F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4 --url devnet
   ```

### Expected Output

You should see:
- Program deployed successfully
- Program ID: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`
- Program is executable on devnet

## Phase 2: Test Smart Contract Integration

1. **Run the test script**:
   ```bash
   cd backend
   node test-smart-contract.js
   ```

2. **Expected output**:
   ```
   ✅ Connected to Solana devnet
   ✅ Program ID: F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4
   ✅ Program found on devnet
   🎉 Basic tests passed!
   ```

## Phase 3: Configure Environment Variables

### Backend Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Application Settings
NODE_ENV=production
PORT=40000

# Database Configuration
DATABASE_URL=your_postgresql_connection_string

# Redis Configuration
REDIS_URL=your_redis_connection_string

# Solana Configuration
SOLANA_NETWORK=https://api.devnet.solana.com
SMART_CONTRACT_PROGRAM_ID=F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4
PROGRAM_ID=F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4

# Fee Wallet Configuration
FEE_WALLET_ADDRESS=your_fee_wallet_address
FEE_WALLET_PRIVATE_KEY=your_fee_wallet_private_key
RESULTS_ATTESTOR_PUBKEY=your_fee_wallet_address

# Smart Contract Settings
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000

# Frontend URL
FRONTEND_URL=https://your-frontend-url.vercel.app
```

## Phase 4: Deploy Backend to Render

### Manual Steps in Render Dashboard

1. **Go to Render Dashboard**: https://dashboard.render.com

2. **Create New Web Service**:
   - Connect your GitHub repository
   - Choose the `backend` folder as root directory
   - Set build command: `npm install && npm run build`
   - Set start command: `npm start`
   - Set environment: `Node`

3. **Configure Environment Variables**:
   - Add all variables from your `.env` file
   - **Important**: Set `NODE_ENV=production`
   - **Important**: Set `SOLANA_NETWORK=https://api.devnet.solana.com`
   - **Important**: Set `PROGRAM_ID=F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`

4. **Deploy**:
   - Click "Create Web Service"
   - Wait for deployment to complete
   - Note the service URL (e.g., `https://guess5-backend.onrender.com`)

### Alternative: Use render.yaml

The `render.yaml` file is already configured with the correct Program ID. You can:

1. **Push to GitHub** with the updated `render.yaml`
2. **Connect repository** to Render
3. **Render will automatically** use the configuration from `render.yaml`

## Phase 5: Deploy Frontend to Vercel

### Manual Steps in Vercel Dashboard

1. **Go to Vercel Dashboard**: https://vercel.com/dashboard

2. **Import Project**:
   - Connect your GitHub repository
   - Choose the `frontend` folder as root directory
   - Framework: Next.js

3. **Configure Environment Variables**:
   - `NEXT_PUBLIC_API_URL`: Your Render backend URL
   - `NEXT_PUBLIC_SOLANA_NETWORK`: `https://api.devnet.solana.com`
   - `NEXT_PUBLIC_PROGRAM_ID`: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`
   - `NEXT_PUBLIC_FEE_WALLET_ADDRESS`: Your fee wallet address

4. **Deploy**:
   - Click "Deploy"
   - Wait for deployment to complete
   - Note the frontend URL

### Alternative: Use vercel.json

The `frontend/vercel.json` file is already configured with the correct Program ID.

## Phase 6: Test Production Deployment

1. **Test Backend Health**:
   ```bash
   curl https://your-backend-url.onrender.com/health
   ```

2. **Test Smart Contract Integration**:
   - Use the frontend to create a test match
   - Verify deposits work
   - Test match settlement

3. **Monitor Logs**:
   - Check Render logs for any errors
   - Check Vercel logs for frontend issues

## Phase 7: Deploy to Mainnet (When Ready)

### Prerequisites

1. **Switch to mainnet**:
   ```bash
   solana config set --url mainnet-beta
   ```

2. **Fund your fee wallet** with real SOL

3. **Update environment variables**:
   - Change `SOLANA_NETWORK` to `https://api.mainnet-beta.solana.com`
   - Update all URLs to use mainnet

### Deploy to Mainnet

1. **Deploy smart contract**:
   ```bash
   anchor deploy --provider.cluster mainnet-beta
   ```

2. **Update all configurations** with the new mainnet Program ID

3. **Deploy backend and frontend** with mainnet configuration

## Troubleshooting

### Common Issues

1. **"Program not found" error**:
   - Ensure smart contract is deployed to the correct network
   - Verify Program ID matches in all configuration files

2. **"DeclaredProgramIdMismatch" error**:
   - This should be resolved with the fresh deployment
   - Ensure all files use the same Program ID: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`

3. **Build failures**:
   - Check that all dependencies are installed
   - Verify TypeScript compilation passes

4. **Deployment failures**:
   - Check environment variables are set correctly
   - Verify database and Redis connections

### Getting Help

1. **Check logs** in Render/Vercel dashboards
2. **Run local tests** with `node test-smart-contract.js`
3. **Verify smart contract** deployment with `solana program show`

## Success Criteria

✅ Smart contract deployed to devnet  
✅ Backend deployed to Render with correct configuration  
✅ Frontend deployed to Vercel with correct configuration  
✅ All services use consistent Program ID  
✅ Test match creation, deposits, and settlements work  
✅ No "DeclaredProgramIdMismatch" errors  

## Next Steps

1. **Deploy smart contract** to devnet
2. **Test thoroughly** on devnet
3. **Deploy backend and frontend** to production
4. **Monitor** for any issues
5. **Plan mainnet deployment** when ready

---

**Program ID**: `F2Bvxq5bucMFdxAXrwRQd2vGoXdJuddgdPkHwmU3wVx4`  
**Network**: Devnet (for testing)  
**Status**: Ready for deployment  
