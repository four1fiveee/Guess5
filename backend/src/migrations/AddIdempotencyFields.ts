import { MigrationInterface, QueryRunner } from "typeorm";

export class AddIdempotencyFields1703123456789 implements MigrationInterface {
    name = 'AddIdempotencyFields1703123456789'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add idempotency fields to match table
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "idempotencyKey" VARCHAR,
            ADD COLUMN "paymentAttempts" INTEGER DEFAULT 0,
            ADD COLUMN "lastPaymentAttempt" TIMESTAMP,
            ADD COLUMN "paymentVerificationSignature" VARCHAR
        `);
        
        // Add indexes for better performance
        await queryRunner.query(`
            CREATE INDEX "IDX_match_idempotency_key" ON "match" ("idempotencyKey")
        `);
        
        await queryRunner.query(`
            CREATE INDEX "IDX_match_payment_attempts" ON "match" ("paymentAttempts")
        `);
        
        console.log('✅ Migration: Added idempotency fields to match table');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove indexes
        await queryRunner.query(`DROP INDEX "IDX_match_payment_attempts"`);
        await queryRunner.query(`DROP INDEX "IDX_match_idempotency_key"`);
        
        // Remove columns
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "paymentVerificationSignature",
            DROP COLUMN "lastPaymentAttempt",
            DROP COLUMN "paymentAttempts",
            DROP COLUMN "idempotencyKey"
        `);
        
        console.log('✅ Migration: Removed idempotency fields from match table');
    }
}
