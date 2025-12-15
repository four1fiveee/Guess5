import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddEscrowFields018 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add escrow fields
    await queryRunner.addColumn(
      'match',
      new TableColumn({
        name: 'escrowAddress',
        type: 'varchar',
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      'match',
      new TableColumn({
        name: 'escrowStatus',
        type: 'varchar',
        isNullable: true,
        default: "'PENDING'",
      })
    );

    await queryRunner.addColumn(
      'match',
      new TableColumn({
        name: 'escrowResultSubmittedAt',
        type: 'timestamp',
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      'match',
      new TableColumn({
        name: 'escrowResultSubmittedBy',
        type: 'varchar',
        isNullable: true,
      })
    );

    await queryRunner.addColumn(
      'match',
      new TableColumn({
        name: 'escrowBackendSignature',
        type: 'text',
        isNullable: true,
      })
    );

    // Create index on escrowAddress for faster lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_escrowAddress" ON "match" ("escrowAddress")
    `);

    // Create index on escrowStatus for filtering
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_escrowStatus" ON "match" ("escrowStatus")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop indexes
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_match_escrowStatus"
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_match_escrowAddress"
    `);

    // Drop columns
    await queryRunner.dropColumn('match', 'escrowBackendSignature');
    await queryRunner.dropColumn('match', 'escrowResultSubmittedBy');
    await queryRunner.dropColumn('match', 'escrowResultSubmittedAt');
    await queryRunner.dropColumn('match', 'escrowStatus');
    await queryRunner.dropColumn('match', 'escrowAddress');
  }
}

