import { MigrationInterface, QueryRunner } from 'typeorm';

export class EntryTierMetadata0131733120000000 implements MigrationInterface {
  name = 'EntryTierMetadata0131733120000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "entryTierId" VARCHAR
    `);
    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "payoutPercentage" NUMERIC(6,3)
    `);
    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "houseEdgePercentage" NUMERIC(6,3)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "match" DROP COLUMN IF EXISTS "houseEdgePercentage"
    `);
    await queryRunner.query(`
      ALTER TABLE "match" DROP COLUMN IF EXISTS "payoutPercentage"
    `);
    await queryRunner.query(`
      ALTER TABLE "match" DROP COLUMN IF EXISTS "entryTierId"
    `);
  }
}
