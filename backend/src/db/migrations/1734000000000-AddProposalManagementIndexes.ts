import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProposalManagementIndexes1734000000000 implements MigrationInterface {
  name = 'AddProposalManagementIndexes1734000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Composite index for matchId + transactionIndex uniqueness checking
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_proposal_transaction" 
      ON "match" ("id", "payoutProposalTransactionIndex")
      WHERE "payoutProposalTransactionIndex" IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_tie_refund_transaction" 
      ON "match" ("id", "tieRefundProposalTransactionIndex")
      WHERE "tieRefundProposalTransactionIndex" IS NOT NULL
    `);

    // Index for proposal attempt count tracking
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_proposal_attempt_count" 
      ON "match" ("proposalAttemptCount")
      WHERE "proposalAttemptCount" > 0
    `);

    // Index for proposal status queries
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_proposal_status" 
      ON "match" ("proposalStatus")
      WHERE "proposalStatus" IS NOT NULL
    `);

    // Composite index for vault + transaction index lookups
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_match_vault_transaction" 
      ON "match" ("squadsVaultAddress", "payoutProposalTransactionIndex")
      WHERE "squadsVaultAddress" IS NOT NULL AND "payoutProposalTransactionIndex" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_proposal_transaction"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_tie_refund_transaction"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_proposal_attempt_count"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_proposal_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_vault_transaction"`);
  }
}

