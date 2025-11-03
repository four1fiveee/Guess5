import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEscrowAndTiming0041753845618940 implements MigrationInterface {
    name = 'AddEscrowAndTiming0041753845618940'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add escrow address column
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "escrowAddress" character varying
        `);

        // Add game start time column
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "gameStartTime" TIMESTAMP
        `);

        // Update payout result type to include payment fields
        await queryRunner.query(`
            COMMENT ON COLUMN "match"."payoutResult" IS 'Updated to include paymentSuccess, paymentError, and transaction fields'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove escrow address column
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "escrowAddress"
        `);

        // Remove game start time column
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "gameStartTime"
        `);
    }
} 