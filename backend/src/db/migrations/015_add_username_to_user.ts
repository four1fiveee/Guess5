import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUsernameToUser015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add username column to user table
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'username',
        type: 'text',
        isUnique: true,
        isNullable: true,
      })
    );

    // Create index for faster username lookups
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_username" ON "user" ("username") WHERE "username" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove index
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_username";`);
    
    // Remove username column
    await queryRunner.dropColumn('user', 'username');
  }
}

