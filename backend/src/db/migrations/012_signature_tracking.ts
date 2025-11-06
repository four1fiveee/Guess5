import { MigrationInterface, QueryRunner, TableIndex } from 'typeorm';

export class SignatureTracking012 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add unique index on payment signatures to prevent duplicate use
    // Only index non-null values to allow multiple nulls
    
    // For player1PaymentSignature - unique constraint when not null
    const hasPlayer1Index = await this.indexExists(queryRunner, 'match', 'IDX_match_player1_payment_signature_unique');
    if (!hasPlayer1Index) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_match_player1_payment_signature_unique" 
        ON "match" ("player1PaymentSignature") 
        WHERE "player1PaymentSignature" IS NOT NULL
      `);
      console.log('✅ Created unique index on player1PaymentSignature');
    }

    // For player2PaymentSignature - unique constraint when not null
    const hasPlayer2Index = await this.indexExists(queryRunner, 'match', 'IDX_match_player2_payment_signature_unique');
    if (!hasPlayer2Index) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_match_player2_payment_signature_unique" 
        ON "match" ("player2PaymentSignature") 
        WHERE "player2PaymentSignature" IS NOT NULL
      `);
      console.log('✅ Created unique index on player2PaymentSignature');
    }

    // For winnerPayoutSignature - unique constraint when not null
    const hasWinnerIndex = await this.indexExists(queryRunner, 'match', 'IDX_match_winner_payout_signature_unique');
    if (!hasWinnerIndex) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_match_winner_payout_signature_unique" 
        ON "match" ("winnerPayoutSignature") 
        WHERE "winnerPayoutSignature" IS NOT NULL
      `);
      console.log('✅ Created unique index on winnerPayoutSignature');
    }

    // For proposalTransactionId - unique constraint when not null (prevents duplicate execution signatures)
    const hasProposalTxIndex = await this.indexExists(queryRunner, 'match', 'IDX_match_proposal_transaction_id_unique');
    if (!hasProposalTxIndex) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "IDX_match_proposal_transaction_id_unique" 
        ON "match" ("proposalTransactionId") 
        WHERE "proposalTransactionId" IS NOT NULL 
        AND "proposalTransactionId" != '' 
        AND LENGTH("proposalTransactionId") > 40
      `);
      console.log('✅ Created unique index on proposalTransactionId');
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove unique indexes
    const hasPlayer1Index = await this.indexExists(queryRunner, 'match', 'IDX_match_player1_payment_signature_unique');
    if (hasPlayer1Index) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_player1_payment_signature_unique"`);
    }

    const hasPlayer2Index = await this.indexExists(queryRunner, 'match', 'IDX_match_player2_payment_signature_unique');
    if (hasPlayer2Index) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_player2_payment_signature_unique"`);
    }

    const hasWinnerIndex = await this.indexExists(queryRunner, 'match', 'IDX_match_winner_payout_signature_unique');
    if (hasWinnerIndex) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_winner_payout_signature_unique"`);
    }

    const hasProposalTxIndex = await this.indexExists(queryRunner, 'match', 'IDX_match_proposal_transaction_id_unique');
    if (hasProposalTxIndex) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_match_proposal_transaction_id_unique"`);
    }

    console.log('✅ Removed signature tracking indexes');
  }

  private async indexExists(queryRunner: QueryRunner, tableName: string, indexName: string): Promise<boolean> {
    try {
      const result = await queryRunner.query(`
        SELECT EXISTS (
          SELECT 1 
          FROM pg_indexes 
          WHERE tablename = $1 
          AND indexname = $2
        )
      `, [tableName, indexName]);
      return result[0]?.exists || false;
    } catch (error) {
      console.warn(`⚠️ Error checking if index exists: ${indexName}`, error);
      return false;
    }
  }
}

