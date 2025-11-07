import { DataSource } from 'typeorm'
import { Client } from 'pg'
import { Match } from '../models/Match'
import { Guess } from '../models/Guess'
import { Transaction } from '../models/Transaction'
import { MatchAttestation } from '../models/MatchAttestation'
import { MatchAuditLog } from '../models/MatchAuditLog'
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
  entities: [Match, Guess, Transaction, MatchAttestation, MatchAuditLog],
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
      await fixMigrationNames(client);
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

      // Run migrations
      await AppDataSource.runMigrations();
      console.log('✅ Database migrations completed');
      
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