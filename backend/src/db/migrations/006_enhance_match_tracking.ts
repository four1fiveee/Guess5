import { MigrationInterface, QueryRunner } from "typeorm";

export class EnhanceMatchTracking1700000000000 implements MigrationInterface {
    name = 'EnhanceMatchTracking1700000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add blockchain transaction tracking columns with IF NOT EXISTS
        const columns = [
            'player1PaymentSignature VARCHAR',
            'player2PaymentSignature VARCHAR',
            'winnerPayoutSignature VARCHAR',
            'player1RefundSignature VARCHAR',
            'player2RefundSignature VARCHAR',
            'matchOutcome VARCHAR',
            'gameEndTime TIMESTAMP',
            'matchDuration INTEGER',
            'totalFeesCollected DECIMAL(10,6) DEFAULT 0',
            'platformFee DECIMAL(10,6) DEFAULT 0',
            'refundReason VARCHAR',
            'refundedAt TIMESTAMP',
            'player1Moves INTEGER',
            'player2Moves INTEGER',
            'player1CompletionTime INTEGER',
            'player2CompletionTime INTEGER',
            'targetWord VARCHAR',
            'player1Guesses JSONB',
            'player2Guesses JSONB',
            'player1PaymentTime TIMESTAMP',
            'player2PaymentTime TIMESTAMP',
            'player1LastGuessTime TIMESTAMP',
            'player2LastGuessTime TIMESTAMP',
            'refundAmount DECIMAL(10,6)',
            'payoutAmount DECIMAL(10,6)',
            'disputeFlagged BOOLEAN DEFAULT FALSE',
            'disputeNotes TEXT',
            'resolvedBy VARCHAR',
            'resolutionTime TIMESTAMP',
            'totalRevenue DECIMAL(10,6) DEFAULT 0',
            'totalPayouts DECIMAL(10,6) DEFAULT 0',
            'totalRefunds DECIMAL(10,6) DEFAULT 0',
            'netRevenue DECIMAL(10,6) DEFAULT 0',
            'platformRevenue DECIMAL(10,6) DEFAULT 0',
            'networkFees DECIMAL(10,6) DEFAULT 0',
            'taxableIncome DECIMAL(10,6) DEFAULT 0',
            'fiscalYear INTEGER',
            'quarter INTEGER',
            'entryFeeUSD DECIMAL(10,2)',
            'refundAmountUSD DECIMAL(10,2)',
            'payoutAmountUSD DECIMAL(10,2)',
            'platformFeeUSD DECIMAL(10,2)',
            'totalFeesCollectedUSD DECIMAL(10,2)',
            'solPriceAtTransaction DECIMAL(10,2)',
            'transactionTimestamp TIMESTAMP'
        ];

        // Add each column individually with IF NOT EXISTS
        for (const column of columns) {
            try {
                await queryRunner.query(`ALTER TABLE "match" ADD COLUMN IF NOT EXISTS ${column}`);
            } catch (error) {
                console.log(`⚠️ Column might already exist: ${column}`);
            }
        }

        // Note: payoutResult is stored as TEXT (simple-json), not JSONB, so we skip JSON operations
        console.log('✅ Migration completed - skipped JSON operations on payoutResult (stored as TEXT)');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "match" 
            DROP COLUMN "player1PaymentSignature",
            DROP COLUMN "player2PaymentSignature", 
            DROP COLUMN "winnerPayoutSignature",
            DROP COLUMN "player1RefundSignature",
            DROP COLUMN "player2RefundSignature",
            DROP COLUMN "matchOutcome",
            DROP COLUMN "gameEndTime",
            DROP COLUMN "matchDuration",
            DROP COLUMN "totalFeesCollected",
            DROP COLUMN "platformFee",
            DROP COLUMN "refundReason",
            DROP COLUMN "refundedAt",
            DROP COLUMN "player1Moves",
            DROP COLUMN "player2Moves",
            DROP COLUMN "player1CompletionTime",
            DROP COLUMN "player2CompletionTime",
            DROP COLUMN "targetWord",
            DROP COLUMN "player1Guesses",
            DROP COLUMN "player2Guesses",
            DROP COLUMN "player1PaymentTime",
            DROP COLUMN "player2PaymentTime",
            DROP COLUMN "player1LastGuessTime",
            DROP COLUMN "player2LastGuessTime",
            DROP COLUMN "refundAmount",
            DROP COLUMN "payoutAmount",
            DROP COLUMN "disputeFlagged",
            DROP COLUMN "disputeNotes",
            DROP COLUMN "resolvedBy",
            DROP COLUMN "resolutionTime",
            DROP COLUMN "totalRevenue",
            DROP COLUMN "totalPayouts",
            DROP COLUMN "totalRefunds",
            DROP COLUMN "netRevenue",
            DROP COLUMN "platformRevenue",
            DROP COLUMN "networkFees",
            DROP COLUMN "taxableIncome",
            DROP COLUMN "fiscalYear",
            DROP COLUMN "quarter",
            DROP COLUMN "entryFeeUSD",
            DROP COLUMN "refundAmountUSD",
            DROP COLUMN "payoutAmountUSD",
            DROP COLUMN "platformFeeUSD",
            DROP COLUMN "totalFeesCollectedUSD",
            DROP COLUMN "solPriceAtTransaction",
            DROP COLUMN "transactionTimestamp"
        `);
    }
}
