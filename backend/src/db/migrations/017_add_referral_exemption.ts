import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddReferralExemption017 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add exemptFromReferralMinimum field to user table
    const exemptColumnExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'user' 
        AND column_name = 'exemptFromReferralMinimum'
      );
    `);

    if (!exemptColumnExists[0]?.exists) {
      await queryRunner.addColumn(
        'user',
        new TableColumn({
          name: 'exemptFromReferralMinimum',
          type: 'boolean',
          default: false,
          isNullable: false,
        })
      );

      // Create index for faster queries
      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_user_exemptFromReferralMinimum" 
        ON "user" ("exemptFromReferralMinimum") 
        WHERE "exemptFromReferralMinimum" = true
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_exemptFromReferralMinimum"`);
    await queryRunner.dropColumn('user', 'exemptFromReferralMinimum');
  }
}

