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
            ADD COLUMN "player2CompletionTime" INTEGER
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
            DROP COLUMN "player2CompletionTime"
        `);
    }
}
