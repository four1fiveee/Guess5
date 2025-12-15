# Squads Transaction Flow Comparison

## Documentation Requirements vs. Our Implementation

### 1. Sequential Transaction Process

**Squads Documentation Requirements:**
- **Initiate**: Transaction is proposed and recorded onchain (creates transaction account and proposal account)
- **Approve**: Signers review and provide onchain signatures (modifies proposal account state, not transaction account)
- **Execute**: Once threshold is met, transaction is executed

**Our Implementation:**
✅ **COMPLIANT**: 
- `proposeWinnerPayout()` creates VaultTransaction first (line 1174), then Proposal (line 1564)
- `approveProposal()` uses `instructions.proposalApprove` which modifies proposal state (line 3549)
- `executeProposal()` executes after threshold is met (line 3947)

### 2. Transaction Immutability

**Squads Documentation:**
- Transaction content is immutable once initiated
- Transaction account contains the actual transaction data to be executed
- Proposal account tracks approvals

**Our Implementation:**
✅ **COMPLIANT**: 
- VaultTransaction is created first and never modified (line 1174)
- Only Proposal account state changes with approvals (line 3549)
- Transaction account remains unchanged throughout approval process

### 3. Two-Minute Rule (Security Best Practice)

**Squads Documentation:**
- After initiation, each signer should wait 2 minutes before the next person proceeds
- This allows blockhash to expire, making captured signatures useless after 2 minutes
- Critical for preventing signature replay attacks

**Our Implementation:**
❌ **NOT IMPLEMENTED**: 
- No 2-minute wait between signers
- Players can sign immediately after proposal creation
- This is a security gap that should be addressed

**Recommendation**: Add a 2-minute minimum wait between signers, or at least log a warning if signers approve too quickly.

### 4. Separate Approval and Execution

**Squads Documentation:**
- Always approve and execute transactions in separate steps
- Avoid using the "Approve + Execute" feature for maximum security

**Our Implementation:**
✅ **COMPLIANT**: 
- `approveProposal()` only approves (line 3421)
- `executeProposal()` only executes (line 3947)
- No combined approve+execute calls

### 5. Transaction Verification

**Squads Documentation:**
- Signers should verify transaction details before approving
- Use transaction simulation and Solana Explorer Inspector
- Verify transaction ID matches across all signers

**Our Implementation:**
⚠️ **PARTIAL**: 
- We verify proposal exists before signing (line 13941+)
- We sync proposal status from on-chain (line 13944+)
- But we don't explicitly verify transaction content matches before approval
- Players sign transactions from frontend, but backend doesn't re-verify the transaction content

**Recommendation**: Add explicit transaction content verification before accepting signatures.

### 6. Proposal State Management

**Squads Documentation:**
- Each signature modifies the proposal account's state
- Squads never sends the same transaction to multiple signers
- Only updates proposal state with each approval

**Our Implementation:**
✅ **COMPLIANT**: 
- Each player signs independently (signProposalHandler)
- Backend verifies signature on-chain (verifySignatureOnChain)
- Proposal state is updated with each approval
- We don't send the same transaction to multiple signers

### 7. Durable Nonce Exception

**Squads Documentation:**
- Two-minute rule depends on blockhash expiration
- Durable nonces bypass this protection
- Should verify initiator has no durable nonce accounts

**Our Implementation:**
❌ **NOT CHECKED**: 
- We don't check for durable nonce accounts
- This could allow signatures to remain valid indefinitely

**Recommendation**: Add durable nonce account check before accepting signatures.

## Summary

### ✅ Compliant Areas:
1. Sequential transaction process (Initiate → Approve → Execute)
2. Transaction immutability (VaultTransaction never modified)
3. Separate approval and execution steps
4. Proposal state management (each signature updates proposal)

### ⚠️ Areas Needing Improvement:
1. **Two-Minute Rule**: Not implemented - security gap
2. **Transaction Content Verification**: Partial - should verify transaction content matches before approval
3. **Durable Nonce Check**: Not implemented - security gap

### 🔧 Recommended Fixes:

1. **Add Two-Minute Rule Enforcement**:
   - Track proposal creation time
   - Require minimum 2-minute wait between signers
   - Log warning if signers approve too quickly

2. **Add Transaction Content Verification**:
   - Before accepting signature, verify the signed transaction matches the on-chain VaultTransaction
   - Ensure transaction ID matches across all signers

3. **Add Durable Nonce Check**:
   - Before accepting signatures, check if initiator has durable nonce accounts
   - Warn or reject if durable nonce is detected

