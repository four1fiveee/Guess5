/**
 * Manual script to run migration 017
 * Run this if the migration didn't run automatically
 * Usage: ts-node src/db/runMigration017.ts
 */

import { AppDataSource } from './index';

async function runMigration017() {
  try {
    console.log('🔌 Connecting to database...');
    await AppDataSource.initialize();
    console.log('✅ Database connected');

    const queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      console.log('🔍 Checking if column exists...');
      const columnCheck = await queryRunner.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'user' 
          AND column_name = 'exemptFromReferralMinimum'
        );
      `);

      if (columnCheck[0]?.exists) {
        console.log('✅ Column already exists');
      } else {
        console.log('➕ Adding exemptFromReferralMinimum column...');
        await queryRunner.query(`
          ALTER TABLE "user" 
          ADD COLUMN "exemptFromReferralMinimum" boolean DEFAULT false NOT NULL;
        `);

        console.log('➕ Creating index...');
        await queryRunner.query(`
          CREATE INDEX IF NOT EXISTS "IDX_user_exemptFromReferralMinimum" 
          ON "user" ("exemptFromReferralMinimum") 
          WHERE "exemptFromReferralMinimum" = true;
        `);

        console.log('✅ Column and index created');
      }

      // Mark migration as run
      console.log('📝 Recording migration in migrations table...');
      await queryRunner.query(`
        INSERT INTO migrations (name, timestamp) 
        VALUES ('AddReferralExemption1700000000017', 1700000000017)
        ON CONFLICT (name) DO NOTHING;
      `);

      await queryRunner.commitTransaction();
      console.log('✅ Migration 017 completed successfully');
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

runMigration017();

