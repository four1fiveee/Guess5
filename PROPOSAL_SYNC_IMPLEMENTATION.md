# 🔄 Proposal Sync Implementation

**Date:** 2025-12-10  
**Issue:** Database proposal IDs can become stale/outdated, causing desync with on-chain state  
**Solution:** Implemented proposal sync utilities and desync detection

---

## ✅ **Implemented Features**

### **1. Proposal Sync Utility** (`backend/src/utils/proposalSync.ts`)

**Functions:**
- `syncMatchProposal(matchId, vaultAddress)`: Syncs a single match's proposal status from on-chain to database
- `detectProposalDesync(matchId, dbProposalId, vaultAddress)`: Detects if database proposal ID is desynced from on-chain

**Features:**
- Fetches on-chain proposal status using Squads SDK
- Compares database vs on-chain proposal ID, status, and signers
- Updates database if desync detected
- Returns detailed sync results with change tracking

### **2. Desync Detection Logging** (`backend/src/controllers/matchController.ts`)

**Location:** `getMatchStatusHandler` - right before response is sent

**Behavior:**
- Runs in background (non-blocking)
- Checks if database proposal ID matches on-chain reality
- Logs warnings when desync detected
- Includes `matchId`, `dbProposalId`, `onChainProposalId`, and `error` details

**Log Format:**
```
⚠️ Proposal desync detected {
  matchId: '...',
  dbProposalId: '...',
  onChainProposalId: '...',
  error: '...',
  note: 'Database proposal ID may be stale or invalid. Consider running syncMatchProposal() to correct.'
}
```

### **3. Sync Script** (`backend/scripts/sync-match-proposal.ts`)

**Usage:**
```bash
ts-node backend/scripts/sync-match-proposal.ts <matchId>
```

**Example:**
```bash
ts-node backend/scripts/sync-match-proposal.ts a3fd6e93-fad9-47e9-8f3a-df676b4c422f
```

**Features:**
- Command-line tool to sync a specific match
- Validates match exists and has vault address
- Shows before/after changes
- Exits with error code if sync fails

---

## 📊 **How It Works**

### **Sync Process:**

1. **Fetch Database State**
   - Get match from database
   - Extract `payoutProposalId`, `proposalStatus`, `proposalSigners`

2. **Fetch On-Chain State**
   - Use Squads SDK to fetch proposal account
   - Extract proposal PDA, transaction index, status, and signers

3. **Compare & Update**
   - Compare proposal IDs (database vs on-chain)
   - Compare status (database vs on-chain)
   - Compare signers (database vs on-chain)
   - Update database if differences found

4. **Return Results**
   - Success + synced: Changes were made
   - Success + not synced: Already in sync
   - Failure: Error details

### **Desync Detection:**

1. **Non-Blocking Check**
   - Runs in background during status endpoint
   - Doesn't block response to frontend

2. **On-Chain Verification**
   - Attempts to fetch proposal account from on-chain
   - If fetch fails, marks as desynced

3. **Warning Logs**
   - Logs warnings when desync detected
   - Includes actionable information for debugging

---

## 🎯 **Usage Examples**

### **Sync a Specific Match:**

```typescript
import { syncMatchProposal } from './utils/proposalSync';

const result = await syncMatchProposal(
  'a3fd6e93-fad9-47e9-8f3a-df676b4c422f',
  '6ED78FF2LekErATXgTw4BvVv4RCQQkdqfw5jzBvbmXfx'
);

if (result.success && result.synced) {
  console.log('✅ Synced:', result.changes);
} else if (result.success && !result.synced) {
  console.log('ℹ️ Already in sync');
} else {
  console.error('❌ Sync failed:', result.error);
}
```

### **Detect Desync:**

```typescript
import { detectProposalDesync } from './utils/proposalSync';

const desyncResult = await detectProposalDesync(
  'a3fd6e93-fad9-47e9-8f3a-df676b4c422f',
  '3qw6mcaarXsT1UssdWrNc5QyXE3t5vDu1hrhz3EKmxTR',
  '6ED78FF2LekErATXgTw4BvVv4RCQQkdqfw5jzBvbmXfx'
);

if (desyncResult.desynced) {
  console.warn('⚠️ Desync detected:', desyncResult);
}
```

---

## 🔧 **Next Steps (Optional)**

### **1. Background Reconciliation Job**

Create a cron job or background worker that:
- Periodically checks matches with `proposalStatus != 'EXECUTED'`
- Fetches on-chain proposal status
- Syncs database if desync detected
- Prevents future stale status issues

### **2. Automatic Sync on Status Endpoint**

Optionally auto-sync when desync is detected:
```typescript
if (desyncResult.desynced) {
  // Auto-sync in background
  syncMatchProposal(matchId, vaultAddress).catch(console.error);
}
```

### **3. Admin Dashboard Integration**

Add UI to:
- View matches with desync warnings
- Manually trigger sync for specific matches
- View sync history/changes

---

## 📝 **Summary**

| Feature | Status | Location |
|---------|--------|----------|
| Proposal Sync Utility | ✅ | `backend/src/utils/proposalSync.ts` |
| Desync Detection Logging | ✅ | `backend/src/controllers/matchController.ts` |
| Sync Script | ✅ | `backend/scripts/sync-match-proposal.ts` |
| Background Reconciliation | 🔲 | Optional future enhancement |
| Auto-Sync on Detection | 🔲 | Optional future enhancement |

---

## ✅ **Success Case: Match `a3fd6e93-fad9-47e9-8f3a-df676b4c422f`**

**Verified:**
- ✅ POST `/sign-proposal` received
- ✅ Transaction broadcasted successfully
- ✅ Signature recorded on-chain
- ✅ Proposal status: `Approved` with both signers
- ✅ On-chain proposal ID: `EgSCwtB1jLXFjNUN6s2Ha8y1xgGXR9qqnsE8A4B7XGoz`

**Issue:**
- ❌ Database shows stale proposal ID: `3qw6mcaarXsT1UssdWrNc5QyXE3t5vDu1hrhz3EKmxTR`
- ❌ Database status: `SIGNATURE_VERIFICATION_FAILED`

**Fix:**
- Run sync script to update database with correct proposal ID
- Desync detection will now warn about future mismatches

