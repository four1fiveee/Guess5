# Multisig Migration Environment Variables

Copy these environment variables to your `.env` file for the multisig migration:

```bash
# Multisig Migration Environment Variables
# Copy this file to .env and fill in the values

# Database Configuration
DATABASE_URL=postgresql://username:password@localhost:5432/guess5_multisig

# Solana Configuration
SOLANA_NETWORK=https://api.devnet.solana.com
PROGRAM_ID=ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4

# Multisig Configuration
AUTOMATED_SIGNER_PUBKEY=your_automated_signer_public_key_here
CO_SIGNER_PUBKEY=your_co_signer_public_key_here
RECOVERY_KEY_PUBKEY=your_recovery_key_public_key_here

# AWS KMS Configuration
AWS_REGION=us-east-1
KMS_KEY_ID=your_kms_key_id_here
AWS_ACCESS_KEY_ID=your_aws_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_aws_secret_access_key_here

# Frontend Configuration
FRONTEND_URL=https://guess5.vercel.app

# Background Services Configuration
DEPOSIT_WATCHER_INTERVAL=10000
TIMEOUT_SCANNER_INTERVAL=30000
RECONCILIATION_WORKER_INTERVAL=60000

# Security Configuration
RECAPTCHA_SECRET_KEY=your_recaptcha_secret_key_here

# Logging Configuration
LOG_LEVEL=info
ENABLE_AUDIT_LOGGING=true

# Redis Configuration (for matchmaking)
REDIS_URL=redis://localhost:6379

# Node Environment
NODE_ENV=development
```

## Setup Instructions

1. **Generate Multisig Keys**: Create three keypairs for the 2-of-3 multisig configuration:
   - Automated Signer (KMS-controlled)
   - Co-signer (manual or second KMS account)
   - Recovery Key (cold wallet)

2. **AWS KMS Setup**: 
   - Create a KMS key in AWS
   - Configure IAM policies for the automated signer
   - Set up proper permissions for signing operations

3. **Database Migration**: Run the migration to add multisig fields:
   ```bash
   npm run migrate
   ```

4. **Background Services**: Start the background services for deposit watching, timeout scanning, and reconciliation.

5. **Testing**: Run the test suite to validate the multisig functionality:
   ```bash
   npm test
   ```

