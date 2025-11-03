-- Add Smart Contract Fields to Match Table
-- Run this SQL directly on your Render database

-- Add smart contract fields (safe to run multiple times)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'matchPda') THEN
        ALTER TABLE "match" ADD COLUMN "matchPda" VARCHAR;
        RAISE NOTICE 'Added matchPda column';
    ELSE
        RAISE NOTICE 'matchPda column already exists';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'vaultPda') THEN
        ALTER TABLE "match" ADD COLUMN "vaultPda" VARCHAR;
        RAISE NOTICE 'Added vaultPda column';
    ELSE
        RAISE NOTICE 'vaultPda column already exists';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'resultsAttestor') THEN
        ALTER TABLE "match" ADD COLUMN "resultsAttestor" VARCHAR;
        RAISE NOTICE 'Added resultsAttestor column';
    ELSE
        RAISE NOTICE 'resultsAttestor column already exists';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'matchId') THEN
        ALTER TABLE "match" ADD COLUMN "matchId" VARCHAR;
        RAISE NOTICE 'Added matchId column';
    ELSE
        RAISE NOTICE 'matchId column already exists';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'feeBps') THEN
        ALTER TABLE "match" ADD COLUMN "feeBps" INTEGER;
        RAISE NOTICE 'Added feeBps column';
    ELSE
        RAISE NOTICE 'feeBps column already exists';
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'match' AND column_name = 'smartContractStatus') THEN
        ALTER TABLE "match" ADD COLUMN "smartContractStatus" VARCHAR;
        RAISE NOTICE 'Added smartContractStatus column';
    ELSE
        RAISE NOTICE 'smartContractStatus column already exists';
    END IF;
END $$;

-- Verify the columns were added
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'match' 
AND column_name IN ('matchPda', 'vaultPda', 'resultsAttestor', 'matchId', 'feeBps', 'smartContractStatus')
ORDER BY column_name;
