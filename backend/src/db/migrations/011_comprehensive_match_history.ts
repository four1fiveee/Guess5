import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class ComprehensiveMatchHistory1700000000011 implements MigrationInterface {
  name = 'ComprehensiveMatchHistory1700000000011';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add tie refund proposal ID
    await queryRunner.addColumn('match', new TableColumn({
      name: 'tieRefundProposalId',
      type: 'varchar',
      isNullable: true,
      comment: 'Squads Protocol proposal ID for tie refund transactions'
    }));

    // Payment signature fields
    await queryRunner.addColumn('match', new TableColumn({
      name: 'player1PaymentSignature',
      type: 'varchar',
      isNullable: true,
      comment: 'Transaction signature for player 1 deposit payment'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'player2PaymentSignature',
      type: 'varchar',
      isNullable: true,
      comment: 'Transaction signature for player 2 deposit payment'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'winnerPayoutSignature',
      type: 'varchar',
      isNullable: true,
      comment: 'Transaction signature for winner payout'
    }));

    // Payment timestamp fields
    await queryRunner.addColumn('match', new TableColumn({
      name: 'player1PaymentTime',
      type: 'timestamp',
      isNullable: true,
      comment: 'Timestamp when player 1 made payment'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'player2PaymentTime',
      type: 'timestamp',
      isNullable: true,
      comment: 'Timestamp when player 2 made payment'
    }));

    // Payment block time fields
    await queryRunner.addColumn('match', new TableColumn({
      name: 'player1PaymentBlockTime',
      type: 'timestamp',
      isNullable: true,
      comment: 'Block time of player 1 payment transaction'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'player2PaymentBlockTime',
      type: 'timestamp',
      isNullable: true,
      comment: 'Block time of player 2 payment transaction'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'winnerPayoutBlockTime',
      type: 'timestamp',
      isNullable: true,
      comment: 'Block time of winner payout transaction'
    }));

    // Payment block number fields
    await queryRunner.addColumn('match', new TableColumn({
      name: 'player1PaymentBlockNumber',
      type: 'bigint',
      isNullable: true,
      comment: 'Block number/slot of player 1 payment transaction'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'player2PaymentBlockNumber',
      type: 'bigint',
      isNullable: true,
      comment: 'Block number/slot of player 2 payment transaction'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'winnerPayoutBlockNumber',
      type: 'bigint',
      isNullable: true,
      comment: 'Block number/slot of winner payout transaction'
    }));

    // Financial amount fields
    await queryRunner.addColumn('match', new TableColumn({
      name: 'payoutAmount',
      type: 'decimal',
      precision: 10,
      scale: 6,
      isNullable: true,
      comment: 'Actual payout amount in SOL'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'payoutAmountUSD',
      type: 'decimal',
      precision: 10,
      scale: 2,
      isNullable: true,
      comment: 'Payout amount in USD at time of payout'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'entryFeeUSD',
      type: 'decimal',
      precision: 10,
      scale: 2,
      isNullable: true,
      comment: 'Entry fee in USD at time of match creation'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'solPriceAtTransaction',
      type: 'decimal',
      precision: 10,
      scale: 2,
      isNullable: true,
      comment: 'SOL price in USD at transaction time'
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove all added columns
    await queryRunner.dropColumn('match', 'solPriceAtTransaction');
    await queryRunner.dropColumn('match', 'entryFeeUSD');
    await queryRunner.dropColumn('match', 'payoutAmountUSD');
    await queryRunner.dropColumn('match', 'payoutAmount');
    await queryRunner.dropColumn('match', 'winnerPayoutBlockNumber');
    await queryRunner.dropColumn('match', 'player2PaymentBlockNumber');
    await queryRunner.dropColumn('match', 'player1PaymentBlockNumber');
    await queryRunner.dropColumn('match', 'winnerPayoutBlockTime');
    await queryRunner.dropColumn('match', 'player2PaymentBlockTime');
    await queryRunner.dropColumn('match', 'player1PaymentBlockTime');
    await queryRunner.dropColumn('match', 'player2PaymentTime');
    await queryRunner.dropColumn('match', 'player1PaymentTime');
    await queryRunner.dropColumn('match', 'winnerPayoutSignature');
    await queryRunner.dropColumn('match', 'player2PaymentSignature');
    await queryRunner.dropColumn('match', 'player1PaymentSignature');
    await queryRunner.dropColumn('match', 'tieRefundProposalId');
  }
}

