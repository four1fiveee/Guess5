-- Add Security Fields Migration
-- This migration adds new fields for the high-impact security features
-- It's safe to run multiple times (uses IF NOT EXISTS)

-- Add new fee wallet fields (if they don't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'feeWalletAddress') THEN
        ALTER TABLE "match" ADD COLUMN "feeWalletAddress" VARCHAR;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1EntrySignature') THEN
        ALTER TABLE "match" ADD COLUMN "player1EntrySignature" VARCHAR;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2EntrySignature') THEN
        ALTER TABLE "match" ADD COLUMN "player2EntrySignature" VARCHAR;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1EntryConfirmed') THEN
        ALTER TABLE "match" ADD COLUMN "player1EntryConfirmed" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2EntryConfirmed') THEN
        ALTER TABLE "match" ADD COLUMN "player2EntryConfirmed" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add blockchain verification fields
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1EntrySlot') THEN
        ALTER TABLE "match" ADD COLUMN "player1EntrySlot" INTEGER;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1EntryBlockTime') THEN
        ALTER TABLE "match" ADD COLUMN "player1EntryBlockTime" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1EntryFinalized') THEN
        ALTER TABLE "match" ADD COLUMN "player1EntryFinalized" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2EntrySlot') THEN
        ALTER TABLE "match" ADD COLUMN "player2EntrySlot" INTEGER;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2EntryBlockTime') THEN
        ALTER TABLE "match" ADD COLUMN "player2EntryBlockTime" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2EntryFinalized') THEN
        ALTER TABLE "match" ADD COLUMN "player2EntryFinalized" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add UTC timestamp fields
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'gameStartTimeUtc') THEN
        ALTER TABLE "match" ADD COLUMN "gameStartTimeUtc" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'gameEndTime') THEN
        ALTER TABLE "match" ADD COLUMN "gameEndTime" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'gameEndTimeUtc') THEN
        ALTER TABLE "match" ADD COLUMN "gameEndTimeUtc" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'refundedAtUtc') THEN
        ALTER TABLE "match" ADD COLUMN "refundedAtUtc" TIMESTAMP;
    END IF;
END $$;

-- Add payout signature fields
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'winnerPayoutSignature') THEN
        ALTER TABLE "match" ADD COLUMN "winnerPayoutSignature" VARCHAR;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'winnerPayoutSlot') THEN
        ALTER TABLE "match" ADD COLUMN "winnerPayoutSlot" INTEGER;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'winnerPayoutBlockTime') THEN
        ALTER TABLE "match" ADD COLUMN "winnerPayoutBlockTime" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'winnerPayoutFinalized') THEN
        ALTER TABLE "match" ADD COLUMN "winnerPayoutFinalized" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add refund signature fields
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1RefundSignature') THEN
        ALTER TABLE "match" ADD COLUMN "player1RefundSignature" VARCHAR;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1RefundSlot') THEN
        ALTER TABLE "match" ADD COLUMN "player1RefundSlot" INTEGER;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1RefundBlockTime') THEN
        ALTER TABLE "match" ADD COLUMN "player1RefundBlockTime" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player1RefundFinalized') THEN
        ALTER TABLE "match" ADD COLUMN "player1RefundFinalized" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2RefundSignature') THEN
        ALTER TABLE "match" ADD COLUMN "player2RefundSignature" VARCHAR;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2RefundSlot') THEN
        ALTER TABLE "match" ADD COLUMN "player2RefundSlot" INTEGER;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2RefundBlockTime') THEN
        ALTER TABLE "match" ADD COLUMN "player2RefundBlockTime" TIMESTAMP;
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'player2RefundFinalized') THEN
        ALTER TABLE "match" ADD COLUMN "player2RefundFinalized" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add financial tracking fields
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'totalFeesCollected') THEN
        ALTER TABLE "match" ADD COLUMN "totalFeesCollected" DECIMAL(10,6);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'platformFee') THEN
        ALTER TABLE "match" ADD COLUMN "platformFee" DECIMAL(10,6);
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'matchDuration') THEN
        ALTER TABLE "match" ADD COLUMN "matchDuration" DECIMAL(10,6);
    END IF;
END $$;

-- Add completion tracking
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'isCompleted') THEN
        ALTER TABLE "match" ADD COLUMN "isCompleted" BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- Add integrity hash field
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'rowHash') THEN
        ALTER TABLE "match" ADD COLUMN "rowHash" VARCHAR;
    END IF;
END $$;

-- Add match outcome field
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'matchOutcome') THEN
        ALTER TABLE "match" ADD COLUMN "matchOutcome" VARCHAR;
    END IF;
END $$;

-- Add refund reason field
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'refundReason') THEN
        ALTER TABLE "match" ADD COLUMN "refundReason" VARCHAR;
    END IF;
END $$;

-- Update existing data to populate new fields
UPDATE "match" SET 
  "player1EntryConfirmed" = COALESCE("player1Paid", FALSE),
  "player2EntryConfirmed" = COALESCE("player2Paid", FALSE),
  "player1EntryFinalized" = TRUE,
  "player2EntryFinalized" = TRUE,
  "gameStartTimeUtc" = "gameStartTime",
  "gameEndTimeUtc" = "updatedAt",
  "refundedAtUtc" = "refundedAt",
  "totalFeesCollected" = COALESCE("entryFee" * 2, 0),
  "platformFee" = COALESCE("entryFee" * 0.1, 0),
  "isCompleted" = CASE WHEN status = 'completed' THEN TRUE ELSE FALSE END
WHERE "player1EntryConfirmed" IS NULL;

-- Create indexes for performance (if they don't exist)
CREATE INDEX IF NOT EXISTS "idx_match_status" ON "match" (status);
CREATE INDEX IF NOT EXISTS "idx_match_created_at" ON "match" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_match_is_completed" ON "match" ("isCompleted");
CREATE INDEX IF NOT EXISTS "idx_match_player1" ON "match" ("player1");
CREATE INDEX IF NOT EXISTS "idx_match_player2" ON "match" ("player2");

-- Migration completed successfully
SELECT 'Security fields migration completed successfully' as migration_status;
