import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPayoutApprovalFields1700000000016 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add reviewedByAdmin field to track who approved the batch
    const reviewedByColumnExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'payout_batch' 
        AND column_name = 'reviewedByAdmin'
      );
    `);

    if (!reviewedByColumnExists[0]?.exists) {
      await queryRunner.addColumn(
        'payout_batch',
        new TableColumn({
          name: 'reviewedByAdmin',
          type: 'text',
          isNullable: true,
        })
      );
    }

    // Add reviewedAt timestamp
    const reviewedAtColumnExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'payout_batch' 
        AND column_name = 'reviewedAt'
      );
    `);

    if (!reviewedAtColumnExists[0]?.exists) {
      await queryRunner.addColumn(
        'payout_batch',
        new TableColumn({
          name: 'reviewedAt',
          type: 'timestamp',
          isNullable: true,
        })
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn('payout_batch', 'reviewedAt');
    await queryRunner.dropColumn('payout_batch', 'reviewedByAdmin');
  }
}

