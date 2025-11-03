import { MigrationInterface, QueryRunner } from "typeorm";

export class AddSmartContractFields1700000000007 implements MigrationInterface {
    name = 'AddSmartContractFields1700000000007'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add smart contract fields to Match table
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "matchPda" varchar,
            ADD COLUMN "vaultPda" varchar,
            ADD COLUMN "resultsAttestor" varchar,
            ADD COLUMN "deadlineSlot" bigint,
            ADD COLUMN "feeBps" integer,
            ADD COLUMN "smartContractStatus" varchar
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove smart contract fields from Match table
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "matchPda",
            DROP COLUMN "vaultPda", 
            DROP COLUMN "resultsAttestor",
            DROP COLUMN "deadlineSlot",
            DROP COLUMN "feeBps",
            DROP COLUMN "smartContractStatus"
        `);
    }
}
