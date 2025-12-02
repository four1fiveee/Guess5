import { AppDataSource } from '../db';
import { User } from '../models/User';

const MIN_MATCHES_REQUIRED = 20; // Define the minimum matches required for referral eligibility

// Proactive check to ensure exemptFromReferralMinimum column exists
let columnCheckPromise: Promise<void> | null = null;
const ensureExemptColumnExists = async (): Promise<void> => {
  if (columnCheckPromise) {
    return columnCheckPromise;
  }
  
  columnCheckPromise = (async () => {
    try {
      if (!AppDataSource.isInitialized) {
        return; // Will be checked during initialization
      }
      
      const columnExists = await AppDataSource.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_schema = 'public' 
          AND table_name = 'user' 
          AND column_name = 'exemptFromReferralMinimum'
        );
      `);
      
      if (!columnExists[0]?.exists) {
        console.log('⚠️ Proactively adding exemptFromReferralMinimum column...');
        await AppDataSource.query(`
          ALTER TABLE "user" 
          ADD COLUMN IF NOT EXISTS "exemptFromReferralMinimum" boolean DEFAULT false NOT NULL;
        `);
        await AppDataSource.query(`
          CREATE INDEX IF NOT EXISTS "IDX_user_exemptFromReferralMinimum" 
          ON "user" ("exemptFromReferralMinimum") 
          WHERE "exemptFromReferralMinimum" = true;
        `);
        console.log('✅ Proactively added exemptFromReferralMinimum column');
      }
    } catch (error: any) {
      // Ignore errors - will be handled by fallback in getUserByWallet
      console.warn('⚠️ Proactive column check failed (will retry on first use):', error?.message);
    }
  })();
  
  return columnCheckPromise;
};

/**
 * User service for tracking cumulative entry fees and referral eligibility
 */
export class UserService {
  /**
   * Get or create a user by wallet address
   */
  static async getUserByWallet(walletAddress: string): Promise<User> {
    // Ensure column exists proactively
    await ensureExemptColumnExists();
    
    const userRepository = AppDataSource.getRepository(User);
    
    try {
      let user = await userRepository.findOne({
        where: { walletAddress }
      });

      if (!user) {
        user = userRepository.create({
          walletAddress,
          totalEntryFees: 0,
          totalEntryFeesSOL: 0,
          exemptFromReferralMinimum: false
        });
        user = await userRepository.save(user);
      }

      return user;
    } catch (error: any) {
      const errorMessage = error?.message || String(error);
      
      // If exemptFromReferralMinimum column doesn't exist, add it
      if (errorMessage.includes('exemptFromReferralMinimum') || 
          (errorMessage.includes('column') && errorMessage.includes('does not exist') && errorMessage.includes('User'))) {
        console.log('⚠️ exemptFromReferralMinimum column missing, adding it now...');
        try {
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
          
          // Retry the operation
          let user = await userRepository.findOne({
            where: { walletAddress }
          });

          if (!user) {
            user = userRepository.create({
              walletAddress,
              totalEntryFees: 0,
              totalEntryFeesSOL: 0,
              exemptFromReferralMinimum: false
            });
            user = await userRepository.save(user);
          }

          return user;
        } catch (addColumnError: any) {
          console.error('❌ Failed to add exemptFromReferralMinimum column:', addColumnError);
          throw new Error('exemptFromReferralMinimum column does not exist and could not be created. Please run migrations.');
        }
      }
      
      // If table doesn't exist, try to create it via raw SQL
      if (error?.message?.includes('relation "user" does not exist') || error?.message?.includes('does not exist')) {
        console.log('⚠️ User table does not exist, attempting to create it...');
        try {
          await AppDataSource.query(`
            CREATE TABLE IF NOT EXISTS "user" (
              "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
              "walletAddress" text UNIQUE NOT NULL,
              "username" text,
              "totalEntryFees" numeric(12,2) DEFAULT 0 NOT NULL,
              "totalEntryFeesSOL" numeric(12,6) DEFAULT 0 NOT NULL,
              "exemptFromReferralMinimum" boolean DEFAULT false NOT NULL,
              "createdAt" timestamp DEFAULT now() NOT NULL,
              "updatedAt" timestamp DEFAULT now() NOT NULL
            )
          `);
          
          await AppDataSource.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_walletAddress" ON "user" ("walletAddress")
          `);
          
          // Usernames are not unique - wallet address is the unique identifier
          // Remove unique index if it exists (migration will handle this)
          try {
            await AppDataSource.query(`
              DROP INDEX IF EXISTS "IDX_user_username"
            `);
          } catch (dropError: any) {
            // Ignore if index doesn't exist
            console.log('ℹ️ Unique username index already removed or never existed');
          }
          
          await AppDataSource.query(`
            CREATE INDEX IF NOT EXISTS "IDX_user_exemptFromReferralMinimum" 
            ON "user" ("exemptFromReferralMinimum") 
            WHERE "exemptFromReferralMinimum" = true
          `);
          
          console.log('✅ User table created successfully');
          
          // Retry the operation
          let user = await userRepository.findOne({
            where: { walletAddress }
          });

          if (!user) {
            user = userRepository.create({
              walletAddress,
              totalEntryFees: 0,
              totalEntryFeesSOL: 0,
              exemptFromReferralMinimum: false
            });
            user = await userRepository.save(user);
          }

          return user;
        } catch (createError: any) {
          console.error('❌ Failed to create user table:', createError);
          throw new Error('User table does not exist and could not be created. Please run migrations.');
        }
      }
      throw error;
    }
  }

  /**
   * Update cumulative entry fees for a user
   */
  static async updateUserEntryFees(
    walletAddress: string,
    entryFeeUSD: number,
    entryFeeSOL?: number
  ): Promise<User> {
    const user = await this.getUserByWallet(walletAddress);
    
    const userRepository = AppDataSource.getRepository(User);
    user.totalEntryFees = Number(user.totalEntryFees) + entryFeeUSD;
    if (entryFeeSOL !== undefined) {
      user.totalEntryFeesSOL = Number(user.totalEntryFeesSOL) + entryFeeSOL;
    }
    
    return await userRepository.save(user);
  }

  /**
   * Count number of matches played by a user
   */
  static async getMatchCount(walletAddress: string): Promise<number> {
    const matchRepository = AppDataSource.getRepository('Match');
    const result = await matchRepository.query(`
      SELECT COUNT(*) as count
      FROM "match"
      WHERE ("player1" = $1 OR "player2" = $1)
        AND "isCompleted" = true
    `, [walletAddress]);
    return parseInt(result[0]?.count || '0', 10);
  }

  /**
   * Check if a user is eligible for referral payouts (must have played at least one match)
   */
  static async checkReferralEligibility(walletAddress: string): Promise<boolean> {
    const user = await this.getUserByWallet(walletAddress);
    return Number(user.totalEntryFees) > 0;
  }

  /**
   * Check if a user can refer others (must have played 20 games OR be exempt)
   */
  static async canReferOthers(walletAddress: string): Promise<{
    canRefer: boolean;
    reason?: string;
    matchCount: number;
    exempt: boolean;
  }> {
    const user = await this.getUserByWallet(walletAddress);
    
    // Check if exempt
    if (user.exemptFromReferralMinimum) {
      return {
        canRefer: true,
        matchCount: await this.getMatchCount(walletAddress),
        exempt: true
      };
    }

    // Check match count
    const matchCount = await this.getMatchCount(walletAddress);

    if (matchCount >= MIN_MATCHES_REQUIRED) {
      return {
        canRefer: true,
        matchCount,
        exempt: false
      };
    }

    return {
      canRefer: false,
      reason: `Must play at least ${MIN_MATCHES_REQUIRED} games before referring others. You have played ${matchCount} game${matchCount !== 1 ? 's' : ''}.`,
      matchCount,
      exempt: false
    };
  }

  /**
   * Get user's total entry fees
   */
  static async getTotalEntryFees(walletAddress: string): Promise<number> {
    const user = await this.getUserByWallet(walletAddress);
    return Number(user.totalEntryFees);
  }

  /**
   * Set username for a user (not unique - wallet address is the unique identifier)
   * Usernames can be changed over time and are stored with each match for historical accuracy
   */
  static async setUsername(walletAddress: string, username: string): Promise<User> {
    const userRepository = AppDataSource.getRepository(User);
    
    // Validate username format (3-20 alphanumeric + underscore, case-insensitive)
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      throw new Error('Username must be 3-20 characters and contain only letters, numbers, and underscores');
    }

    // No uniqueness check - usernames are not unique, wallet address is the unique identifier
    // Get or create user
    const user = await this.getUserByWallet(walletAddress);
    user.username = username.toLowerCase(); // Store lowercase for consistency
    
    return await userRepository.save(user);
  }

  /**
   * Get username for a wallet address (optimized - direct query, no user creation)
   */
  static async getUsername(walletAddress: string): Promise<string | null> {
    try {
      // Use direct query for speed - don't create user if it doesn't exist
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { walletAddress },
        select: ['username'] // Only select username field for speed
      });
      return user?.username || null;
    } catch (error: any) {
      // If query fails, return null (non-blocking)
      console.warn('⚠️ Error getting username (non-blocking):', error?.message);
      return null;
    }
  }

  /**
   * Get user by username
   */
  static async getUserByUsername(username: string): Promise<User | null> {
    const userRepository = AppDataSource.getRepository(User);
    return await userRepository.findOne({
      where: { username: username.toLowerCase() }
    });
  }

  /**
   * Check if username is available (always returns true - usernames are not unique)
   * Only validates format, doesn't check database
   */
  static async isUsernameAvailable(username: string): Promise<boolean> {
    // Usernames are not unique - wallet address is the unique identifier
    // Just validate format, no database check needed
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    return usernameRegex.test(username);
  }

  /**
   * Recompute total entry fees for a user from matches table
   */
  static async recomputeTotalEntryFees(walletAddress: string): Promise<User> {
    const matchRepository = AppDataSource.getRepository('Match');
    
    // Sum all entry fees from matches where this wallet is player1 or player2
    const result = await matchRepository.query(`
      SELECT 
        COALESCE(SUM(CASE 
          WHEN "player1" = $1 THEN "entryFeeUSD"
          WHEN "player2" = $1 THEN "entryFeeUSD"
          ELSE 0
        END), 0) as total_usd,
        COALESCE(SUM(CASE 
          WHEN "player1" = $1 THEN "entryFee"
          WHEN "player2" = $1 THEN "entryFee"
          ELSE 0
        END), 0) as total_sol
      FROM "match"
      WHERE ("player1" = $1 OR "player2" = $1)
        AND "entryFeeUSD" IS NOT NULL
    `, [walletAddress]);

    const totalUSD = parseFloat(result[0]?.total_usd || '0');
    const totalSOL = parseFloat(result[0]?.total_sol || '0');

    const user = await this.getUserByWallet(walletAddress);
    const userRepository = AppDataSource.getRepository(User);
    user.totalEntryFees = totalUSD;
    user.totalEntryFeesSOL = totalSOL;
    
    return await userRepository.save(user);
  }
}

