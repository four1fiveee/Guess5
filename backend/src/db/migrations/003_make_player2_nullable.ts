import { MigrationInterface, QueryRunner } from "typeorm";

export class MakePlayer2Nullable1700000000003 implements MigrationInterface {
    name = 'MakePlayer2Nullable1700000000003'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "match" ALTER COLUMN "player2" DROP NOT NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "match" ALTER COLUMN "player2" SET NOT NULL`);
    }
} 