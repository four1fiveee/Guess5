import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddProposalAttemptCount1734000000001 implements MigrationInterface {
  name = 'AddProposalAttemptCount1734000000001';

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

    // Add proposalAttemptCount column
    await addColumnIfNotExists('proposalAttemptCount', new TableColumn({
      name: 'proposalAttemptCount',
      type: 'integer',
      default: 0,
      isNullable: true,
      comment: 'Number of proposal creation attempts (for versioning/debugging)'
    }));

    console.log('✅ Migration completed: Added proposalAttemptCount column');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('match');
    
    const proposalAttemptCountColumn = table?.findColumnByName('proposalAttemptCount');
    if (proposalAttemptCountColumn) {
      await queryRunner.dropColumn('match', 'proposalAttemptCount');
      console.log('✅ Removed proposalAttemptCount column');
    }
  }
}

