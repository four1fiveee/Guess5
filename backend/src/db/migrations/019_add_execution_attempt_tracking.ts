import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddExecutionAttemptTracking019 implements MigrationInterface {
  public name = 'AddExecutionAttemptTracking019';
  
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

    // Add executionAttempts column
    await addColumnIfNotExists('executionAttempts', new TableColumn({
      name: 'executionAttempts',
      type: 'integer',
      default: 0,
      isNullable: true,
      comment: 'Number of times execution has been attempted'
    }));

    // Add executionLastAttemptAt column
    await addColumnIfNotExists('executionLastAttemptAt', new TableColumn({
      name: 'executionLastAttemptAt',
      type: 'timestamp',
      isNullable: true,
      comment: 'Timestamp of the last execution attempt'
    }));

    console.log('✅ Migration 019 completed: Added execution attempt tracking columns');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('match');
    
    const executionAttemptsColumn = table?.findColumnByName('executionAttempts');
    if (executionAttemptsColumn) {
      await queryRunner.dropColumn('match', 'executionAttempts');
      console.log('✅ Removed executionAttempts column');
    }

    const executionLastAttemptAtColumn = table?.findColumnByName('executionLastAttemptAt');
    if (executionLastAttemptAtColumn) {
      await queryRunner.dropColumn('match', 'executionLastAttemptAt');
      console.log('✅ Removed executionLastAttemptAt column');
    }
  }
}

