# Production Deployment Guide

## Environment Overview

Based on your current setup, here's how to deploy the non-custodial smart contract system:

### Current Production Environment
- **Backend**: Render (https://api.guess5.io)
- **Frontend**: Vercel (https://guess5.io)
- **Database**: PostgreSQL on Render
- **Redis**: Redis Cloud (matchmaking + operations)
- **Solana Network**: Devnet (for now)

## Pre-Deployment Checklist

### 1. Smart Contract Environment Variables

Add these to your **Render backend environment**:

```env
# Smart Contract Configuration
SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
RESULTS_ATTESTOR_PUBKEY=YourResultsAttestorPubkey
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000

# Solana Configuration (Update for production)
SOLANA_NETWORK=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
```

### 2. Frontend Environment Variables

Add these to your **Vercel frontend environment**:

```env
# Smart Contract Integration
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=YourDeployedProgramId
NEXT_PUBLIC_SOLANA_NETWORK=https://api.mainnet-beta.solana.com
```

## Deployment Steps

### Step 1: Deploy Smart Contract

#### Option A: Deploy to Devnet First (Recommended)
```bash
# 1. Build the contract
cd backend/smart-contract
anchor build

# 2. Deploy to devnet
anchor deploy --provider.cluster devnet

# 3. Note the Program ID from the output
# Example: Program Id: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

#### Option B: Deploy to Mainnet (Production)
```bash
# 1. Build the contract
cd backend/smart-contract
anchor build

# 2. Deploy to mainnet
anchor deploy --provider.cluster mainnet-beta

# 3. Note the Program ID from the output
```

### Step 2: Generate Results Attestor

```bash
# Generate a new keypair for results attestor
solana-keygen new --no-bip39-passphrase --silent

# Note the public key from the output
# Example: pubkey: 9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
```

### Step 3: Update Environment Variables

#### Render Backend Environment
```env
# Add these to your existing Render environment variables
SMART_CONTRACT_PROGRAM_ID=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
RESULTS_ATTESTOR_PUBKEY=9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM
DEFAULT_FEE_BPS=500
DEFAULT_DEADLINE_BUFFER_SLOTS=1000
MIN_STAKE_LAMPORTS=1000000
MAX_FEE_BPS=1000
SOLANA_NETWORK=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
```

#### Vercel Frontend Environment
```env
# Add these to your existing Vercel environment variables
NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
NEXT_PUBLIC_SOLANA_NETWORK=https://api.mainnet-beta.solana.com
```

### Step 4: Run Database Migration

```bash
# Connect to your Render backend and run migration
npm run migration:run
```

### Step 5: Test the Integration

#### Test Smart Contract
```bash
cd backend/smart-contract
anchor test
```

#### Test Backend Integration
```bash
# Test match creation
curl -X POST https://api.guess5.io/api/matches/create \
  -H "Content-Type: application/json" \
  -d '{"entryFee": 0.1}'

# Test deposit
curl -X POST https://api.guess5.io/api/matches/deposit \
  -H "Content-Type: application/json" \
  -d '{"matchId": "test_match", "playerWallet": "player_pubkey"}'
```

## Security Considerations

### 1. Results Attestor Key Management

**CRITICAL**: Store the results attestor private key securely:

```bash
# Store in environment variable (Render)
RESULTS_ATTESTOR_PRIVATE_KEY=your_private_key_here

# Or use a secure key management service
# Consider using AWS Secrets Manager or similar
```

### 2. Multisig for Production (Recommended)

For production, consider using a 2-of-3 multisig for the results attestor:

```bash
# Generate 3 keypairs
solana-keygen new --no-bip39-passphrase --silent
solana-keygen new --no-bip39-passphrase --silent
solana-keygen new --no-bip39-passphrase --silent

# Create multisig account
spl-token create-multisig 2 pubkey1 pubkey2 pubkey3
```

### 3. Fee Wallet Security

Your current fee wallet setup looks good:
- **Address**: `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
- **Private Key**: Securely stored in Render environment

## Network Configuration

### Current Setup (Devnet)
```env
SOLANA_NETWORK=https://api.devnet.solana.com
SOLANA_CLUSTER=devnet
```

### Production Setup (Mainnet)
```env
SOLANA_NETWORK=https://api.mainnet-beta.solana.com
SOLANA_CLUSTER=mainnet-beta
```

### RPC Endpoint Considerations

For production, consider using a dedicated RPC provider:
- **Alchemy**: `https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY`
- **QuickNode**: `https://your-endpoint.solana-mainnet.quiknode.pro/YOUR_API_KEY/`
- **Helius**: `https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY`

## Monitoring Setup

### 1. Smart Contract Monitoring

Monitor these on-chain events:
- `MatchCreated`: New matches
- `DepositMade`: Player deposits
- `MatchSettled`: Match completions
- `MatchRefunded`: Timeout/error refunds

### 2. Backend Monitoring

Monitor these metrics in Render:
- Match creation success rate
- Deposit success rate
- Settlement success rate
- Error rates

### 3. Alerting

Set up alerts for:
- Failed match creations
- Failed deposits
- Failed settlements
- High error rates
- Approaching deadlines

## Rollback Plan

### If Issues Arise

1. **Immediate**: Switch back to custodial system
2. **Update Environment**: Remove smart contract variables
3. **Redeploy**: Backend without smart contract integration
4. **Monitor**: Ensure system stability

### Environment Variable Rollback

```env
# Remove these variables to disable smart contract
# SMART_CONTRACT_PROGRAM_ID=
# RESULTS_ATTESTOR_PUBKEY=
# DEFAULT_FEE_BPS=
# DEFAULT_DEADLINE_BUFFER_SLOTS=
# MIN_STAKE_LAMPORTS=
# MAX_FEE_BPS=
```

## Testing Strategy

### Phase 1: Devnet Testing
1. Deploy to devnet
2. Test with small amounts (0.001 SOL)
3. Verify all game outcomes
4. Test error scenarios

### Phase 2: Mainnet Beta
1. Deploy to mainnet
2. Test with small amounts (0.01 SOL)
3. Monitor for 24-48 hours
4. Verify fee collection

### Phase 3: Full Production
1. Increase stake amounts
2. Monitor performance
3. Full user rollout

## Cost Analysis

### Smart Contract Costs (Mainnet)
- **Deployment**: ~2-3 SOL (one-time)
- **Match Creation**: ~0.002 SOL per match
- **Deposits**: ~0.0005 SOL per deposit
- **Settlement**: ~0.001 SOL per settlement

### Operational Savings
- **Reduced Risk**: No custodial liability
- **Lower Compliance**: Reduced regulatory burden
- **Better UX**: Faster, more transparent payouts
- **Scalability**: No backend bottleneck

## Support and Maintenance

### Daily Monitoring
- Check match creation success rate
- Monitor deposit success rate
- Verify settlement success rate
- Check for stuck matches

### Weekly Maintenance
- Review error logs
- Check fee collection
- Monitor performance metrics
- Update documentation

### Monthly Review
- Analyze usage patterns
- Review security measures
- Update monitoring alerts
- Plan improvements

## Emergency Procedures

### If Smart Contract Fails
1. **Immediate**: Switch to custodial system
2. **Investigate**: Check logs and on-chain data
3. **Fix**: Deploy updated contract if needed
4. **Test**: Verify fix before re-enabling

### If Results Attestor Compromised
1. **Immediate**: Generate new attestor keypair
2. **Update**: Environment variables
3. **Redeploy**: Backend with new attestor
4. **Monitor**: For any unauthorized settlements

## Conclusion

Your current production setup is well-configured for the smart contract deployment. The key steps are:

1. **Deploy smart contract** to mainnet
2. **Generate results attestor** keypair
3. **Update environment variables** in Render and Vercel
4. **Run database migration**
5. **Test thoroughly** before full rollout

The non-custodial system will provide significant benefits in terms of security, transparency, and user trust while maintaining the same user experience.

**Important**: Start with devnet testing, then gradually move to mainnet with small amounts before full production deployment.





