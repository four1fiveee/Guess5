# SDK Upgrade Readiness: @sqds/multisig@2.3.0

## Current Status

✅ **Code is ready for SDK v2.3.0+**

The codebase already includes `vaultTransactionActivate()` calls in `squadsVaultService.ts`:
- Lines 4605-4630: Primary activation call before execution
- Lines 4668-4689: Retry activation on publicKey errors

## Current SDK Version

- **Installed**: `@sqds/multisig@2.1.4` (latest available on npm)
- **Required**: `@sqds/multisig@^2.3.0` (not yet published)

## When SDK v2.3.0 is Released

### Upgrade Steps

1. **Install the new SDK version:**
   ```bash
   cd backend
   npm install @sqds/multisig@^2.3.0 --save
   ```

2. **Update package.json:**
   ```json
   "@sqds/multisig": "^2.3.0"
   ```

3. **Verify the upgrade:**
   ```bash
   npm list @sqds/multisig
   # Should show version 2.3.0 or higher
   ```

4. **Test execution:**
   - The `vaultTransactionActivate()` calls will now work
   - Proposals in `Approved` state will transition to `ExecuteReady`
   - Execution will succeed without `publicKey` errors

## What Will Change After Upgrade

### Before (v2.1.4):
- ❌ `vaultTransactionActivate()` doesn't exist → throws error (caught gracefully)
- ❌ Cannot execute `Approved` proposals → stuck in retry loop
- ❌ SDK crashes with `"Cannot read properties of undefined (reading 'publicKey')"`

### After (v2.3.0+):
- ✅ `vaultTransactionActivate()` exists → proposals transition to `ExecuteReady`
- ✅ Can execute `Approved` proposals → automatic execution succeeds
- ✅ No more SDK crashes → full automation restored

## Code Locations

The activation logic is implemented in:
- **File**: `backend/src/services/squadsVaultService.ts`
- **Function**: `executeProposal()`
- **Lines**: 4592-4630 (primary activation), 4667-4689 (retry activation)

## Monitoring

After upgrade, watch for these log messages:
- ✅ `"🔄 Activating proposal to ExecuteReady state"`
- ✅ `"✅ Proposal activation successful"`
- ✅ `"✅ Proposal executed successfully"`
- ✅ `"📊 METRIC: execute.success"`

## Current Behavior

The code currently:
1. Attempts to call `vaultTransactionActivate()` (wrapped in try-catch)
2. Logs a warning if activation fails (expected with v2.1.4)
3. Continues with execution attempt
4. Fails with `publicKey` error (SDK limitation)
5. Retries with activation again
6. Background monitor continues retrying every 60 seconds

Once SDK v2.3.0 is installed, steps 2, 4, and 5 will be eliminated, and execution will succeed.

