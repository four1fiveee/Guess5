# Custodial System Audit Report

## Executive Summary

The current system is **CUSTODIAL** and does not meet non-custodial requirements for financial regulations. The backend controls vault private keys and can unilaterally withdraw player funds.

## Critical Custodial Issues Found

### 1. **Backend Controls Vault Private Keys** (CUSTODIAL)
**File:** `backend/src/services/multisigVaultService.ts`
- **Lines 68-70**: Generates deterministic keypair from match ID
- **Lines 357-358**: Regenerates same keypair for signing transactions
- **Lines 380, 482**: Backend signs all payout/refund transactions
- **Problem**: You control the private keys, can withdraw funds anytime

### 2. **Unilateral Transaction Execution** (CUSTODIAL)
**File:** `backend/src/services/multisigVaultService.ts`
- **Lines 296-428**: `processPayout()` - Backend executes winner payouts
- **Lines 433-528**: `processRefund()` - Backend executes refunds
- **Problem**: No player consent required for fund movements

### 3. **Fake Multisig Configuration** (NOT REAL MULTISIG)
**File:** `backend/src/config/kms.config.ts`
- **Lines 22-27**: Defines 2-of-3 multisig config
- **Problem**: This config is never used - system uses single deterministic keypair

### 4. **KMS Only Used for Attestations** (NOT FOR FUND CONTROL)
**File:** `backend/src/services/kmsService.ts`
- **Lines 59-126**: KMS signs attestations only
- **Problem**: KMS doesn't control funds, just validates game results

## Current Flow Analysis

### Match Creation Flow:
1. Backend creates deterministic vault keypair from match ID
2. Players deposit SOL to vault address
3. Backend monitors deposits via `depositWatcherService`
4. Backend verifies deposits via `verifyDeposit()`

### Payout Flow:
1. Game completes, backend determines winner
2. Backend calls `processPayout()` with attestation
3. Backend regenerates vault keypair
4. Backend signs and executes payout transaction
5. **NO PLAYER CONSENT REQUIRED**

### Refund Flow:
1. Timeout or error occurs
2. Backend calls `processRefund()`
3. Backend regenerates vault keypair
4. Backend signs and executes refund transaction
5. **NO PLAYER CONSENT REQUIRED**

## Regulatory Compliance Assessment

**Status: ❌ CUSTODIAL**

**Why it's custodial:**
- You generate and control vault private keys
- You can withdraw funds without player consent
- Players have no control over their deposits
- You execute all transactions unilaterally

**What regulators would see:**
- Backend controls all fund movements
- No player protection mechanisms
- Single point of control (your backend)
- Ability to misappropriate funds

## Files Requiring Complete Replacement

### Backend Services (CUSTODIAL):
- `backend/src/services/multisigVaultService.ts` - **DELETE** (lines 56-118, 296-528)
- `backend/src/controllers/multisigController.ts` - **REPLACE** (calls to custodial service)

### Configuration (FAKE MULTISIG):
- `backend/src/config/kms.config.ts` - **CLEAN** (remove multisig config lines 15-27)

### Frontend Components (WORK WITH CUSTODIAL SYSTEM):
- `frontend/src/components/MultisigVaultDeposit.tsx` - **UPDATE** (for Squads integration)
- `frontend/src/components/MatchStatusDisplay.tsx` - **UPDATE** (add proposal signing UI)

### Database Model (CUSTODIAL FIELDS):
- `backend/src/models/Match.ts` - **ADD** Squads-specific fields (lines 26-27, 69-73)

## Files to Keep (NON-CUSTODIAL PARTS)

### Services (KEEP):
- `backend/src/services/kmsService.ts` - **REPURPOSE** (for transaction proposals)
- `backend/src/services/depositWatcherService.ts` - **UPDATE** (watch Squads vaults)
- `backend/src/services/timeoutScannerService.ts` - **UPDATE** (create refund proposals)

### Models (KEEP):
- `backend/src/models/MatchAttestation.ts` - **KEEP** (for audit trail)
- `backend/src/models/MatchAuditLog.ts` - **KEEP** (for audit trail)

## Migration Strategy

### Phase 1: Remove Custodial Code
1. Delete deterministic keypair generation
2. Remove unilateral transaction execution
3. Clean up fake multisig configuration
4. Remove obsolete documentation

### Phase 2: Implement Squads Protocol
1. Install `@sqds/multisig` SDK
2. Create `squadsVaultService.ts` with 2-of-3 multisig
3. Implement proposal-based payout system
4. Add player signing UI

### Phase 3: Test Non-Custodial Architecture
1. Verify backend cannot withdraw funds alone
2. Test player consent requirements
3. Validate timeout/refund mechanisms
4. Security audit

## Success Criteria

After migration, the system must:
- ✅ Use Squads Protocol for all vaults
- ✅ Require player signature for all payouts
- ✅ Backend cannot unilaterally withdraw funds
- ✅ Players control their own money
- ✅ Pass regulatory non-custodial assessment

## Risk Assessment

**Current Risk: HIGH**
- Regulatory non-compliance
- Single point of failure
- Potential fund misappropriation
- Legal liability for custodial status

**Post-Migration Risk: LOW**
- Regulatory compliant
- Player-controlled funds
- Audited smart contract infrastructure
- Transparent transaction history
