import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMultisigVaultFields1700000000008 implements MigrationInterface {
    name = 'AddMultisigVaultFields1700000000008'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add multisig vault fields to Match table
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "vault_address" VARCHAR,
            ADD COLUMN "deposit_a_tx" VARCHAR,
            ADD COLUMN "deposit_b_tx" VARCHAR,
            ADD COLUMN "deposit_a_confirmations" INTEGER DEFAULT 0,
            ADD COLUMN "deposit_b_confirmations" INTEGER DEFAULT 0,
            ADD COLUMN "match_status" VARCHAR DEFAULT 'PENDING',
            ADD COLUMN "attestation_hash" VARCHAR,
            ADD COLUMN "payout_tx_hash" VARCHAR,
            ADD COLUMN "refund_tx_hash" VARCHAR
        `);

        // Create match_attestations table
        await queryRunner.query(`
            CREATE TABLE "match_attestations" (
                "id" BIGSERIAL PRIMARY KEY,
                "match_id" UUID NOT NULL,
                "attestation_json" JSONB NOT NULL,
                "attestation_hash" VARCHAR NOT NULL UNIQUE,
                "signed_by_kms" BOOLEAN DEFAULT FALSE,
                "kms_signature" VARCHAR,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
                FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE CASCADE
            )
        `);

        // Create match_audit_logs table
        await queryRunner.query(`
            CREATE TABLE "match_audit_logs" (
                "id" BIGSERIAL PRIMARY KEY,
                "match_id" UUID,
                "event_type" VARCHAR NOT NULL,
                "event_data" JSONB,
                "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now(),
                FOREIGN KEY ("match_id") REFERENCES "match"("id") ON DELETE CASCADE
            )
        `);

        // Add indexes for better performance
        await queryRunner.query(`
            CREATE INDEX "IDX_match_vault_address" ON "match" ("vault_address")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_match_attestations_hash" ON "match_attestations" ("attestation_hash")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_match_attestations_match_id" ON "match_attestations" ("match_id")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_match_audit_logs_match_id" ON "match_audit_logs" ("match_id")
        `);

        await queryRunner.query(`
            CREATE INDEX "IDX_match_audit_logs_event_type" ON "match_audit_logs" ("event_type")
        `);

        console.log('✅ Migration completed: Added multisig vault fields and tables');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove indexes
        await queryRunner.query(`DROP INDEX "IDX_match_audit_logs_event_type"`);
        await queryRunner.query(`DROP INDEX "IDX_match_audit_logs_match_id"`);
        await queryRunner.query(`DROP INDEX "IDX_match_attestations_match_id"`);
        await queryRunner.query(`DROP INDEX "IDX_match_attestations_hash"`);
        await queryRunner.query(`DROP INDEX "IDX_match_vault_address"`);

        // Drop tables
        await queryRunner.query(`DROP TABLE "match_audit_logs"`);
        await queryRunner.query(`DROP TABLE "match_attestations"`);

        // Remove columns from match table
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "refund_tx_hash",
            DROP COLUMN "payout_tx_hash",
            DROP COLUMN "attestation_hash",
            DROP COLUMN "match_status",
            DROP COLUMN "deposit_b_confirmations",
            DROP COLUMN "deposit_a_confirmations",
            DROP COLUMN "deposit_b_tx",
            DROP COLUMN "deposit_a_tx",
            DROP COLUMN "vault_address"
        `);

        console.log('✅ Migration reverted: Removed multisig vault fields and tables');
    }
}

