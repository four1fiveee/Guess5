-- Migration: Add tier tracking fields to referral_earning table
-- This migration adds fields to track tier information at the time of earning
-- for historical accuracy and better analytics

-- Add tier tracking fields
ALTER TABLE "referral_earning" 
ADD COLUMN IF NOT EXISTS "tierName" VARCHAR(20),
ADD COLUMN IF NOT EXISTS "tier" INTEGER,
ADD COLUMN IF NOT EXISTS "percentage" DECIMAL(5,4),
ADD COLUMN IF NOT EXISTS "bothPlayersReferred" BOOLEAN DEFAULT FALSE;

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS "IDX_referral_earning_tier" ON "referral_earning" ("tier");
CREATE INDEX IF NOT EXISTS "IDX_referral_earning_tierName" ON "referral_earning" ("tierName");
CREATE INDEX IF NOT EXISTS "IDX_referral_earning_bothPlayersReferred" ON "referral_earning" ("bothPlayersReferred");

-- Add comment for documentation
COMMENT ON COLUMN "referral_earning"."tierName" IS 'Tier name at time of earning: Base, Silver, Gold, Platinum';
COMMENT ON COLUMN "referral_earning"."tier" IS 'Tier number at time of earning: 0 (Base), 1 (Silver), 2 (Gold), 3 (Platinum)';
COMMENT ON COLUMN "referral_earning"."percentage" IS 'Percentage used at time of earning: 0.10, 0.15, 0.20, 0.25';
COMMENT ON COLUMN "referral_earning"."bothPlayersReferred" IS 'Whether both players in the match were referred by this referrer';

