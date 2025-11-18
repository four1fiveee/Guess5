import { AppDataSource } from '../db';
import { User } from '../models/User';

/**
 * User service for tracking cumulative entry fees and referral eligibility
 */
export class UserService {
  /**
   * Get or create a user by wallet address
   */
  static async getUserByWallet(walletAddress: string): Promise<User> {
    const userRepository = AppDataSource.getRepository(User);
    
    let user = await userRepository.findOne({
      where: { walletAddress }
    });

    if (!user) {
      user = userRepository.create({
        walletAddress,
        totalEntryFees: 0,
        totalEntryFeesSOL: 0
      });
      user = await userRepository.save(user);
    }

    return user;
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
   * Check if a user is eligible for referral payouts (must have played at least one match)
   */
  static async checkReferralEligibility(walletAddress: string): Promise<boolean> {
    const user = await this.getUserByWallet(walletAddress);
    return Number(user.totalEntryFees) > 0;
  }

  /**
   * Get user's total entry fees
   */
  static async getTotalEntryFees(walletAddress: string): Promise<number> {
    const user = await this.getUserByWallet(walletAddress);
    return Number(user.totalEntryFees);
  }

  /**
   * Set username for a user (must be unique)
   */
  static async setUsername(walletAddress: string, username: string): Promise<User> {
    const userRepository = AppDataSource.getRepository(User);
    
    // Validate username format (3-20 alphanumeric + underscore, case-insensitive)
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      throw new Error('Username must be 3-20 characters and contain only letters, numbers, and underscores');
    }

    // Check if username is already taken
    const existingUser = await userRepository.findOne({
      where: { username: username.toLowerCase() }
    });

    if (existingUser && existingUser.walletAddress !== walletAddress) {
      throw new Error('Username is already taken');
    }

    // Get or create user
    const user = await this.getUserByWallet(walletAddress);
    user.username = username.toLowerCase(); // Store lowercase for uniqueness
    
    return await userRepository.save(user);
  }

  /**
   * Get username for a wallet address
   */
  static async getUsername(walletAddress: string): Promise<string | null> {
    const user = await this.getUserByWallet(walletAddress);
    return user.username;
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
   * Check if username is available
   */
  static async isUsernameAvailable(username: string): Promise<boolean> {
    const userRepository = AppDataSource.getRepository(User);
    const existing = await userRepository.findOne({
      where: { username: username.toLowerCase() }
    });
    return !existing;
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

