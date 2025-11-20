import { DataSource } from 'typeorm'
import { Client } from 'pg'
import { Match } from '../models/Match'
import { Guess } from '../models/Guess'
import { Transaction } from '../models/Transaction'
import { MatchAttestation } from '../models/MatchAttestation'
import { MatchAuditLog } from '../models/MatchAuditLog'
import { User } from '../models/User'
import { Referral } from '../models/Referral'
import { ReferralUpline } from '../models/ReferralUpline'
import { ReferralEarning } from '../models/ReferralEarning'
import { PayoutBatch } from '../models/PayoutBatch'
import { MatchSubscriber } from '../subscribers/matchSubscriber'
import * as dotenv from 'dotenv'

// Load environment variables
dotenv.config()

// Validate required environment variables
const validateDatabaseConfig = () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL environment variable is required');
  }
  
  console.log('✅ Database configuration validated');
};

// Validate environment variables before creating DataSource
validateDatabaseConfig();

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL!,
  entities: [Match, Guess, Transaction, MatchAttestation, MatchAuditLog, User, Referral, ReferralUpline, ReferralEarning, PayoutBatch],
  subscribers: [MatchSubscriber],
  migrations: ['dist/db/migrations/*.js'],
  synchronize: false, // Use migrations instead of synchronize
  logging: process.env.NODE_ENV === 'development',
  extra: {
    ssl: {
      rejectUnauthorized: false
    }
  }
})

// Database connection health check
export const checkDatabaseHealth = async () => {
  try {
    if (!AppDataSource.isInitialized) {
      return { healthy: false, error: 'Database not initialized' };
    }
    
    // Test query to verify connection
    await AppDataSource.query('SELECT 1');
    return { healthy: true };
  } catch (error: unknown) {
    console.error('❌ Database health check failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { healthy: false, error: errorMessage };
  }
};

// Reconnection logic
export const reconnectDatabase = async () => {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    
    console.log('🔄 Attempting to reconnect to database...');
    await AppDataSource.initialize();
    console.log('✅ Database reconnected successfully');
    return true;
  } catch (error: unknown) {
    console.error('❌ Database reconnection failed:', error);
    return false;
  }
};

// Initialize database connection with retry logic
export const initializeDatabase = async () => {
  const maxRetries = 3;
  let retryCount = 0;
  
  const fixMigrationNames = async (client?: Client) => {
    try {
      const renameQuery = 'UPDATE "migration" SET name = $1 WHERE name = $2';
      const deleteQuery = 'DELETE FROM "migration" WHERE name = $1';
      const oldName = 'ProposalExpiration013';
      const newName = 'ProposalExpiration1710012345678';
      const tables = ['migration', 'migrations', 'schema_migrations', 'typeorm_migrations'];
      for (const table of tables) {
        const renameSql = renameQuery.replace('"migration"', `"${table}"`);
        const deleteSql = deleteQuery.replace('"migration"', `"${table}"`);
        if (client) {
          await client.query(renameSql, [newName, oldName]);
          await client.query(deleteSql, [oldName]);
        } else if (AppDataSource.isInitialized) {
          await AppDataSource.query(renameSql, [newName, oldName]);
          await AppDataSource.query(deleteSql, [oldName]);
        }
        const checkSql = `SELECT name FROM "${table}" ORDER BY name`;
        const result = client
          ? await client.query(checkSql)
          : AppDataSource.isInitialized
            ? await AppDataSource.query(checkSql)
            : undefined;
        if (result) {
          const rows = Array.isArray(result.rows) ? result.rows : result;
          console.log(`🔎 Migration names in ${table}:`, rows.map((r: any) => r.name));
        }
      }
    } catch (error) {
      console.warn('⚠️ Unable to normalize legacy migration names (safe to ignore if table missing):', error);
    }
  };

  const ensureReferralTables = async () => {
    try {
      // Create referral tables if they don't exist
      await AppDataSource.query(`
        CREATE TABLE IF NOT EXISTS "referral" (
          "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          "referredWallet" text UNIQUE NOT NULL,
          "referrerWallet" text NOT NULL,
          "referredAt" timestamp DEFAULT now() NOT NULL,
          "eligible" boolean DEFAULT false NOT NULL,
          "active" boolean DEFAULT true NOT NULL
        )
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_referrerWallet" ON "referral" ("referrerWallet")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_referredWallet" ON "referral" ("referredWallet")
      `);
      
      await AppDataSource.query(`
        CREATE TABLE IF NOT EXISTS "referral_upline" (
          "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
          "referredWallet" text NOT NULL,
          "level" integer NOT NULL,
          "uplineWallet" text NOT NULL,
          "createdAt" timestamp DEFAULT now() NOT NULL,
          CONSTRAINT "UQ_referral_upline_referred_level_upline" UNIQUE ("referredWallet", "level", "uplineWallet")
        )
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_upline_uplineWallet" ON "referral_upline" ("uplineWallet")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_upline_referredWallet" ON "referral_upline" ("referredWallet")
      `);
      
      await AppDataSource.query(`
        DO $$ BEGIN
          CREATE TYPE payout_batch_status_enum AS ENUM ('prepared', 'reviewed', 'sent', 'failed');
        EXCEPTION
          WHEN duplicate_object THEN null;
        END $$;
      `);
      
      await AppDataSource.query(`
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
      
      await AppDataSource.query(`
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
            REFERENCES "match"("id") ON DELETE CASCADE
        )
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_earning_uplineWallet" ON "referral_earning" ("uplineWallet")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_earning_matchId" ON "referral_earning" ("matchId")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_earning_paid" ON "referral_earning" ("paid")
      `);
      
      await AppDataSource.query(`
        CREATE INDEX IF NOT EXISTS "IDX_referral_earning_payoutBatchId" ON "referral_earning" ("payoutBatchId")
      `);
      
      console.log('✅ Referral tables created');
    } catch (error: any) {
      console.error('❌ Error creating referral tables:', error);
      throw error;
    }
  };

  const ensureMatchReferralColumns = async () => {
    try {
      await AppDataSource.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsCost" numeric(10,6)
      `);
      await AppDataSource.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsCostUSD" numeric(10,2)
      `);
      await AppDataSource.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netProfit" numeric(10,6)
      `);
      await AppDataSource.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netProfitUSD" numeric(10,2)
      `);
      await AppDataSource.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "referralEarningsComputed" boolean DEFAULT false NOT NULL
      `);
      console.log('✅ Match referral columns added');
    } catch (error: any) {
      console.error('❌ Error adding match referral columns:', error);
      throw error;
    }
  };

  const ensureProposalExpiresAtColumn = async (client?: Client) => {
    try {
      console.log('🔍 Ensuring proposalExpiresAt column exists (fallback safeguard)...');
      const query = 'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "proposalExpiresAt" TIMESTAMP NULL';
      if (client) {
        await client.query(query);
      } else if (AppDataSource.isInitialized) {
        await AppDataSource.query(query);
      }
      console.log('✅ proposalExpiresAt column verified/created');
    } catch (error) {
      console.error('❌ Failed to ensure proposalExpiresAt column exists:', error);
    }
  };

  const ensureBonusColumns = async (client?: Client) => {
    try {
      console.log('🔍 Ensuring bonus payout columns exist (fallback safeguard)...');
      const statements = [
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusPercent" DECIMAL(5,4) DEFAULT 0',
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusAmount" DECIMAL(12,6)',
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusAmountUSD" DECIMAL(10,2)',
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusSignature" VARCHAR',
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusPaid" BOOLEAN DEFAULT FALSE',
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusPaidAt" TIMESTAMP',
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "bonusTier" VARCHAR'
      ];

      for (const statement of statements) {
        if (client) {
          await client.query(statement);
        } else if (AppDataSource.isInitialized) {
          await AppDataSource.query(statement);
        }
      }
      console.log('✅ Bonus payout columns verified/created');
    } catch (error) {
      console.error('❌ Failed to ensure bonus payout columns exist:', error);
    }
  };

  const ensureVaultColumns = async (client?: Client) => {
    try {
      console.log('🔍 Ensuring Squads vault columns exist (fallback safeguard)...');
      const statements = [
        'ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsVaultPda" VARCHAR'
      ];

      for (const statement of statements) {
        if (client) {
          await client.query(statement);
        } else if (AppDataSource.isInitialized) {
          await AppDataSource.query(statement);
        }
      }

      console.log('✅ Squads vault columns verified/created');
    } catch (error) {
      console.error('❌ Failed to ensure Squads vault columns exist:', error);
    }
  };

  const fixCompletedMatchStatuses = async (client?: Client) => {
    const pendingSql = `
      SELECT COUNT(*)::int AS pending
      FROM "match"
      WHERE "isCompleted" = true
        AND (status IS NULL OR status <> 'completed')
    `;
    const updateSql = `
      UPDATE "match"
      SET status = 'completed'
      WHERE "isCompleted" = true
        AND (status IS NULL OR status <> 'completed')
    `;

    const runQuery = async <T>(sql: string): Promise<T | undefined> => {
      if (client) {
        const result = await client.query(sql);
        return (result.rows?.[0] as T) ?? undefined;
      }
      if (AppDataSource.isInitialized) {
        const result = await AppDataSource.query(sql);
        return (Array.isArray(result) ? (result[0] as T) : undefined);
      }
      return undefined;
    };

    try {
      const pendingBefore = await runQuery<{ pending: number }>(pendingSql);
      const needsFix = pendingBefore?.pending ?? 0;

      if (!needsFix) {
        console.log('✅ Completed match statuses already normalized');
        return;
      }

      if (client) {
        await client.query(updateSql);
      } else if (AppDataSource.isInitialized) {
        await AppDataSource.query(updateSql);
      }

      const pendingAfter = await runQuery<{ pending: number }>(pendingSql);
      const remaining = pendingAfter?.pending ?? 0;
      const fixed = needsFix - remaining;

      console.log(`✅ Normalized ${fixed} completed match status${fixed === 1 ? '' : 'es'}`);
      if (remaining > 0) {
        console.warn(`⚠️ ${remaining} completed match status${remaining === 1 ? '' : 'es'} still need review`);
      }
    } catch (error) {
      console.warn('⚠️ Failed to normalize completed match statuses:', error);
    }
  };

  const ensureMatchReferralColumnsPreInit = async (client: Client) => {
    try {
      console.log('🔍 Ensuring match referral columns exist (pre-init)...');
      await client.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsCost" numeric(10,6)
      `);
      await client.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "squadsCostUSD" numeric(10,2)
      `);
      await client.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netProfit" numeric(10,6)
      `);
      await client.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netProfitUSD" numeric(10,2)
      `);
      await client.query(`
        ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "referralEarningsComputed" boolean DEFAULT false NOT NULL
      `);
      console.log('✅ Match referral columns verified/created (pre-init)');
    } catch (error: any) {
      console.error('❌ Failed to ensure match referral columns exist (pre-init):', error);
      // Don't throw - continue with initialization
    }
  };

  const runPreInitializationSchemaFixes = async () => {
    let client: Client | undefined;
    try {
      client = new Client({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
      });
      console.log('🔌 Running pre-initialization schema fixes using raw pg client...');
      await client.connect();
      await ensureProposalExpiresAtColumn(client);
      await ensureBonusColumns(client);
      await ensureVaultColumns(client);
      await ensureMatchReferralColumnsPreInit(client); // Add match referral columns BEFORE anything else
      await fixMigrationNames(client);
      await fixCompletedMatchStatuses(client);
      console.log('✅ Pre-initialization schema fixes complete');
    } catch (error) {
      console.warn('⚠️ Pre-initialization schema fixes failed (continuing):', error);
    } finally {
      if (client) {
        try {
          await client.end();
        } catch (closeError) {
          console.warn('⚠️ Failed to close pre-initialization client:', closeError);
        }
      }
    }
  };

  while (retryCount < maxRetries) {
    try {
      console.log(`🔌 Initializing database connection (attempt ${retryCount + 1}/${maxRetries})...`);
      
      // Check if already connected
      if (AppDataSource.isInitialized) {
        console.log('✅ Database already connected');
        return;
      }
      
          await runPreInitializationSchemaFixes();
          await AppDataSource.initialize();
          console.log('✅ Database connected successfully');
          
          // Patch legacy migration records before running migrations
          await fixMigrationNames();
          // Ensure critical columns exist even if migration failed previously
          await ensureProposalExpiresAtColumn();
          await ensureBonusColumns();
          await ensureVaultColumns();
          await ensureMatchReferralColumns(); // Ensure match referral columns exist
          await fixCompletedMatchStatuses();

      // Run migrations
      try {
        const migrations = await AppDataSource.runMigrations();
        if (migrations.length > 0) {
          console.log(`✅ Ran ${migrations.length} migration(s):`, migrations.map(m => m.name).join(', '));
        } else {
          console.log('✅ No pending migrations');
        }
        
        // Ensure all referral-related migrations have run (fallback for 014-017)
        console.log('🔍 Checking referral migration status...');
        
        // Check if referral tables exist (migration 014)
        const referralTableExists = await AppDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'referral'
          );
        `);
        
        if (!referralTableExists[0]?.exists) {
          console.log('⚠️ Migration 014 not run - creating referral tables...');
          await ensureReferralTables();
        }
        
        // Ensure user table exists (migration 014)
        const userTableExists = await AppDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'user'
          );
        `);
        
        if (!userTableExists[0]?.exists) {
          console.log('⚠️ User table missing - creating it...');
          await AppDataSource.query(`
            CREATE TABLE IF NOT EXISTS "user" (
              "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
              "walletAddress" text UNIQUE NOT NULL,
              "totalEntryFees" numeric(12,2) DEFAULT 0 NOT NULL,
              "totalEntryFeesSOL" numeric(12,6) DEFAULT 0 NOT NULL,
              "createdAt" timestamp DEFAULT now() NOT NULL,
              "updatedAt" timestamp DEFAULT now() NOT NULL
            )
          `);
          await AppDataSource.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_walletAddress" ON "user" ("walletAddress")
          `);
          console.log('✅ User table created');
        }
        
        // Check if user table has username column (migration 015)
        const usernameColumnExists = await AppDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'user' 
            AND column_name = 'username'
          );
        `);
        
        if (!usernameColumnExists[0]?.exists) {
          console.log('⚠️ Migration 015 not run - adding username column...');
          await AppDataSource.query(`
            ALTER TABLE "user" 
            ADD COLUMN IF NOT EXISTS "username" text UNIQUE;
          `);
          await AppDataSource.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_username" 
            ON "user" ("username") WHERE "username" IS NOT NULL;
          `);
          console.log('✅ Added username column');
        }
        
        // Check if payout_batch has approval fields (migration 016)
        const reviewedByExists = await AppDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'payout_batch' 
            AND column_name = 'reviewedByAdmin'
          );
        `);
        
        if (!reviewedByExists[0]?.exists) {
          console.log('⚠️ Migration 016 not run - adding payout approval fields...');
          await AppDataSource.query(`
            ALTER TABLE "payout_batch" 
            ADD COLUMN IF NOT EXISTS "reviewedByAdmin" text;
          `);
          await AppDataSource.query(`
            ALTER TABLE "payout_batch" 
            ADD COLUMN IF NOT EXISTS "reviewedAt" timestamp;
          `);
          console.log('✅ Added payout approval fields');
        }
        
        // Check if user table has exemptFromReferralMinimum (migration 017)
        const exemptColumnExists = await AppDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'user' 
            AND column_name = 'exemptFromReferralMinimum'
          );
        `);
        
        if (!exemptColumnExists[0]?.exists) {
          console.log('⚠️ Migration 017 not run - adding exemptFromReferralMinimum column...');
          await AppDataSource.query(`
            ALTER TABLE "user" 
            ADD COLUMN IF NOT EXISTS "exemptFromReferralMinimum" boolean DEFAULT false NOT NULL;
          `);
          await AppDataSource.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_exemptFromReferralMinimum" 
            ON "user" ("exemptFromReferralMinimum") 
            WHERE "exemptFromReferralMinimum" = true;
          `);
          console.log('✅ Added exemptFromReferralMinimum column');
        }
        
        // Check if match table has referral columns (migration 014)
        const netProfitExists = await AppDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'match' 
            AND column_name = 'netProfitUSD'
          );
        `);
        
        if (!netProfitExists[0]?.exists) {
          console.log('⚠️ Migration 014 not run - adding match referral columns...');
          await ensureMatchReferralColumns();
        }
        
        console.log('✅ All referral migration fallbacks checked');
      } catch (migrationError: any) {
        console.error('❌ Migration error:', migrationError);
        // Log detailed error but don't fail startup - migrations might have partial failures
        if (migrationError.message) {
          console.error('Migration error details:', migrationError.message);
        }
        throw migrationError; // Re-throw to prevent startup with failed migrations
      }
      
      // Set up connection monitoring
      if (process.env.NODE_ENV === 'production') {
        setInterval(async () => {
          const health = await checkDatabaseHealth();
          if (!health.healthy) {
            console.warn('⚠️ Database health check failed, attempting reconnection...');
            await reconnectDatabase();
          }
        }, 30000); // Check every 30 seconds
      }
      
      return;
    } catch (error: unknown) {
      console.error(`❌ Database connection attempt ${retryCount + 1} failed:`, error);
      
      // If already connected, don't retry
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage && errorMessage.includes('already established')) {
        console.log('✅ Database already connected, continuing...');
        return;
      }
      
      retryCount++;
      
      if (retryCount < maxRetries) {
        console.log(`⏳ Retrying in ${retryCount * 2000}ms...`);
        await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
      } else {
        console.error('❌ Database connection failed after all retries');
        throw error;
      }
    }
  }
} 