-- Migration: Add transactionIndex columns to match table
-- Purpose: Store transaction indices to ensure proposal IDs always match transaction index PDAs
-- Date: 2025-12-12

-- Add payoutProposalTransactionIndex column
ALTER TABLE "match" 
ADD COLUMN IF NOT EXISTS "payoutProposalTransactionIndex" VARCHAR;

-- Add tieRefundProposalTransactionIndex column
ALTER TABLE "match" 
ADD COLUMN IF NOT EXISTS "tieRefundProposalTransactionIndex" VARCHAR;

-- Create index for faster lookups during sync operations
CREATE INDEX IF NOT EXISTS "IDX_match_payout_proposal_transaction_index" 
ON "match" ("payoutProposalTransactionIndex");

CREATE INDEX IF NOT EXISTS "IDX_match_tie_refund_proposal_transaction_index" 
ON "match" ("tieRefundProposalTransactionIndex");

-- Add comment explaining the columns
COMMENT ON COLUMN "match"."payoutProposalTransactionIndex" IS 'Transaction index used to derive proposal PDA. Ensures proposal ID always matches transaction index.';
COMMENT ON COLUMN "match"."tieRefundProposalTransactionIndex" IS 'Transaction index used to derive refund proposal PDA. Ensures proposal ID always matches transaction index.';

