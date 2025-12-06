import { Request, Response } from 'express';
import { UserService } from '../services/userService';

/**
 * Set username for a user
 * POST /api/user/username
 */
export const setUsername = async (req: Request, res: Response) => {
  try {
    const { wallet, username } = req.body;

    if (!wallet || !username) {
      return res.status(400).json({ error: 'Wallet and username are required' });
    }

    const user = await UserService.setUsername(wallet, username);
    
    return res.json({
      success: true,
      username: user.username,
      walletAddress: user.walletAddress
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error setting username:', errorMessage);
    return res.status(400).json({ error: errorMessage });
  }
};

/**
 * Get username for a wallet
 * GET /api/user/username?wallet=<address>
 */
export const getUsername = async (req: Request, res: Response) => {
  // Set CORS headers
  const { resolveCorsOrigin } = require('../config/corsOrigins');
  const origin = resolveCorsOrigin(req.headers.origin);
  const originToUse = origin || 'https://guess5.io';
  res.header('Access-Control-Allow-Origin', originToUse);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  try {
    const wallet = req.query.wallet as string;

    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address is required' });
    }

    const username = await UserService.getUsername(wallet);
    
    return res.json({
      username: username || null,
      walletAddress: wallet
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting username:', errorMessage);
    return res.status(500).json({ error: 'Failed to get username' });
  }
};

/**
 * Check if username is available (format validation only - usernames are not unique)
 * GET /api/user/username/check?username=<username>
 */
export const checkUsernameAvailability = async (req: Request, res: Response) => {
  try {
    const username = req.query.username as string;

    if (!username) {
      return res.json({
        available: false,
        reason: 'Username is required'
      });
    }

    // Validate format only - usernames are not unique
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(username)) {
      return res.json({
        available: false,
        reason: 'Username must be 3-20 characters and contain only letters, numbers, and underscores'
      });
    }

    // Always return available - no database check needed (usernames are not unique)
    return res.json({
      available: true,
      username: username.toLowerCase()
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error checking username availability:', errorMessage);
    return res.status(500).json({ error: 'Failed to check username availability' });
  }
};

