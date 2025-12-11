# Referral System Database Schema Documentation

## Overview

This document outlines the complete database schema for tracking the referral system, including tier tracking, earnings, and match-level data.

## Database Tables

### 1. `match` Table
**Purpose**: Stores match information and referral earnings tracking

**Existing Fields**:
- `id` (UUID) - Primary key
- `player1`, `player2` - Player wallet addresses
- `netProfit` (DECIMAL) - Net profit from match
- `netProfitUSD` (DECIMAL) - USD equivalent
- `referralEarningsComputed` (BOOLEAN) - Flag if earnings calculated

**Status**: ✅ Complete - All required fields exist

### 2. `referral` Table
**Purpose**: Stores direct referral relationships

**Fields**:
- `id` (UUID) - Primary key
- `referredWallet` (TEXT) - Referred wallet address
- `referrerWallet` (TEXT) - Referrer wallet address
- `eligible` (BOOLEAN) - Eligibility status
- `active` (BOOLEAN) - Active status
- `referredAt` (TIMESTAMP) - Creation time

**Status**: ✅ Complete - All required fields exist

### 3. `referral_earning` Table
**Purpose**: Stores earnings records with tier tracking

**Fields**:
- `id` (UUID) - Primary key
- `matchId` (UUID) - Foreign key to match
- `referredWallet` (TEXT) - Referred wallet(s)
- `uplineWallet` (TEXT) - Referrer wallet
- `level` (INT) - Always 1 for direct referrals
- `amountUSD` (DECIMAL) - Earnings amount
- `amountSOL` (DECIMAL) - SOL equivalent
- `paid` (BOOLEAN) - Paid status
- `paidAt` (TIMESTAMP) - Payment time
- `payoutBatchId` (UUID) - Payout batch reference

**New Fields Added** (via migration):
- `tierName` (VARCHAR(20)) - Tier name at time of earning
- `tier` (INT) - Tier number
- `percentage` (DECIMAL) - Percentage used
- `bothPlayersReferred` (BOOLEAN) - Whether both players referred

**Status**: ✅ Migration added, fields available

## Database Queries Available

### Historical Earnings by Tier
```sql
SELECT 
  re.*,
  m.id as match_id,
  m.createdAt as match_created_at,
  m.netProfit,
  m.netProfitUSD
FROM referral_earning re
JOIN match m ON re.matchId = m.id
WHERE re.uplineWallet = $1
ORDER BY re.createdAt DESC
```

### Earnings by Match
```sql
SELECT 
  re.*,
  m.id as match_id,
  m.createdAt as match_created_at,
  m.player1,
  m.player2
FROM referral_earning re
JOIN match m ON re.matchId = m.id
WHERE re.uplineWallet = $1
ORDER BY re.createdAt DESC
```

### Match-Level Earnings
```sql
SELECT 
  m.id,
  m.player1,
  m.player2,
  m.netProfit,
  m.netProfitUSD,
  m.referralEarningsComputed,
  m.createdAt
FROM match m
WHERE m.id = $1
```

## Data Integrity

### Constraints
1. **Referral Uniqueness**: Each wallet can only be referred once per referrer
2. **Match Reference**: Must reference valid match
3. **Tier Consistency**: Tier must match referrer's current tier

### Indexes
- `IDX_referral_earning_upline_wallet` - Fast lookup by referrer
- `IDX_referral_earning_match_id` - Fast lookup by match
- `IDX_referral_earning_tier` - Fast lookup by tier
- `IDX_referral_earning_created_at` - Time-based queries

## Migration Status

✅ **Migration File Created**: `backend/src/migrations/add-referral-tier-tracking.sql`
✅ **Model Updated**: `backend/src/models/ReferralEarning.ts`
✅ **Service Updated**: `backend/src/services/referralService.ts`
✅ **Auto-Migration**: Added to `backend/src/db/index.ts`

## Verification Checklist

- [x] `tierName` field added to `referral_earning` table
- [x] `tier` field added to `referral_earning` table
- [x] `percentage` field added to `referral_earning` table
- [x] `bothPlayersReferred` field added to `referral_earning` table
- [x] Indexes created for performance
- [x] Migration SQL created
- [x] Auto-migration added to database initialization
- [x] Service updated to populate new fields
- [x] Model updated with new fields

## Next Steps

1. **Test Migration**: Run migration on dev environment
2. **Verify Data**: Check that tier data is being saved
3. **Monitor Performance**: Check query performance with new indexes

