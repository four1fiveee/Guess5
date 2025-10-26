# Guess5.io Multisig Migration Guide

This guide provides step-by-step instructions for migrating Guess5.io to multisig vault architecture with automated KMS signing. The old PDA-based escrow system has been completely removed as it was problematic and never worked properly.

## Overview

The new architecture uses:
- Per-match multisig vaults (2-of-3 configuration)
- KMS-backed automated signer for payouts/refunds
- Enhanced audit logging and transparency
- Background services for deposit monitoring and timeout handling
- Complete removal of the old PDA-based smart contract system

## Prerequisites

- AWS account with KMS access
- Solana devnet access
- PostgreSQL database
- Redis instance
- Node.js 18+ and npm

## Phase 1: Database Migration

### 1.1 Run Database Migration

```bash
cd backend
npm run migrate
```

This will:
- Remove all old PDA-related fields from the `match` table
- Add the following new tables and columns:
  - `match_attestations` table for KMS-signed attestations
  - `match_audit_logs` table for comprehensive audit trails
  - New columns in `match` table for multisig vault tracking
- Clean up legacy escrow and smart contract fields

### 1.2 Verify Migration

```bash
# Check database schema
psql -d your_database -c "\d match"
psql -d your_database -c "\d match_attestations"
psql -d your_database -c "\d match_audit_logs"
```

## Phase 2: KMS Setup

### 2.1 Create AWS KMS Key

```bash
# Create KMS key for automated signing
aws kms create-key --description "Guess5.io Automated Signer" --key-usage SIGN_VERIFY --key-spec ECC_SECG_P256R1

# Get the key ID
aws kms describe-key --key-id your-key-id
```

### 2.2 Configure IAM Policy

Create IAM policy for the automated signer:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "kms:Sign",
                "kms:Verify"
            ],
            "Resource": "arn:aws:kms:us-east-1:account:key/your-key-id"
        }
    ]
}
```

### 2.3 Generate Multisig Keys

```bash
# Generate three keypairs for 2-of-3 multisig
solana-keygen new --outfile automated_signer.json
solana-keygen new --outfile co_signer.json
solana-keygen new --outfile recovery_key.json

# Get public keys
solana-keygen pubkey automated_signer.json
solana-keygen pubkey co_signer.json
solana-keygen pubkey recovery_key.json
```

## Phase 3: Backend Deployment

### 3.1 Install Dependencies

```bash
cd backend
npm install @aws-sdk/client-kms
```

### 3.2 Configure Environment Variables

Copy the environment variables from `MULTISIG_ENV_EXAMPLE.md` and fill in your values.

### 3.3 Start Background Services

```bash
# Start the application with background services
npm run dev
```

The following services will start automatically:
- Deposit Watcher Service (10s interval)
- Timeout Scanner Service (30s interval)
- Reconciliation Worker Service (60s interval)

## Phase 4: Frontend Updates

### 4.1 Install New Components

The new components are already created:
- `MultisigVaultDeposit.tsx` - Handles vault deposits
- `MatchStatusDisplay.tsx` - Shows match and vault status

### 4.2 Update Match Flow

The frontend will now:
1. Show vault address after match creation
2. Block gameplay until both deposits are confirmed
3. Display real-time deposit and payout status
4. Show transaction links to Solana Explorer

## Phase 5: Testing

### 5.1 Run Test Suite

```bash
cd backend
npm test -- --testPathPattern=multisigMigration.test.ts
```

### 5.2 Manual Testing

Test the following scenarios:

1. **Happy Path**: Both players deposit, game played, winner confirmed
2. **Timeout Refund**: One player doesn't deposit
3. **Tie Scenario**: Both players solve same moves/time
4. **Invalid Replay**: Attempt to replay attestation
5. **Manual Co-signer**: Simulate partial failure

### 5.3 Devnet Validation

```bash
# Test on Solana devnet
export SOLANA_NETWORK=https://api.devnet.solana.com
npm run test:devnet
```

## Phase 6: Production Deployment

### 6.1 Update Render Configuration

Update `render.yaml` with new environment variables:

```yaml
services:
  - type: web
    name: guess5-backend
    env: node
    plan: starter
    buildCommand: cd backend && npm install && npm run build
    startCommand: cd backend && npm start
    envVars:
      - key: KMS_KEY_ID
        value: your-production-kms-key-id
      - key: AUTOMATED_SIGNER_PUBKEY
        value: your-production-automated-signer
      # ... other environment variables
```

### 6.2 Deploy to Production

```bash
# Deploy backend to Render
git push origin main

# Deploy frontend to Vercel
cd frontend
vercel --prod
```

## Phase 7: Monitoring and Maintenance

### 7.1 Monitor Background Services

Check service status via API:

```bash
curl https://your-backend-url/api/debug/status
```

### 7.2 Audit Log Monitoring

Monitor audit logs for discrepancies:

```bash
# Check recent audit logs
psql -d your_database -c "SELECT * FROM match_audit_logs ORDER BY created_at DESC LIMIT 10;"
```

### 7.3 Vault Reconciliation

The reconciliation worker automatically checks for balance discrepancies. Monitor logs for alerts.

## Rollback Plan

If issues arise, you can rollback by:

1. **Stop Background Services**: Services can be stopped without affecting existing matches
2. **Revert Database**: Use migration rollback commands
3. **Switch to Legacy API**: Keep the old PDA-based endpoints active during transition

## Security Considerations

1. **KMS Key Rotation**: Regularly rotate KMS keys
2. **Access Control**: Limit access to KMS operations
3. **Audit Logging**: All operations are logged for security analysis
4. **Multi-signature**: 2-of-3 multisig provides redundancy and security

## Performance Optimization

1. **Background Service Tuning**: Adjust polling intervals based on load
2. **Database Indexing**: Ensure proper indexes on new tables
3. **Redis Caching**: Use Redis for frequently accessed match data
4. **Connection Pooling**: Optimize database connections

## Support and Troubleshooting

### Common Issues

1. **KMS Signing Failures**: Check IAM permissions and key configuration
2. **Deposit Timeouts**: Verify Solana network connectivity
3. **Database Lock Issues**: Check for long-running transactions

### Log Analysis

```bash
# Check application logs
tail -f logs/application.log

# Check audit logs
psql -d your_database -c "SELECT * FROM match_audit_logs WHERE event_type = 'ERROR' ORDER BY created_at DESC;"
```

## Conclusion

This migration provides:
- ✅ Enhanced security with multisig vaults
- ✅ Automated payout processing with KMS
- ✅ Complete audit trails for transparency
- ✅ Scalable architecture for future growth
- ✅ Non-custodial design maintained

The migration maintains all existing game logic while providing a more robust and scalable foundation for Guess5.io's continued growth.
