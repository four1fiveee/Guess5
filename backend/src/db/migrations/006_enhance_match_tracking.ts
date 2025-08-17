import { MigrationInterface, QueryRunner } from "typeorm";

export class EnhanceMatchTracking1700000000000 implements MigrationInterface {
    name = 'EnhanceMatchTracking1700000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add blockchain transaction tracking columns
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "player1PaymentSignature" VARCHAR,
            ADD COLUMN "player2PaymentSignature" VARCHAR,
            ADD COLUMN "winnerPayoutSignature" VARCHAR,
            ADD COLUMN "player1RefundSignature" VARCHAR,
            ADD COLUMN "player2RefundSignature" VARCHAR,
            ADD COLUMN "matchOutcome" VARCHAR,
            ADD COLUMN "gameEndTime" TIMESTAMP,
            ADD COLUMN "matchDuration" INTEGER,
            ADD COLUMN "totalFeesCollected" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "platformFee" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "refundReason" VARCHAR,
            ADD COLUMN "refundedAt" TIMESTAMP,
            ADD COLUMN "player1Moves" INTEGER,
            ADD COLUMN "player2Moves" INTEGER,
            ADD COLUMN "player1CompletionTime" INTEGER,
            ADD COLUMN "player2CompletionTime" INTEGER,
            ADD COLUMN "targetWord" VARCHAR,
            ADD COLUMN "player1Guesses" JSONB,
            ADD COLUMN "player2Guesses" JSONB,
            ADD COLUMN "player1PaymentTime" TIMESTAMP,
            ADD COLUMN "player2PaymentTime" TIMESTAMP,
            ADD COLUMN "player1LastGuessTime" TIMESTAMP,
            ADD COLUMN "player2LastGuessTime" TIMESTAMP,
            ADD COLUMN "refundAmount" DECIMAL(10,6),
            ADD COLUMN "payoutAmount" DECIMAL(10,6),
            ADD COLUMN "disputeFlagged" BOOLEAN DEFAULT FALSE,
            ADD COLUMN "disputeNotes" TEXT,
            ADD COLUMN "resolvedBy" VARCHAR,
            ADD COLUMN "resolutionTime" TIMESTAMP,
            ADD COLUMN "totalRevenue" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "totalPayouts" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "totalRefunds" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "netRevenue" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "platformRevenue" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "networkFees" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "taxableIncome" DECIMAL(10,6) DEFAULT 0,
            ADD COLUMN "fiscalYear" INTEGER,
            ADD COLUMN "quarter" INTEGER,
            ADD COLUMN "entryFeeUSD" DECIMAL(10,2),
            ADD COLUMN "refundAmountUSD" DECIMAL(10,2),
            ADD COLUMN "payoutAmountUSD" DECIMAL(10,2),
            ADD COLUMN "platformFeeUSD" DECIMAL(10,2),
            ADD COLUMN "totalFeesCollectedUSD" DECIMAL(10,2),
            ADD COLUMN "solPriceAtTransaction" DECIMAL(10,2),
            ADD COLUMN "transactionTimestamp" TIMESTAMP
        `);

        // Add signature field to payoutResult JSON if it exists
        await queryRunner.query(`
            UPDATE "match" 
            SET "payoutResult" = jsonb_set(
                COALESCE("payoutResult"::jsonb, '{}'::jsonb),
                '{transactions}',
                COALESCE("payoutResult"->'transactions', '[]'::jsonb)
            )
            WHERE "payoutResult" IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "player1PaymentSignature",
            DROP COLUMN "player2PaymentSignature", 
            DROP COLUMN "winnerPayoutSignature",
            DROP COLUMN "player1RefundSignature",
            DROP COLUMN "player2RefundSignature",
            DROP COLUMN "matchOutcome",
            DROP COLUMN "gameEndTime",
            DROP COLUMN "matchDuration",
            DROP COLUMN "totalFeesCollected",
            DROP COLUMN "platformFee",
            DROP COLUMN "refundReason",
            DROP COLUMN "refundedAt",
            DROP COLUMN "player1Moves",
            DROP COLUMN "player2Moves",
            DROP COLUMN "player1CompletionTime",
            DROP COLUMN "player2CompletionTime",
            DROP COLUMN "targetWord",
            DROP COLUMN "player1Guesses",
            DROP COLUMN "player2Guesses",
            DROP COLUMN "player1PaymentTime",
            DROP COLUMN "player2PaymentTime",
            DROP COLUMN "player1LastGuessTime",
            DROP COLUMN "player2LastGuessTime",
            DROP COLUMN "refundAmount",
            DROP COLUMN "payoutAmount",
            DROP COLUMN "disputeFlagged",
            DROP COLUMN "disputeNotes",
            DROP COLUMN "resolvedBy",
            DROP COLUMN "resolutionTime",
            DROP COLUMN "totalRevenue",
            DROP COLUMN "totalPayouts",
            DROP COLUMN "totalRefunds",
            DROP COLUMN "netRevenue",
            DROP COLUMN "platformRevenue",
            DROP COLUMN "networkFees",
            DROP COLUMN "taxableIncome",
            DROP COLUMN "fiscalYear",
            DROP COLUMN "quarter",
            DROP COLUMN "entryFeeUSD",
            DROP COLUMN "refundAmountUSD",
            DROP COLUMN "payoutAmountUSD",
            DROP COLUMN "platformFeeUSD",
            DROP COLUMN "totalFeesCollectedUSD",
            DROP COLUMN "solPriceAtTransaction",
            DROP COLUMN "transactionTimestamp"
        `);
    }
}
