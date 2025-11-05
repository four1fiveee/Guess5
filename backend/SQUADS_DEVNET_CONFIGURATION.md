# Squads Protocol Devnet Configuration Guide
## November 2025

This guide provides comprehensive instructions for configuring Squads Protocol on Solana Devnet.

## Overview

**Current Status:**
- Squads Protocol v4 is primarily deployed on Mainnet-beta with program ID: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- Devnet support for Squads v4 may be limited or require different program IDs
- The `@sqds/multisig` SDK v2.1.4+ supports both mainnet and devnet configurations

## Key Configuration Points

### 1. Program IDs

**Mainnet (Production):**
- Program ID: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`
- This is the default `PROGRAM_ID` exported by `@sqds/multisig` SDK

**Devnet (Development):**
- Program ID: `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` (Same as Mainnet)
- According to [official Squads Protocol v4 README](https://github.com/Squads-Protocol/v4/blob/main/README.md), Devnet uses the same program ID as Mainnet

### 2. SDK Version

**Current Version:** `@sqds/multisig@^2.1.4`

**Installation:**
```bash
npm install @sqds/multisig@latest
```

**SDK Exports:**
- `PROGRAM_ID` - Default program ID (typically Mainnet)
- `rpc` - RPC methods for multisig operations
- `accounts` - Account types and parsers
- `types` - TypeScript types and permissions
- `getMultisigPda`, `getVaultPda`, `getProgramConfigPda` - PDA derivation helpers

### 3. Environment Variables

#### Backend (.env)

```bash
# Solana Network Configuration
SOLANA_NETWORK=https://api.devnet.solana.com

# Squads Protocol Configuration
# If Devnet has a different program ID, set it here
# Otherwise, leave unset to use SDK default (Mainnet program ID)
SQUADS_PROGRAM_ID=<DEVNET_PROGRAM_ID_IF_AVAILABLE>

# Alternative: Use Mainnet program ID on Devnet (for testing only)
# SQUADS_PROGRAM_ID=SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf

# Network identifier (informational)
SQUADS_NETWORK=devnet
```

#### Frontend (.env.local)

```bash
# Solana Network
NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com

# Squads Program ID (if different from SDK default)
NEXT_PUBLIC_SQUADS_PROGRAM_ID=<DEVNET_PROGRAM_ID_IF_AVAILABLE>
```

### 4. Cluster Detection and Configuration

The SDK **does NOT automatically detect** the cluster. You must:

1. **Set the Connection URL explicitly:**
   ```typescript
   const connection = new Connection(
     'https://api.devnet.solana.com',
     'confirmed'
   );
   ```

2. **Override Program ID if needed:**
   ```typescript
   import { PROGRAM_ID } from '@sqds/multisig';
   
   // Use environment variable or SDK default
   const programId = process.env.SQUADS_PROGRAM_ID 
     ? new PublicKey(process.env.SQUADS_PROGRAM_ID)
     : PROGRAM_ID;
   ```

3. **Pass programId explicitly to all SDK calls:**
   ```typescript
   await rpc.multisigCreateV2({
     connection,
     programId, // Explicitly pass network-specific program ID
     // ... other params
   });
   ```

### 5. Wallet Configuration

#### Phantom Wallet

1. Open Phantom wallet
2. Click the network selector (top right)
3. Select **"Devnet"** network
4. Ensure wallet has Devnet SOL for transactions

#### Solana CLI

```bash
# Set cluster to Devnet
solana config set --url https://api.devnet.solana.com

# Verify configuration
solana config get

# Airdrop SOL for testing (if needed)
solana airdrop 2 <YOUR_WALLET_ADDRESS>
```

### 6. SDK Usage Patterns

#### ✅ Correct: Network-Aware Configuration

```typescript
import { Connection, PublicKey } from '@solana/web3.js';
import { rpc, PROGRAM_ID } from '@sqds/multisig';

// 1. Create connection with explicit Devnet URL
const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

// 2. Determine program ID based on environment
const programId = process.env.SQUADS_PROGRAM_ID
  ? new PublicKey(process.env.SQUADS_PROGRAM_ID)
  : PROGRAM_ID; // SDK default (usually Mainnet)

// 3. Use programId in all SDK calls
await rpc.multisigCreateV2({
  connection,
  programId, // Explicitly pass
  createKey,
  creator,
  multisigPda,
  // ... other params
});
```

#### ❌ Incorrect: Assuming Auto-Detection

```typescript
// DON'T assume SDK auto-detects cluster
const connection = new Connection('https://api.devnet.solana.com');
// SDK will still use Mainnet PROGRAM_ID by default!
```

### 7. Known Issues and Workarounds

#### Issue: Program ID Mismatch

**Symptom:** `InvalidProgramId` or `DeclaredProgramIdMismatch` errors

**Solution:**
1. Verify the correct Devnet program ID from Squads documentation
2. Set `SQUADS_PROGRAM_ID` environment variable
3. Ensure all SDK calls pass `programId` parameter explicitly

#### Issue: Network Mismatch Errors

**Symptom:** Transactions fail with network-related errors

**Solution:**
1. Verify `SOLANA_NETWORK` points to Devnet
2. Ensure wallet is configured for Devnet
3. Check that program ID matches the Devnet deployment

#### Issue: SDK Defaults to Mainnet

**Symptom:** SDK uses Mainnet program ID even on Devnet connection

**Solution:**
- Always set `SQUADS_PROGRAM_ID` environment variable for Devnet
- Pass `programId` explicitly to all SDK RPC calls
- Don't rely on SDK's default `PROGRAM_ID` constant for Devnet

### 8. Testing Checklist

- [ ] Connection URL points to Devnet: `https://api.devnet.solana.com`
- [ ] Wallet is configured for Devnet network
- [ ] `SQUADS_PROGRAM_ID` is set (if Devnet has different program ID)
- [ ] All SDK calls pass `programId` parameter explicitly
- [ ] Phantom wallet shows Devnet network
- [ ] Wallet has Devnet SOL for transactions
- [ ] Multisig creation succeeds on Devnet
- [ ] Transaction proposals can be created
- [ ] Approvals work with Devnet wallet signatures
- [ ] Transaction execution succeeds

### 9. Migration Notes

**From v1/v2 to v4:**
- `createMultisig` → `rpc.multisigCreateV2`
- `executeTransaction` → `rpc.vaultTransactionExecute`
- `approveTransaction` → `rpc.vaultTransactionApprove`
- Permission objects are now required: `types.Permissions.all()` or `types.Permissions.fromPermissions([types.Permission.Vote])`

**Deprecated Functions:**
- `createMultisig` - Use `multisigCreateV2` instead
- `executeTransaction` - Use `vaultTransactionExecute` instead
- Direct transaction building - Use `TransactionMessage` with SDK compilation

### 10. Verification Steps

1. **Check Program ID:**
   ```typescript
   console.log('Program ID:', programId.toString());
   console.log('SDK Default:', PROGRAM_ID.toString());
   ```

2. **Verify Connection:**
   ```typescript
   const version = await connection.getVersion();
   console.log('Cluster:', version); // Should show devnet cluster info
   ```

3. **Test Multisig Creation:**
   ```typescript
   const multisigPda = await rpc.multisigCreateV2({
     connection,
     programId, // Verify this is correct for Devnet
     // ... params
   });
   ```

### 11. Resources

- **Squads Protocol Docs:** https://docs.squads.so/
- **SDK Documentation:** https://v4-sdk-typedoc.vercel.app/
- **GitHub Repository:** https://github.com/squads-so
- **Discord Support:** Check Squads Discord for Devnet status updates

### 12. Important Notes

⚠️ **Warning:** If Squads Protocol v4 is not officially deployed on Devnet:
- The Mainnet program ID may not work on Devnet
- You may need to wait for official Devnet deployment
- Consider using localnet or testnet if available
- Contact Squads team for Devnet program ID confirmation

✅ **Best Practice:** Always verify the program ID matches your target cluster before deploying to production.

---

## Quick Reference

**Devnet RPC URL:**
```
https://api.devnet.solana.com
```

**Environment Variables:**
```bash
SOLANA_NETWORK=https://api.devnet.solana.com
SQUADS_PROGRAM_ID=<VERIFY_WITH_SQUADS_TEAM>
SQUADS_NETWORK=devnet
```

**SDK Import:**
```typescript
import { rpc, PROGRAM_ID, accounts, types, getVaultPda } from '@sqds/multisig';
```

**Program ID Resolution:**
```typescript
const programId = process.env.SQUADS_PROGRAM_ID
  ? new PublicKey(process.env.SQUADS_PROGRAM_ID)
  : PROGRAM_ID; // Mainnet default
```
