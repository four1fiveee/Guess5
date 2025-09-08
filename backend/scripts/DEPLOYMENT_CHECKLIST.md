# Complete Deployment Checklist

## Phase 1: Prerequisites Installation

### ✅ Install Required Tools
- [ ] **Install Solana CLI Tools**
  - Download from: https://github.com/solana-labs/solana/releases/latest
  - Or use PowerShell: `cmd /c "curl https://release.solana.com/v1.18.4/solana-install-init-x86_64-pc-windows-msvc.exe --output C:\solana-install-init.exe --silent --show-error"`
  - Run installer and restart terminal

- [ ] **Install Rust** (if not already installed)
  - Run: `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
  - Restart terminal after installation

- [ ] **Install Anchor Framework**
  - Run: `cargo install --git https://github.com/coral-xyz/anchor avm --locked --force`
  - Run: `avm install latest`
  - Run: `avm use latest`

- [ ] **Verify Installation**
  - Run: `solana --version` (should show version 1.18.4+)
  - Run: `anchor --version` (should show version 0.30.0+)

## Phase 2: Devnet Deployment

### ✅ Deploy Smart Contract
- [ ] **Run Deployment Script**
  - Navigate to: `cd backend`
  - Run: `node scripts/deploy-devnet.js`
  - This will:
    - Set up devnet configuration
    - Build the smart contract
    - Deploy to devnet
    - Generate results attestor
    - Run tests
    - Generate environment configuration

- [ ] **Note Important Values**
  - [ ] Program ID: `_________________`
  - [ ] Results Attestor Public Key: `_________________`
  - [ ] Results Attestor Private Key Location: `~/.config/solana/results-attestor.json`

### ✅ Update Environment Variables

#### Backend (Render) - Add These Variables:
```env
# Smart Contract Configuration
SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
RESULTS_ATTESTOR_PUBKEY=YourResultsAttestorPubkey
RESULTS_ATTESTOR_PRIVATE_KEY=YourResultsAttestorPrivateKey
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000

# Solana Network Configuration
SOLANA_NETWORK=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet
```

#### Frontend (Vercel) - Add These Variables:
```env
# Smart Contract Integration
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com
```

### ✅ Database Migration
- [ ] **Run Migration**
  - Connect to your Render backend
  - Run: `npm run migration:run`
  - Verify new columns are added to match table

### ✅ Deploy Backend
- [ ] **Deploy to Render**
  - Push changes to your repository
  - Verify environment variables are loaded
  - Check deployment logs for any errors

### ✅ Deploy Frontend
- [ ] **Deploy to Vercel**
  - Push changes to your repository
  - Verify environment variables are loaded
  - Check deployment logs for any errors

## Phase 3: Testing

### ✅ Smart Contract Testing
- [ ] **Verify Contract on Explorer**
  - Visit: https://explorer.solana.com/?cluster=devnet
  - Search for your Program ID
  - Verify contract is deployed and shows correct code

- [ ] **Test Match Creation**
  - Use small amounts (0.001 SOL)
  - Verify match is created on-chain
  - Check match account data

- [ ] **Test Player Deposits**
  - Test both players depositing
  - Verify vault balance increases
  - Check deposit status tracking

- [ ] **Test All Game Outcomes**
  - [ ] Player1 Win (with 5% fee)
  - [ ] Player2 Win (with 5% fee)
  - [ ] Winner Tie (with gas fee only)
  - [ ] Losing Tie (with 5% fee from each)
  - [ ] Timeout (with gas fee only)
  - [ ] Error (with gas fee only)

### ✅ Backend Integration Testing
- [ ] **Test API Endpoints**
  - Test match creation endpoint
  - Test deposit processing
  - Test settlement calls
  - Verify error handling

- [ ] **Test Database Integration**
  - Verify match records are created
  - Check smart contract data storage
  - Test status updates

### ✅ Frontend Integration Testing
- [ ] **Test Wallet Connection**
  - Connect with Phantom/Solflare
  - Verify network is set to devnet
  - Test wallet balance display

- [ ] **Test Match Flow**
  - Create a match
  - Make deposits
  - Complete a game
  - Verify payouts

## Phase 4: Monitoring

### ✅ Set Up Monitoring
- [ ] **Solana Explorer Monitoring**
  - Bookmark your contract: https://explorer.solana.com/address/YOUR_PROGRAM_ID?cluster=devnet
  - Monitor transaction activity
  - Check for any failed transactions

- [ ] **Backend Monitoring**
  - Monitor Render logs
  - Check API response times
  - Track error rates

- [ ] **Key Metrics to Track**
  - [ ] Match creation success rate
  - [ ] Deposit success rate
  - [ ] Settlement success rate
  - [ ] Timeout refund frequency
  - [ ] Fee collection rate

## Phase 5: Security Verification

### ✅ Security Checks
- [ ] **Verify Non-Custodial Design**
  - Confirm funds never touch your wallet
  - Verify each match has isolated vault
  - Test timeout mechanisms

- [ ] **Verify Attestor Security**
  - Confirm only attestor can settle matches
  - Test unauthorized settlement attempts
  - Verify attestor can only choose predefined outcomes

- [ ] **Verify Fee Structure**
  - Test all fee scenarios
  - Confirm gas fee protection
  - Verify no funds can be locked

## Phase 6: Production Readiness

### ✅ Documentation
- [ ] **Update API Documentation**
  - Document new smart contract endpoints
  - Update integration examples
  - Document error codes

- [ ] **Update User Guides**
  - Explain new fee structure
  - Document different outcome types
  - Provide troubleshooting guide

### ✅ Rollback Preparation
- [ ] **Prepare Rollback Plan**
  - Document current custodial system
  - Prepare rollback environment variables
  - Test rollback procedure

- [ ] **Emergency Procedures**
  - Document emergency contacts
  - Prepare incident response plan
  - Set up alerting for critical failures

## Phase 7: Mainnet Deployment (After Devnet Success)

### ✅ Mainnet Preparation
- [ ] **Update Configuration**
  - Change RPC to mainnet: `solana config set --url https://api.mainnet-beta.solana.com`
  - Update environment variables to use mainnet URLs
  - Ensure sufficient SOL for deployment

- [ ] **Deploy to Mainnet**
  - Run: `cd smart-contract && anchor deploy --provider.cluster mainnet-beta`
  - Note the new Program ID
  - Update environment variables

- [ ] **Final Testing**
  - Test with small amounts (0.01 SOL)
  - Monitor for 24-48 hours
  - Verify fee collection

## Success Criteria

### ✅ Technical Success
- [ ] All tests pass
- [ ] No critical errors
- [ ] Performance meets requirements
- [ ] Security requirements met
- [ ] Monitoring is functional

### ✅ Business Success
- [ ] User experience maintained
- [ ] Fee collection working
- [ ] No user complaints
- [ ] System stability maintained
- [ ] Performance improved

---

## Important Notes

1. **Start with devnet** - Never deploy to mainnet without thorough devnet testing
2. **Use small amounts** - Test with minimal stakes first
3. **Monitor closely** - Watch for any issues during initial deployment
4. **Have rollback ready** - Be prepared to switch back to custodial system if needed
5. **Secure your keys** - Store results attestor private key securely

## Emergency Contacts

- **Technical Lead**: [Your contact]
- **DevOps**: [Your contact]
- **Security**: [Your contact]

## Key Resources

- **Solana Explorer**: https://explorer.solana.com/
- **Render Dashboard**: https://dashboard.render.com/
- **Vercel Dashboard**: https://vercel.com/dashboard
- **Smart Contract Code**: `backend/smart-contract/`
- **Deployment Scripts**: `backend/scripts/`









