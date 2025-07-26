# 🚀 Solana Integration Guide for Guess5

## **🔑 Private Key Requirements**

### **Required Keys:**
1. **Program Authority Key:** Signs transactions to execute smart contract instructions
2. **Fee Wallet Key:** Receives 10% of all game fees
3. **Player Wallet Keys:** Users sign their own transactions (handled by frontend)

### **Current Setup:**
- ✅ **Fee Wallet Address:** `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
- ⚠️ **Program Authority:** Auto-generated (needs funding)
- ⚠️ **Smart Contract:** Needs deployment to devnet

---

## **📋 Next Steps to Complete Integration**

### **Step 1: Install Dependencies**
```bash
cd backend
npm install
```

### **Step 2: Setup Wallets**
```bash
cd backend
chmod +x setup-solana.sh
./setup-solana.sh
```

This will:
- Install Solana dependencies
- Generate program authority keypair
- Generate fee wallet keypair
- Create wallet configuration files

### **Step 3: Fund Wallets (Devnet)**
```bash
# Get your fee wallet address
node -e "
const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const keyData = JSON.parse(fs.readFileSync('wallets/fee-wallet.json'));
const keypair = Keypair.fromSecretKey(new Uint8Array(keyData));
console.log('Fee Wallet Address:', keypair.publicKey.toString());
"

# Fund with devnet SOL (use Solana CLI or faucet)
solana airdrop 2 <FEE_WALLET_ADDRESS> --url devnet
```

### **Step 4: Deploy Smart Contract**
```bash
cd contract
anchor build
anchor deploy --provider.cluster devnet
```

### **Step 5: Update Configuration**
Update `backend/src/config/wallet.ts` with your deployed program ID:
```typescript
const PROGRAM_ID = "YOUR_DEPLOYED_PROGRAM_ID";
```

### **Step 6: Test Integration**
```bash
cd backend
npm run build
npm start
```

---

## **💰 Fee Structure**

### **Game Flow:**
1. **Entry:** Both players pay entry fee → locked in smart contract
2. **Game:** Players solve word puzzle
3. **Payout:** 
   - **Winner gets 90%** of total pot
   - **Fee wallet gets 10%** of total pot
   - **Tie:** Each player gets 45%, fee wallet gets 10%

### **Example:**
- Entry fee: 0.1 SOL each
- Total pot: 0.2 SOL
- Winner gets: 0.18 SOL (90%)
- Fee wallet gets: 0.02 SOL (10%)

---

## **🔧 Environment Variables**

### **Backend (.env):**
```env
SOLANA_NETWORK=https://api.devnet.solana.com
NODE_ENV=production
PORT=10000
```

### **Frontend (Vercel):**
```env
NEXT_PUBLIC_API_URL=https://your-backend.onrender.com
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
```

---

## **🛡️ Security Considerations**

### **Private Keys:**
- **NEVER commit wallet files to git**
- **Use environment variables for production**
- **Backup wallet files securely**
- **Consider hardware wallets for mainnet**

### **Smart Contract:**
- **Audit before mainnet deployment**
- **Test thoroughly on devnet**
- **Implement proper access controls**

---

## **🚨 Common Issues**

### **1. "Cannot find module '@solana/web3.js'"**
```bash
cd backend
npm install @solana/web3.js @project-serum/anchor
```

### **2. "Insufficient funds"**
```bash
# Fund your fee wallet
solana airdrop 2 <FEE_WALLET_ADDRESS> --url devnet
```

### **3. "Program not found"**
```bash
# Deploy your contract first
cd contract
anchor deploy --provider.cluster devnet
```

### **4. "Invalid program ID"**
Update `PROGRAM_ID` in `backend/src/config/wallet.ts` with your deployed program ID.

---

## **🎯 Testing Checklist**

- [ ] Dependencies installed
- [ ] Wallets generated and funded
- [ ] Smart contract deployed to devnet
- [ ] Program ID updated in config
- [ ] Backend builds successfully
- [ ] Frontend connects to backend
- [ ] Game creation works
- [ ] Entry fees are collected
- [ ] Game results are submitted
- [ ] Payouts are executed
- [ ] Fee wallet receives 10%

---

## **📈 Production Deployment**

### **Mainnet Setup:**
1. **Deploy contract to mainnet**
2. **Fund wallets with real SOL**
3. **Update network URLs to mainnet**
4. **Set up monitoring and alerts**
5. **Implement proper error handling**

### **Security Checklist:**
- [ ] Smart contract audited
- [ ] Private keys secured
- [ ] Rate limiting implemented
- [ ] Error handling robust
- [ ] Monitoring in place

---

## **🎮 Game Flow with Solana**

1. **Player joins lobby** → Frontend connects wallet
2. **Match found** → Backend calls `anchorInitGame()`
3. **Entry fees locked** → Smart contract holds funds
4. **Game starts** → Players solve puzzle
5. **Results submitted** → Backend calls `anchorSubmitResult()`
6. **Winner determined** → Backend calls `anchorPayout()`
7. **Funds distributed** → 90% to winner, 10% to fee wallet

---

## **💡 Tips**

- **Start with devnet** for testing
- **Use small entry fees** initially
- **Monitor transaction logs** for debugging
- **Test all scenarios** (win, lose, tie)
- **Keep wallet files secure**
- **Backup everything** before mainnet

---

**Ready to launch? Run the setup script and start testing! 🚀** 