import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class RemoveSquadsFields0191735000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Drop all Squads-related columns from the match table
    const columnsToDrop = [
      'squadsVaultAddress',
      'squadsVaultPda',
      'payoutProposalId',
      'payoutProposalTransactionIndex',
      'proposalAttemptCount',
      'proposalCreatedAt',
      'proposalStatus',
      'proposalSigners',
      'needsSignatures',
      'proposalExecutedAt',
      'proposalExpiresAt',
      'executionAttempts',
      'executionLastAttemptAt',
      'proposalTransactionId',
      'tieRefundProposalId',
      'tieRefundProposalTransactionIndex',
    ];

    for (const columnName of columnsToDrop) {
      try {
        await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS "${columnName}"`);
        console.log(`✅ Dropped column: ${columnName}`);
      } catch (error) {
        console.warn(`⚠️ Could not drop column ${columnName}:`, error);
        // Continue even if column doesn't exist
      }
    }

    // Drop indexes related to proposals if they exist
    try {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_proposalStatus"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_payoutProposalId"`);
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_tieRefundProposalId"`);
      console.log('✅ Dropped proposal-related indexes');
    } catch (error) {
      console.warn('⚠️ Could not drop indexes:', error);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Re-add columns if migration needs to be rolled back
    // Note: This is a destructive migration - data will be lost
    await queryRunner.query(`
      ALTER TABLE "match"
      ADD COLUMN IF NOT EXISTS "squadsVaultAddress" VARCHAR,
      ADD COLUMN IF NOT EXISTS "squadsVaultPda" VARCHAR,
      ADD COLUMN IF NOT EXISTS "payoutProposalId" VARCHAR,
      ADD COLUMN IF NOT EXISTS "payoutProposalTransactionIndex" VARCHAR,
      ADD COLUMN IF NOT EXISTS "proposalAttemptCount" INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "proposalCreatedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "proposalStatus" VARCHAR DEFAULT 'PENDING',
      ADD COLUMN IF NOT EXISTS "proposalSigners" TEXT,
      ADD COLUMN IF NOT EXISTS "needsSignatures" INTEGER DEFAULT 2,
      ADD COLUMN IF NOT EXISTS "proposalExecutedAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "proposalExpiresAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "executionAttempts" INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "executionLastAttemptAt" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "proposalTransactionId" VARCHAR,
      ADD COLUMN IF NOT EXISTS "tieRefundProposalId" VARCHAR,
      ADD COLUMN IF NOT EXISTS "tieRefundProposalTransactionIndex" VARCHAR
    `);
  }
}

