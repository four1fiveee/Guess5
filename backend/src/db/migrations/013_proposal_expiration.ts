import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class ProposalExpiration013 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Helper function to safely add column if it doesn't exist
    const addColumnIfNotExists = async (columnName: string, columnDef: TableColumn) => {
      const table = await queryRunner.getTable('match');
      const column = table?.findColumnByName(columnName);
      if (!column) {
        await queryRunner.addColumn('match', columnDef);
        console.log(`✅ Added column: ${columnName}`);
      } else {
        console.log(`⏭️  Column ${columnName} already exists, skipping`);
      }
    };

    // Add proposalExpiresAt column
    await addColumnIfNotExists('proposalExpiresAt', new TableColumn({
      name: 'proposalExpiresAt',
      type: 'timestamp',
      isNullable: true,
      comment: 'Timestamp when the proposal expires (30 minutes after creation)'
    }));

    console.log('✅ Migration 013 completed: Added proposalExpiresAt column');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('match');
    const column = table?.findColumnByName('proposalExpiresAt');
    
    if (column) {
      await queryRunner.dropColumn('match', 'proposalExpiresAt');
      console.log('✅ Removed proposalExpiresAt column');
    }
  }
}

