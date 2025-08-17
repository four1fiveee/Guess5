import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMissingColumns1700000000001 implements MigrationInterface {
    name = 'AddMissingColumns1700000000001'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add missing columns that weren't in the previous migration
        const missingColumns = [
            'actualNetworkFees DECIMAL(10,6) DEFAULT 0',
            'actualNetworkFeesUSD DECIMAL(10,2) DEFAULT 0',
            'player1PaymentBlockTime TIMESTAMP',
            'player2PaymentBlockTime TIMESTAMP',
            'winnerPayoutBlockTime TIMESTAMP',
            'player1RefundBlockTime TIMESTAMP',
            'player2RefundBlockTime TIMESTAMP',
            'player1PaymentBlockNumber INTEGER',
            'player2PaymentBlockNumber INTEGER',
            'winnerPayoutBlockNumber INTEGER',
            'player1RefundBlockNumber INTEGER',
            'player2RefundBlockNumber INTEGER',
            'player1PaymentConfirmed BOOLEAN DEFAULT FALSE',
            'player2PaymentConfirmed BOOLEAN DEFAULT FALSE',
            'winnerPayoutConfirmed BOOLEAN DEFAULT FALSE',
            'player1RefundConfirmed BOOLEAN DEFAULT FALSE',
            'player2RefundConfirmed BOOLEAN DEFAULT FALSE',
            'player1PaymentFee DECIMAL(10,6) DEFAULT 0',
            'player2PaymentFee DECIMAL(10,6) DEFAULT 0',
            'winnerPayoutFee DECIMAL(10,6) DEFAULT 0',
            'player1RefundFee DECIMAL(10,6) DEFAULT 0',
            'player2RefundFee DECIMAL(10,6) DEFAULT 0'
        ];

        // Add each column individually with IF NOT EXISTS
        for (const column of missingColumns) {
            try {
                await queryRunner.query(`ALTER TABLE "match" ADD COLUMN IF NOT EXISTS ${column}`);
                console.log(`✅ Added column: ${column}`);
            } catch (error) {
                console.log(`⚠️ Column might already exist: ${column}`);
            }
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const columnsToDrop = [
            'actualNetworkFees',
            'actualNetworkFeesUSD',
            'player1PaymentBlockTime',
            'player2PaymentBlockTime',
            'winnerPayoutBlockTime',
            'player1RefundBlockTime',
            'player2RefundBlockTime',
            'player1PaymentBlockNumber',
            'player2PaymentBlockNumber',
            'winnerPayoutBlockNumber',
            'player1RefundBlockNumber',
            'player2RefundBlockNumber',
            'player1PaymentConfirmed',
            'player2PaymentConfirmed',
            'winnerPayoutConfirmed',
            'player1RefundConfirmed',
            'player2RefundConfirmed',
            'player1PaymentFee',
            'player2PaymentFee',
            'winnerPayoutFee',
            'player1RefundFee',
            'player2RefundFee'
        ];

        for (const column of columnsToDrop) {
            try {
                await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS ${column}`);
            } catch (error) {
                console.log(`⚠️ Could not drop column: ${column}`);
            }
        }
    }
}
