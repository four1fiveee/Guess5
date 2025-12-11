-- Create payout_lock table for tracking weekly referral payout locks
CREATE TABLE IF NOT EXISTS "payout_lock" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "lockDate" timestamp NOT NULL UNIQUE,
  "totalAmountUSD" decimal(12,2) NOT NULL,
  "totalAmountSOL" decimal(12,6) NOT NULL,
  "referrerCount" integer NOT NULL,
  "lockedAt" timestamp,
  "executedAt" timestamp,
  "transactionSignature" text,
  "executedByAdmin" text,
  "autoExecuted" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

-- Create index on lockDate for fast lookups
CREATE INDEX IF NOT EXISTS "IDX_payout_lock_lockDate" ON "payout_lock" ("lockDate");

-- Create index on executedAt for filtering executed locks
CREATE INDEX IF NOT EXISTS "IDX_payout_lock_executedAt" ON "payout_lock" ("executedAt");

