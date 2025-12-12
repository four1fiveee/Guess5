# Priority 2, 3, and 4 Implementation Summary

## Overview

All three remaining priorities have been implemented to complete the system hardening upgrades. These fixes prevent orphaned proposals at the source, provide observability into desyncs, and ensure accurate tracking of proposal transaction indices.

---

## ✅ Priority 2: Fix Proposal Creation Retry Logic

### Goal
Prevent creation of orphaned proposals at skipped transactionIndex values (e.g. trying 02 → failing → skipping to 04). Instead, reuse existing proposals when they exist on-chain.

### Implementation

**File:** `backend/src/services/squadsVaultService.ts`

**Changes:**
1. **Winner Payout Proposal Creation (lines ~1514-1550):**
   - Added on-chain existence check before creating proposal
   - If proposal already exists at target `transactionIndex`, reuse it instead of creating a new one
   - Handles race conditions where proposal is created between check and create attempt

2. **Tie Refund Proposal Creation (lines ~2678-2714):**
   - Applied the same fix to tie refund proposals
   - Ensures consistency across all proposal types

**Key Logic:**
```typescript
// Check if proposal already exists on-chain
const [proposalPda] = getProposalPda({
  multisigPda: multisigAddress,
  transactionIndex: transactionIndex,
  programId: this.programId,
});

let existingProposal: any = null;
try {
  existingProposal = await accounts.Proposal.fromAccountAddress(this.connection, proposalPda);
  // Reuse existing proposal
} catch (checkError: any) {
  // Proposal doesn't exist - create it
}

if (existingProposal) {
  // Reuse existing proposal instead of creating
} else {
  // Create new proposal
}
```

### Benefits
- ✅ Prevents orphaned proposals at the source
- ✅ Ensures one match = one proposal (predictable system)
- ✅ Stops wasted proposals and scattered transaction indices
- ✅ Simplifies downstream logic (monitor doesn't need to do recovery)

---

## ✅ Priority 3: Add Reconciliation Job

### Goal
Detect and alert on mismatches between:
- On-chain proposal statuses
- DB-tracked proposals
- Executed vs. not executed
- Proposal index differences

### Implementation

**New File:** `backend/src/services/proposalReconciliationService.ts`

**Features:**
1. **`reconcileProposalsForVault(vaultAddress: string)`**
   - Scans transaction indices 0-19 for a given vault
   - Compares on-chain proposal state with database state
   - Detects:
     - Orphaned proposals (exist on-chain but not in DB)
     - Status mismatches (on-chain status ≠ DB status)
     - Executed proposals not marked in DB
   - Auto-heals executed proposals by updating database

2. **`reconcileAllProposals()`**
   - Scans all unique vault addresses from database
   - Runs reconciliation for each vault
   - Returns comprehensive summary with counts

**Integration:** `backend/src/services/cronService.ts`
- Added `reconcileProposals()` method
- Runs every 10 minutes via `setInterval`
- Runs immediately on server start (after 30s delay)
- Sends admin notifications if significant issues detected (>5 orphaned or >5 mismatches)

### Benefits
- ✅ Provides visibility into hidden desyncs
- ✅ Enables proactive detection of issues
- ✅ Auto-heals executed proposals not marked in DB
- ✅ Supports alerting, debugging, and reporting

---

## ✅ Priority 4: Store transactionIndex in Database

### Status: Already Implemented ✅

**Verification:**
- Database schema already includes:
  - `payoutProposalTransactionIndex` (varchar, nullable)
  - `tieRefundProposalTransactionIndex` (varchar, nullable)
- Database updates already store `transactionIndex`:
  - `backend/src/controllers/matchController.ts` lines 3099, 4069, 4479, 4524, 4634, 4669
  - All proposal creation flows update `payoutProposalTransactionIndex` or `tieRefundProposalTransactionIndex`

**Example:**
```typescript
await matchRepository.query(`
  UPDATE "match"
  SET "payoutProposalId" = $1, 
      "payoutProposalTransactionIndex" = $2,
      ...
  WHERE id = $8
`, [proposalResult.proposalId, proposalResult.transactionIndex || null, ...]);
```

### Benefits
- ✅ Links DB proposal ID to on-chain index unambiguously
- ✅ Enables fast cross-checking and monitoring
- ✅ Simplifies external dashboards and admin tooling
- ✅ Supports efficient queries: `WHERE vault_address = ? AND transaction_index = ?`

---

## 📊 Integration Summary

| Priority | Status | Impact | Files Modified |
|----------|--------|--------|----------------|
| **2️⃣ Retry-safe proposal creation** | ✅ Implemented | Prevents desync at source | `squadsVaultService.ts` |
| **3️⃣ Reconciliation job** | ✅ Implemented | Detects/fixes hidden mismatches | `proposalReconciliationService.ts` (new), `cronService.ts` |
| **4️⃣ transactionIndex in DB** | ✅ Already implemented | Enables accurate tracking | Verified in `matchController.ts` |

---

## 🧪 Expected Behavior

### Priority 2 (Proposal Creation)
- **Before:** If proposal creation fails at index 02, system skips to 04, creating orphaned proposal at 02
- **After:** System checks if proposal exists at 02 before creating. If it exists, reuses it. If not, creates it.

### Priority 3 (Reconciliation)
- **Runs:** Every 10 minutes automatically
- **Scans:** All vaults, all transaction indices (0-19)
- **Detects:** Orphaned proposals, status mismatches, executed proposals not in DB
- **Auto-heals:** Executed proposals by updating database
- **Alerts:** Admin if >5 orphaned or >5 mismatches detected

### Priority 4 (transactionIndex Storage)
- **Already working:** All proposal creation flows store `transactionIndex` in database
- **Enables:** Fast, accurate matching between on-chain and DB proposals

---

## 🔄 Next Steps

1. **Deploy changes** to Render
2. **Monitor logs** for reconciliation job output
3. **Verify** proposal creation reuses existing proposals when appropriate
4. **Check** admin notifications if reconciliation finds issues

---

## 📝 Notes

- Priority 2 prevents the root cause of orphaned proposals
- Priority 3 provides observability and auto-healing
- Priority 4 was already implemented - verified and documented
- All three priorities work together to ensure system reliability and data integrity

---

## ✅ Completion Status

All three priorities are now **fully implemented and ready for deployment**.

The system is now:
- ✅ **Resilient** to proposal creation retries
- ✅ **Observable** via reconciliation job
- ✅ **Accurate** with transactionIndex tracking

This completes the system hardening cycle and ensures production-grade reliability.

