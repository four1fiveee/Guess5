-- High-Impact Security Schema Update Migration
-- This migration updates the match table to align with no-escrow flow and add security features

-- 1. Rename escrow fields to entry fields
ALTER TABLE "match" RENAME COLUMN "escrowAddress" TO "feeWalletAddress";
ALTER TABLE "match" RENAME COLUMN "player1EscrowConfirmed" TO "player1EntryConfirmed";
ALTER TABLE "match" RENAME COLUMN "player2EscrowConfirmed" TO "player2EntryConfirmed";
ALTER TABLE "match" RENAME COLUMN "player1EscrowSignature" TO "player1EntrySignature";
ALTER TABLE "match" RENAME COLUMN "player2EscrowSignature" TO "player2EntrySignature";

-- 2. Add new blockchain verification fields for entry payments
ALTER TABLE "match" ADD COLUMN "player1EntrySlot" INTEGER;
ALTER TABLE "match" ADD COLUMN "player1EntryBlockTime" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "player1EntryFinalized" BOOLEAN DEFAULT FALSE;
ALTER TABLE "match" ADD COLUMN "player2EntrySlot" INTEGER;
ALTER TABLE "match" ADD COLUMN "player2EntryBlockTime" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "player2EntryFinalized" BOOLEAN DEFAULT FALSE;

-- 3. Add UTC timestamp fields for dual timezone support
ALTER TABLE "match" ADD COLUMN "gameStartTimeUtc" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "gameEndTime" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "gameEndTimeUtc" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "refundedAtUtc" TIMESTAMP;

-- 4. Add payout signature fields with blockchain verification
ALTER TABLE "match" ADD COLUMN "winnerPayoutSignature" VARCHAR;
ALTER TABLE "match" ADD COLUMN "winnerPayoutSlot" INTEGER;
ALTER TABLE "match" ADD COLUMN "winnerPayoutBlockTime" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "winnerPayoutFinalized" BOOLEAN DEFAULT FALSE;

-- 5. Add refund signature fields with blockchain verification
ALTER TABLE "match" ADD COLUMN "player1RefundSignature" VARCHAR;
ALTER TABLE "match" ADD COLUMN "player1RefundSlot" INTEGER;
ALTER TABLE "match" ADD COLUMN "player1RefundBlockTime" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "player1RefundFinalized" BOOLEAN DEFAULT FALSE;
ALTER TABLE "match" ADD COLUMN "player2RefundSignature" VARCHAR;
ALTER TABLE "match" ADD COLUMN "player2RefundSlot" INTEGER;
ALTER TABLE "match" ADD COLUMN "player2RefundBlockTime" TIMESTAMP;
ALTER TABLE "match" ADD COLUMN "player2RefundFinalized" BOOLEAN DEFAULT FALSE;

-- 6. Add financial tracking fields
ALTER TABLE "match" ADD COLUMN "totalFeesCollected" DECIMAL(10,6);
ALTER TABLE "match" ADD COLUMN "platformFee" DECIMAL(10,6);
ALTER TABLE "match" ADD COLUMN "matchDuration" DECIMAL(10,6);

-- 7. Add completion tracking
ALTER TABLE "match" ADD COLUMN "isCompleted" BOOLEAN DEFAULT FALSE;

-- 8. Add integrity hash field
ALTER TABLE "match" ADD COLUMN "rowHash" VARCHAR;

-- 9. Update status enum constraint (if using PostgreSQL)
-- Note: This may need to be done differently depending on your database
-- For now, we'll add a check constraint
ALTER TABLE "match" ADD CONSTRAINT "match_status_check" 
  CHECK (status IN ('pending', 'funding', 'live', 'completed', 'canceled'));

-- 10. Add matchOutcome enum constraint
ALTER TABLE "match" ADD CONSTRAINT "match_outcome_check" 
  CHECK ("matchOutcome" IN ('p1_win', 'p2_win', 'draw', 'cancel_opponent_no_fund', 'cancel_both_unfunded', 'cancel_tech_error'));

-- 11. Update existing data to set default values
UPDATE "match" SET 
  "player1EntryConfirmed" = "player1Paid",
  "player2EntryConfirmed" = "player2Paid",
  "player1EntryFinalized" = TRUE,
  "player2EntryFinalized" = TRUE,
  "gameStartTimeUtc" = "gameStartTime",
  "gameEndTimeUtc" = "updatedAt",
  "refundedAtUtc" = "refundedAt",
  "totalFeesCollected" = "entryFee" * 2,
  "platformFee" = "entryFee" * 0.1,
  "isCompleted" = CASE WHEN status = 'completed' THEN TRUE ELSE FALSE END;

-- 12. Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_match_status" ON "match" (status);
CREATE INDEX IF NOT EXISTS "idx_match_created_at" ON "match" ("createdAt");
CREATE INDEX IF NOT EXISTS "idx_match_is_completed" ON "match" ("isCompleted");
CREATE INDEX IF NOT EXISTS "idx_match_player1" ON "match" ("player1");
CREATE INDEX IF NOT EXISTS "idx_match_player2" ON "match" ("player2");

-- 13. Add comments for documentation
COMMENT ON COLUMN "match"."feeWalletAddress" IS 'Fee wallet address (renamed from escrowAddress)';
COMMENT ON COLUMN "match"."player1EntrySignature" IS 'Player 1 entry payment transaction signature';
COMMENT ON COLUMN "match"."player2EntrySignature" IS 'Player 2 entry payment transaction signature';
COMMENT ON COLUMN "match"."player1EntrySlot" IS 'Blockchain slot for player 1 entry payment';
COMMENT ON COLUMN "match"."player1EntryFinalized" IS 'Whether player 1 entry payment is finalized';
COMMENT ON COLUMN "match"."rowHash" IS 'SHA256 hash for row-level integrity verification';
COMMENT ON COLUMN "match"."isCompleted" IS 'Whether both players have finished the game';

-- Migration completed successfully
SELECT 'High-Impact Security Schema Update Migration completed successfully' as migration_status;
