# 🧩 Proposal Execution Monitor

## Overview

Background worker that automatically executes proposals when they become `ExecuteReady` on-chain. This closes the final automation gap for proposals that are `Approved` but not executed.

## Problem Solved

**Scenario**: Proposal reaches `Approved` state with both signatures, but execution doesn't happen automatically.

**Root Causes**:
- Proposal status transition from `Approved` → `ExecuteReady` may be delayed
- Execution might fail silently
- Manual intervention required to execute stuck proposals

**Solution**: Background monitor that periodically scans for `Approved` proposals and executes them when ready.

## Implementation

### Service: `proposalExecutionMonitor.ts`

**Location**: `backend/src/services/proposalExecutionMonitor.ts`

**Key Features**:
- ✅ Scans every 60 seconds for `Approved` proposals
- ✅ Checks on-chain status to verify `ExecuteReady` state
- ✅ Automatically executes when ready
- ✅ Retry logic with exponential backoff (max 3 attempts)
- ✅ Tracks execution attempts to prevent spam
- ✅ Only processes proposals updated in last 30 minutes
- ✅ Graceful error handling (one failure doesn't stop the monitor)

### Configuration

```typescript
const SCAN_INTERVAL_MS = 60000;        // Scan every 60 seconds
const MAX_RETRY_ATTEMPTS = 3;          // Max retry attempts per proposal
const RETRY_BACKOFF_MS = 30000;        // 30 seconds between retries
const MAX_AGE_MINUTES = 30;            // Only process proposals updated in last 30 minutes
```

### Execution Flow

```
1. Scan database for Approved proposals
   - Status = 'APPROVED'
   - proposalExecutedAt IS NULL
   - proposalTransactionId IS NULL
   - Updated in last 30 minutes

2. For each proposal:
   a. Check on-chain status
   b. If already executed → Update database
   c. If ExecuteReady → Execute proposal
   d. If Approved but not ExecuteReady → Wait (check again next scan)
   e. If execution fails → Schedule retry with backoff

3. Track execution attempts to prevent spam
4. Clean up old attempts (1 hour TTL)
```

### Integration

**Server Startup** (`backend/src/server.ts`):
- Monitor starts automatically when server starts
- Runs in background (non-blocking)
- Gracefully stops on server shutdown

**Lifecycle**:
```typescript
// Start
startProposalExecutionMonitor();

// Stop (on graceful shutdown)
stopProposalExecutionMonitor();
```

## Monitoring

### Log Messages

**Success**:
- `✅ Proposal executed successfully (monitor)` - Execution completed
- `✅ Proposal already executed on-chain, updating database` - Already executed

**Info**:
- `🔍 Proposal execution monitor: Found X Approved proposals to check` - Scan results
- `⏳ Proposal is Approved but not ExecuteReady yet, waiting` - Not ready yet

**Warnings**:
- `⚠️ Proposal execution failed, will retry` - Execution failed, retry scheduled
- `⚠️ Max execution attempts reached for proposal` - Max retries reached

**Errors**:
- `❌ Error processing Approved proposal, will retry` - Error occurred, retry scheduled

## Comparison with Existing Services

### `executionRetryService.ts`
- **Focus**: Retries failed executions for `READY_TO_EXECUTE` and `EXECUTING` statuses
- **Use Case**: Handles execution failures and stuck executions

### `proposalExecutionMonitor.ts` (NEW)
- **Focus**: Watches for `Approved` proposals and executes when `ExecuteReady`
- **Use Case**: Handles proposals that never transitioned to execution

**Together**: Complete coverage for all execution scenarios

## Testing

### Manual Test

1. Create a match with an `Approved` proposal
2. Wait for proposal to become `ExecuteReady` on-chain
3. Monitor should detect and execute within 60 seconds
4. Check logs for execution confirmation

### Expected Behavior

- ✅ Monitor scans every 60 seconds
- ✅ Executes `ExecuteReady` proposals automatically
- ✅ Retries failed executions with backoff
- ✅ Updates database with execution results
- ✅ Cleans up old execution attempts

## Future Enhancements

### Optional Improvements

1. **Configurable Intervals**: Make scan interval configurable via environment variable
2. **Metrics**: Track execution success rate, average execution time
3. **Alerting**: Notify when proposals are stuck for extended periods
4. **Batch Execution**: Execute multiple proposals in parallel (with rate limiting)

## Files Changed

1. **Created**: `backend/src/services/proposalExecutionMonitor.ts`
2. **Modified**: `backend/src/server.ts`
   - Added monitor startup in server initialization
   - Added monitor shutdown in graceful shutdown handler

## Deployment Notes

- ✅ No database migrations required
- ✅ No environment variables required
- ✅ Backward compatible (optional service)
- ✅ Can be disabled by not calling `startProposalExecutionMonitor()`
- ✅ Safe to deploy immediately




