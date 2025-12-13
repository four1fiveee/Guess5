# Execution Signature Verification Failure Analysis

## Match Details
- **Match ID**: `2a37dbdc-46bf-4ae8-a065-8ef71e909e17`
- **Proposal ID**: `DpbSoG3KLNrtQ2q9nY1LvwMMaJ5se4LrWcZusuwQ35yw`
- **Vault Address**: `Aatkf7asi98FkxwxRFBfrViAjCCFJMW8eQvgZajuQ44B`
- **Transaction Index**: 1

## Current Status

### On-Chain Status (from Squads MCP)
- **Proposal Status**: `Approved`
- **Approved Signers**: 2/2
  - `2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt`
  - `F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8`
- **Threshold**: 2
- **Status Kind**: `{"__kind": "Approved", "timestamp": "693db558"}`
- **NOT ExecuteReady**: The proposal is stuck in `Approved` state

### Database Status
- **proposalStatus**: `APPROVED`
- **needsSignatures**: 0
- **proposalExecutedAt**: `null` (not executed)
- **proposalTransactionId**: `2hiqWahakP2cNJML7ny8GmGt6BK6Y8YUweCakd7CzLhMZo8g91gShWPxAAVQVuy6e5xShupxTYZpUj6xZ25PjTfP` (this is the signature from signing, not execution)

## Problem Analysis

### Root Cause
The execution is failing with **"Transaction signature verification failure"** when attempting to execute from `Approved` state. This error occurs during transaction simulation, before the transaction is even sent to the network.

### Error Pattern
```
⚠️ Execute failed from Approved state — proposal may be in invalid state
Error: Simulation failed. 
Message: Transaction signature verification failure. 

Catch the `SendTransactionError` and call `getLogs()` on it for full details.
```

### Key Observations

1. **Proposal is Approved with Threshold Met**
   - 2/2 signatures collected
   - Threshold requirement satisfied
   - Status is `Approved` (not `ExecuteReady`)

2. **Execution Attempts Failing Consistently**
   - All execution attempts from `Approved` state fail
   - Error is always "Transaction signature verification failure"
   - This happens during simulation, not during on-chain execution

3. **Our Fix is Working (Partially)**
   - The code correctly detects `Approved` state with threshold met
   - It correctly skips `waitForExecuteReady()` as designed
   - But execution still fails because the SDK requires `ExecuteReady` state

## Critical Discovery

### The SDK's `vaultTransactionExecute` May Require ExecuteReady State

While we theorized that Squads v4 allows execution from `Approved` state (and the program does validate at execution time), **the SDK's `rpc.vaultTransactionExecute()` method may internally require the proposal to be in `ExecuteReady` state** to properly build the transaction.

The "Transaction signature verification failure" during simulation suggests:
- The SDK is trying to build a transaction
- The transaction structure is invalid because the proposal isn't in the expected state
- The SDK might be checking proposal status internally and failing

## Solution Options

### Option 1: Force ExecuteReady Transition Before Execution (RECOMMENDED)

Even though we skip `waitForExecuteReady()`, we should still **explicitly trigger the transition** using `vaultTransactionActivate()` before attempting execution. This ensures the proposal is in the correct state for the SDK.

**Implementation**:
1. Call `vaultTransactionActivate()` to trigger `Approved → ExecuteReady` transition
2. Wait briefly (1-2 seconds) for the state to update
3. Then call `vaultTransactionExecute()`

### Option 2: Wait for ExecuteReady After Activation

If Option 1 doesn't work, we may need to:
1. Call `vaultTransactionActivate()`
2. Wait for `ExecuteReady` state (using our existing `waitForExecuteReady()` logic)
3. Then execute

### Option 3: Investigate SDK Requirements

Check Squads SDK documentation or source code to confirm if `vaultTransactionExecute` requires `ExecuteReady` state, or if there's a different execution method for `Approved` proposals.

## Recommended Fix

Modify `executeProposal()` in `squadsVaultService.ts`:

```typescript
// When proposal is Approved with threshold met:
if (isApprovedWithThresholdMet) {
  // CRITICAL: Even though we skip waitForExecuteReady, we still need to
  // trigger the transition for the SDK to work properly
  try {
    await rpc.vaultTransactionActivate({
      connection: this.connection,
      feePayer: executor,
      multisigPda: multisigAddress,
      transactionIndex: transactionIndexNumber,
      programId: this.programId,
    });
    
    // Wait briefly for state to update (1-2 seconds)
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Verify we're now in ExecuteReady state
    const updatedProposal = await accounts.Proposal.fromAccountAddress(
      this.connection,
      proposalPda
    );
    const updatedStatus = updatedProposal.status.__kind;
    
    if (updatedStatus !== 'ExecuteReady') {
      enhancedLogger.warn('⚠️ Proposal did not transition to ExecuteReady after activation', {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndexNumber,
        currentStatus: updatedStatus,
        correlationId,
        note: 'Will attempt execution anyway - SDK may handle this',
      });
    }
  } catch (activateError: any) {
    enhancedLogger.warn('⚠️ Failed to activate proposal before execution', {
      vaultAddress,
      proposalId,
      transactionIndex: transactionIndexNumber,
      error: activateError?.message || String(activateError),
      correlationId,
      note: 'Continuing with execution attempt - may fail if ExecuteReady is required',
    });
  }
  
  // Now attempt execution
  executionSignature = await rpc.vaultTransactionExecute({...});
}
```

## Next Steps

1. **Implement Option 1**: Add explicit `vaultTransactionActivate()` call before execution from `Approved` state
2. **Test**: Verify execution succeeds after activation
3. **Monitor**: Check logs to confirm ExecuteReady transition occurs
4. **Fallback**: If still failing, implement Option 2 (wait for ExecuteReady after activation)

## Conclusion

The issue is that while Squads v4 programmatically allows execution from `Approved` state, the SDK's `vaultTransactionExecute()` method appears to require `ExecuteReady` state to properly build and sign the execution transaction. We need to explicitly trigger the state transition before execution, even though we skip the waiting logic.

