import { DataSource } from 'typeorm'
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
    
    await AppDataSource.query('SELECT 1');
    return { healthy: true };
  } catch (error) {
    return { healthy: false, error: error instanceof Error ? error.message : String(error) };
  }
};

// Simple database initialization without complex schema fixes
export const initializeDatabase = async () => {
  const maxRetries = 3;
  let retryCount = 0;
  
  while (retryCount < maxRetries) {
    try {
      console.log(`🔌 Initializing database connection (attempt ${retryCount + 1}/${maxRetries})...`);
      
      if (!AppDataSource.isInitialized) {
        await AppDataSource.initialize();
        console.log('✅ Database connection established');
      }

      // Run migrations
      try {
        const migrations = await AppDataSource.runMigrations();
        if (migrations.length > 0) {
          console.log(`✅ Ran ${migrations.length} migration(s):`, migrations.map(m => m.name).join(', '));
        } else {
          console.log('✅ No pending migrations');
        }
      } catch (migrationError) {
        console.warn('⚠️ Migration error (continuing):', migrationError);
      }

      // Ensure player1Username and player2Username columns exist (migration might have failed)
      try {
        await AppDataSource.query(`
          ALTER TABLE "match" 
          ADD COLUMN IF NOT EXISTS "player1Username" text,
          ADD COLUMN IF NOT EXISTS "player2Username" text
        `);
        console.log('✅ Ensured player1Username and player2Username columns exist');
      } catch (columnError: any) {
        // Ignore if columns already exist or other non-critical errors
        if (!columnError?.message?.includes('already exists') && !columnError?.message?.includes('duplicate')) {
          console.warn('⚠️ Could not ensure match username columns:', columnError?.message);
        }
      }

      // Ensure executionAttempts and executionLastAttemptAt columns exist (migration might have failed)
      try {
        await AppDataSource.query(`
          ALTER TABLE "match" 
          ADD COLUMN IF NOT EXISTS "executionAttempts" integer DEFAULT 0,
          ADD COLUMN IF NOT EXISTS "executionLastAttemptAt" timestamp
        `);
        console.log('✅ Ensured executionAttempts and executionLastAttemptAt columns exist');
      } catch (columnError: any) {
        // Ignore if columns already exist or other non-critical errors
        if (!columnError?.message?.includes('already exists') && !columnError?.message?.includes('duplicate')) {
          console.warn('⚠️ Could not ensure execution attempt tracking columns:', columnError?.message);
        }
      }

      console.log('✅ Database initialization complete');
      return;
      
    } catch (error) {
      retryCount++;
      console.error(`❌ Database initialization attempt ${retryCount} failed:`, error);
      
      if (retryCount >= maxRetries) {
        console.error('❌ Max database initialization retries reached');
        throw error;
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
    }
  }
};

// Close database connection
export const closeDatabase = async () => {
  try {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
      console.log('✅ Database connection closed');
    }
  } catch (error) {
    console.error('❌ Error closing database connection:', error);
  }
};
