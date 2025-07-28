import { MigrationInterface, QueryRunner } from "typeorm";

export class UpdateEntryFeeType1700000000002 implements MigrationInterface {
    name = 'UpdateEntryFeeType1700000000002'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Change entryFee column from integer to decimal
        await queryRunner.query(`ALTER TABLE "match" ALTER COLUMN "entryFee" TYPE DECIMAL(10,6)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Revert back to integer (this might lose precision)
        await queryRunner.query(`ALTER TABLE "match" ALTER COLUMN "entryFee" TYPE INTEGER`);
    }
} 