import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateReferralTables1700000000014 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create User table if not exists
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "walletAddress" text UNIQUE NOT NULL,
        "totalEntryFees" numeric(12,2) DEFAULT 0 NOT NULL,
        "totalEntryFeesSOL" numeric(12,6) DEFAULT 0 NOT NULL,
        "createdAt" timestamp DEFAULT now() NOT NULL,
        "updatedAt" timestamp DEFAULT now() NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_user_walletAddress" ON "user" ("walletAddress")
    `);

    // Create referrals table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "referral" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "referredWallet" text UNIQUE NOT NULL,
        "referrerWallet" text NOT NULL,
        "referredAt" timestamp DEFAULT now() NOT NULL,
        "eligible" boolean DEFAULT false NOT NULL,
        "active" boolean DEFAULT true NOT NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_referrerWallet" ON "referral" ("referrerWallet")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_referredWallet" ON "referral" ("referredWallet")
    `);

    // Create referral_uplines table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "referral_upline" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "referredWallet" text NOT NULL,
        "level" integer NOT NULL,
        "uplineWallet" text NOT NULL,
        "createdAt" timestamp DEFAULT now() NOT NULL,
        CONSTRAINT "UQ_referral_upline_referred_level_upline" UNIQUE ("referredWallet", "level", "uplineWallet")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_upline_uplineWallet" ON "referral_upline" ("uplineWallet")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_upline_referredWallet" ON "referral_upline" ("referredWallet")
    `);

    // Create payout_batches table
    await queryRunner.query(`
      CREATE TYPE "payout_batch_status_enum" AS ENUM ('prepared', 'reviewed', 'sent', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "payout_batch" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "batchAt" timestamp NOT NULL,
        "scheduledSendAt" timestamp NOT NULL,
        "minPayoutUSD" numeric(12,2) DEFAULT 20 NOT NULL,
        "status" payout_batch_status_enum DEFAULT 'prepared' NOT NULL,
        "totalAmountUSD" numeric(12,2) NOT NULL,
        "totalAmountSOL" numeric(12,6) NOT NULL,
        "solPriceAtPayout" numeric(12,2),
        "createdByAdmin" text,
        "transactionSignature" text,
        "createdAt" timestamp DEFAULT now() NOT NULL,
        "updatedAt" timestamp DEFAULT now() NOT NULL
      )
    `);

    // Create referral_earnings table
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "referral_earning" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "matchId" uuid NOT NULL,
        "referredWallet" text NOT NULL,
        "uplineWallet" text NOT NULL,
        "level" integer NOT NULL,
        "amountUSD" numeric(12,2) NOT NULL,
        "amountSOL" numeric(12,6),
        "createdAt" timestamp DEFAULT now() NOT NULL,
        "paid" boolean DEFAULT false NOT NULL,
        "paidAt" timestamp,
        "payoutBatchId" uuid,
        CONSTRAINT "FK_referral_earning_match" FOREIGN KEY ("matchId") 
          REFERENCES "match"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_referral_earning_payout_batch" FOREIGN KEY ("payoutBatchId") 
          REFERENCES "payout_batch"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_earning_uplineWallet" ON "referral_earning" ("uplineWallet")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_earning_matchId" ON "referral_earning" ("matchId")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_earning_paid" ON "referral_earning" ("paid")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_referral_earning_payoutBatchId" ON "referral_earning" ("payoutBatchId")
    `);

    // Add referral-related fields to match table
    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsCost" numeric(10,6)
    `);

    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsCostUSD" numeric(10,2)
    `);

    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netProfit" numeric(10,6)
    `);

    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netProfitUSD" numeric(10,2)
    `);

    await queryRunner.query(`
      ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "referralEarningsComputed" boolean DEFAULT false NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop tables in reverse order
    await queryRunner.query(`DROP TABLE IF EXISTS "referral_earning"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "payout_batch"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "payout_batch_status_enum"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "referral_upline"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "referral"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user"`);

    // Remove columns from match table
    await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS "referralEarningsComputed"`);
    await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS "netProfitUSD"`);
    await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS "netProfit"`);
    await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS "squadsCostUSD"`);
    await queryRunner.query(`ALTER TABLE "match" DROP COLUMN IF EXISTS "squadsCost"`);
  }
}

