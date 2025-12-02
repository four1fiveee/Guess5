import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveUsernameUniqueAddMatchUsernames1733120200000 implements MigrationInterface {
  name = 'RemoveUsernameUniqueAddMatchUsernames1733120200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Remove unique constraint/index on username (usernames are not unique)
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_user_username"
    `);
    
    // Remove UNIQUE constraint from username column if it exists
    await queryRunner.query(`
      ALTER TABLE "user" 
      DROP CONSTRAINT IF EXISTS "UQ_user_username"
    `);
    
    // Add username fields to match table for historical accuracy
    await queryRunner.query(`
      ALTER TABLE "match" 
      ADD COLUMN IF NOT EXISTS "player1Username" text,
      ADD COLUMN IF NOT EXISTS "player2Username" text
    `);
    
    console.log('✅ Removed username unique constraint and added match username fields');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove match username fields
    await queryRunner.query(`
      ALTER TABLE "match" 
      DROP COLUMN IF EXISTS "player1Username",
      DROP COLUMN IF EXISTS "player2Username"
    `);
    
    // Re-add unique index (not recommended, but for rollback)
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_username" 
      ON "user" ("username") 
      WHERE "username" IS NOT NULL
    `);
  }
}

