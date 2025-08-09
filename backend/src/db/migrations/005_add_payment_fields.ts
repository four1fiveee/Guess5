import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPaymentFields0051753845618940 implements MigrationInterface {
    name = 'AddPaymentFields0051753845618940'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add payment confirmation fields
        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "player1Paid" boolean DEFAULT false
        `);

        await queryRunner.query(`
            ALTER TABLE "match" 
            ADD COLUMN "player2Paid" boolean DEFAULT false
        `);

        console.log('✅ Added payment confirmation fields to match table');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Remove payment confirmation fields
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "player1Paid"
        `);

        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "player2Paid"
        `);

        console.log('✅ Removed payment confirmation fields from match table');
    }
}
