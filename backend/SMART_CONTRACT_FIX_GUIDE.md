# Smart Contract Integration Fix Guide

## Issues Identified and Fixed

### 1. **PDA Generation Mismatch**
- **Problem**: Manual client was using string-based stake amounts instead of proper byte arrays
- **Fix**: Updated `getMatchAccountPDA` to use proper 8-byte serialization

### 2. **Account Structure Mismatch**
- **Problem**: Smart contract expects specific account order and types
- **Fix**: Updated instruction creation to match the smart contract's expected account structure

### 3. **Program ID Consistency**
- **Problem**: Different services using different program IDs
- **Fix**: Standardized on `rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X`

## Testing Steps

### Step 1: Test Basic Connection
```bash
cd backend
node test-integration-simple.js
```

### Step 2: Deploy Smart Contract (if needed)
```bash
cd backend/guess5-escrow
anchor build
anchor deploy --provider.cluster devnet
```

### Step 3: Test Full Integration
```bash
cd backend
node test-smart-contract-integration.js
```

## Key Changes Made

### 1. Fixed PDA Generation
```javascript
// OLD (incorrect)
Buffer.from(stakeAmount.toString())

// NEW (correct)
const stakeAmountBuffer = Buffer.alloc(8);
stakeAmountBuffer.writeBigUInt64LE(BigInt(stakeAmount), 0);
```

### 2. Fixed Account Structure
The smart contract expects these accounts in order:
1. `match_account` (writable)
2. `vault` (writable)
3. `player1` (read-only)
4. `player2` (read-only)
5. `payer` (signer, writable) - this is the results attestor
6. `fee_wallet` (signer, writable)
7. `system_program` (read-only)

### 3. Fixed Instruction Discriminators
Using the correct 8-byte discriminators for each instruction:
- `create_match`: `[107, 2, 184, 145, 70, 142, 17, 165]`
- `deposit`: `[242, 35, 198, 137, 82, 225, 242, 182]`
- `settle_match`: `[71, 124, 117, 96, 191, 217, 116, 24]`

## Environment Variables Required

Make sure these are set in your environment:
```bash
FEE_WALLET_ADDRESS=2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt
FEE_WALLET_PRIVATE_KEY=27vPYFSiF9KFDMDszPsLRVGT3jk5E1UWr9yLCw7hawEAs5pMnmv1zEVptmXJSTy56LTQSChP9ENiKK6kiRaajxWe
PROGRAM_ID=rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X
```

## Common Issues and Solutions

### Issue: "Account not found"
- **Cause**: PDA generation mismatch
- **Solution**: Ensure stake amount is serialized as 8-byte little-endian

### Issue: "Invalid instruction data"
- **Cause**: Wrong instruction discriminator
- **Solution**: Use the correct 8-byte discriminator for each instruction

### Issue: "Insufficient funds"
- **Cause**: Not enough SOL for transaction fees
- **Solution**: Request airdrop or fund accounts

### Issue: "Account already exists"
- **Cause**: Trying to create match with same parameters
- **Solution**: Use different stake amount or player addresses

## Next Steps

1. **Test the integration** using the provided test scripts
2. **Deploy to devnet** if the smart contract needs updating
3. **Integrate with your backend** using the fixed services
4. **Test with real players** on devnet

## Files Modified

- `backend/src/services/manualSolanaClient.ts` - Fixed PDA generation and account structure
- `backend/src/services/smartContractService.ts` - Already had correct program ID
- `backend/src/services/anchorClient.ts` - Already had correct program ID

## Test Scripts Created

- `backend/test-integration-simple.js` - Simple integration test
- `backend/test-smart-contract-integration.js` - Comprehensive test
- `backend/deploy-and-test.js` - Deployment and testing script

Run these scripts to verify everything works correctly!


