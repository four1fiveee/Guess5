import { MigrationInterface, QueryRunner } from "typeorm";

export class AddEscrowConfirmation0051753845618940 implements MigrationInterface {
    name = 'AddEscrowConfirmation0051753845618940'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "match" ADD COLUMN "player1EscrowConfirmed" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "match" ADD COLUMN "player2EscrowConfirmed" boolean DEFAULT false`);
        await queryRunner.query(`ALTER TABLE "match" ADD COLUMN "player1EscrowSignature" character varying`);
        await queryRunner.query(`ALTER TABLE "match" ADD COLUMN "player2EscrowSignature" character varying`);
        await queryRunner.query(`COMMENT ON COLUMN "match"."status" IS 'Can be waiting, escrow, active, or completed'`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "match" DROP COLUMN "player1EscrowConfirmed"`);
        await queryRunner.query(`ALTER TABLE "match" DROP COLUMN "player2EscrowConfirmed"`);
        await queryRunner.query(`ALTER TABLE "match" DROP COLUMN "player1EscrowSignature"`);
        await queryRunner.query(`ALTER TABLE "match" DROP COLUMN "player2EscrowSignature"`);
    }
} 