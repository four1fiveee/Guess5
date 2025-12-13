# Migration Deployment Guide

## Overview

This guide explains how migrations work in this project and ensures they run automatically on Render and Vercel deployments.

## How Migrations Work

### Automatic Migration Execution

Migrations run **automatically** when the server starts:

1. **Server Startup** (`backend/src/server.ts`):
   - Calls `initializeDatabase()` on line 70
   - This happens during server initialization

2. **Database Initialization** (`backend/src/db/index.ts`):
   - `initializeDatabase()` function (line 61) automatically runs migrations
   - Line 76: `await AppDataSource.runMigrations()`
   - Migrations are loaded from `dist/db/migrations/*.js` (compiled TypeScript)

3. **Build Process**:
   - `npm run build` compiles TypeScript from `src/` to `dist/`
   - Migration files in `src/db/migrations/*.ts` are compiled to `dist/db/migrations/*.js`
   - TypeORM then loads and executes them

### Fallback Safety

Even if migrations fail, the code includes **fallback SQL** in `initializeDatabase()`:
- Ensures columns exist using `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`
- Ensures indexes exist using `CREATE INDEX IF NOT EXISTS`
- This provides redundancy in case migrations don't run

## New Migrations Added

### 1. `1734000000000-AddProposalManagementIndexes.ts`
- Adds 5 indexes for proposal management
- Composite indexes for faster queries
- Status and attempt count indexes

### 2. `1734000000001-AddProposalAttemptCount.ts`
- Adds `proposalAttemptCount` column to `match` table
- Tracks proposal creation attempts

## Deployment on Render

### Render Configuration

Render runs:
1. **Build Command**: `npm install && npm run build`
   - This compiles TypeScript (including migrations) to `dist/`

2. **Start Command**: `node dist/server.js`
   - Server starts and calls `initializeDatabase()`
   - Migrations run automatically

### Verification

After deployment, check logs for:
```
✅ Ran X migration(s): AddProposalManagementIndexes1734000000000, AddProposalAttemptCount1734000000001
```

Or if migrations already ran:
```
✅ No pending migrations
```

## Deployment on Vercel

### Vercel Configuration

Vercel (if used for API routes) should:
1. Run build command: `npm run build`
2. Start server: `node dist/server.js`

Same automatic migration execution applies.

## Manual Migration (If Needed)

If migrations don't run automatically, you can run them manually:

```bash
# Option 1: Using TypeORM CLI (if configured)
npm run migrate

# Option 2: Direct database connection
# Connect to Render Postgres and run SQL manually
```

## Fallback SQL (Already in Code)

The following fallback SQL is already in `backend/src/db/index.ts`:

```sql
-- proposalAttemptCount column
ALTER TABLE "match" 
ADD COLUMN IF NOT EXISTS "proposalAttemptCount" integer DEFAULT 0;

-- Proposal management indexes
CREATE INDEX IF NOT EXISTS "IDX_match_proposal_transaction" 
ON "match" ("id", "payoutProposalTransactionIndex")
WHERE "payoutProposalTransactionIndex" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IDX_match_tie_refund_transaction" 
ON "match" ("id", "tieRefundProposalTransactionIndex")
WHERE "tieRefundProposalTransactionIndex" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IDX_match_proposal_attempt_count" 
ON "match" ("proposalAttemptCount")
WHERE "proposalAttemptCount" > 0;

CREATE INDEX IF NOT EXISTS "IDX_match_proposal_status" 
ON "match" ("proposalStatus")
WHERE "proposalStatus" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "IDX_match_vault_transaction" 
ON "match" ("squadsVaultAddress", "payoutProposalTransactionIndex")
WHERE "squadsVaultAddress" IS NOT NULL AND "payoutProposalTransactionIndex" IS NOT NULL;
```

This ensures columns and indexes exist even if migrations fail.

## Troubleshooting

### Migrations Not Running

1. **Check Build Output**:
   - Verify `dist/db/migrations/` contains compiled `.js` files
   - Check that migration files are included in build

2. **Check Server Logs**:
   - Look for migration execution messages
   - Check for migration errors

3. **Check Database**:
   ```sql
   -- Check if migrations table exists
   SELECT * FROM migrations ORDER BY timestamp DESC LIMIT 10;
   
   -- Check if columns exist
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'match' AND column_name = 'proposalAttemptCount';
   
   -- Check if indexes exist
   SELECT indexname FROM pg_indexes 
   WHERE tablename = 'match' AND indexname LIKE 'IDX_match_proposal%';
   ```

### Migration Errors

If migrations fail:
1. Check database connection
2. Check migration file syntax
3. Fallback SQL will still create columns/indexes
4. Check server logs for specific error messages

## Verification Checklist

After deployment:

- [ ] Server starts successfully
- [ ] Migration logs show migrations ran (or "No pending migrations")
- [ ] `proposalAttemptCount` column exists in `match` table
- [ ] Proposal management indexes exist
- [ ] No errors in server logs related to migrations

## Summary

✅ **Migrations run automatically** on both Render and Vercel deployments
✅ **Fallback SQL** ensures columns/indexes exist even if migrations fail
✅ **No manual intervention needed** - everything happens during server startup

The system is designed to be resilient and self-healing.

