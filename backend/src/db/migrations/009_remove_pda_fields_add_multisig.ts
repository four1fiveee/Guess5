import { MigrationInterface, QueryRunner } from "typeorm";

export class RemovePdaFieldsAddMultisig1700000000009 implements MigrationInterface {
    name = 'RemovePdaFieldsAddMultisig1700000000009'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Remove old PDA and smart contract fields
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN IF EXISTS "matchPda",
            DROP COLUMN IF EXISTS "vaultPda",
            DROP COLUMN IF EXISTS "resultsAttestor",
            DROP COLUMN IF EXISTS "deadlineSlot",
            DROP COLUMN IF EXISTS "feeBps",
            DROP COLUMN IF EXISTS "smartContractStatus",
            DROP COLUMN IF EXISTS "feeWalletAddress",
            DROP COLUMN IF EXISTS "player1EntryConfirmed",
            DROP COLUMN IF EXISTS "player2EntryConfirmed",
            DROP COLUMN IF EXISTS "player1EntrySignature",
            DROP COLUMN IF EXISTS "player2EntrySignature",
            DROP COLUMN IF EXISTS "player1EntrySlot",
            DROP COLUMN IF EXISTS "player1EntryBlockTime",
            DROP COLUMN IF EXISTS "player1EntryFinalized",
            DROP COLUMN IF EXISTS "player2EntrySlot",
            DROP COLUMN IF EXISTS "player2EntryBlockTime",
            DROP COLUMN IF EXISTS "player2EntryFinalized",
            DROP COLUMN IF EXISTS "player1PaymentSignature",
            DROP COLUMN IF EXISTS "player2PaymentSignature",
            DROP COLUMN IF EXISTS "winnerPayoutSignature",
            DROP COLUMN IF EXISTS "winnerPayoutSlot",
            DROP COLUMN IF EXISTS "winnerPayoutBlockTime",
            DROP COLUMN IF EXISTS "winnerPayoutFinalized",
            DROP COLUMN IF EXISTS "player1RefundSignature",
            DROP COLUMN IF EXISTS "player1RefundSlot",
            DROP COLUMN IF EXISTS "player1RefundBlockTime",
            DROP COLUMN IF EXISTS "player1RefundFinalized",
            DROP COLUMN IF EXISTS "player2RefundSignature",
            DROP COLUMN IF EXISTS "player2RefundSlot",
            DROP COLUMN IF EXISTS "player2RefundBlockTime",
            DROP COLUMN IF EXISTS "player2RefundFinalized"
        `);

        // Add new multisig fields (if not already added by previous migration)
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN IF NOT EXISTS "vaultAddress" VARCHAR,
            ADD COLUMN IF NOT EXISTS "depositATx" VARCHAR,
            ADD COLUMN IF NOT EXISTS "depositBTx" VARCHAR,
            ADD COLUMN IF NOT EXISTS "depositAConfirmations" INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS "depositBConfirmations" INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS "matchStatus" VARCHAR DEFAULT 'PENDING',
            ADD COLUMN IF NOT EXISTS "attestationHash" VARCHAR,
            ADD COLUMN IF NOT EXISTS "payoutTxHash" VARCHAR,
            ADD COLUMN IF NOT EXISTS "refundTxHash" VARCHAR
        `);

        console.log('✅ Migration completed: Removed PDA fields and added multisig fields');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove multisig fields
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN IF EXISTS "vaultAddress",
            DROP COLUMN IF EXISTS "depositATx",
            DROP COLUMN IF EXISTS "depositBTx",
            DROP COLUMN IF EXISTS "depositAConfirmations",
            DROP COLUMN IF EXISTS "depositBConfirmations",
            DROP COLUMN IF EXISTS "matchStatus",
            DROP COLUMN IF EXISTS "attestationHash",
            DROP COLUMN IF EXISTS "payoutTxHash",
            DROP COLUMN IF EXISTS "refundTxHash"
        `);

        // Re-add old PDA fields (for rollback)
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN IF NOT EXISTS "matchPda" VARCHAR,
            ADD COLUMN IF NOT EXISTS "vaultPda" VARCHAR,
            ADD COLUMN IF NOT EXISTS "resultsAttestor" VARCHAR,
            ADD COLUMN IF NOT EXISTS "deadlineSlot" BIGINT,
            ADD COLUMN IF NOT EXISTS "feeBps" INTEGER,
            ADD COLUMN IF NOT EXISTS "smartContractStatus" VARCHAR
        `);

        console.log('✅ Migration reverted: Restored PDA fields and removed multisig fields');
    }
}

