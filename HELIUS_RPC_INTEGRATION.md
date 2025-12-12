# Helius RPC Integration

## Overview

This project now supports Helius RPC for premium Solana RPC access with higher rate limits and better reliability. Helius RPC is automatically used when the API key is configured.

## Environment Variable

**Variable Name:** `HELIUS_API_KEY`

**Where to Set:**
- **Render (Backend):** Add this as an environment variable in your Render dashboard
- **Local Development:** Add to your `.env` file

## How It Works

1. **Automatic Detection:** The system automatically detects if `HELIUS_API_KEY` is set
2. **Network Selection:** Uses the appropriate Helius endpoint based on `SOLANA_NETWORK`:
   - `devnet` → `https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY`
   - `mainnet` or `mainnet-beta` → `https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY`
3. **Fallback:** If `HELIUS_API_KEY` is not set, falls back to standard Solana RPC endpoints

## Configuration

### Render Environment Variables

Add the following environment variable in your Render dashboard:

```
HELIUS_API_KEY=your_helius_api_key_here
```

**Note:** Keep your API key secure and never commit it to version control.

### Network Configuration

The `SOLANA_NETWORK` environment variable determines which network to use:

- `devnet` (default) - Uses Helius devnet endpoint
- `mainnet` or `mainnet-beta` - Uses Helius mainnet endpoint

## Benefits

✅ **Higher Rate Limits:** Developer plan provides significantly higher rate limits than free-tier RPC  
✅ **Better Reliability:** Reduced 429 errors during high-throughput operations  
✅ **Priority Routing:** Faster response times for critical operations  
✅ **Automatic Failover:** Falls back to standard RPC if Helius is unavailable  

## Implementation Details

### Centralized Connection Factory

All Solana connections are created through `backend/src/config/solanaConnection.ts`:

```typescript
import { createSolanaConnection } from '../config/solanaConnection';

// Creates a connection with Helius if API key is set
const connection = createSolanaConnection('confirmed');
```

### Updated Services

The following services have been updated to use Helius RPC:

- ✅ `matchController.ts` - Transaction broadcasting and proposal sync
- ✅ `proposalSyncService.ts` - Proposal status synchronization
- ✅ `squadsVaultService.ts` - Squads multisig operations
- ✅ `payoutService.ts` - Payout processing
- ✅ `paymentVerificationService.ts` - Payment verification

## Verification

After setting `HELIUS_API_KEY` in Render, check the backend logs on startup. You should see:

```
✅ Using Helius RPC (devnet)
✅ Helius RPC API key configured - using premium RPC endpoint
```

If the API key is not set, you'll see:

```
⚠️ Using standard Solana RPC (devnet) - Consider setting HELIUS_API_KEY for better performance
⚠️ HELIUS_API_KEY not set - using standard Solana RPC (may have rate limits)
```

## Troubleshooting

### Still Getting 429 Errors?

1. **Verify API Key:** Check that `HELIUS_API_KEY` is correctly set in Render
2. **Check Logs:** Look for "✅ Using Helius RPC" in startup logs
3. **Rate Limits:** Even with Helius, there are still rate limits - the Redis sync lock helps reduce duplicate calls
4. **Network:** Ensure `SOLANA_NETWORK` matches your Helius plan (devnet vs mainnet)

### Connection Issues

If you experience connection issues:

1. **Test Helius Endpoint:** Verify your API key works by testing the endpoint directly
2. **Check Network:** Ensure `SOLANA_NETWORK` is set correctly
3. **Fallback:** The system will automatically fall back to standard RPC if Helius fails

## Next Steps

1. ✅ Add `HELIUS_API_KEY` to Render environment variables
2. ✅ Restart the backend service
3. ✅ Monitor logs to confirm Helius is being used
4. ✅ Test transaction signing and broadcasting
5. ✅ Monitor for reduced 429 errors

## Support

For Helius-specific issues:
- Helius Dashboard: https://dashboard.helius.dev
- Helius Documentation: https://docs.helius.dev

For application issues:
- Check backend logs for connection status
- Verify environment variables are set correctly
- Ensure network configuration matches your Helius plan

