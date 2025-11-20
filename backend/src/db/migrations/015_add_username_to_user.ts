import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUsernameToUser1700000000015 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Ensure user table exists first (in case migration 014 hasn't run)
    const tableExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'user'
      );
    `);

    if (!tableExists[0]?.exists) {
      console.log('⚠️ User table does not exist, creating it with username column...');
      // Create user table if it doesn't exist (from migration 014) - include username column
      await queryRunner.query(`
        CREATE TABLE "user" (
          "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          "walletAddress" text UNIQUE NOT NULL,
          "username" text UNIQUE,
          "totalEntryFees" numeric(12,2) DEFAULT 0 NOT NULL,
          "totalEntryFeesSOL" numeric(12,6) DEFAULT 0 NOT NULL,
          "createdAt" timestamp DEFAULT now() NOT NULL,
          "updatedAt" timestamp DEFAULT now() NOT NULL
        )
      `);

      await queryRunner.query(`
        CREATE INDEX IF NOT EXISTS "IDX_user_walletAddress" ON "user" ("walletAddress")
      `);
      
      await queryRunner.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_username" ON "user" ("username") WHERE "username" IS NOT NULL
      `);
      
      console.log('✅ User table created with username column');
      return; // Table created with username, no need to add column
    }

    // Check if username column already exists
    const columnExists = await queryRunner.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'user' 
        AND column_name = 'username'
      );
    `);

    if (!columnExists[0]?.exists) {
      console.log('⚠️ Username column does not exist, adding it...');
      // Add username column to user table (use quoted table name for PostgreSQL)
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
      console.log('✅ Username column added');
    } else {
      console.log('✅ Username column already exists');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove index
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_username";`);
    
    // Remove username column
    await queryRunner.dropColumn('user', 'username');
  }
}

