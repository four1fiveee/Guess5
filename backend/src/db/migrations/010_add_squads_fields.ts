import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddSquadsFields1700000000010 implements MigrationInterface {
  name = 'AddSquadsFields1700000000010';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add Squads-specific fields to the Match table
    await queryRunner.addColumn('match', new TableColumn({
      name: 'squadsVaultAddress',
      type: 'varchar',
      isNullable: true,
      comment: 'Squads Protocol multisig vault address'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'payoutProposalId',
      type: 'varchar',
      isNullable: true,
      comment: 'Squads Protocol proposal ID for payout transactions'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'proposalCreatedAt',
      type: 'timestamp',
      isNullable: true,
      comment: 'Timestamp when the payout proposal was created'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'proposalStatus',
      type: 'varchar',
      isNullable: true,
      default: "'PENDING'",
      comment: 'Status of the Squads proposal: PENDING, APPROVED, EXECUTED, REJECTED'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'proposalSigners',
      type: 'text',
      isNullable: true,
      comment: 'JSON array of public keys that have signed the proposal'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'needsSignatures',
      type: 'int',
      isNullable: true,
      default: 2,
      comment: 'Number of signatures still needed to execute the proposal'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'proposalExecutedAt',
      type: 'timestamp',
      isNullable: true,
      comment: 'Timestamp when the proposal was executed'
    }));

    await queryRunner.addColumn('match', new TableColumn({
      name: 'proposalTransactionId',
      type: 'varchar',
      isNullable: true,
      comment: 'Transaction ID of the executed proposal'
    }));
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove Squads-specific fields
    await queryRunner.dropColumn('match', 'proposalTransactionId');
    await queryRunner.dropColumn('match', 'proposalExecutedAt');
    await queryRunner.dropColumn('match', 'needsSignatures');
    await queryRunner.dropColumn('match', 'proposalSigners');
    await queryRunner.dropColumn('match', 'proposalStatus');
    await queryRunner.dropColumn('match', 'proposalCreatedAt');
    await queryRunner.dropColumn('match', 'payoutProposalId');
    await queryRunner.dropColumn('match', 'squadsVaultAddress');
  }
}
