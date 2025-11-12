// @ts-nocheck
const expressMatch = require('express');
const { Match } = require('../models/Match');
const { FEE_WALLET_ADDRESS } = require('../config/wallet');
const {
  normalizeRequiredSignatures,
  buildInitialProposalState,
  applyProposalStateToMatch,
} = require('../utils/proposalSigners');
const RESULTS_ATTESTOR_ADDRESS = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
const { Not, LessThan, Between, IsNull } = require('typeorm');
const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const path = require('path');
const wordListModule = require(path.join(__dirname, '../wordList'));
const { getRandomWord } = wordListModule;

// Import database connection for pending claims handler
const { AppDataSource } = require('../db/index');

// Import Squads service for non-custodial vault operations
const { squadsVaultService } = require('../services/squadsVaultService');

// Import Redis helpers to replace in-memory storage
const { getGameState, setGameState, deleteGameState } = require('../utils/redisGameState');
const { getMatchmakingLock, setMatchmakingLock, deleteMatchmakingLock } = require('../utils/redisMatchmakingLocks');
const { redisMatchmakingService } = require('../services/redisMatchmakingService');
const { getRedisMM } = require('../config/redis');
const { resolveCorsOrigin } = require('../config/corsOrigins');

// Redis-based memory management for 1000 concurrent users
const { redisMemoryManager } = require('../utils/redisMemoryManager');
const { disburseBonusIfEligible } = require('../services/bonusService');
const { buildProposalExecutionUpdates } = require('../utils/proposalExecutionUpdates');

// Helper function to check fee wallet balance
const checkFeeWalletBalance = async (requiredAmount: number): Promise<boolean> => {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    const feeWalletPublicKey = new PublicKey(FEE_WALLET_ADDRESS);
    
    const balance = await connection.getBalance(feeWalletPublicKey);
    const hasEnough = balance >= requiredAmount;
    
    console.log('💰 Fee wallet balance check:', {
      balance: balance / 1000000000, // Convert lamports to SOL
      required: requiredAmount / 1000000000,
      hasEnough
    });
    
    return hasEnough;
  } catch (error: unknown) {
    console.error('❌ Error checking fee wallet balance:', error);
    return false;
  }
};

const stringifySafe = (value: any): string => {
  try {
    return JSON.stringify(
      value,
      (_, v) => {
        if (typeof v === 'bigint') {
          return v.toString();
        }
        return v;
      }
    );
  } catch {
    return String(value);
  }
};

const formatError = (error: any): string => {
  if (!error) {
    return 'Unknown error';
  }
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  if (typeof error === 'string') {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

const normalizeProposalSigners = (value: any): string[] => {
  if (!value) {
    return [];
  }

  const coerceToArray = (input: any): string[] => {
    if (!input) {
      return [];
    }

    if (Array.isArray(input)) {
      return input
        .filter((entry) => typeof entry === 'string' && entry.length > 0)
        .map((entry) => entry.trim());
    }

    if (typeof input === 'string') {
      return input.length > 0 ? [input.trim()] : [];
    }

    if (typeof input === 'object') {
      return Object.values(input)
        .filter((entry) => typeof entry === 'string' && entry.length > 0)
        .map((entry) => entry.trim());
    }

    return [];
  };

  try {
    if (typeof value === 'string') {
      // Attempt to parse JSON strings; fall back to treating as comma-separated or single value
      try {
        const parsed = JSON.parse(value);
        const result = coerceToArray(parsed);
        if (result.length > 0) {
          return result;
        }
      } catch {
        // Not JSON; check if comma-separated string
        if (value.includes(',')) {
          return value
            .split(',')
            .map((entry) => entry.trim())
            .filter((entry) => entry.length > 0);
        }
        return coerceToArray(value);
      }
    } else {
      const result = coerceToArray(value);
      if (result.length > 0) {
        return result;
      }
    }
  } catch {
    // Ignore errors; fall back below
  }

  return [];
};

const persistExecutionUpdates = async (matchRepository: any, matchId: string, updates: Record<string, any>) => {
  const entries = Object.entries(updates || {});
  if (entries.length === 0) {
    return;
  }

  const setClauses = entries.map(([key], idx) => `"${key}" = $${idx + 1}`);
  setClauses.push('"updatedAt" = NOW()');

  const values = entries.map(([, value]) => value);
  values.push(matchId);

  await matchRepository.query(`
    UPDATE "match"
    SET ${setClauses.join(', ')}
    WHERE id = $${entries.length + 1}
  `, values);
};

const applyExecutionUpdatesToMatch = (matchRow: any, updates: Record<string, any>) => {
  if (!matchRow || !updates) {
    return;
  }

  Object.entries(updates).forEach(([key, value]) => {
    matchRow[key] = value;
  });
};

const attemptAutoExecuteIfReady = async (
  match: any,
  matchRepository: any,
  context: string
): Promise<boolean> => {
  try {
    if (!match || !matchRepository) {
      return false;
    }

    const proposalIdRaw =
      (match as any).payoutProposalId || (match as any).tieRefundProposalId;
    if (!proposalIdRaw) {
      return false;
    }

    const proposalIdString = String(proposalIdRaw).trim();
    const proposalStatus = ((match as any).proposalStatus || '').toUpperCase();
    const remainingSignatures = normalizeRequiredSignatures((match as any).needsSignatures);

    if (proposalStatus === 'EXECUTED' || proposalStatus === 'CANCELLED') {
      return false;
    }

    if (remainingSignatures > 0) {
      return false;
    }

    if (!(match as any).squadsVaultAddress) {
      return false;
    }

    const feeWalletData = require('../config/wallet');
    const feeWalletAddress =
      typeof feeWalletData.getFeeWalletAddress === 'function'
        ? feeWalletData.getFeeWalletAddress()
        : feeWalletData.FEE_WALLET_ADDRESS;

    const proposalSigners = normalizeProposalSigners((match as any).proposalSigners);
    const hasFeeWalletSignature =
      !!feeWalletAddress &&
      proposalSigners.some(
        (signer) => signer && signer.toLowerCase() === feeWalletAddress.toLowerCase()
      );

    const playerSigners = proposalSigners.filter(
      (signer) =>
        signer &&
        (!feeWalletAddress || signer.toLowerCase() !== feeWalletAddress.toLowerCase())
    );

    if (!hasFeeWalletSignature || playerSigners.length === 0) {
      return false;
    }

    let feeWalletKeypair: any = null;
    try {
      feeWalletKeypair = feeWalletData.getFeeWalletKeypair();
    } catch (keypairError: any) {
      enhancedLogger.warn('⚠️ Fee wallet keypair unavailable, cannot auto-execute proposal right now', {
        matchId: match.id,
        proposalId: proposalIdString,
        context,
        error: keypairError?.message || String(keypairError),
      });
      return false;
    }

    const executeResult = await squadsVaultService.executeProposal(
      (match as any).squadsVaultAddress,
      proposalIdString,
      feeWalletKeypair,
      (match as any).squadsVaultPda ?? undefined
    );

    if (!executeResult.success) {
      const isVaultEmpty =
        executeResult.error === 'INSUFFICIENT_VAULT_BALANCE' ||
        executeResult.logs?.some((entry: string) =>
          entry?.toLowerCase?.().includes('vault balance is zero')
        );

      const logPayload = {
        matchId: match.id,
        proposalId: proposalIdString,
        context,
        error: executeResult.error,
        logs: executeResult.logs?.slice(-5),
      };

      if (isVaultEmpty) {
        enhancedLogger.warn('⚠️ Auto-execute deferred - vault has no funds yet', logPayload);
      } else {
        enhancedLogger.error('❌ Auto-execute attempt failed', logPayload);
      }
      return false;
    }

    const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
    const isTieRefund =
      !!(match as any).tieRefundProposalId &&
      String((match as any).tieRefundProposalId).trim() === proposalIdString;
    const isWinnerPayout =
      !!(match as any).payoutProposalId &&
      String((match as any).payoutProposalId).trim() === proposalIdString &&
      (match as any).winner &&
      (match as any).winner !== 'tie';

    const executionUpdates = buildProposalExecutionUpdates({
      executedAt,
      signature: executeResult.signature ?? null,
      isTieRefund,
      isWinnerPayout,
    });

    await persistExecutionUpdates(matchRepository, match.id, executionUpdates);
    applyExecutionUpdatesToMatch(match as any, executionUpdates);

    enhancedLogger.info('✅ Proposal auto-executed after readiness check', {
      matchId: match.id,
      proposalId: proposalIdString,
      context,
      playerSigners,
      executionSignature: executeResult.signature,
      slot: executeResult.slot,
    });

    if (isWinnerPayout) {
      try {
        if (!executeResult.signature) {
          enhancedLogger.warn('⚠️ Skipping bonus payout (auto-execute) because execution signature is missing', {
            matchId: match.id,
            proposalId: proposalIdString,
            context,
          });
        } else {
          const entryFeeSol = (match as any).entryFee ? Number((match as any).entryFee) : 0;
          const entryFeeUsd = (match as any).entryFeeUSD ? Number((match as any).entryFeeUSD) : undefined;
          const solPriceAtTransaction = (match as any).solPriceAtTransaction
            ? Number((match as any).solPriceAtTransaction)
            : undefined;
          const bonusAlreadyPaid = (match as any).bonusPaid === true;
          const bonusSignatureExisting = (match as any).bonusSignature || null;

          const bonusResult = await disburseBonusIfEligible({
            matchId: match.id,
            winner: (match as any).winner,
            entryFeeSol,
            entryFeeUsd,
            solPriceAtTransaction,
            alreadyPaid: bonusAlreadyPaid,
            existingSignature: bonusSignatureExisting,
            executionSignature: executeResult.signature,
            executionTimestamp: executedAt,
            executionSlot: executeResult.slot,
          });

          if (bonusResult.triggered && bonusResult.success && bonusResult.signature) {
            await matchRepository.query(`
              UPDATE "match"
              SET "bonusPaid" = true,
                  "bonusSignature" = $1,
                  "bonusAmount" = $2,
                  "bonusAmountUSD" = $3,
                  "bonusPercent" = $4,
                  "bonusTier" = $5,
                  "bonusPaidAt" = NOW(),
                  "solPriceAtTransaction" = COALESCE("solPriceAtTransaction", $6)
              WHERE id = $7
            `, [
              bonusResult.signature,
              bonusResult.bonusSol ?? null,
              bonusResult.bonusUsd ?? null,
              bonusResult.bonusPercent ?? null,
              bonusResult.tierId ?? null,
              bonusResult.solPriceUsed ?? null,
              match.id,
            ]);

            applyExecutionUpdatesToMatch(match as any, {
              bonusPaid: true,
              bonusSignature: bonusResult.signature,
              bonusAmount: bonusResult.bonusSol ?? null,
              bonusAmountUSD: bonusResult.bonusUsd ?? null,
              bonusPercent: bonusResult.bonusPercent ?? null,
              bonusTier: bonusResult.tierId ?? null,
              solPriceAtTransaction:
                bonusResult.solPriceUsed ?? (match as any).solPriceAtTransaction,
            });

            enhancedLogger.info('✅ Bonus payout executed after auto-execute', {
              matchId: match.id,
              proposalId: proposalIdString,
              context,
              bonusSignature: bonusResult.signature,
            });
          } else if (bonusResult.triggered && !bonusResult.success) {
            enhancedLogger.warn('⚠️ Bonus payout attempted but unsuccessful after auto-execute', {
              matchId: match.id,
              proposalId: proposalIdString,
              context,
              reason: bonusResult.reason,
            });
          }
        }
      } catch (bonusError: any) {
        enhancedLogger.error('❌ Error processing bonus payout after auto-execute', {
          matchId: match.id,
          proposalId: proposalIdString,
          context,
          error: bonusError?.message || String(bonusError),
        });
      }
    }

    return true;
  } catch (error: unknown) {
    enhancedLogger.error('❌ Auto-execute readiness check failed', {
      matchId: match?.id,
      context,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
};

// Memory limit check function using Redis
const checkMemoryLimits = async () => {
  try {
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    
    // Log warnings
    stats.warnings.forEach((warning: string) => {
      console.warn(`⚠️ ${warning}`);
    });

    return stats;
  } catch (error) {
    console.error('❌ Error checking memory limits:', error);
    return {
      activeGames: 0,
      matchmakingLocks: 0,
      inMemoryMatches: 0,
      warnings: []
    };
  }
};

// Simplified matchmaking without idempotency for now

// Enhanced cleanup function using Redis memory manager
const cleanupInactiveGames = async () => {
  try {
    const result = await redisMemoryManager.getInstance().cleanupInactiveGames();
    
    if (result.cleanedGames > 0 || result.cleanedLocks > 0) {
      console.log(`🧹 Memory cleanup completed:`, {
        games: result.cleanedGames,
        locks: result.cleanedLocks
      });
    }
    
    // Log current memory stats
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    console.log(`📊 Memory stats: ${stats.activeGames} active games, ${stats.matchmakingLocks} locks, ${stats.inMemoryMatches} in-memory matches`);
    
    // Log memory usage if high
    if (stats.activeGames > 100 || stats.matchmakingLocks > 50) {
      console.warn(`⚠️ High memory usage detected:`, stats);
    }
    
    return result;
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
    return { cleanedGames: 0, cleanedLocks: 0 };
  }
};

// Update game activity
const updateGameActivity = async (matchId: string) => {
  const gameState = await getGameState(matchId);
  if (gameState) {
    gameState.lastActivity = Date.now();
    await setGameState(matchId, gameState);
  }
};

// Mark game as completed and cleanup immediately
const markGameCompleted = async (matchId: string) => {
  const gameState = await getGameState(matchId);
  if (gameState) {
    gameState.completed = true;
    gameState.lastActivity = Date.now();
    console.log(`✅ Game ${matchId} marked as completed`);
    // IMMEDIATE CLEANUP: Remove from active games since match is confirmed over
    await deleteGameState(matchId);
    console.log(`🧹 Immediate cleanup: Removed completed game ${matchId} from Redis`);
  }
  
  // Also cleanup from database
  (async () => {
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      
      const match = await matchRepository.findOne({ where: { id: matchId } });
      if (match) {
        match.status = 'completed';
        await matchRepository.save(match);
        console.log(`✅ Marked match ${matchId} as completed in database`);
        
        // NOTE: We do NOT remove completed matches - they are kept for long-term storage and CSV downloads
      }
    } catch (error: unknown) {
      console.error(`❌ Error marking match ${matchId} as completed:`, error);
    }
  })();
};

// Periodic cleanup function with enhanced monitoring
const periodicCleanup = async () => {
  try {
    console.log('🧹 Running periodic cleanup...');
    const { AppDataSource } = require('../db/index');
    const { getFeeWalletKeypair, getFeeWalletAddress, FEE_WALLET_ADDRESS: CONFIG_FEE_WALLET } = require('../config/wallet');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up matches older than 10 minutes using raw SQL to avoid proposalExpiresAt column
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    
    const staleMatchRows = await matchRepository.query(`
      SELECT id
      FROM "match"
      WHERE (status = $1 OR status = $2) AND "createdAt" < $3
    `, ['waiting', 'escrow', tenMinutesAgo]);
    
    if (staleMatchRows && staleMatchRows.length > 0) {
      console.log(`🧹 Cleaning up ${staleMatchRows.length} stale matches`);
      for (const row of staleMatchRows) {
        await matchRepository.query(`DELETE FROM "match" WHERE id = $1`, [row.id]);
      }
      console.log(`✅ Cleaned up ${staleMatchRows.length} stale matches`);
    }
    
    // Process refunds for payment_required matches that are too old (5 minutes) using raw SQL
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const oldPaymentRequiredRows = await matchRepository.query(`
    SELECT id, "player1", "player2", "entryFee", "squadsVaultAddress", "squadsVaultPda", status
    FROM "match"
    WHERE status = $1 AND "updatedAt" < $2
  `, ['payment_required', fiveMinutesAgo]);
    
    if (oldPaymentRequiredRows && oldPaymentRequiredRows.length > 0) {
      console.log(`💰 Processing refunds for ${oldPaymentRequiredRows.length} old payment_required matches`);
      
      for (const matchRow of oldPaymentRequiredRows) {
        // Create a minimal match object for processAutomatedRefunds
        const match = {
          id: matchRow.id,
          player1: matchRow.player1,
          player2: matchRow.player2,
          entryFee: matchRow.entryFee,
          squadsVaultAddress: matchRow.squadsVaultAddress,
          status: matchRow.status
        };
        await processAutomatedRefunds(match, 'payment_timeout');
      }
      
      console.log(`✅ Processed refunds for ${oldPaymentRequiredRows.length} old payment_required matches`);
    }
    
    // NOTE: We do NOT clean up completed matches - they are kept for long-term storage and CSV downloads
    // Only clean up incomplete/stale matches that are blocking the system
    
    // Log memory statistics from Redis
    const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
    console.log('📊 Memory statistics:', stats);
    
    // Alert if memory usage is high
    if (stats.activeGames > 50) {
      console.warn(`⚠️ High active games count: ${stats.activeGames}`);
    }
    
    if (stats.matchmakingLocks > 20) {
      console.warn(`⚠️ High matchmaking locks count: ${stats.matchmakingLocks}`);
    }
    
    console.log('✅ Periodic cleanup completed');
    
  } catch (error: unknown) {
    console.error('❌ Error in periodic cleanup:', error);
  }
};

// Run periodic cleanup every 5 minutes
setInterval(periodicCleanup, 5 * 60 * 1000);

// API endpoint to clear Redis matchmaking data (for testing)
const clearMatchmakingDataHandler = async (req: any, res: any) => {
  try {
    console.log('🧹 Clearing Redis matchmaking data...');
    await redisMatchmakingService.clearAllMatchmakingData();
    res.json({ success: true, message: 'Redis matchmaking data cleared' });
  } catch (error: unknown) {
    console.error('❌ Error clearing matchmaking data:', error);
    res.status(500).json({ error: 'Failed to clear matchmaking data' });
  }
};

// Word list for games
const wordList = [
  'APPLE', 'BEACH', 'CHAIR', 'DREAM', 'EARTH', 'FLAME', 'GRAPE', 'HEART',
  'IMAGE', 'JUICE', 'KNIFE', 'LEMON', 'MUSIC', 'NIGHT', 'OCEAN', 'PEACE',
  'QUEEN', 'RADIO', 'SMILE', 'TABLE', 'UNITY', 'VOICE', 'WATER', 'YOUTH',
  'ZEBRA', 'ALPHA', 'BRAVE', 'CLOUD', 'DANCE', 'EAGLE', 'FAITH', 'GLORY',
  'HAPPY', 'IDEAL', 'JOYCE', 'KARMA', 'LIGHT', 'MAGIC', 'NOVEL', 'OPERA',
  'PRIDE', 'QUIET', 'RADAR', 'SPACE', 'TRUTH', 'UNITY', 'VALUE', 'WORLD'
];

const requestMatchHandler = async (req: any, res: any) => {
  const startTime = Date.now();
  try {
    console.log('📥 Received match request:', {
      body: req.body,
      headers: req.headers,
      method: req.method,
      url: req.url,
      timestamp: new Date().toISOString()
    });

    // Ensure database is initialized
    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in requestMatchHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }

    // Check memory limits before processing
    const memoryStats = await checkMemoryLimits();
    if (memoryStats.activeGames >= 1000) { // MAX_ACTIVE_GAMES constant
      console.warn('🚨 Server at capacity - rejecting match request');
      return res.status(503).json({ error: 'Server at capacity, please try again later' });
    }

    const wallet = req.body.wallet;
    const entryFee = Number(req.body.entryFee);
    

    
    if (!wallet || !entryFee) {
      console.log('❌ Missing required fields:', { wallet: !!wallet, entryFee: !!entryFee });
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (isNaN(entryFee) || entryFee <= 0) {
      console.log('❌ Invalid entry fee:', { entryFee, isNaN: isNaN(entryFee) });
      return res.status(400).json({ error: 'Invalid entry fee' });
    }

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      console.log('❌ Invalid wallet address format:', wallet);
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Validate entry fee is reasonable (between 0.001 and 100 SOL)
    if (entryFee < 0.001 || entryFee > 100) {
      console.log('❌ Entry fee out of reasonable range:', entryFee);
      return res.status(400).json({ error: 'Entry fee must be between 0.001 and 100 SOL' });
    }



    // CRITICAL: Implement locking to prevent race conditions
    const lockKey = `matchmaking_${wallet}`;
    if ((await getMatchmakingLock(lockKey)) !== null) {
      console.log('⏳ Player already in matchmaking, returning existing lock');
      return res.status(429).json({ error: 'Matchmaking in progress, please wait' });
    }

    // Create lock for this player with enhanced tracking
    const matchmakingPromise = (async () => {
      try {
        return await performMatchmaking(wallet, entryFee);
      } finally {
        // Always clean up the lock
        await deleteMatchmakingLock(lockKey);
      }
    })();

    await setMatchmakingLock(lockKey, {
      promise: matchmakingPromise,
      timestamp: Date.now(),
      wallet: wallet,
      entryFee: entryFee
    });
    
    const result = await matchmakingPromise;
    const duration = Date.now() - startTime;
    console.log(`✅ Matchmaking completed for ${wallet} in ${duration}ms:`, result);
    res.json(result);
    
  } catch (error: unknown) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Error in requestMatchHandler after', duration, 'ms:', error);
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      name: errorName,
      wallet: req.body?.wallet,
      entryFee: req.body?.entryFee,
      timestamp: new Date().toISOString()
    });
    
    // Clean up any locks that might have been created
    if (req.body.wallet) {
      const lockKey = `matchmaking_${req.body.wallet}`;
      if ((await getMatchmakingLock(lockKey)) !== null) {
        await deleteMatchmakingLock(lockKey);
      }
    }
    
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Separate function for the actual matchmaking logic
const performMatchmaking = async (wallet: string, entryFee: number) => {
  try {
    console.log(`🔒 REDIS ATOMIC: Starting matchmaking for wallet: ${wallet} with entry fee: ${entryFee}`);
    
    // Get database repository for cleanup and validation
    const { AppDataSource } = require('../db/index');
    const { getFeeWalletKeypair, getFeeWalletAddress, FEE_WALLET_ADDRESS: CONFIG_FEE_WALLET } = require('../config/wallet');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up old matches for this player
    await cleanupOldMatches(matchRepository, wallet);
    
    // Check for existing active matches
    const existingMatch = await checkExistingMatches(matchRepository, wallet);
    if (existingMatch) {
      return existingMatch;
    }
    
    // REDIS ATOMIC MATCHMAKING: Use Redis service for high-scale operations

    const redisResult = await redisMatchmakingService.addPlayerToQueue(wallet, entryFee);
    
    if (redisResult.status === 'matched' && redisResult.matchId) {
  
      
      // Get match data from Redis
      const matchData = await redisMatchmakingService.getMatch(redisResult.matchId);
      if (!matchData) {
        throw new Error('Match data not found in Redis after creation');
      }
      
      // Create database record for the match FIRST using raw SQL to avoid column issues
      // This ensures both players can find the match immediately via checkPlayerMatch
      const word = getRandomWord();
      const now = new Date();
      const createdAt = new Date(matchData.createdAt);
      
      await matchRepository.query(`
        INSERT INTO "match" (
          id, "player1", "player2", "entryFee", status, "matchStatus", word,
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
      `, [
        matchData.matchId,
        matchData.player1,
        matchData.player2,
        matchData.entryFee,
        'payment_required',
        'PENDING',
        word,
        createdAt,
        now
      ]);
      
      // Verify the match was saved by reloading it using raw SQL
      const savedMatchRows = await matchRepository.query(`
        SELECT 
          id, "player1", "player2", "entryFee", status, "matchStatus", word,
          "squadsVaultAddress", "createdAt", "updatedAt"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [matchData.matchId]);
      
      if (!savedMatchRows || savedMatchRows.length === 0) {
        throw new Error('Failed to save match to database');
      }
      
      // Convert raw row to Match entity
      const savedMatchRow = savedMatchRows[0];
      const savedMatch = new Match();
      Object.assign(savedMatch, savedMatchRow);
      
      console.log(`✅ Database record created and verified for Redis match: ${matchData.matchId}`, {
        matchId: savedMatch.id,
        player1: savedMatch.player1,
        player2: savedMatch.player2,
        status: savedMatch.status
      });
      
      // Create Squads vault for fund custody AFTER database record is confirmed
      console.log('🔧 Creating Squads vault for fund custody...', {
        matchId: matchData.matchId,
        player1: matchData.player1,
        player2: matchData.player2,
        entryFee: matchData.entryFee
      });
      
      let vaultResult;
      try {
        const player1Pubkey = new PublicKey(matchData.player1);
        const player2Pubkey = new PublicKey(matchData.player2);
        console.log('🔧 Creating vault with PublicKeys:', {
          player1: player1Pubkey.toString(),
          player2: player2Pubkey.toString()
        });
        // Create vault (with built-in retry logic in the service)
        vaultResult = await squadsVaultService.createMatchVault(
          matchData.matchId,
          player1Pubkey,
          player2Pubkey,
          matchData.entryFee
        );
        console.log('🔧 Vault creation result:', { success: vaultResult?.success, error: vaultResult?.error });
      } catch (vaultError: unknown) {
        const vaultErrorMessage = vaultError instanceof Error ? vaultError.message : String(vaultError);
        console.error('❌ Exception during vault creation:', vaultErrorMessage);
        console.error('❌ Vault creation stack:', vaultError instanceof Error ? vaultError.stack : 'No stack');
        // Don't throw - return match without vault, on-demand creation will handle it
        console.warn('⚠️ Vault creation failed, but match is saved - on-demand creation will handle it');
        await matchRepository.query(`
          UPDATE "match" 
          SET "matchStatus" = $1, "updatedAt" = $2
          WHERE id = $3
        `, ['VAULT_PENDING', new Date(), matchData.matchId]);
        
        return {
          status: 'matched',
          matchId: matchData.matchId,
          player1: matchData.player1,
          player2: matchData.player2,
          entryFee: matchData.entryFee,
          squadsVaultAddress: null,
        squadsVaultPda: null,
          vaultAddress: null,
          message: 'Match created - vault creation in progress, please wait'
        };
      }
      
      if (!vaultResult || !vaultResult.success) {
        console.error('❌ Failed to create multisig vault:', vaultResult?.error || 'Unknown error');
        // Don't throw - return match without vault, on-demand creation will handle it
        console.warn('⚠️ Returning match without vault - on-demand creation will handle it');
        await matchRepository.query(`
          UPDATE "match" 
          SET "matchStatus" = $1, "updatedAt" = $2
          WHERE id = $3
        `, ['VAULT_PENDING', new Date(), matchData.matchId]);
        
        return {
          status: 'matched',
          matchId: matchData.matchId,
          player1: matchData.player1,
          player2: matchData.player2,
          entryFee: matchData.entryFee,
          squadsVaultAddress: null,
        squadsVaultPda: null,
          vaultAddress: null,
          message: 'Match created - vault creation in progress, please wait'
        };
      }
      
      console.log('✅ Multisig vault created:', {
        squadsVaultAddress: vaultResult.vaultAddress,
        vaultPda: vaultResult.vaultPda
      });

      // Update match with vault addresses using raw SQL
      await matchRepository.query(`
        UPDATE "match" 
        SET "squadsVaultAddress" = $1,
            "squadsVaultPda" = $2,
            "matchStatus" = $3,
            "updatedAt" = $4
        WHERE id = $5
      `, [
        vaultResult.vaultAddress,
        vaultResult.vaultPda ?? null,
        'VAULT_CREATED',
        new Date(),
        matchData.matchId
      ]);
      
      console.log(`✅ Match ${matchData.matchId} fully created with vault - both players can now find it`);
      
      return {
        status: 'matched',
        matchId: matchData.matchId,
        player1: matchData.player1,
        player2: matchData.player2,
        entryFee: matchData.entryFee,
        squadsVaultAddress: vaultResult.vaultAddress,
        vaultAddress: vaultResult.vaultAddress,
        squadsVaultPda: vaultResult.vaultPda ?? null,
        message: 'Match created - both players must pay entry fee to start game'
      };
    } else if (redisResult.status === 'waiting') {
      console.log(`⏳ REDIS: Player added to waiting queue: ${wallet}`);
      
      // Don't create database record for waiting players - let Redis handle everything
      // This prevents the synchronization issue between database and Redis
      console.log(`✅ Player ${wallet} is waiting in Redis queue (${redisResult.waitingCount || 1} waiting)`);
      
      return {
        status: 'waiting',
        waitingCount: redisResult.waitingCount || 1,
        message: 'Waiting for opponent to join'
      };
    } else {
      throw new Error(`Unexpected Redis matchmaking result: ${redisResult.status}`);
    }
    
  } catch (error: unknown) {
    console.error('❌ Error in performMatchmaking:', error);
    // Clean up any locks that might have been created
    const lockKey = `matchmaking_${wallet}`;
    if ((await getMatchmakingLock(lockKey)) !== null) {
      await deleteMatchmakingLock(lockKey);
    }
    throw error;
  }
};
// Helper function to cleanup old matches for a player
const cleanupOldMatches = async (matchRepository: any, wallet: string) => {
  
  
  // Use raw SQL to avoid TypeORM column issues - only select existing columns
  // Don't cleanup matches created in the last 30 seconds to avoid race conditions
  // Also, don't cleanup payment_required, escrow, or active matches (these are in progress)
  const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);
  const oldPlayerMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "player1Paid",
      "player2Paid"
    FROM "match" 
    WHERE (("player1" = $1 AND "status" NOT IN ($2, $3, $4, $5)) OR ("player2" = $6 AND "status" NOT IN ($7, $8, $9, $10)))
      AND "createdAt" < $11
  `, [wallet, 'escrow', 'completed', 'active', 'payment_required', 
      wallet, 'escrow', 'completed', 'active', 'payment_required', 
      thirtySecondsAgo]);
  
  if (oldPlayerMatches.length > 0) {

    
    // Process refunds for any matches where players paid but match failed
    for (const match of oldPlayerMatches) {
      if ((match.player1Paid || match.player2Paid) && match.status !== 'completed') {
        await processAutomatedRefunds(match, 'cleanup');
      }
    }
    
    // Remove old matches using raw SQL - EXCLUDE completed, active, escrow, and payment_required matches
        await matchRepository.query(`
      DELETE FROM "match" 
      WHERE (("player1" = $1 AND "status" NOT IN ($2, $3, $4, $5)) OR ("player2" = $6 AND "status" NOT IN ($7, $8, $9, $10)))
        AND "createdAt" < $11
    `, [wallet, 'escrow', 'completed', 'active', 'payment_required', 
        wallet, 'escrow', 'completed', 'active', 'payment_required', 
        thirtySecondsAgo]);
  }
  
  // Also cleanup any stale waiting entries older than 5 minutes
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  const staleWaitingMatches = await matchRepository.query(`
    SELECT id FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['waiting', fiveMinutesAgo]);
  
  if (staleWaitingMatches.length > 0) {
    await matchRepository.query(`
      DELETE FROM "match" 
      WHERE "status" = $1 AND "createdAt" < $2
    `, ['waiting', fiveMinutesAgo]);
  }
  
  // Clean up stale payment_required matches (e.g., stuck in deposit screen for too long)
  // After 3 minutes, refund any deposits and cancel the match
  const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
  const stalePaymentMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "player1Paid",
      "player2Paid",
      "squadsVaultAddress"
    FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['payment_required', threeMinutesAgo]);
  
  if (stalePaymentMatches.length > 0) {
    console.log(`⏰ Found ${stalePaymentMatches.length} stale payment_required matches for ${wallet}, processing refunds...`);
    for (const match of stalePaymentMatches) {
      // Process refunds if players have deposited
      if ((match.player1Paid || match.player2Paid) || match.squadsVaultAddress) {
        console.log(`💰 Processing refund for stale match ${match.id} (players may have deposited)`);
        await processAutomatedRefunds(match, 'payment_timeout');
      }
      
      // Delete the stale match
      await matchRepository.query(`
        DELETE FROM "match" WHERE id = $1
      `, [match.id]);
      console.log(`✅ Cleaned up stale payment_required match ${match.id}`);
    }
  }
  
  // Clean up stale active matches (e.g., game started but player left)
  // After 10 minutes, cancel and refund
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
  const staleActiveMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "squadsVaultAddress"
    FROM "match" 
    WHERE "status" = $1 AND "createdAt" < $2
  `, ['active', tenMinutesAgo]);
  
  if (staleActiveMatches.length > 0) {
    console.log(`⏰ Found ${staleActiveMatches.length} stale active matches for ${wallet}, processing refunds...`);
    for (const match of staleActiveMatches) {
      if (match.squadsVaultAddress) {
        console.log(`💰 Processing refund for stale active match ${match.id}`);
        await processAutomatedRefunds(match, 'game_abandoned');
      }
      
      await matchRepository.query(`
        DELETE FROM "match" WHERE id = $1
      `, [match.id]);
      console.log(`✅ Cleaned up stale active match ${match.id}`);
    }
  }
  
  // CRITICAL: We do NOT clean up completed matches - they are kept for long-term storage and CSV downloads
  // Only clean up incomplete/stale matches that are blocking the system
  // Completed matches (status = 'completed') are NEVER deleted by cleanup functions
};

// Helper function to check for existing matches and cleanup if needed
const checkExistingMatches = async (matchRepository: any, wallet: string) => {
  // First, cleanup any old matches for this player
  await cleanupOldMatches(matchRepository, wallet);
  
  // Now check if there are any remaining active matches using raw SQL
  // Include payment_required, active, and escrow as existing matches
  const existingMatches = await matchRepository.query(`
    SELECT 
      id,
      "player1",
      "player2",
      "entryFee",
      status,
      "squadsVaultAddress",
      "squadsVaultPda"
    FROM "match" 
    WHERE (("player1" = $1 AND "status" IN ($2, $3, $4)) OR ("player2" = $5 AND "status" IN ($6, $7, $8)))
    LIMIT 1
  `, [wallet, 'active', 'escrow', 'payment_required', wallet, 'active', 'escrow', 'payment_required']);
  
  if (existingMatches.length > 0) {
    const existingMatch = existingMatches[0];
    console.log('⚠️ Player still has an active/escrow match after cleanup');
    return {
      status: existingMatch.squadsVaultAddress ? 'matched' : 'vault_pending',
      matchId: existingMatch.id,
      player1: existingMatch.player1,
      player2: existingMatch.player2,
      entryFee: existingMatch.entryFee,
      squadsVaultAddress: existingMatch.squadsVaultAddress || null,
      squadsVaultPda: existingMatch.squadsVaultPda || null,
      vaultAddress: existingMatch.squadsVaultAddress || null,
      matchStatus: existingMatch.status,
      message: existingMatch.status === 'escrow' ? 'Match created - please lock your entry fee' : 'Already in active match'
    };
  }
  
  return null;
};

// Helper function to find waiting players with simplified logic
const findWaitingPlayer = async (matchRepository: any, wallet: string, entryFee: number) => {
  const tolerance = 0.01; // Increased tolerance to 0.01 SOL for better matching
  const minEntryFee = entryFee - tolerance;
  const maxEntryFee = entryFee + tolerance;
  
  try {

    
    // First try exact match using raw SQL
    let waitingMatches = await matchRepository.query(`
      SELECT 
        id,
        "player1",
        "entryFee"
      FROM "match" 
      WHERE "status" = $1 
        AND "entryFee" BETWEEN $2 AND $3 
        AND "player2" IS NULL 
        AND "player1" != $4
      ORDER BY "createdAt" ASC 
      LIMIT 1
    `, ['waiting', minEntryFee, maxEntryFee, wallet]);
    
    console.log(`  Found ${waitingMatches.length} waiting matches with exact tolerance`);
    
    // If no exact match, try flexible matching (within 3% tolerance for better matching)
    if (waitingMatches.length === 0) {
      const flexibleMinEntryFee = entryFee * 0.97;
      const flexibleMaxEntryFee = entryFee * 1.03;
      
  
      console.log(`  Range: ${flexibleMinEntryFee} - ${flexibleMaxEntryFee} SOL`);
      
      waitingMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "entryFee"
        FROM "match" 
        WHERE "status" = $1 
          AND "entryFee" BETWEEN $2 AND $3 
          AND "player2" IS NULL 
          AND "player1" != $4
        ORDER BY "createdAt" ASC 
        LIMIT 1
      `, ['waiting', flexibleMinEntryFee, flexibleMaxEntryFee, wallet]);
      
      console.log(`  Found ${waitingMatches.length} waiting matches with flexible tolerance`);
    }
    
    // If still no match, try any waiting player (for testing)
    if (waitingMatches.length === 0) {
  
      
      waitingMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "entryFee"
        FROM "match" 
        WHERE "status" = $1 
          AND "player2" IS NULL 
          AND "player1" != $2
        ORDER BY "createdAt" ASC 
        LIMIT 1
      `, ['waiting', wallet]);
      
      console.log(`  Found ${waitingMatches.length} any waiting players`);
    }
    
    if (waitingMatches.length > 0) {
      const waitingEntry = waitingMatches[0];
      
  
      
      // Create a NEW match record (not update the waiting entry)
      const actualEntryFee = Math.min(waitingEntry.entryFee, entryFee);
      
      // Generate game word
      const gameWord = getRandomWord();
      
      // Create new match record
      const newMatchResult = await matchRepository.query(`
        INSERT INTO "match" (
          "player1", "player2", "entryFee", "status", "word", 
          "player1Paid", "player2Paid", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING id, "player1", "player2", "entryFee", "status"
      `, [
        waitingEntry.player1, wallet, actualEntryFee, 'payment_required', gameWord,
        false, false, new Date(), new Date()
      ]);
      
      const newMatch = newMatchResult[0];
      
      // Delete the waiting entry since we've created a match
      await matchRepository.query(`
        DELETE FROM "match" 
        WHERE id = $1
      `, [waitingEntry.id]);
      
      console.log(`✅ Successfully created match ${newMatch.id} between ${waitingEntry.player1} and ${wallet}`);
      
      return {
        wallet: waitingEntry.player1,
        entryFee: actualEntryFee,
        matchId: newMatch.id
      };
    }
    
    console.log(`❌ No waiting players found for ${wallet} with entry fee ${entryFee}`);
    return null;
    
  } catch (error: unknown) {
    console.error('❌ Error in findWaitingPlayer:', error);
    throw error;
  }
};

// REDIS ATOMIC MATCHMAKING: This function has been replaced with Redis-based matchmaking
// The findAndClaimWaitingPlayer function is no longer needed as we use redisMatchmakingService

// Helper function to create a match (now handled in findWaitingPlayer)
const createMatch = async (matchRepository: any, waitingPlayer: any, wallet: string, entryFee: number) => {
  try {
    console.log('🎮 Match already created in findWaitingPlayer, returning details:', {
      player1: waitingPlayer.wallet,
      player2: wallet,
      entryFee: waitingPlayer.entryFee,
      matchId: waitingPlayer.matchId
    });
    
    return {
    status: 'vault_pending',
      matchId: waitingPlayer.matchId,
      player1: waitingPlayer.wallet,
      player2: wallet,
      entryFee: waitingPlayer.entryFee,
    squadsVaultAddress: null,
    vaultAddress: null,
      message: 'Match created - both players must pay entry fee to start game'
    };
  } catch (error: unknown) {
    console.error('❌ Error in createMatch:', error);
    throw error;
  }
};

// REDIS ATOMIC MATCHMAKING: This function has been replaced with Redis-based matchmaking
// The createWaitingEntry function is no longer needed as we use redisMatchmakingService

// Debug endpoint to check waiting players
const debugWaitingPlayersHandler = async (req: any, res: any) => {
  try {

    
    let dbWaitingMatches = [];
    let dbActiveMatches = [];
    
    // Try database first
    try {
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      
      // Get all waiting matches from database
      dbWaitingMatches = await matchRepository.find({
        where: { status: 'waiting' },
        order: { createdAt: 'ASC' }
      });
      
      // Get all active matches from database
      dbActiveMatches = await matchRepository.find({
        where: { status: 'active' },
        order: { createdAt: 'ASC' }
      });
      
      console.log('✅ Database queries successful');
    } catch (dbError: unknown) {
      const errorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn('⚠️ Database queries failed:', errorMessage);
    }
    
    // Get Redis-based matches
    const memoryActiveMatches = [];
    
    // Check active games in Redis
    const { getAllGameStates } = require('../utils/redisGameState');
    const redisGameStates = await getAllGameStates();
    for (const [matchId, gameState] of redisGameStates) {
      memoryActiveMatches.push({
        id: matchId,
        player1: 'active_game',
        player2: 'active_game',
        entryFee: 0,
        status: 'active',
        source: 'redis'
      });
    }
    
    const totalWaiting = dbWaitingMatches.length;
        const totalActive = dbActiveMatches.length + memoryActiveMatches.length;
    
    console.log('Debug results:', {
      database: { waiting: dbWaitingMatches.length, active: dbActiveMatches.length },
      memory: { waiting: 0, active: memoryActiveMatches.length },
      total: { waiting: totalWaiting, active: totalActive }
    });
    
    res.json({
      database: {
        waitingCount: dbWaitingMatches.length,
        activeCount: dbActiveMatches.length,
        waitingPlayers: dbWaitingMatches.map((m: any) => ({
          id: m.id,
          player1: m.player1,
          entryFee: m.entryFee,
          createdAt: m.createdAt,
          source: 'database'
        })),
        activeMatches: dbActiveMatches.map((m: any) => ({
          id: m.id,
          player1: m.player1,
          player2: m.player2,
          entryFee: m.entryFee,
          status: m.status,
          source: 'database'
        }))
      },
      memory: {
        waitingCount: 0,
        activeCount: memoryActiveMatches.length,
        waitingPlayers: [],
        activeMatches: memoryActiveMatches
      },
      total: {
        waiting: totalWaiting,
        active: totalActive
      }
    });
  } catch (error: unknown) {
    console.error('❌ Error in debugWaitingPlayersHandler:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Simple test endpoint
const matchTestHandler = async (req: any, res: any) => {
  try {
    console.log('🧪 Test endpoint called');
    res.json({ 
      status: 'ok', 
      message: 'Test endpoint working',
      timestamp: new Date().toISOString()
    });
  } catch (error: unknown) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: 'Test endpoint failed' });
  }
};

// Simple test endpoint for repository debugging
const testRepositoryHandler = async (req: any, res: any) => {
  try {
    console.log('🧪 Testing repository creation...');
    
    // Test 1: Check if Match entity is available
    console.log('🔍 Match entity available:', !!Match);
    
    // Test 2: Check if AppDataSource is available
    const { AppDataSource } = require('../db/index');
    console.log('🔍 AppDataSource available:', !!AppDataSource);
    console.log('🔍 AppDataSource initialized:', AppDataSource.isInitialized);
    
    // Test 3: Try to get repository using AppDataSource
    try {
      const testRepo = AppDataSource.getRepository(Match);
      console.log('✅ Repository created successfully');
      res.json({ 
        status: 'ok', 
        message: 'Repository test successful',
        matchEntity: !!Match,
        appDataSource: !!AppDataSource,
        appDataSourceInitialized: AppDataSource.isInitialized,
        repository: !!testRepo
      });
    } catch (repoError: unknown) {
      const errorMessage = repoError instanceof Error ? repoError.message : String(repoError);
      const errorName = repoError instanceof Error ? repoError.name : undefined;
      const errorStack = repoError instanceof Error ? repoError.stack : undefined;
      console.error('❌ Repository creation failed:', repoError);
      res.status(500).json({ 
        error: 'Repository creation failed',
        details: {
          message: errorMessage,
          name: errorName,
          stack: errorStack
        }
      });
    }
  } catch (error: unknown) {
    console.error('❌ Test endpoint error:', error);
    res.status(500).json({ error: 'Test endpoint failed' });
  }
};

// Simple database test endpoint
const testDatabaseHandler = async (req: any, res: any) => {
  try {
    console.log('🧪 Testing basic database operations...');
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Test 1: Simple count query
    console.log('🔍 Testing count query...');
    const count = await matchRepository.count();
    console.log('✅ Count query successful:', count);
    
    // Test 2: Simple find query
    console.log('🔍 Testing find query...');
    const allMatches = await matchRepository.find({ take: 5 });
    console.log('✅ Find query successful, found:', allMatches.length, 'matches');
    
    // Test 3: Test with specific entry fee
    console.log('🔍 Testing find with entry fee...');
    const testEntryFee = 0.104;
    const matchesWithFee = await matchRepository.find({
      where: { entryFee: testEntryFee },
      take: 1
    });
    console.log('✅ Entry fee query successful, found:', matchesWithFee.length, 'matches');
    
    res.json({
      status: 'ok',
      message: 'Database operations successful',
      totalMatches: count,
      sampleMatches: allMatches.length,
      entryFeeMatches: matchesWithFee.length
    });
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Database test failed:', error);
    res.status(500).json({ 
      error: 'Database test failed',
      details: {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined
      }
    });
  }
};

// Cleanup self-matches endpoint
const cleanupSelfMatchesHandler = async (req: any, res: any) => {
  try {
    console.log('🧹 Cleaning up self-matches...');
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find all active matches
    const activeMatches = await matchRepository.find({
      where: {
        status: 'active',
        player1: Not(null),
        player2: Not(null)
      }
    });
    
    // Filter self-matches
    const selfMatches = activeMatches.filter((match: any) => match.player1 === match.player2);
    
    if (selfMatches.length > 0) {
      console.log(`🧹 Found ${selfMatches.length} self-matches to clean up:`, selfMatches.map((m: any) => m.id));
      await matchRepository.remove(selfMatches);
      console.log('✅ Self-matches cleaned up successfully');
    } else {
      console.log('✅ No self-matches found');
    }
    
    res.json({
      success: true,
      message: 'Self-matches cleaned up',
      removedCount: selfMatches.length,
      removedMatches: selfMatches.map((m: any) => ({ id: m.id, player1: m.player1, player2: m.player2 }))
    });
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Cleanup failed:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
};
// Helper function to determine winner and calculate payout instructions
// Accepts optional transaction manager for atomic operations
const determineWinnerAndPayout = async (matchId: any, player1Result: any, player2Result: any, manager?: any) => {
  const { AppDataSource } = require('../db/index');
  
  // Use row-level locking if in transaction (FOR UPDATE prevents concurrent modifications)
  // Use raw SQL to avoid querying non-existent proposalExpiresAt column
  let match: any;
  if (manager) {
    // Use raw SQL with FOR UPDATE lock in transaction
    const matchRows = await manager.query(`
      SELECT id, "player1", "player2", "entryFee", "squadsVaultAddress", "squadsVaultPda",
             "payoutProposalId", "tieRefundProposalId", "proposalStatus", 
             "proposalSigners", "needsSignatures", "proposalExecutedAt", 
             "proposalTransactionId", "player1Result", "player2Result", 
             winner, "isCompleted", "matchStatus"
      FROM "match"
      WHERE id = $1
      FOR UPDATE
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      throw new Error('Match not found');
    }
    match = matchRows[0];
  } else {
  const matchRepository = AppDataSource.getRepository(Match);
    // Use raw SQL to avoid querying non-existent proposalExpiresAt column
    const matchRows = await matchRepository.query(`
      SELECT id, "player1", "player2", "entryFee", "squadsVaultAddress", "squadsVaultPda",
             "payoutProposalId", "tieRefundProposalId", "proposalStatus", 
             "proposalSigners", "needsSignatures", "proposalExecutedAt", 
             "proposalTransactionId", "player1Result", "player2Result", 
             winner, "isCompleted", "matchStatus"
      FROM "match"
      WHERE id = $1
    `, [matchId]);
  
    if (!matchRows || matchRows.length === 0) {
    throw new Error('Match not found');
    }
    match = matchRows[0];
  }

  console.log('🏆 Determining winner for match:', matchId);
  console.log('Player 1 result:', player1Result);
  console.log('Player 2 result:', player2Result);

  let winner = null;
  let payoutResult = null;

  // Winner determination logic:
  // 1. Did you solve the puzzle? (Yes/No)
  // 2. If both solved → Fewest moves wins
  // 3. If same moves → Tie breaker by time (faster wins)
  // 4. If only one solved → That player wins
  // 5. If neither solved → Both lose (tie)
  
  if (player1Result && player2Result) {
    // Both players submitted results
    if (player1Result.won && !player2Result.won) {
      // Player 1 solved, Player 2 didn't
      winner = match.player1;
      console.log('🏆 Player 1 wins - only one solved');
    } else if (player2Result.won && !player1Result.won) {
      // Player 2 solved, Player 1 didn't
      winner = match.player2;
      console.log('🏆 Player 2 wins - only one solved');
    } else if (player1Result.won && player2Result.won) {
      // Both solved - fewest moves wins
      console.log('🏆 Both solved - comparing moves:', {
        player1Moves: player1Result.numGuesses,
        player2Moves: player2Result.numGuesses
      });
      
      if (player1Result.numGuesses < player2Result.numGuesses) {
        // Player 1 wins with fewer moves
        winner = match.player1;
        console.log('🏆 Player 1 wins with fewer moves');
      } else if (player2Result.numGuesses < player1Result.numGuesses) {
        // Player 2 wins with fewer moves
        winner = match.player2;
        console.log('🏆 Player 2 wins with fewer moves');
      } else {
        // Same number of moves - tie breaker by time
        console.log('⚖️ Same moves - tie breaker by time:', {
          player1Time: player1Result.totalTime,
          player2Time: player2Result.totalTime
        });
        
        const timeDiff = Math.abs(player1Result.totalTime - player2Result.totalTime);
        const tolerance = 0.001; // 1 millisecond tolerance for "exact" ties (smallest reasonable unit for web app)
        
        if (timeDiff < tolerance) {
          // Winning tie: Both solved with same moves AND same time (within 1ms tolerance)
          winner = 'tie';
          console.log('🤝 Winning tie: Both solved with same moves AND same time (within 1ms tolerance)');
        } else if (player1Result.totalTime < player2Result.totalTime) {
          winner = match.player1;
          console.log('🏆 Player 1 wins by time');
        } else {
          winner = match.player2;
          console.log('🏆 Player 2 wins by time');
        }
      }
    } else {
      // Both didn't solve - both lose
      winner = 'tie';
      console.log('⚖️ Both players failed to solve');
    }
  } else if (player1Result && !player2Result) {
    // Only player 1 submitted result
    if (player1Result.won) {
      // Player 1 solved, Player 2 didn't (disconnected or lost)
      winner = match.player1;
      console.log('🏆 Player 1 wins - opponent disconnected');
    } else {
      // Player 1 didn't solve, Player 2 didn't solve - both lose
      winner = 'tie';
      console.log('⚖️ Both players failed to solve');
    }
  } else if (player2Result && !player1Result) {
    // Only player 2 submitted result
    if (player2Result.won) {
      // Player 2 solved, Player 1 didn't (disconnected or lost)
      winner = match.player2;
      console.log('🏆 Player 2 wins - opponent disconnected');
    } else {
      // Player 2 didn't solve, Player 1 didn't solve - both lose
      winner = 'tie';
      console.log('⚖️ Both players failed to solve');
    }
  } else {
    // No results submitted - both lose
    winner = 'tie';
    console.log('⚖️ No results submitted');
  }

  console.log('🏆 Winner determined:', winner);

  // Calculate payout instructions
  if (winner && winner !== 'tie') {
    const winnerWallet = winner;
    const loserWallet = winner === match.player1 ? match.player2 : match.player1;
    const entryFee = match.entryFee;
    const totalPot = entryFee * 2; // Total pot is both players' entry fees
    const winnerAmount = totalPot * 0.95; // 95% of total pot to winner
    const feeAmount = totalPot * 0.05; // 5% fee from total pot

    // Use multisig vault for payout
    payoutResult = {
      winner: winnerWallet,
      winnerAmount: winnerAmount,
      feeAmount: feeAmount,
      feeWallet: FEE_WALLET_ADDRESS,
      smartContract: false, // Using multisig vault instead
      transactions: [
        {
          from: 'Multisig Vault',
          to: winnerWallet,
          amount: winnerAmount,
          description: 'Winner payout (95% of total pot) from vault'
        }
      ]
    };

    console.log('💰 Payout calculated:', payoutResult);
  } else if (winner === 'tie') {
    // Determine if this is a winning tie (both solved with same moves AND same time) or losing tie (both failed)
    const isWinningTie = player1Result && player2Result && 
                        player1Result.won && player2Result.won && 
                        player1Result.numGuesses === player2Result.numGuesses &&
                        Math.abs(player1Result.totalTime - player2Result.totalTime) < 0.001;
    
    if (isWinningTie) {
      // Winning tie: Both solved with same moves AND same time (within 1ms tolerance) - FULL REFUND to both players
      console.log('🤝 Winning tie: Both solved with same moves AND same time (within 1ms tolerance) - FULL REFUND to both players');
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: 0,
        refundAmount: match.entryFee, // Full refund for winning tie
        isWinningTie: true, // Flag to indicate this is a winning tie
        feeWallet: FEE_WALLET_ADDRESS,
        transactions: [
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player1,
            amount: match.entryFee,
            description: 'Winning tie refund (player 1)'
          },
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player2,
            amount: match.entryFee,
            description: 'Winning tie refund (player 2)'
          }
        ]
      };
    } else {
      // Losing tie: Both failed to solve - 5% fee kept, 95% refunded to both players
      console.log('🤝 Losing tie: Both failed to solve - 5% fee kept, 95% refunded to both players');
      const feeAmount = match.entryFee * 0.05;
      const refundAmount = match.entryFee * 0.95; // 95% refund to each player
      
      payoutResult = {
        winner: 'tie',
        winnerAmount: 0,
        feeAmount: feeAmount * 2, // Total fees from both players
        refundAmount: refundAmount, // 95% refund amount for each player
        isWinningTie: false, // Flag to indicate this is a losing tie
        feeWallet: FEE_WALLET_ADDRESS,
        transactions: [
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player1,
            amount: refundAmount,
            description: 'Losing tie refund (player 1)'
          },
          {
            from: FEE_WALLET_ADDRESS,
            to: match.player2,
            amount: refundAmount,
            description: 'Losing tie refund (player 2)'
          }
        ]
      };
    }

    console.log('🤝 Tie payout calculated:', payoutResult);
  }

  // Update match with winner and payout using raw SQL
  // Parse existing results from JSON strings
  const player1ResultRaw = match.player1Result;
  const player2ResultRaw = match.player2Result;
  const existingPlayer1Result = player1ResultRaw ? (typeof player1ResultRaw === 'string' ? JSON.parse(player1ResultRaw) : player1ResultRaw) : null;
  const existingPlayer2Result = player2ResultRaw ? (typeof player2ResultRaw === 'string' ? JSON.parse(player2ResultRaw) : player2ResultRaw) : null;
  
  console.log('💾 Saving match with winner:', {
    matchId: match.id,
    winner: winner,
    isCompleted: true,
    player1Result: existingPlayer1Result,
    player2Result: existingPlayer2Result
  });
  
  // Use raw SQL to update match (avoids proposalExpiresAt column issue)
  const payoutResultJson = JSON.stringify(payoutResult);
  if (manager) {
    await manager.query(`
      UPDATE "match"
      SET winner = $1, 
          "payoutResult" = $2,
          "isCompleted" = $3,
          status = $4,
          "updatedAt" = $5
      WHERE id = $6
    `, [winner, payoutResultJson, true, 'completed', new Date(), matchId]);
  } else {
    const matchRepository = AppDataSource.getRepository(Match);
    await matchRepository.query(`
      UPDATE "match"
      SET winner = $1, 
          "payoutResult" = $2,
          "isCompleted" = $3,
          status = $4,
          "updatedAt" = $5
      WHERE id = $6
    `, [winner, payoutResultJson, true, 'completed', new Date(), matchId]);
  }
  
  console.log('✅ Match saved successfully with winner:', winner);

  return payoutResult;
};

const submitResultHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, result } = req.body;
    
    if (!matchId || !wallet || !result) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // SERVER-SIDE VALIDATION: Validate result structure
    if (typeof result.won !== 'boolean' || typeof result.numGuesses !== 'number' || !Array.isArray(result.guesses)) {
      return res.status(400).json({ error: 'Invalid result format' });
    }

    // SERVER-SIDE VALIDATION: Validate game rules
    if (result.numGuesses > 7) {
      return res.status(400).json({ error: 'Maximum 7 guesses allowed' });
    }

    // SERVER-SIDE VALIDATION: Validate player is part of this match using raw SQL first
    // Check database before Redis to handle cases where Redis state was deleted prematurely
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const matchRows = await matchRepository.query(`
      SELECT id, "player1", "player2", "player1Result", "player2Result", "gameStartTime", "isCompleted", status
      FROM "match"
      WHERE id = $1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchRows[0];
    
    // Check if match is already completed in database
    if (match.isCompleted) {
      // Match is completed - check if player already submitted
      const existingResultRaw = wallet === match.player1 ? match.player1Result : match.player2Result;
      if (existingResultRaw) {
        const existingResult = typeof existingResultRaw === 'string' ? JSON.parse(existingResultRaw) : existingResultRaw;
        return res.json({
          success: true,
          message: 'Result already submitted',
          result: existingResult,
          matchId,
        });
      }
      return res.status(400).json({ error: 'Match is already completed' });
    }

    // SERVER-SIDE VALIDATION: Get server-side game state from Redis
    // If Redis state is missing but match exists and isn't completed, try to restore it
    let serverGameState = await getGameState(matchId);
    if (!serverGameState) {
      // Redis state missing - check if we can restore from database or if match is truly invalid
      if (match.status !== 'active' && match.status !== 'payment_required') {
        return res.status(404).json({ error: 'Game not found or already completed' });
      }
      // Match exists and is active, but Redis state is missing - this shouldn't happen
      // Log warning but allow submission to proceed (we'll validate against database)
      console.warn('⚠️ Redis game state missing but match exists in database, allowing submission', {
        matchId,
        wallet,
        matchStatus: match.status,
        isCompleted: match.isCompleted
      });
      // Create a minimal serverGameState for validation purposes
      serverGameState = {
        startTime: match.gameStartTime ? new Date(match.gameStartTime).getTime() : Date.now(),
        player1StartTime: match.gameStartTime ? new Date(match.gameStartTime).getTime() : Date.now(),
        player2StartTime: match.gameStartTime ? new Date(match.gameStartTime).getTime() : Date.now(),
        player1Guesses: [],
        player2Guesses: [],
        player1Solved: false,
        player2Solved: false,
        word: '', // Will be validated from database if needed
        matchId: matchId,
        lastActivity: Date.now(),
        completed: false
      };
    }

    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // SERVER-SIDE VALIDATION: Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerKey = isPlayer1 ? 'player1' : 'player2';
    const opponentKey = isPlayer1 ? 'player2' : 'player1';

    // SERVER-SIDE VALIDATION: Check if player already submitted
    // Make idempotent - if already submitted, return success (prevents duplicate submission errors)
    // Parse player results from JSON strings
    const existingResultRaw = isPlayer1 ? match.player1Result : match.player2Result;
    const existingResult = existingResultRaw ? (typeof existingResultRaw === 'string' ? JSON.parse(existingResultRaw) : existingResultRaw) : null;
    if (existingResult) {
      console.log('✅ Player already submitted result, returning existing result (idempotent)', {
        matchId,
        wallet,
        isPlayer1,
        existingResult: {
          won: existingResult.won,
          numGuesses: existingResult.numGuesses,
          totalTime: existingResult.totalTime,
        },
      });
      // Return success with existing result to prevent frontend retry loops
      return res.json({
        success: true,
        message: 'Result already submitted',
        result: existingResult,
        matchId,
      });
    }

    // Stricter guess validation while maintaining race condition tolerance
    const serverGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    
    // Reject if guess count is more than 2 ahead (allows +1 for race conditions, +2 for safety margin)
    if (result.guesses.length > serverGuesses.length + 2) {
      console.warn('⚠️ Guess count mismatch: too many guesses submitted', {
        clientGuesses: result.guesses.length,
        serverGuesses: serverGuesses.length,
        wallet
      });
      return res.status(400).json({ 
        error: 'Guess count mismatch: too many guesses submitted',
        clientGuesses: result.guesses.length,
        serverGuesses: serverGuesses.length
      });
    }
    
    // Validate that submitted guesses match server guesses (with +1 tolerance for race conditions)
    const maxServerIndex = serverGuesses.length - 1;
    for (let i = 0; i < Math.min(result.guesses.length, serverGuesses.length + 1); i++) {
      if (i <= maxServerIndex && result.guesses[i] !== serverGuesses[i]) {
        console.warn('⚠️ Guess mismatch at position', {
          position: i,
          clientGuess: result.guesses[i],
          serverGuess: serverGuesses[i],
          wallet
        });
        return res.status(400).json({ 
          error: `Guess mismatch at position ${i}`,
          clientGuess: result.guesses[i],
          serverGuess: serverGuesses[i]
        });
      }
    }

    // SERVER-SIDE VALIDATION: Validate win condition
    const expectedWon = serverGameState.word === result.guesses[result.guesses.length - 1];
    if (result.won !== expectedWon) {
      return res.status(400).json({ error: 'Win condition mismatch with server state' });
    }

    // SERVER-SIDE VALIDATION: Use server-side time tracking
    // Prefer database gameStartTime if available (more accurate), otherwise use Redis start time
    const candidateStartTimes: number[] = [];
    if (match.gameStartTime) {
      candidateStartTimes.push(new Date(match.gameStartTime).getTime());
    }
    if (match.gameStartTimeUtc) {
      candidateStartTimes.push(new Date(match.gameStartTimeUtc).getTime());
    }
    if (serverGameState?.startTime) {
      candidateStartTimes.push(serverGameState.startTime);
    }
    if (isPlayer1 && serverGameState?.player1StartTime) {
      candidateStartTimes.push(serverGameState.player1StartTime);
    }
    if (!isPlayer1 && serverGameState?.player2StartTime) {
      candidateStartTimes.push(serverGameState.player2StartTime);
    }
    
    const nowMs = Date.now();
    const validStartTimes = candidateStartTimes
      .filter((value) => typeof value === 'number' && !Number.isNaN(value))
      .filter((value) => value > 0 && value <= nowMs);
    
    let serverStartTime: number;
    if (validStartTimes.length > 0) {
      serverStartTime = Math.max(...validStartTimes);
      
      const dbStart = match.gameStartTime ? new Date(match.gameStartTime).getTime() : null;
      if (dbStart && serverStartTime !== dbStart && serverStartTime - dbStart > 60000) {
        console.log('ℹ️ Using fresher game start time from runtime state instead of database value', {
          matchId,
          dbStart,
          chosenStart: serverStartTime,
          source: serverStartTime === serverGameState?.player1StartTime || serverStartTime === serverGameState?.player2StartTime
            ? 'playerStartTime'
            : serverStartTime === serverGameState?.startTime
              ? 'redisStartTime'
              : 'other'
        });
      }
    } else {
      // Absolute fallback – should be rare, but prevents negative durations
      serverStartTime = nowMs;
      console.warn('⚠️ No valid server start times found; defaulting to current timestamp', {
        matchId,
        player: isPlayer1 ? 'player1' : 'player2'
      });
    }
    
    const serverEndTime = Date.now();
    const serverTotalTime = serverEndTime - serverStartTime;

    // SERVER-SIDE VALIDATION: Validate time limits (allow timeout submissions)
    const isTimeoutSubmission = result.reason === 'timeout';
    
    // Check if player has made guesses - if so, be more lenient with time validation
    // (player might have been thinking, or page was reloaded)
    const playerGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    const hasGuesses = playerGuesses && playerGuesses.length > 0;
    
    // Check if opponent has already submitted (game might be in completion state)
    const opponentResultRaw = isPlayer1 ? match.player2Result : match.player1Result;
    const opponentHasResult = opponentResultRaw ? true : false;
    
    // If player has guesses OR opponent has submitted, be lenient (game is clearly in progress/completed)
    // This handles cases where player reloaded page after game was completed
    // If no guesses yet and opponent hasn't submitted, use strict 2-minute limit
    const maxTimeAllowed = (hasGuesses || opponentHasResult) ? 600000 : 120000; // 10 minutes if has guesses/opponent submitted, 2 minutes otherwise
    
    if (serverTotalTime > maxTimeAllowed && !isTimeoutSubmission) {
      console.log('⏰ Time validation failed:', { 
        serverTotalTime, 
        maxTimeAllowed,
        hasGuesses,
        opponentHasResult,
        reason: result.reason, 
        isTimeoutSubmission 
      });
      return res.status(400).json({ error: 'Game time exceeded limit' });
    }

    // SERVER-SIDE VALIDATION: Check for impossibly fast times (less than 1 second)
    // Only check this if player has guesses (to avoid false positives on first submission)
    if (hasGuesses && serverTotalTime < 1000) {
      return res.status(400).json({ error: 'Suspiciously fast completion time detected' });
    }



    // Create server-validated result object
    // For timeout submissions, always use exactly 120000ms (2 minutes)
    const finalTotalTime = isTimeoutSubmission ? 120000 : serverTotalTime;
    const serverValidatedResult = {
      won: result.won,
      numGuesses: result.numGuesses,
      totalTime: finalTotalTime, // Use exact 120000ms for timeouts, server time otherwise
      guesses: result.guesses,
      reason: isTimeoutSubmission ? 'timeout' : 'server-validated'
    };

    // Update server game state in Redis
    if (isPlayer1) {
      serverGameState.player1Solved = result.won;
    } else {
      serverGameState.player2Solved = result.won;
    }
    
    // Save updated game state to Redis
    await setGameState(matchId, serverGameState);

    // Use database transaction to prevent race conditions with raw SQL
    await AppDataSource.transaction(async (manager: any) => {
      // Update the result for this player using raw SQL
      const resultColumn = isPlayer1 ? 'player1Result' : 'player2Result';
      await manager.query(`
        UPDATE "match"
        SET "${resultColumn}" = $1, "updatedAt" = $2
        WHERE id = $3
      `, [JSON.stringify(serverValidatedResult), new Date(), matchId]);
      
      // Update the local match object for consistency
      if (isPlayer1) {
        match.player1Result = JSON.stringify(serverValidatedResult);
      } else {
        match.player2Result = JSON.stringify(serverValidatedResult);
      }
    });



    // Check if both players have submitted results (regardless of win/loss) using raw SQL
    const updatedMatchRows = await matchRepository.query(`
      SELECT "player1Result", "player2Result"
      FROM "match"
      WHERE id = $1
    `, [matchId]);
    const updatedMatch = updatedMatchRows?.[0];
    const player1ResultRaw = updatedMatch?.player1Result;
    const player2ResultRaw = updatedMatch?.player2Result;
    const player1Result = player1ResultRaw ? (typeof player1ResultRaw === 'string' ? JSON.parse(player1ResultRaw) : player1ResultRaw) : null;
    const player2Result = player2ResultRaw ? (typeof player2ResultRaw === 'string' ? JSON.parse(player2ResultRaw) : player2ResultRaw) : null;
    // Check if this player solved the puzzle OR if both players have submitted results
    if (result.won || (player1Result && player2Result)) {

      
      // Check if both players have finished playing (solved, run out of guesses, or both submitted results)
      // Use the updated server game state after recording this player's result
      const updatedServerGameState = await getGameState(matchId);
      const player1Finished = updatedServerGameState?.player1Solved || (updatedServerGameState?.player1Guesses?.length || 0) >= 7 || player1Result;
      const player2Finished = updatedServerGameState?.player2Solved || (updatedServerGameState?.player2Guesses?.length || 0) >= 7 || player2Result;
      
      // Check if match should complete:
      // 1. Both players have submitted results (most reliable check), OR
      // 2. Both players finished in game state AND at least one has submitted a result (prevents timeout scanner interference), OR
      // 3. One player has submitted a timeout result and the other player has no result (never got to game)
      const bothHaveResults = !!player1Result && !!player2Result;
      const shouldComplete = bothHaveResults || 
                           ((player1Finished && player2Finished) && (!!player1Result || !!player2Result)) ||
                           (player1Result && player1Result.reason === 'timeout' && !player2Result) ||
                           (player2Result && player2Result.reason === 'timeout' && !player1Result);
      
      if (shouldComplete) {
        // Use transaction to ensure atomic winner determination with raw SQL
        let updatedMatch: any = null;
        const payoutResult = await AppDataSource.transaction(async (manager: any) => {
          // Get the latest match data with both results within the transaction using raw SQL
          const matchRows = await manager.query(`
            SELECT "player1Result", "player2Result", winner, "isCompleted"
            FROM "match"
            WHERE id = $1
          `, [matchId]);
          
          if (!matchRows || matchRows.length === 0) {
            throw new Error('Match not found during winner determination');
          }
          
          updatedMatch = matchRows[0];
          
          // Parse player results from JSON strings
          const player1ResultRaw = updatedMatch.player1Result;
          const player2ResultRaw = updatedMatch.player2Result;
          const player1Result = player1ResultRaw ? (typeof player1ResultRaw === 'string' ? JSON.parse(player1ResultRaw) : player1ResultRaw) : null;
          const player2Result = player2ResultRaw ? (typeof player2ResultRaw === 'string' ? JSON.parse(player2ResultRaw) : player2ResultRaw) : null;
          
          // Handle case where one player times out and the other never gets to the game
          if ((player1Result && player1Result.reason === 'timeout' && !player2Result) ||
              (player2Result && player2Result.reason === 'timeout' && !player1Result)) {
            console.log('⏰ One player timed out, other player never got to game - creating timeout result for missing player');
            
            // Create a timeout result for the missing player
            const timeoutResult = {
              won: false,
              numGuesses: 0,
              totalTime: 120000, // 2 minutes
              guesses: [],
              reason: 'timeout'
            };
            
            if (!player1Result) {
              await manager.query(`
                UPDATE "match"
                SET "player1Result" = $1, "updatedAt" = $2
                WHERE id = $3
              `, [JSON.stringify(timeoutResult), new Date(), matchId]);
            } else if (!player2Result) {
              await manager.query(`
                UPDATE "match"
                SET "player2Result" = $1, "updatedAt" = $2
                WHERE id = $3
              `, [JSON.stringify(timeoutResult), new Date(), matchId]);
            }
            
            // Reload results after update
            const updatedRows = await manager.query(`
              SELECT "player1Result", "player2Result"
              FROM "match"
              WHERE id = $1
            `, [matchId]);
            const updated = updatedRows?.[0];
            const updatedPlayer1ResultRaw = updated?.player1Result;
            const updatedPlayer2ResultRaw = updated?.player2Result;
            const updatedPlayer1Result = updatedPlayer1ResultRaw ? (typeof updatedPlayer1ResultRaw === 'string' ? JSON.parse(updatedPlayer1ResultRaw) : updatedPlayer1ResultRaw) : null;
            const updatedPlayer2Result = updatedPlayer2ResultRaw ? (typeof updatedPlayer2ResultRaw === 'string' ? JSON.parse(updatedPlayer2ResultRaw) : updatedPlayer2ResultRaw) : null;
          
            const result = await determineWinnerAndPayout(matchId, updatedPlayer1Result, updatedPlayer2Result, manager);
            
            // IMPORTANT: determineWinnerAndPayout saves its own match instance, so reload to get the winner
            const matchWithWinnerRows = await manager.query(`
              SELECT winner, "isCompleted"
              FROM "match"
              WHERE id = $1
            `, [matchId]);
            const matchWithWinner = matchWithWinnerRows?.[0];
            if (matchWithWinner) {
              updatedMatch.winner = matchWithWinner.winner;
              updatedMatch.isCompleted = matchWithWinner.isCompleted;
            }
            
            return result;
          }
          
          const result = await determineWinnerAndPayout(matchId, player1Result, player2Result, manager);
          
          // IMPORTANT: determineWinnerAndPayout saves its own match instance, so reload to get the winner
          const matchWithWinnerRows = await manager.query(`
            SELECT winner, "isCompleted"
            FROM "match"
            WHERE id = $1
          `, [matchId]);
          const matchWithWinner = matchWithWinnerRows?.[0];
          if (matchWithWinner) {
            updatedMatch.winner = matchWithWinner.winner;
            updatedMatch.isCompleted = matchWithWinner.isCompleted;
          }
          
          return result;
        });
        
        // IMPORTANT: Reload match after transaction to ensure we have the latest winner using raw SQL
        // Include all fields needed for proposal creation
        const matchRepository = AppDataSource.getRepository(Match);
        const finalMatchRows = await matchRepository.query(`
          SELECT id, winner, "isCompleted", "player1Result", "player2Result", 
                 "player1", "player2", "entryFee", "squadsVaultAddress"
          FROM "match"
          WHERE id = $1
        `, [matchId]);
        updatedMatch = finalMatchRows?.[0];
        if (!updatedMatch) {
          throw new Error('Match not found after transaction');
        }
        
        // DELAYED CLEANUP: Only delete Redis state after both players have submitted
        // Don't delete immediately - wait a bit to allow the other player to submit
        setTimeout(async () => {
          try {
            const { AppDataSource } = require('../db/index');
            const matchRepository = AppDataSource.getRepository(Match);
            // Double-check both players have submitted before deleting
            const checkRows = await matchRepository.query(`
              SELECT "player1Result", "player2Result", "isCompleted"
              FROM "match"
              WHERE id = $1
            `, [matchId]);
            if (checkRows && checkRows.length > 0 && checkRows[0].isCompleted && 
                checkRows[0].player1Result && checkRows[0].player2Result) {
          await deleteGameState(matchId);
              console.log(`🧹 Cleaned up Redis game state for completed match: ${matchId}`);
            }
        } catch (error) {
            console.warn('⚠️ Error in delayed cleanup:', error);
        }
        }, 30000); // Wait 30 seconds before cleanup to allow other player to submit
        
        // Execute Squads proposal for winner payout (same as non-solved case)
        console.log('🔍 Checking if proposal should be created:', {
          hasPayoutResult: !!payoutResult,
          winner: payoutResult?.winner,
          isTie: payoutResult?.winner === 'tie',
          hasVaultAddress: !!updatedMatch.squadsVaultAddress,
          vaultAddress: updatedMatch.squadsVaultAddress,
          entryFee: updatedMatch.entryFee,
        });
        
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          
          const winner = payoutResult.winner;
          const loser = winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1;
          const entryFee = updatedMatch.entryFee;
          
          // Calculate payment amounts
          const totalPot = entryFee * 2; // Total pot is both players' entry fees
          const winnerAmount = totalPot * 0.95; // 95% of total pot to winner
          const feeAmount = totalPot * 0.05; // 5% fee from total pot
          
          console.log('💰 Creating winner payout proposal:', {
            matchId: updatedMatch.id,
            winner,
            loser,
            entryFee,
            totalPot,
            winnerAmount,
            feeAmount,
            vaultAddress: updatedMatch.squadsVaultAddress,
          });
          
          // Create Squads proposal for winner payout
          if (!updatedMatch.squadsVaultAddress) {
            console.error('❌ Cannot create payout proposal (solved case): missing squadsVaultAddress', {
              matchId: updatedMatch.id,
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
            });
          } else {
            try {
              const proposalResult = await squadsVaultService.proposeWinnerPayout(
                updatedMatch.squadsVaultAddress,
                new PublicKey(winner),
                winnerAmount,
                new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                feeAmount,
                updatedMatch.squadsVaultPda ?? undefined
              );
              
              if (proposalResult.success) {
                console.log('✅ Squads winner payout proposal created (solved case):', proposalResult.proposalId);
              
                const proposalState = buildInitialProposalState(proposalResult.needsSignatures);

                // Update match with proposal information
                updatedMatch.payoutProposalId = proposalResult.proposalId;
                updatedMatch.proposalCreatedAt = new Date();
                updatedMatch.proposalStatus = 'ACTIVE';
                updatedMatch.matchStatus = 'PROPOSAL_CREATED';
                applyProposalStateToMatch(updatedMatch, proposalState);
                
                // CRITICAL: Set proposal expiration (30 minutes after creation)
                const { proposalExpirationService } = require('../services/proposalExpirationService');
                proposalExpirationService.setProposalExpiration(updatedMatch);
                
                // Save the match with proposal information using raw SQL
                await matchRepository.query(`
                  UPDATE "match"
                  SET "payoutProposalId" = $1,
                      "proposalCreatedAt" = $2,
                      "proposalStatus" = $3,
                      "needsSignatures" = $4,
                      "proposalSigners" = $5,
                      "matchStatus" = $6,
                      "updatedAt" = $7
                  WHERE id = $8
                `, [
                  proposalResult.proposalId,
                  new Date(),
                  'ACTIVE',
                  proposalState.normalizedNeeds,
                  proposalState.signersJson,
                  'PROPOSAL_CREATED',
                  new Date(),
                  updatedMatch.id
                ]);
                console.log('✅ Match saved with proposal information (solved case):', {
                  matchId: updatedMatch.id,
                  proposalId: proposalResult.proposalId,
                  proposalStatus: 'ACTIVE',
                  needsSignatures: proposalState.normalizedNeeds,
                  signers: proposalState.signers,
                });
                
                const paymentInstructions = {
                  winner,
                  loser,
                  winnerAmount,
                  feeAmount,
                  feeWallet: FEE_WALLET_ADDRESS,
                  squadsProposal: true,
                  proposalId: proposalResult.proposalId,
                  transactions: [
                    {
                      from: 'Squads Vault',
                      to: winner,
                      amount: winnerAmount,
                      description: 'Winner payout via Squads proposal (requires signatures)',
                      proposalId: proposalResult.proposalId
                    }
                  ]
                };
                
                (payoutResult as any).paymentInstructions = paymentInstructions;
                (payoutResult as any).paymentSuccess = true;
                (payoutResult as any).squadsProposal = true;
                (payoutResult as any).proposalId = proposalResult.proposalId;
                
                console.log('✅ Squads proposal created and payment instructions set (solved case)');
              } else {
                console.error('❌ Squads proposal creation failed (solved case):', proposalResult.error);
                // Fallback to manual instructions
                const paymentInstructions = {
                  winner,
                  loser,
                  winnerAmount,
                  feeAmount,
                  feeWallet: FEE_WALLET_ADDRESS,
                  squadsProposal: false,
                  transactions: [
                    {
                      from: 'Multisig Vault',
                      to: winner,
                      amount: winnerAmount,
                      description: 'Manual payout to winner (contact support)'
                    }
                  ]
                };
                (payoutResult as any).paymentInstructions = paymentInstructions;
                (payoutResult as any).paymentSuccess = false;
                (payoutResult as any).paymentError = 'Squads proposal failed - contact support';
              }
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.error('❌ Error creating Squads proposal (solved case):', errorMessage);
              // Fallback to manual instructions
              const paymentInstructions = {
                winner,
                loser,
                winnerAmount,
                feeAmount,
                feeWallet: FEE_WALLET_ADDRESS,
                squadsProposal: false,
                transactions: [
                  {
                    from: 'Multisig Vault',
                    to: winner,
                    amount: winnerAmount,
                    description: 'Manual payout to winner (contact support)'
                  }
                ]
              };
              (payoutResult as any).paymentInstructions = paymentInstructions;
              (payoutResult as any).paymentSuccess = false;
              (payoutResult as any).paymentError = `Squads proposal failed: ${errorMessage}`;
            }
          }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.getPlayer1Result() && updatedMatch.getPlayer2Result() && 
              updatedMatch.getPlayer1Result().won && updatedMatch.getPlayer2Result().won) {
            // Winning tie - each player gets their entry fee back
            console.log('🤝 Winning tie - each player gets refund...');
            
            const entryFee = updatedMatch.entryFee;
            const feeAmount = entryFee * 0.05; // 5% fee
            
            const paymentInstructions = {
              winner: 'tie',
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              transactions: [
                {
                  from: updatedMatch.player1,
                  to: updatedMatch.player2,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 2'
                },
                {
                  from: updatedMatch.player1,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: updatedMatch.player1,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 2'
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = true;
            
            console.log('✅ Tie payment instructions created');
          } else {
            // Losing tie - skip duplicate handler, use Squads proposal logic in main tie block below
          }
        }
        // Use raw SQL to update match completion status and payout result
        const payoutResultJson = JSON.stringify(payoutResult);
        const updateFields: string[] = [];
        const updateValues: any[] = [];
        
        updateFields.push('"isCompleted" = $' + (updateValues.length + 1));
        updateValues.push(true);
        updateFields.push('"winner" = $' + (updateValues.length + 1));
        updateValues.push(payoutResult.winner);
        updateFields.push('"payoutResult" = $' + (updateValues.length + 1));
        updateValues.push(payoutResultJson);
        
          // Preserve proposal fields if they were set earlier
          if ((updatedMatch as any).payoutProposalId) {
          updateFields.push('"payoutProposalId" = $' + (updateValues.length + 1));
          updateValues.push((updatedMatch as any).payoutProposalId);
          updateFields.push('"proposalStatus" = $' + (updateValues.length + 1));
          updateValues.push((updatedMatch as any).proposalStatus || 'ACTIVE');
          if ((updatedMatch as any).proposalCreatedAt) {
            updateFields.push('"proposalCreatedAt" = $' + (updateValues.length + 1));
            updateValues.push((updatedMatch as any).proposalCreatedAt);
          }
          updateFields.push('"needsSignatures" = $' + (updateValues.length + 1));
          updateValues.push(normalizeRequiredSignatures((updatedMatch as any).needsSignatures));
            console.log('✅ Preserving proposal fields in final save (solved case):', {
            matchId,
            proposalId: (updatedMatch as any).payoutProposalId,
            proposalStatus: (updatedMatch as any).proposalStatus || 'ACTIVE',
            });
          }
        
        updateValues.push(matchId);
        await matchRepository.query(`
          UPDATE "match"
          SET ${updateFields.join(', ')}, "updatedAt" = NOW()
          WHERE id = $${updateValues.length}
        `, updateValues);
        
        // DELAYED CLEANUP: Only delete Redis state after both players have submitted
        // Don't delete immediately - wait a bit to allow the other player to submit
        setTimeout(async () => {
          try {
            const { AppDataSource } = require('../db/index');
            const matchRepository = AppDataSource.getRepository(Match);
            // Double-check both players have submitted before deleting
            const checkRows = await matchRepository.query(`
              SELECT "player1Result", "player2Result", "isCompleted"
              FROM "match"
              WHERE id = $1
            `, [matchId]);
            if (checkRows && checkRows.length > 0 && checkRows[0].isCompleted && 
                checkRows[0].player1Result && checkRows[0].player2Result) {
              await deleteGameState(matchId);
              console.log(`🧹 Cleaned up Redis game state for completed match: ${matchId}`);
            }
          } catch (error) {
            console.warn('⚠️ Error in delayed cleanup:', error);
          }
        }, 30000); // Wait 30 seconds before cleanup to allow other player to submit
        
        res.json({
          status: 'completed',
          winner: (payoutResult as any).winner,
          payout: payoutResult,
          message: 'Game completed - winner determined'
        });
      } else {
        // Both players haven't finished yet - save partial result and wait using raw SQL
        console.log('⏳ Not all players finished yet, waiting for other player');
        // Result was already saved in the transaction above, no need to save again
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player to finish'
        });
      }
    } else {
      // Player didn't solve - check if both players have finished playing
      // This `serverGameState` needs to be `updatedServerGameState` for consistency
      const updatedServerGameState = await getGameState(matchId);
      const player1Finished = updatedServerGameState?.player1Solved || (updatedServerGameState?.player1Guesses?.length || 0) >= 7;
      const player2Finished = updatedServerGameState?.player2Solved || (updatedServerGameState?.player2Guesses?.length || 0) >= 7;
      
      console.log('🔍 Game end check (non-solved case):', {
        matchId,
        player1Solved: updatedServerGameState?.player1Solved,
        player2Solved: updatedServerGameState?.player2Solved,
        player1Guesses: updatedServerGameState?.player1Guesses?.length || 0,
        player2Guesses: updatedServerGameState?.player2Guesses?.length || 0,
        player1Finished,
        player2Finished,
        bothFinished: player1Finished && player2Finished
      });
      
      if (player1Finished && player2Finished) {
        console.log('🏁 Both players have finished playing, determining winner...');
        
        // Use transaction to ensure atomic winner determination
        let updatedMatch: any = null;
        const payoutResult = await AppDataSource.transaction(async (manager: any) => {
          // Get the latest match data with both results within the transaction
          updatedMatch = await manager.findOne(Match, { where: { id: matchId } });
          if (!updatedMatch) {
            throw new Error('Match not found during winner determination');
          }
          
          console.log('🏆 Winner determination (non-solved) - Match state:', {
            player1Result: updatedMatch.getPlayer1Result(),
            player2Result: updatedMatch.getPlayer2Result(),
            winner: updatedMatch.winner,
            isCompleted: updatedMatch.isCompleted
          });
          
          const result = await determineWinnerAndPayout(matchId, updatedMatch.getPlayer1Result(), updatedMatch.getPlayer2Result(), manager);
          
          // IMPORTANT: determineWinnerAndPayout saves its own match instance, so reload to get the winner
          const matchWithWinner = await manager.findOne(Match, { where: { id: matchId } });
          if (matchWithWinner) {
            updatedMatch.winner = matchWithWinner.winner;
            updatedMatch.isCompleted = matchWithWinner.isCompleted;
          }
          
          console.log('🏆 Winner determination completed (non-solved case):', {
            matchId,
            winner: result?.winner,
            updatedMatchWinner: updatedMatch.winner,
            player1Result: updatedMatch.getPlayer1Result(),
            player2Result: updatedMatch.getPlayer2Result()
          });
          
          return result;
        });
        
        // IMPORTANT: Reload match after transaction to ensure we have the latest winner
        const matchRepository = AppDataSource.getRepository(Match);
        updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
        if (!updatedMatch) {
          throw new Error('Match not found after transaction');
        }
        
        console.log('💰 Checking if payout proposal needed...', {
          matchId: updatedMatch.id,
          winner: payoutResult?.winner,
          squadsVaultAddress: (updatedMatch as any).squadsVaultAddress,
          hasPayoutResult: !!payoutResult,
        });
        
          // Execute Squads proposal for winner payout (non-custodial)
        if (payoutResult && payoutResult.winner && payoutResult.winner !== 'tie') {
          console.log('💰 Creating Squads proposal for winner payout...');
          
          const winner = payoutResult.winner;
          const loser = winner === updatedMatch.player1 ? updatedMatch.player2 : updatedMatch.player1;
          const entryFee = updatedMatch.entryFee;
          
          // Check if vault address exists
          if (!updatedMatch.squadsVaultAddress) {
            console.error('❌ Cannot create payout proposal: missing squadsVaultAddress', {
              matchId: updatedMatch.id,
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
            });
          } else {
            // Calculate payment amounts
            const totalPot = entryFee * 2; // Total pot is both players' entry fees
            const winnerAmount = totalPot * 0.95; // 95% of total pot to winner
            const feeAmount = totalPot * 0.05; // 5% fee from total pot
            
            // Create Squads proposal for winner payout
            try {
              // squadsVaultService is now imported at the top of the file
              
              const proposalResult = await squadsVaultService.proposeWinnerPayout(
                updatedMatch.squadsVaultAddress,
                new PublicKey(winner),
                winnerAmount,
                new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                feeAmount,
                updatedMatch.squadsVaultPda ?? undefined
              );
              
              if (proposalResult.success) {
                console.log('✅ Squads winner payout proposal created:', proposalResult.proposalId);
              
                const proposalState = buildInitialProposalState(proposalResult.needsSignatures);

                // Update match with proposal information
                updatedMatch.payoutProposalId = proposalResult.proposalId;
                updatedMatch.proposalCreatedAt = new Date();
                updatedMatch.proposalStatus = 'ACTIVE'; // CRITICAL: Set proposalStatus for frontend
                updatedMatch.matchStatus = 'PROPOSAL_CREATED';
                applyProposalStateToMatch(updatedMatch, proposalState);
                
                // IMPORTANT: Save the match with proposal information
                await matchRepository.save(updatedMatch);
                console.log('✅ Match saved with proposal information:', {
                  matchId: updatedMatch.id,
                  proposalId: proposalResult.proposalId,
                  proposalStatus: 'ACTIVE',
                  needsSignatures: proposalState.normalizedNeeds,
                  signers: proposalState.signers,
                });
            
            // Create payment instructions for display
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
                feeWallet: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
                squadsProposal: true,
                proposalId: proposalResult.proposalId,
              transactions: [
                {
                    from: 'Squads Vault',
                  to: winner,
                  amount: winnerAmount,
                    description: 'Winner payout via Squads proposal (requires winner signature)',
                    proposalId: proposalResult.proposalId
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = true;
              (payoutResult as any).squadsProposal = true;
              (payoutResult as any).proposalId = proposalResult.proposalId;
            
              console.log('✅ Squads winner payout proposal completed');
            
            } else {
              console.error('❌ Squads proposal creation failed:', proposalResult.error);
              throw new Error(`Squads proposal failed: ${proposalResult.error}`);
            }
            
          } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn('⚠️ Squads proposal failed, falling back to manual instructions:', errorMessage);
            
            // Fallback to manual payment instructions
            const paymentInstructions = {
              winner,
              loser,
              winnerAmount,
              feeAmount,
              feeWallet: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
              squadsProposal: false,
              transactions: [
                {
                  from: 'Squads Vault',
                  to: winner,
                  amount: winnerAmount,
                  description: 'Manual payout to winner (contact support)'
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = false;
            (payoutResult as any).paymentError = 'Squads proposal failed - contact support';
            
            console.log('⚠️ Manual payment instructions created');
          }
        }
        } else if (payoutResult && payoutResult.winner === 'tie') {
          // Handle tie scenarios
          if (updatedMatch.getPlayer1Result() && updatedMatch.getPlayer2Result() && 
              updatedMatch.getPlayer1Result().won && updatedMatch.getPlayer2Result().won) {
            // Winning tie - each player gets their entry fee back
            console.log('🤝 Winning tie - each player gets refund...');
            
            const entryFee = updatedMatch.entryFee;
            const feeAmount = entryFee * 0.05; // 5% fee
            
            const paymentInstructions = {
              winner: 'tie',
              player1: updatedMatch.player1,
              player2: updatedMatch.player2,
              feeAmount,
              feeWallet: FEE_WALLET_ADDRESS,
              transactions: [
                {
                  from: updatedMatch.player1,
                  to: updatedMatch.player2,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 2'
                },
                {
                  from: updatedMatch.player1,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: updatedMatch.player1,
                  amount: entryFee * 0.45,
                  description: 'Split payment to player 1'
                },
                {
                  from: updatedMatch.player2,
                  to: FEE_WALLET_ADDRESS,
                  amount: feeAmount * 0.5,
                  description: 'Fee payment from player 2'
                }
              ]
            };
            
            (payoutResult as any).paymentInstructions = paymentInstructions;
            (payoutResult as any).paymentSuccess = true;
            
            console.log('✅ Tie payment instructions created');
          } else {
          // Losing tie - both players get 95% refund via Squads
            console.log('🤝 Losing tie - processing 95% refunds to both players via Squads...');
            
            const entryFee = updatedMatch.entryFee;
            const refundAmount = entryFee * 0.95; // 95% refund to each player
            
            // Check if vault address exists
            if (!updatedMatch.squadsVaultAddress) {
              console.error('❌ Cannot create tie refund proposal: missing squadsVaultAddress', {
                matchId: updatedMatch.id,
                player1: updatedMatch.player1,
                player2: updatedMatch.player2,
              });
              throw new Error('Cannot create tie refund: missing squadsVaultAddress');
            }
            
            // Create Squads proposal for tie refund
            try {
              const tiePaymentStatus = {
                ...(updatedMatch.player1Paid !== undefined && { player1Paid: !!updatedMatch.player1Paid }),
                ...(updatedMatch.player2Paid !== undefined && { player2Paid: !!updatedMatch.player2Paid }),
              };

              const refundResult = await squadsVaultService.proposeTieRefund(
                updatedMatch.squadsVaultAddress,
                new PublicKey(updatedMatch.player1),
                new PublicKey(updatedMatch.player2),
                refundAmount,
                updatedMatch.squadsVaultPda ?? undefined,
                tiePaymentStatus
              );
              
              if (refundResult.success) {
                console.log('✅ Squads tie refund proposal created:', refundResult.proposalId);
                
                const proposalState = buildInitialProposalState(refundResult.needsSignatures);

                // Update match with proposal information
                // CRITICAL: Set both payoutProposalId and tieRefundProposalId for tie refunds
                updatedMatch.payoutProposalId = refundResult.proposalId;
                updatedMatch.tieRefundProposalId = refundResult.proposalId;
                updatedMatch.proposalCreatedAt = new Date();
                updatedMatch.proposalStatus = 'ACTIVE';
                updatedMatch.matchStatus = 'PROPOSAL_CREATED';
                applyProposalStateToMatch(updatedMatch, proposalState);
                
                // Save the match with proposal information
                await matchRepository.save(updatedMatch);
                console.log('✅ Match saved with tie refund proposal:', {
                  matchId: updatedMatch.id,
                  proposalId: refundResult.proposalId,
                  proposalStatus: 'ACTIVE',
                  needsSignatures: proposalState.normalizedNeeds,
                  signers: proposalState.signers,
                });
                
                // Create payment instructions for display
                const paymentInstructions = {
                  winner: 'tie',
                  player1: updatedMatch.player1,
                  player2: updatedMatch.player2,
                  refundAmount: refundAmount,
                  feeAmount: entryFee * 0.05 * 2,
                  feeWallet: FEE_WALLET_ADDRESS,
                  squadsProposal: true,
                  proposalId: refundResult.proposalId,
                  transactions: [
                    {
                      from: 'Squads Vault',
                      to: updatedMatch.player1,
                      amount: refundAmount,
                      description: 'Losing tie refund (player 1)'
                    },
                    {
                      from: 'Squads Vault',
                      to: updatedMatch.player2,
                      amount: refundAmount,
                      description: 'Losing tie refund (player 2)'
                    }
                  ]
                };
                
                (payoutResult as any).paymentInstructions = paymentInstructions;
                (payoutResult as any).paymentSuccess = true;
                
              } else {
                console.error('❌ Squads tie refund proposal failed:', refundResult.error);
                throw new Error(`Squads proposal failed: ${refundResult.error}`);
              }
              
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.warn('⚠️ Squads tie refund proposal failed, falling back to manual instructions:', errorMessage);
              
              // Fallback to manual payment instructions
              const paymentInstructions = {
                winner: 'tie',
                player1: updatedMatch.player1,
                player2: updatedMatch.player2,
                refundAmount: refundAmount,
                feeAmount: entryFee * 0.05 * 2,
                feeWallet: FEE_WALLET_ADDRESS,
                squadsProposal: false,
                transactions: [
                  {
                    from: 'Squads Vault',
                    to: updatedMatch.player1,
                    amount: refundAmount,
                    description: 'Manual losing tie refund (player 1) - contact support'
                  },
                  {
                    from: 'Squads Vault',
                    to: updatedMatch.player2,
                    amount: refundAmount,
                    description: 'Manual losing tie refund (player 2) - contact support'
                  }
                ]
              };
              
              (payoutResult as any).paymentInstructions = paymentInstructions;
              (payoutResult as any).paymentSuccess = false;
              (payoutResult as any).paymentError = 'Squads proposal failed - contact support';
              
              console.log('⚠️ Manual losing tie refund instructions created');
            }
          }
        }
        
                  // Mark match as completed and ensure winner is set
          // IMPORTANT: Reload match to get latest proposal info before final save
          const finalMatch = await matchRepository.findOne({ where: { id: matchId } });
          if (finalMatch) {
            finalMatch.isCompleted = true;
            finalMatch.winner = payoutResult.winner; // Ensure winner is set from payout result
            finalMatch.setPayoutResult(payoutResult);
            // Preserve proposal fields if they were set earlier
            if ((updatedMatch as any).payoutProposalId) {
              (finalMatch as any).payoutProposalId = (updatedMatch as any).payoutProposalId;
              (finalMatch as any).proposalStatus = (updatedMatch as any).proposalStatus || 'ACTIVE';
              (finalMatch as any).proposalCreatedAt = (updatedMatch as any).proposalCreatedAt;
              (finalMatch as any).needsSignatures = normalizeRequiredSignatures((updatedMatch as any).needsSignatures);
              console.log('✅ Preserving proposal fields in final save:', {
                matchId: finalMatch.id,
                proposalId: (finalMatch as any).payoutProposalId,
                proposalStatus: (finalMatch as any).proposalStatus,
                needsSignatures: (finalMatch as any).needsSignatures,
              });
            }
            await matchRepository.save(finalMatch);
            
            // CRITICAL: Ensure proposals are created after saving match
            // Create proposal directly if it doesn't exist (fixed missing service file issue)
            try {
              console.log('🔍 Checking if proposal needs to be created:', {
                matchId: finalMatch.id,
                hasPayoutProposalId: !!(finalMatch as any).payoutProposalId,
                hasTieRefundProposalId: !!(finalMatch as any).tieRefundProposalId,
                winner: finalMatch.winner,
                hasVaultAddress: !!(finalMatch as any).squadsVaultAddress,
              });
              
              // Check if proposal needs to be created - for tie games, winner is 'tie', for other games it's a wallet address
              const needsProposal = !(finalMatch as any).payoutProposalId && 
                                    !(finalMatch as any).tieRefundProposalId && 
                                    (finalMatch.winner || finalMatch.winner === 'tie') && 
                                    (finalMatch as any).squadsVaultAddress;
              
              if (needsProposal) {
                // Acquire distributed lock to prevent race conditions
                const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
                const lockAcquired = await getProposalLock(finalMatch.id);
                
                if (!lockAcquired) {
                  console.log('⚠️ Proposal lock not acquired, another process may be creating proposal. Reloading match...');
                  // Reload match to check if proposal was created by another process
                  const reloadedRows = await matchRepository.query(`
                    SELECT "payoutProposalId", "tieRefundProposalId"
                    FROM "match"
                    WHERE id = $1
                    LIMIT 1
                  `, [finalMatch.id]);
                  if (reloadedRows && reloadedRows.length > 0 && (reloadedRows[0].payoutProposalId || reloadedRows[0].tieRefundProposalId)) {
                    console.log('✅ Proposal was created by another process');
                    return; // Proposal already created
                  }
                  // If still no proposal, continue (lock may have been stale)
                }
                
                try {
                  // Double-check proposal still doesn't exist after acquiring lock
                  const checkRows = await matchRepository.query(`
                    SELECT "payoutProposalId", "tieRefundProposalId"
                    FROM "match"
                    WHERE id = $1
                    LIMIT 1
                  `, [finalMatch.id]);
                  if (checkRows && checkRows.length > 0 && (checkRows[0].payoutProposalId || checkRows[0].tieRefundProposalId)) {
                    console.log('✅ Proposal already exists, skipping creation');
                    return; // Already created
                  }
                  
                console.log('✅ Proposal creation conditions met, creating proposal...', {
                  matchId: finalMatch.id,
                  winner: finalMatch.winner,
                });
                
                const { PublicKey } = require('@solana/web3.js');
                const { SquadsVaultService } = require('../services/squadsVaultService');
                const squadsService = new SquadsVaultService();
                
                if (finalMatch.winner !== 'tie') {
                  // Winner payout proposal
                  const winner = finalMatch.winner;
                  const entryFee = finalMatch.entryFee;
                  const totalPot = entryFee * 2;
                  const winnerAmount = totalPot * 0.95;
                  const feeAmount = totalPot * 0.05;

                  const proposalResult = await squadsService.proposeWinnerPayout(
                    (finalMatch as any).squadsVaultAddress,
                    new PublicKey(winner),
                    winnerAmount,
                    new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                    feeAmount
                  );

                  if (proposalResult.success && proposalResult.proposalId) {
                    (finalMatch as any).payoutProposalId = proposalResult.proposalId;
                      const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                      (finalMatch as any).proposalCreatedAt = new Date();
                      (finalMatch as any).proposalStatus = 'ACTIVE';
                      applyProposalStateToMatch(finalMatch, proposalState);
                      await matchRepository.save(finalMatch);
                    console.log('✅ Winner payout proposal created:', { matchId: finalMatch.id, proposalId: proposalResult.proposalId });
                  } else {
                    console.error('❌ Failed to create winner payout proposal:', proposalResult.error);
                  }
                } else {
                  // Tie refund proposal
                  console.log('🎯 Creating tie refund proposal...', { matchId: finalMatch.id });
                  const player1Result = finalMatch.getPlayer1Result();
                  const player2Result = finalMatch.getPlayer2Result();
                  const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
                  
                  console.log('🔍 Tie refund check:', {
                    matchId: finalMatch.id,
                    player1Result: player1Result ? { won: player1Result.won, numGuesses: player1Result.numGuesses } : null,
                    player2Result: player2Result ? { won: player2Result.won, numGuesses: player2Result.numGuesses } : null,
                    isLosingTie,
                  });
                  
                  if (isLosingTie) {
                    console.log('✅ Creating tie refund proposal for losing tie...', { matchId: finalMatch.id });
                    const entryFee = finalMatch.entryFee;
                    const refundAmount = entryFee * 0.95;
                    const tiePaymentStatus = {
                      ...(finalMatch.player1Paid !== undefined && { player1Paid: !!finalMatch.player1Paid }),
                      ...(finalMatch.player2Paid !== undefined && { player2Paid: !!finalMatch.player2Paid }),
                    };
                    
                    const proposalResult = await squadsService.proposeTieRefund(
                      (finalMatch as any).squadsVaultAddress,
                      new PublicKey(finalMatch.player1),
                      new PublicKey(finalMatch.player2),
                      refundAmount,
                      (finalMatch as any).squadsVaultPda ?? undefined,
                      tiePaymentStatus
                    );

                    if (proposalResult.success && proposalResult.proposalId) {
                      (finalMatch as any).payoutProposalId = proposalResult.proposalId;
                      (finalMatch as any).tieRefundProposalId = proposalResult.proposalId;
                      const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                      (finalMatch as any).proposalCreatedAt = new Date();
                      (finalMatch as any).proposalStatus = 'ACTIVE';
                      applyProposalStateToMatch(finalMatch, proposalState);
                      await matchRepository.save(finalMatch);
                      console.log('✅ Tie refund proposal created:', { matchId: finalMatch.id, proposalId: proposalResult.proposalId });
                    } else {
                      console.error('❌ Failed to create tie refund proposal:', proposalResult.error);
                    }
                    }
                  }
                } finally {
                  if (lockAcquired) {
                    await releaseProposalLock(finalMatch.id);
                  }
                }
              }
            } catch (proposalError: unknown) {
              const errorMessage = proposalError instanceof Error ? proposalError.message : String(proposalError);
              console.error('❌ Failed to create proposals after match completion:', errorMessage);
            }
          } else {
            // Fallback if reload fails
            updatedMatch.isCompleted = true;
            updatedMatch.winner = payoutResult.winner;
            updatedMatch.setPayoutResult(payoutResult);
            await matchRepository.save(updatedMatch);
            
            // CRITICAL: Ensure proposals are created for fallback save as well
            try {
              if (!(updatedMatch as any).payoutProposalId && !(updatedMatch as any).tieRefundProposalId && updatedMatch.winner && (updatedMatch as any).squadsVaultAddress) {
                // Acquire distributed lock to prevent race conditions
                const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
                const lockAcquired = await getProposalLock(updatedMatch.id);
                
                if (!lockAcquired) {
                  console.log('⚠️ Proposal lock not acquired (fallback), another process may be creating proposal. Reloading match...');
                  // Reload match to check if proposal was created by another process
                  const reloadedRows = await matchRepository.query(`
                    SELECT "payoutProposalId", "tieRefundProposalId"
                    FROM "match"
                    WHERE id = $1
                    LIMIT 1
                  `, [updatedMatch.id]);
                  if (reloadedRows && reloadedRows.length > 0 && (reloadedRows[0].payoutProposalId || reloadedRows[0].tieRefundProposalId)) {
                    console.log('✅ Proposal was created by another process (fallback)');
                    return; // Proposal already created
                  }
                }
                
                try {
                  // Double-check proposal still doesn't exist after acquiring lock
                  const checkRows = await matchRepository.query(`
                    SELECT "payoutProposalId", "tieRefundProposalId"
                    FROM "match"
                    WHERE id = $1
                    LIMIT 1
                  `, [updatedMatch.id]);
                  if (checkRows && checkRows.length > 0 && (checkRows[0].payoutProposalId || checkRows[0].tieRefundProposalId)) {
                    console.log('✅ Proposal already exists (fallback), skipping creation');
                    return; // Already created
                  }
                  
                const { PublicKey } = require('@solana/web3.js');
                const { SquadsVaultService } = require('../services/squadsVaultService');
                const squadsService = new SquadsVaultService();
                
                if (updatedMatch.winner !== 'tie') {
                  const winner = updatedMatch.winner;
                  const entryFee = updatedMatch.entryFee;
                  const totalPot = entryFee * 2;
                  const winnerAmount = totalPot * 0.95;
                  const feeAmount = totalPot * 0.05;

                  const proposalResult = await squadsService.proposeWinnerPayout(
                    (updatedMatch as any).squadsVaultAddress,
                    new PublicKey(winner),
                    winnerAmount,
                    new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                    feeAmount,
                    (updatedMatch as any).squadsVaultPda ?? undefined
                  );

                  if (proposalResult.success && proposalResult.proposalId) {
                      const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                      applyProposalStateToMatch(updatedMatch, proposalState);
                      await matchRepository.query(`
                        UPDATE "match"
                        SET "payoutProposalId" = $1, "proposalCreatedAt" = $2, "proposalStatus" = $3, "needsSignatures" = $4, "proposalSigners" = $5, "updatedAt" = $6
                        WHERE id = $7
                      `, [proposalResult.proposalId, new Date(), 'ACTIVE', proposalState.normalizedNeeds, proposalState.signersJson, new Date(), updatedMatch.id]);
                    console.log('✅ Winner payout proposal created (fallback):', { matchId: updatedMatch.id, proposalId: proposalResult.proposalId });
                  }
                } else {
                    // Parse player results from JSON strings
                    const player1ResultRaw = updatedMatch.player1Result;
                    const player2ResultRaw = updatedMatch.player2Result;
                    const player1Result = player1ResultRaw ? (typeof player1ResultRaw === 'string' ? JSON.parse(player1ResultRaw) : player1ResultRaw) : null;
                    const player2Result = player2ResultRaw ? (typeof player2ResultRaw === 'string' ? JSON.parse(player2ResultRaw) : player2ResultRaw) : null;
                  const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
                  
                  if (isLosingTie) {
                    const entryFee = updatedMatch.entryFee;
                    const refundAmount = entryFee * 0.95;
                    const tiePaymentStatus = {
                      ...(updatedMatch.player1Paid !== undefined && { player1Paid: !!updatedMatch.player1Paid }),
                      ...(updatedMatch.player2Paid !== undefined && { player2Paid: !!updatedMatch.player2Paid }),
                    };
                    
                    const proposalResult = await squadsService.proposeTieRefund(
                      (updatedMatch as any).squadsVaultAddress,
                      new PublicKey(updatedMatch.player1),
                      new PublicKey(updatedMatch.player2),
                      refundAmount,
                      (updatedMatch as any).squadsVaultPda ?? undefined,
                      tiePaymentStatus
                    );

                    if (proposalResult.success && proposalResult.proposalId) {
                        const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                        applyProposalStateToMatch(updatedMatch, proposalState);
                        await matchRepository.query(`
                          UPDATE "match"
                          SET "payoutProposalId" = $1, "tieRefundProposalId" = $2, "proposalCreatedAt" = $3, "proposalStatus" = $4, "needsSignatures" = $5, "proposalSigners" = $6, "updatedAt" = $7
                          WHERE id = $8
                        `, [proposalResult.proposalId, proposalResult.proposalId, new Date(), 'ACTIVE', proposalState.normalizedNeeds, proposalState.signersJson, new Date(), updatedMatch.id]);
                      console.log('✅ Tie refund proposal created (fallback):', { matchId: updatedMatch.id, proposalId: proposalResult.proposalId });
                    }
                    }
                  }
                } finally {
                  if (lockAcquired) {
                    await releaseProposalLock(updatedMatch.id);
                  }
                }
              }
            } catch (proposalError: unknown) {
              const errorMessage = proposalError instanceof Error ? proposalError.message : String(proposalError);
              console.error('❌ Failed to create proposals for fallback save:', errorMessage);
            }
          }
          
          // DELAYED CLEANUP: Only delete Redis state after both players have submitted
          // Don't delete immediately - wait a bit to allow the other player to submit
          // The game state will be cleaned up by TTL (1 hour) or when both players have definitely finished
          setTimeout(async () => {
            try {
              // Double-check both players have submitted before deleting
              const checkRows = await matchRepository.query(`
                SELECT "player1Result", "player2Result", "isCompleted"
                FROM "match"
                WHERE id = $1
              `, [matchId]);
              if (checkRows && checkRows.length > 0 && checkRows[0].isCompleted && 
                  checkRows[0].player1Result && checkRows[0].player2Result) {
                await deleteGameState(matchId);
                console.log(`🧹 Cleaned up Redis game state for completed match: ${matchId}`);
              }
            } catch (error) {
              console.warn('⚠️ Error in delayed cleanup:', error);
            }
          }, 30000); // Wait 30 seconds before cleanup to allow other player to submit
        
        res.json({
          status: 'completed',
          winner: (payoutResult as any).winner,
          payout: payoutResult,
          message: 'Game completed - winner determined'
        });
      } else {
        // Both players haven't finished yet - save partial result and wait using raw SQL
        console.log('⏳ Not all players finished yet (non-solved case), waiting for other player');
        // Result was already saved in the transaction above, no need to save again
        
        res.json({
          status: 'waiting',
          message: 'Waiting for other player to finish'
        });
      }
    }

  } catch (error: unknown) {
    console.error('❌ Error submitting result:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
const getMatchStatusHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;
    
    console.log('🔍 Looking up match status for:', matchId);

    const applyNoCacheHeaders = () => {
      res.set({
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
        'Surrogate-Control': 'no-store'
      });
    };
    
    // Try to find match in database first
    let match = null;
    let matchRepository: any = null;
    try {
      const { AppDataSource } = require('../db/index');
      matchRepository = AppDataSource.getRepository(Match);
      // Use raw SQL to avoid issues with missing columns like proposalExpiresAt
      const matchRows = await matchRepository.query(`
        SELECT 
          id, "player1", "player2", "entryFee", status, word,
          "squadsVaultAddress", "squadsVaultPda", "player1Paid", "player2Paid",
          "player1Result", "player2Result", "payoutResult",
          winner, "isCompleted", "createdAt", "updatedAt",
          "payoutProposalId", "tieRefundProposalId", "proposalStatus",
          "proposalSigners", "needsSignatures", "proposalExecutedAt",
          "proposalTransactionId", "entryFeeUSD", "solPriceAtTransaction",
          "bonusPercent", "bonusAmount", "bonusAmountUSD",
          "bonusSignature", "bonusPaid", "bonusPaidAt", "bonusTier",
          "refundReason", "refundedAt", "matchOutcome"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [matchId]);
      
      if (matchRows && matchRows.length > 0) {
        const row = matchRows[0];
        match = new Match();
        Object.assign(match, row);
        // Parse JSON fields
        if (row.proposalSigners) {
          try {
            (match as any).proposalSigners = typeof row.proposalSigners === 'string' ? JSON.parse(row.proposalSigners) : row.proposalSigners;
          } catch {
            (match as any).proposalSigners = [];
          }
        } else {
          (match as any).proposalSigners = [];
        }
        // Add helper methods
        (match as any).getPlayer1Result = () => {
          try {
            if (!row.player1Result) return null;
            // Handle both string and already-parsed object cases
            return typeof row.player1Result === 'string' ? JSON.parse(row.player1Result) : row.player1Result;
          } catch (error) {
            console.warn('⚠️ Failed to parse player1Result:', error);
            return null;
          }
        };
        (match as any).getPlayer2Result = () => {
          try {
            if (!row.player2Result) return null;
            // Handle both string and already-parsed object cases
            return typeof row.player2Result === 'string' ? JSON.parse(row.player2Result) : row.player2Result;
          } catch (error) {
            console.warn('⚠️ Failed to parse player2Result:', error);
            return null;
          }
        };
        (match as any).getPayoutResult = () => {
          try {
            return row.payoutResult ? JSON.parse(row.payoutResult) : null;
          } catch {
            return null;
          }
        };
      }
      if (match) {
        console.log('✅ Found match in database');
      }
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.warn('⚠️ Database lookup failed:', dbErrorMessage);
    }
    
    // If not found in database, check Redis matchmaking service
    if (!match) {
      console.log('🔍 Checking Redis matchmaking service...');
      try {
        const { redisMatchmakingService } = require('../services/redisMatchmakingService');
        const redisMatch = await redisMatchmakingService.getMatch(matchId);
        if (redisMatch) {
          console.log('✅ Found match in Redis matchmaking service');
          // Convert Redis match data to database match format
          match = {
            id: redisMatch.matchId,
            player1: redisMatch.player1,
            player2: redisMatch.player2,
            entryFee: redisMatch.entryFee,
            status: redisMatch.status,
            word: (redisMatch as any).word || null,
            createdAt: new Date(redisMatch.createdAt),
            updatedAt: new Date(redisMatch.createdAt), // Use createdAt as updatedAt for Redis matches
            squadsVaultAddress: (redisMatch as any).squadsVaultAddress || null,
            squadsVaultPda: (redisMatch as any).squadsVaultPda || null,
            // Add payment status fields (default to false for new matches)
            player1Paid: (redisMatch as any).player1Paid || false,
            player2Paid: (redisMatch as any).player2Paid || false,
            payoutResult: (redisMatch as any).payoutResult || null,
            // Add methods that the frontend expects
            getPlayer1Result: () => {
              const result = (redisMatch as any).player1Result;
              if (!result) return null;
              try {
                return JSON.parse(result);
              } catch {
                return null;
              }
            },
            getPlayer2Result: () => {
              const result = (redisMatch as any).player2Result;
              if (!result) return null;
              try {
                return JSON.parse(result);
              } catch {
                return null;
              }
            },
            getPayoutResult: () => {
              const result = (redisMatch as any).payoutResult;
              if (!result) return null;
              try {
                return JSON.parse(result);
              } catch {
                return null;
              }
            },
            isCompleted: redisMatch.status === 'completed',
            winner: (redisMatch as any).winner || null
          };
        } else {
          console.log('❌ Match not found in database or Redis matchmaking service');
          applyNoCacheHeaders();
          return res.status(404).json({ error: 'Match not found' });
        }
      } catch (redisError: unknown) {
        const redisErrorMessage = redisError instanceof Error ? redisError.message : String(redisError);
        console.warn('⚠️ Redis matchmaking service lookup failed:', redisErrorMessage);
        console.log('❌ Match not found in database or Redis');
        applyNoCacheHeaders();
        return res.status(404).json({ error: 'Match not found' });
      }
    }

    // Ensure we have a vault PDA when a vault exists
    if (match && (match as any).squadsVaultAddress && !(match as any).squadsVaultPda) {
      try {
        const { getSquadsVaultService } = require('../services/squadsVaultService');
        const squadsVaultService = getSquadsVaultService();
        const derivedVaultPda = squadsVaultService?.deriveVaultPda?.((match as any).squadsVaultAddress);

        if (derivedVaultPda) {
          (match as any).squadsVaultPda = derivedVaultPda;
          if (matchRepository) {
            try {
              await matchRepository.update(
                { id: match.id },
                { squadsVaultPda: derivedVaultPda }
              );
            } catch (updateError: unknown) {
              enhancedLogger.warn('⚠️ Failed to persist derived vault PDA (non-blocking)', {
                matchId: match.id,
                vaultAddress: (match as any).squadsVaultAddress,
                error: updateError instanceof Error ? updateError.message : String(updateError),
              });
            }
          }
        } else {
          enhancedLogger.warn('⚠️ Unable to derive vault PDA', {
            matchId: match.id,
            vaultAddress: (match as any).squadsVaultAddress,
          });
        }
      } catch (deriveErr: unknown) {
        enhancedLogger.warn('⚠️ Vault PDA derivation failed (non-blocking)', {
          matchId: match?.id,
          vaultAddress: (match as any)?.squadsVaultAddress,
          error: deriveErr instanceof Error ? deriveErr.message : String(deriveErr),
        });
      }
    }

    // Auto-create Squads vault if missing and match requires escrow
    try {
      if (match && !(match as any).squadsVaultAddress && ['payment_required', 'matched', 'escrow', 'active'].includes(match.status)) {
        // Rate limit vault creation attempts - only try once per 5 seconds per match
        const vaultCreationKey = `vault_creation_${match.id}`;
        const { getRedisMM } = require('../config/redis');
        const redis = getRedisMM();
        const lastAttempt = await redis.get(vaultCreationKey);
        const now = Date.now();
        const cooldownPeriod = 5000; // 5 seconds (reduced from 30s for faster retries)
        
        if (!lastAttempt || (now - parseInt(lastAttempt)) > cooldownPeriod) {
        console.log('🏦 No vault on match yet; attempting on-demand creation...', { matchId: match.id });
          // Mark that we're attempting vault creation
          await redis.set(vaultCreationKey, now.toString(), 'EX', 60); // Expire after 60 seconds
          
          try {
        const creation = await squadsVaultService.createMatchVault(
          match.id,
          new PublicKey(match.player1),
          new PublicKey(match.player2),
          match.entryFee
        );
        if (creation?.success && creation.vaultAddress) {
          const { AppDataSource } = require('../db/index');
          const matchRepository = AppDataSource.getRepository(Match);
          (match as any).squadsVaultAddress = creation.vaultAddress;
          (match as any).squadsVaultPda = creation.vaultPda ?? null;
          await matchRepository.update(
            { id: match.id },
            { 
              squadsVaultAddress: creation.vaultAddress,
              squadsVaultPda: creation.vaultPda ?? null,
              matchStatus: 'VAULT_CREATED'
            }
          );
          console.log('✅ Vault created on-demand for match', { matchId: match.id, vault: creation.vaultAddress, vaultPda: creation.vaultPda });
              // Clear the rate limit key on success
              await redis.del(vaultCreationKey);
            } else {
              console.warn('⚠️ On-demand vault creation failed', {
                matchId: match.id,
                error: creation?.error || 'Unknown error'
              });
            }
          } catch (creationErr) {
            console.warn('⚠️ On-demand vault creation exception', {
              matchId: match.id,
              error: creationErr instanceof Error ? creationErr.message : String(creationErr)
            });
          }
        } else {
          const timeSinceLastAttempt = now - parseInt(lastAttempt);
          const remainingCooldown = Math.ceil((cooldownPeriod - timeSinceLastAttempt) / 1000);
          console.log(`⏳ Vault creation cooldown active for match ${match.id} (${remainingCooldown}s remaining)`);
        }
      }
    } catch (onDemandErr) {
      console.warn('⚠️ On-demand vault creation check failed (non-blocking)', {
        matchId: match?.id,
        error: onDemandErr instanceof Error ? onDemandErr.message : String(onDemandErr)
      });
      // Don't throw - allow the response to continue
    }

    if (match && matchRepository) {
      try {
        await attemptAutoExecuteIfReady(match, matchRepository, 'status_poll');
      } catch (autoExecuteError: unknown) {
        enhancedLogger.error('❌ Auto-execute readiness check errored during status poll', {
          matchId: match?.id,
          error: autoExecuteError instanceof Error ? autoExecuteError.message : String(autoExecuteError),
        });
      }
    }

    // Check if this match already has results for the requesting player
    const requestingWallet = req.query.wallet || req.headers['x-wallet'];
    const isPlayer1 = match.player1 === requestingWallet;
    const existingResult = isPlayer1 ? match.getPlayer1Result() : match.getPlayer2Result();
    
    // Determine the appropriate status based on the requesting player's payment status
    let playerSpecificStatus = match.status;
    
    if (match.status === 'payment_required') {
      const requestingPlayerPaid = isPlayer1 ? match.player1Paid : match.player2Paid;
      const otherPlayerPaid = isPlayer1 ? match.player2Paid : match.player1Paid;
      
      if (requestingPlayerPaid && otherPlayerPaid) {
        // Both players have paid
        playerSpecificStatus = 'active';
      } else if (requestingPlayerPaid && !otherPlayerPaid) {
        // Requesting player has paid, waiting for other player
        playerSpecificStatus = 'waiting_for_payment';
      } else if (!requestingPlayerPaid) {
        // Requesting player hasn't paid yet
        playerSpecificStatus = 'payment_required';
      }
    } else if (match.status === 'cancelled') {
      const paidByEitherPlayer = !!(match.player1Paid || match.player2Paid);
      playerSpecificStatus = paidByEitherPlayer ? 'refund_pending' : 'cancelled';
    }
    
    console.log('✅ Returning match data:', {
      status: playerSpecificStatus,
      originalStatus: match.status,
      player1: match.player1,
      player2: match.player2,
      hasWord: !!match.word,
      requestingWallet,
      isPlayer1,
      requestingPlayerPaid: isPlayer1 ? match.player1Paid : match.player2Paid,
      otherPlayerPaid: isPlayer1 ? match.player2Paid : match.player1Paid,
      hasExistingResult: !!existingResult,
      player1Result: match.getPlayer1Result(),
      player2Result: match.getPlayer2Result(),
      winner: match.winner,
      isCompleted: match.isCompleted
    });

    // If match has existing results, mark it as completed
    if (existingResult) {
      playerSpecificStatus = 'completed';
      match.isCompleted = true;
    }

  // If match is completed but winner is missing, OR both players have results but match isn't marked completed, recalculate and save it
  const player1Result = match.getPlayer1Result();
  const player2Result = match.getPlayer2Result();
  const bothHaveResults = !!player1Result && !!player2Result;
  const atLeastOneHasResult = !!player1Result || !!player2Result;
  const shouldRecalculate = (match.isCompleted && !match.winner) || (bothHaveResults && (!match.isCompleted || !match.winner));
  
  if (shouldRecalculate) {
    console.log('⚠️ Match needs winner calculation - recalculating...', { 
      matchId: match.id,
      isCompleted: match.isCompleted,
      hasWinner: !!match.winner,
      bothHaveResults,
      atLeastOneHasResult,
      hasPlayer1Result: !!player1Result,
      hasPlayer2Result: !!player2Result,
      player1Result: player1Result ? { won: player1Result.won, numGuesses: player1Result.numGuesses } : null,
      player2Result: player2Result ? { won: player2Result.won, numGuesses: player2Result.numGuesses } : null
    });
    
    // determineWinnerAndPayout can handle cases where only one player has results
    // It will determine winner based on who has results and whether they won
    if (atLeastOneHasResult) {
      try {
        console.log('🔄 Calling determineWinnerAndPayout with:', {
          matchId: match.id,
          player1Result: { won: player1Result.won, numGuesses: player1Result.numGuesses },
          player2Result: { won: player2Result.won, numGuesses: player2Result.numGuesses }
        });
        const recalculatedPayout = await determineWinnerAndPayout(match.id, player1Result, player2Result);
        console.log('✅ determineWinnerAndPayout completed, payoutResult:', recalculatedPayout ? { winner: recalculatedPayout.winner } : null);
        // Reload match to get the updated winner and all fields using raw SQL
        const { AppDataSource } = require('../db/index');
        const matchRepository = AppDataSource.getRepository(Match);
        const reloadedRows = await matchRepository.query(`
          SELECT 
            id, winner, "payoutResult", "payoutProposalId", 
            "proposalStatus", "proposalCreatedAt", "needsSignatures"
          FROM "match"
          WHERE id = $1
          LIMIT 1
        `, [match.id]);
        if (reloadedRows && reloadedRows.length > 0) {
          const reloadedRow = reloadedRows[0];
          console.log('🔄 Reloaded match after determineWinnerAndPayout:', {
            matchId: match.id,
            winner: reloadedRow.winner,
            hasPayoutResult: !!reloadedRow.payoutResult
          });
          match.winner = reloadedRow.winner;
          try {
            const reloadedPayoutResult = reloadedRow.payoutResult ? JSON.parse(reloadedRow.payoutResult) : null;
          if (reloadedPayoutResult) {
            match.setPayoutResult(reloadedPayoutResult);
            }
          } catch (e) {
            // Ignore parse errors
          }
          // Copy proposal fields
          (match as any).payoutProposalId = reloadedRow.payoutProposalId;
          (match as any).proposalStatus = reloadedRow.proposalStatus;
          (match as any).proposalCreatedAt = reloadedRow.proposalCreatedAt;
          (match as any).needsSignatures = reloadedRow.needsSignatures;
          console.log('✅ Winner recalculated and saved:', { 
            matchId: match.id, 
            winner: match.winner,
            payoutProposalId: (match as any).payoutProposalId
          });
          
          // If payout proposal is missing, create it based on match outcome
          if (!(match as any).payoutProposalId && !(match as any).tieRefundProposalId && match.winner && (match as any).squadsVaultAddress) {
            console.log('⚠️ Payout proposal missing, creating now...', { matchId: match.id, winner: match.winner });
            try {
              const { PublicKey } = require('@solana/web3.js');
              const { squadsVaultService } = require('../services/squadsVaultService');
              
              if (match.winner !== 'tie') {
                // Winner payout proposal
                const winner = match.winner;
                const entryFee = match.entryFee;
                const totalPot = entryFee * 2;
                const winnerAmount = totalPot * 0.95;
                const feeAmount = totalPot * 0.05;

                const proposalResult = await squadsVaultService.proposeWinnerPayout(
                  (match as any).squadsVaultAddress,
                  new PublicKey(winner),
                  winnerAmount,
                  new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
                  feeAmount,
                  (match as any).squadsVaultPda ?? undefined
                );

                if (proposalResult.success) {
                  const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                  (match as any).payoutProposalId = proposalResult.proposalId;
                  (match as any).proposalCreatedAt = new Date();
                  (match as any).proposalStatus = 'ACTIVE';
                  applyProposalStateToMatch(match, proposalState);
                  await matchRepository.save(match);
                  console.log('✅ Payout proposal created for missing winner:', { matchId: match.id, proposalId: proposalResult.proposalId, signers: proposalState.signers, needsSignatures: proposalState.normalizedNeeds });
                }
              } else {
                // Tie refund proposal
                const player1Result = match.getPlayer1Result();
                const player2Result = match.getPlayer2Result();
                const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
                
                if (isLosingTie) {
                  const entryFee = match.entryFee;
                  const refundAmount = entryFee * 0.95; // 95% refund
                  
                  console.log('🔄 Attempting to create tie refund proposal', {
                    matchId: match.id,
                    vaultAddress: (match as any).squadsVaultAddress,
                    player1: match.player1,
                    player2: match.player2,
                    refundAmount,
                  });
                  const tiePaymentStatus = {
                    ...(match.player1Paid !== undefined && { player1Paid: !!match.player1Paid }),
                    ...(match.player2Paid !== undefined && { player2Paid: !!match.player2Paid }),
                  };
                  
                  const proposalResult = await squadsVaultService.proposeTieRefund(
                    (match as any).squadsVaultAddress,
                    new PublicKey(match.player1),
                    new PublicKey(match.player2),
                    refundAmount,
                    (match as any).squadsVaultPda ?? undefined,
                    tiePaymentStatus
                  );

                  if (proposalResult.success && proposalResult.proposalId) {
                    const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                    (match as any).payoutProposalId = proposalResult.proposalId;
                    (match as any).tieRefundProposalId = proposalResult.proposalId;
                    (match as any).proposalCreatedAt = new Date();
                    (match as any).proposalStatus = 'ACTIVE';
                    applyProposalStateToMatch(match, proposalState);
                    
                    // CRITICAL: Set proposal expiration (30 minutes after creation)
                    const { proposalExpirationService } = require('../services/proposalExpirationService');
                    proposalExpirationService.setProposalExpiration(match);
                    
                    await matchRepository.save(match);
                    console.log('✅ Tie refund proposal created:', { matchId: match.id, proposalId: proposalResult.proposalId, signers: proposalState.signers, needsSignatures: proposalState.normalizedNeeds });
                    
                    // Reload match to ensure we have the latest proposal data
                    // Use raw SQL to avoid proposalExpiresAt column errors
                    const reloadedRows = await matchRepository.query(`
                      SELECT 
                        "payoutProposalId", "tieRefundProposalId", 
                        "proposalStatus", "proposalCreatedAt", "needsSignatures"
                      FROM "match"
                      WHERE id = $1
                      LIMIT 1
                    `, [match.id]);
                    if (reloadedRows && reloadedRows.length > 0) {
                      const reloadedRow = reloadedRows[0];
                      (match as any).payoutProposalId = reloadedRow.payoutProposalId;
                      (match as any).tieRefundProposalId = reloadedRow.tieRefundProposalId;
                      (match as any).proposalStatus = reloadedRow.proposalStatus;
                      (match as any).proposalCreatedAt = reloadedRow.proposalCreatedAt;
                      (match as any).needsSignatures = reloadedRow.needsSignatures;
                    }
                  } else {
                    console.error('❌ Failed to create tie refund proposal:', {
                      matchId: match.id,
                      success: proposalResult.success,
                      proposalId: proposalResult.proposalId,
                      error: proposalResult.error,
                      needsSignatures: proposalResult.needsSignatures,
                    });
                  }
                } else {
                  console.warn('⚠️ Tie detected but isLosingTie check failed:', {
                    matchId: match.id,
                    player1Result: player1Result ? { won: player1Result.won, numGuesses: player1Result.numGuesses } : null,
                    player2Result: player2Result ? { won: player2Result.won, numGuesses: player2Result.numGuesses } : null,
                  });
                }
              }
            } catch (proposalError: unknown) {
              const errorMessage = proposalError instanceof Error ? proposalError.message : String(proposalError);
              console.error('❌ Error creating payout proposal:', errorMessage);
            }
          }
        }
      } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('❌ Error recalculating winner:', errorMessage);
      }
    } else {
      console.warn('⚠️ Cannot recalculate winner: no player results found', {
        matchId: match.id,
        isCompleted: match.isCompleted,
        hasPlayer1Result: !!player1Result,
        hasPlayer2Result: !!player2Result,
        player1Result: player1Result ? { won: player1Result.won, numGuesses: player1Result.numGuesses } : null,
        player2Result: player2Result ? { won: player2Result.won, numGuesses: player2Result.numGuesses } : null
      });
    }
  }

  // Get payout result and ensure refund signatures are included
  let payoutResult = match.getPayoutResult();
  if (payoutResult && (match.player1RefundSignature || match.player2RefundSignature)) {
    // Add refund signatures from database if not already in payout result
    if (!payoutResult.player1RefundSignature && match.player1RefundSignature) {
      payoutResult.player1RefundSignature = match.player1RefundSignature;
    }
    if (!payoutResult.player2RefundSignature && match.player2RefundSignature) {
      payoutResult.player2RefundSignature = match.player2RefundSignature;
    }
  }

  // FINAL FALLBACK: If proposal is still missing and match is completed, create it now
  // This ensures proposals are created even if the earlier code paths didn't execute
  // CRITICAL: Reload match from database to ensure we have the latest vault address
  // The vault might have been created after the match was initially loaded
  let freshMatch = match;
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    // Use raw SQL to avoid proposalExpiresAt column errors
    const reloadedRows = await matchRepository.query(`
      SELECT 
        id, "squadsVaultAddress", "squadsVaultPda", "payoutProposalId", "tieRefundProposalId",
        winner, "isCompleted", "player1Result", "player2Result", "payoutResult"
      FROM "match"
      WHERE id = $1
      LIMIT 1
    `, [match.id]);
    if (reloadedRows && reloadedRows.length > 0) {
      const reloadedRow = reloadedRows[0];
      // Update match object with reloaded data
      (freshMatch as any).squadsVaultAddress = reloadedRow.squadsVaultAddress || (freshMatch as any).squadsVaultAddress;
      (freshMatch as any).squadsVaultPda = reloadedRow.squadsVaultPda || (freshMatch as any).squadsVaultPda;
      (freshMatch as any).payoutProposalId = reloadedRow.payoutProposalId || (freshMatch as any).payoutProposalId;
      (freshMatch as any).tieRefundProposalId = reloadedRow.tieRefundProposalId || (freshMatch as any).tieRefundProposalId;
      freshMatch.winner = reloadedRow.winner || freshMatch.winner;
      freshMatch.isCompleted = reloadedRow.isCompleted || freshMatch.isCompleted;
      // Copy any methods that might be missing
      if (!freshMatch.getPlayer1Result) {
        freshMatch.getPlayer1Result = match.getPlayer1Result;
      }
      if (!freshMatch.getPlayer2Result) {
        freshMatch.getPlayer2Result = match.getPlayer2Result;
      }
      if (!freshMatch.getPayoutResult) {
        freshMatch.getPayoutResult = match.getPayoutResult;
      }
    }
  } catch (reloadError) {
    console.warn('⚠️ Failed to reload match for final fallback, using cached match:', reloadError);
  }
  
  // Log current state for debugging
  // Reuse player1Result and player2Result from earlier in the function (line 2788-2789)
  // If freshMatch was reloaded, get results from it, otherwise use the existing variables
  const finalPlayer1Result = freshMatch.getPlayer1Result ? freshMatch.getPlayer1Result() : player1Result;
  const finalPlayer2Result = freshMatch.getPlayer2Result ? freshMatch.getPlayer2Result() : player2Result;
  const hasResults = !!finalPlayer1Result && !!finalPlayer2Result;
  const isTieMatch = freshMatch.winner === 'tie';
  const hasWinner = freshMatch.winner && freshMatch.winner !== 'tie';
  const needsProposal = !(freshMatch as any).payoutProposalId && !(freshMatch as any).tieRefundProposalId;
  const hasVault = !!(freshMatch as any).squadsVaultAddress;
  
  console.log('🔍 FINAL FALLBACK CHECK:', {
    matchId: freshMatch.id,
    isCompleted: freshMatch.isCompleted,
    winner: freshMatch.winner,
    hasPayoutProposalId: !!(freshMatch as any).payoutProposalId,
    hasTieRefundProposalId: !!(freshMatch as any).tieRefundProposalId,
    hasSquadsVaultAddress: hasVault,
    squadsVaultAddress: (freshMatch as any).squadsVaultAddress,
    squadsVaultPda: (freshMatch as any).squadsVaultPda,
    player1Result: finalPlayer1Result ? { won: finalPlayer1Result.won, numGuesses: finalPlayer1Result.numGuesses } : null,
    player2Result: finalPlayer2Result ? { won: finalPlayer2Result.won, numGuesses: finalPlayer2Result.numGuesses } : null,
    hasResults,
    isTieMatch,
    hasWinner,
    needsProposal,
    willCreateWinnerProposal: hasResults && hasWinner && needsProposal && hasVault,
    willCreateTieProposal: hasResults && isTieMatch && needsProposal && hasVault,
  });
  
  // Create proposal for winner payout (non-tie matches)
  if (hasResults && hasWinner && needsProposal && hasVault) {
    console.log('🔄 FINAL FALLBACK: Creating missing winner payout proposal before response', {
      matchId: freshMatch.id,
      winner: freshMatch.winner,
      isCompleted: freshMatch.isCompleted,
      hasVault: hasVault,
      hasResults: hasResults,
      squadsVaultAddress: (freshMatch as any).squadsVaultAddress
    });
    
    // Acquire distributed lock to prevent race conditions
    const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
    const lockAcquired = await getProposalLock(freshMatch.id);
    
    if (!lockAcquired) {
      console.log('⚠️ Proposal lock not acquired (FINAL FALLBACK winner), another process may be creating proposal. Reloading match...');
      // Reload match to check if proposal was created by another process
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      const reloadedRows = await matchRepository.query(`
        SELECT "payoutProposalId", "tieRefundProposalId"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [freshMatch.id]);
      if (reloadedRows && reloadedRows.length > 0 && (reloadedRows[0].payoutProposalId || reloadedRows[0].tieRefundProposalId)) {
        console.log('✅ Proposal was created by another process (FINAL FALLBACK winner)');
        // Update match object with new proposal
        (match as any).payoutProposalId = reloadedRows[0].payoutProposalId || (match as any).payoutProposalId;
        (match as any).tieRefundProposalId = reloadedRows[0].tieRefundProposalId || (match as any).tieRefundProposalId;
      }
    } else {
      try {
        // Double-check proposal still doesn't exist after acquiring lock
        const { AppDataSource } = require('../db/index');
        const matchRepository = AppDataSource.getRepository(Match);
        const checkRows = await matchRepository.query(`
          SELECT "payoutProposalId", "tieRefundProposalId"
          FROM "match"
          WHERE id = $1
          LIMIT 1
        `, [freshMatch.id]);
        if (checkRows && checkRows.length > 0 && (checkRows[0].payoutProposalId || checkRows[0].tieRefundProposalId)) {
          console.log('✅ Proposal already exists (FINAL FALLBACK winner), skipping creation');
          // Update match object
          (match as any).payoutProposalId = checkRows[0].payoutProposalId || (match as any).payoutProposalId;
          (match as any).tieRefundProposalId = checkRows[0].tieRefundProposalId || (match as any).tieRefundProposalId;
        } else {
          const { PublicKey } = require('@solana/web3.js');
          const { squadsVaultService } = require('../services/squadsVaultService');
          
          const winner = freshMatch.winner;
          const entryFee = freshMatch.entryFee;
          const totalPot = entryFee * 2;
          const winnerAmount = totalPot * 0.95;
          const feeAmount = totalPot * 0.05;
          
          const proposalResult = await squadsVaultService.proposeWinnerPayout(
            (freshMatch as any).squadsVaultAddress,
            new PublicKey(winner),
            winnerAmount,
            new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
            feeAmount,
            (freshMatch as any).squadsVaultPda ?? undefined
          );
          
          if (proposalResult.success && proposalResult.proposalId) {
            const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
            applyProposalStateToMatch(match, proposalState);

            // Update match with proposal data using raw SQL
            await matchRepository.query(`
              UPDATE "match"
              SET "payoutProposalId" = $1,
                  "proposalStatus" = $2,
                  "proposalCreatedAt" = NOW(),
                  "needsSignatures" = $3,
                  "proposalSigners" = $4
              WHERE id = $5
            `, [proposalResult.proposalId, 'ACTIVE', proposalState.normalizedNeeds, proposalState.signersJson, freshMatch.id]);
            
            // Update match object
            (match as any).payoutProposalId = proposalResult.proposalId;
            (match as any).proposalStatus = 'ACTIVE';
            (match as any).proposalCreatedAt = new Date();
            (match as any).needsSignatures = proposalState.normalizedNeeds;
            
            console.log('✅ FINAL FALLBACK: Winner payout proposal created and saved successfully', {
              matchId: freshMatch.id,
              proposalId: proposalResult.proposalId,
              proposalStatus: (match as any).proposalStatus,
              needsSignatures: (match as any).needsSignatures,
              signers: proposalState.signers
            });
          } else {
            console.error('❌ FINAL FALLBACK: Failed to create winner payout proposal', {
              matchId: match.id,
              success: proposalResult.success,
              proposalId: proposalResult.proposalId,
              error: proposalResult.error,
              needsSignatures: proposalResult.needsSignatures
            });
          }
        }
      } catch (fallbackError: unknown) {
        const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error('❌ FINAL FALLBACK: Error creating winner payout proposal', {
          matchId: match.id,
          error: errorMessage
        });
      } finally {
        await releaseProposalLock(freshMatch.id);
      }
    }
  }
  // Create proposal for tie refund (tie matches)
  if (hasResults && isTieMatch && needsProposal && hasVault) {
    
    console.log('🔄 FINAL FALLBACK: Creating missing proposal before response', {
      matchId: freshMatch.id,
      winner: freshMatch.winner,
      isCompleted: freshMatch.isCompleted,
      hasVault: hasVault,
      hasResults: hasResults,
      squadsVaultAddress: (freshMatch as any).squadsVaultAddress
    });
    
    // Acquire distributed lock to prevent race conditions
    const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
    const lockAcquired = await getProposalLock(freshMatch.id);
    
    if (!lockAcquired) {
      console.log('⚠️ Proposal lock not acquired (FINAL FALLBACK tie), another process may be creating proposal. Reloading match...');
      // Reload match to check if proposal was created by another process
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      const reloadedRows = await matchRepository.query(`
        SELECT "payoutProposalId", "tieRefundProposalId"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [freshMatch.id]);
      if (reloadedRows && reloadedRows.length > 0 && (reloadedRows[0].payoutProposalId || reloadedRows[0].tieRefundProposalId)) {
        console.log('✅ Proposal was created by another process (FINAL FALLBACK tie)');
        // Update match object with new proposal
        (match as any).payoutProposalId = reloadedRows[0].payoutProposalId || (match as any).payoutProposalId;
        (match as any).tieRefundProposalId = reloadedRows[0].tieRefundProposalId || (match as any).tieRefundProposalId;
      }
    } else {
      try {
        // Double-check proposal still doesn't exist after acquiring lock
        const { AppDataSource } = require('../db/index');
        const matchRepository = AppDataSource.getRepository(Match);
        const checkRows = await matchRepository.query(`
          SELECT "payoutProposalId", "tieRefundProposalId"
          FROM "match"
          WHERE id = $1
          LIMIT 1
        `, [freshMatch.id]);
        if (checkRows && checkRows.length > 0 && (checkRows[0].payoutProposalId || checkRows[0].tieRefundProposalId)) {
          console.log('✅ Proposal already exists (FINAL FALLBACK tie), skipping creation');
          // Update match object
          (match as any).payoutProposalId = checkRows[0].payoutProposalId || (match as any).payoutProposalId;
          (match as any).tieRefundProposalId = checkRows[0].tieRefundProposalId || (match as any).tieRefundProposalId;
        } else {
          const { PublicKey } = require('@solana/web3.js');
          const { squadsVaultService } = require('../services/squadsVaultService');
          
          if (freshMatch.winner === 'tie') {
            const player1Result = freshMatch.getPlayer1Result();
            const player2Result = freshMatch.getPlayer2Result();
            const isLosingTie = player1Result && player2Result && !player1Result.won && !player2Result.won;
            
            if (isLosingTie) {
              const entryFee = freshMatch.entryFee;
              const refundAmount = entryFee * 0.95;
              
              console.log('🔄 FINAL FALLBACK: Creating tie refund proposal', {
                matchId: freshMatch.id,
                refundAmount,
                player1: freshMatch.player1,
                player2: freshMatch.player2,
                squadsVaultAddress: (freshMatch as any).squadsVaultAddress
              });
              const tiePaymentStatus = {
                ...(freshMatch.player1Paid !== undefined && { player1Paid: !!freshMatch.player1Paid }),
                ...(freshMatch.player2Paid !== undefined && { player2Paid: !!freshMatch.player2Paid }),
              };
              
              const proposalResult = await squadsVaultService.proposeTieRefund(
                (freshMatch as any).squadsVaultAddress,
                new PublicKey(freshMatch.player1),
                new PublicKey(freshMatch.player2),
                refundAmount,
                (freshMatch as any).squadsVaultPda ?? undefined,
                tiePaymentStatus
              );
              
              if (proposalResult.success && proposalResult.proposalId) {
                const proposalState = buildInitialProposalState(proposalResult.needsSignatures);
                applyProposalStateToMatch(freshMatch, proposalState);
                // Update match with proposal data
                (freshMatch as any).payoutProposalId = proposalResult.proposalId;
                (freshMatch as any).tieRefundProposalId = proposalResult.proposalId;
                (freshMatch as any).proposalCreatedAt = new Date();
                (freshMatch as any).proposalStatus = 'ACTIVE';
                
                // Ensure match is marked as completed
                if (!freshMatch.isCompleted) {
                  freshMatch.isCompleted = true;
                }
                
                // Save match
                await matchRepository.save(freshMatch);
                
                // Reload to ensure we have the latest data and update the match reference
                // Use raw SQL to avoid proposalExpiresAt column errors
                const reloadedRows = await matchRepository.query(`
                  SELECT 
                    "payoutProposalId", "tieRefundProposalId", "proposalStatus",
                    "proposalCreatedAt", "needsSignatures", winner, "isCompleted"
                  FROM "match"
                  WHERE id = $1
                  LIMIT 1
                `, [freshMatch.id]);
                if (reloadedRows && reloadedRows.length > 0) {
                  const reloadedRow = reloadedRows[0];
                  (match as any).payoutProposalId = reloadedRow.payoutProposalId;
                  (match as any).tieRefundProposalId = reloadedRow.tieRefundProposalId;
                  (match as any).proposalStatus = reloadedRow.proposalStatus;
                  (match as any).proposalCreatedAt = reloadedRow.proposalCreatedAt;
                  (match as any).needsSignatures = reloadedRow.needsSignatures;
                  match.winner = reloadedRow.winner || match.winner;
                  match.isCompleted = reloadedRow.isCompleted || match.isCompleted;
                }
                
                console.log('✅ FINAL FALLBACK: Tie refund proposal created and saved successfully', {
                  matchId: freshMatch.id,
                  proposalId: proposalResult.proposalId,
                  proposalStatus: (match as any).proposalStatus,
                  needsSignatures: (match as any).needsSignatures,
                  signers: proposalState.signers
                });
              } else {
                console.error('❌ FINAL FALLBACK: Failed to create tie refund proposal', {
                  matchId: match.id,
                  success: proposalResult.success,
                  proposalId: proposalResult.proposalId,
                  error: proposalResult.error,
                  needsSignatures: proposalResult.needsSignatures
                });
              }
            }
          }
        }
      } catch (fallbackError: unknown) {
        const errorMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        console.error('❌ FINAL FALLBACK: Error creating proposal', {
          matchId: match.id,
          error: errorMessage
        });
      } finally {
        await releaseProposalLock(freshMatch.id);
      }
    }
  }

  // CRITICAL: Execute proposals that are READY_TO_EXECUTE but haven't been executed yet
  // This is a fallback in case execution failed during signProposalHandler
  if ((match as any).proposalStatus === 'READY_TO_EXECUTE' && 
      ((match as any).payoutProposalId || (match as any).tieRefundProposalId) &&
      (match as any).squadsVaultAddress &&
      !(match as any).proposalExecutedAt) {
    console.log('🚀 Found READY_TO_EXECUTE proposal - executing now (fallback)', {
      matchId: match.id,
      payoutProposalId: (match as any).payoutProposalId,
      tieRefundProposalId: (match as any).tieRefundProposalId,
    });
    
    try {
      const { getSquadsVaultService } = require('../services/squadsVaultService');
      const { getFeeWalletKeypair, getFeeWalletAddress, FEE_WALLET_ADDRESS } = require('../config/wallet');
      const squadsVaultService = getSquadsVaultService();
      const matchRepository = AppDataSource.getRepository(Match);
      
      let feeWalletKeypair: any = null;
      try {
        feeWalletKeypair = getFeeWalletKeypair();
      } catch (keypairError: any) {
        console.warn('⚠️ Fee wallet keypair unavailable, skipping automatic proposal execution (fallback)', {
          matchId: match.id,
          error: keypairError?.message || String(keypairError),
        });
      }

      const proposalId = (match as any).payoutProposalId || (match as any).tieRefundProposalId;
      const proposalIdString = String(proposalId).trim();
      
      const feeWalletAddress =
        typeof getFeeWalletAddress === 'function' ? getFeeWalletAddress() : FEE_WALLET_ADDRESS;
      const proposalSigners = normalizeProposalSigners((match as any).proposalSigners);
      let autoApproved = false;
      let feeWalletApprovalError: string | null = null;

      if (!proposalSigners.includes(feeWalletAddress) && feeWalletKeypair) {
        try {
          const approveResult = await squadsVaultService.approveProposal(
            (match as any).squadsVaultAddress,
            proposalIdString,
            feeWalletKeypair
          );

          if (approveResult.success) {
            autoApproved = true;
            proposalSigners.push(feeWalletAddress);
            const updatedSignersJson = JSON.stringify(Array.from(new Set(proposalSigners)));
            await matchRepository.query(`
              UPDATE "match"
              SET "proposalSigners" = $1,
                  "needsSignatures" = 0
              WHERE id = $2
            `, [updatedSignersJson, match.id]);
            (match as any).proposalSigners = updatedSignersJson;
            (match as any).needsSignatures = 0;
            console.log('✅ Fallback auto-approval from fee wallet recorded', {
              matchId: match.id,
              proposalId: proposalIdString,
              signature: approveResult.signature,
            });
          } else {
            feeWalletApprovalError = approveResult.error || 'Unknown error';
            console.error('❌ Fallback fee wallet auto-approval failed', {
              matchId: match.id,
              proposalId: proposalIdString,
              error: approveResult.error,
            });
          }
        } catch (autoApproveError: any) {
          feeWalletApprovalError = autoApproveError?.message || String(autoApproveError);
          console.warn('⚠️ Fallback fee wallet auto-approval unavailable', {
            matchId: match.id,
            proposalId: proposalIdString,
            error: feeWalletApprovalError,
          });
        }
      }

      const finalProposalSigners = Array.from(new Set(proposalSigners));
      const hasFeeWalletSignature = finalProposalSigners.includes(feeWalletAddress);
      const entryFeeSolFallback = (match as any).entryFee ? Number((match as any).entryFee) : 0;
      const entryFeeUsdFallback = (match as any).entryFeeUSD ? Number((match as any).entryFeeUSD) : undefined;
      const solPriceAtTransactionFallback = (match as any).solPriceAtTransaction ? Number((match as any).solPriceAtTransaction) : undefined;
      const bonusAlreadyPaidFallback = (match as any).bonusPaid === true;
      const bonusSignatureExistingFallback = (match as any).bonusSignature || null;
      
      // Check on-chain proposal status to verify it's actually ready
      // But trust database state if on-chain check fails or shows mismatch
      let onChainReady = false;
      let onChainCheckFailed = false;
      try {
        const proposalStatus = await squadsVaultService.checkProposalStatus(
          (match as any).squadsVaultAddress,
          proposalIdString
        );
        onChainReady = proposalStatus.needsSignatures === 0 && !proposalStatus.executed;
        console.log('🔍 On-chain proposal status check (fallback)', {
          matchId: match.id,
          proposalId: proposalIdString,
          onChainReady,
          needsSignatures: proposalStatus.needsSignatures,
          executed: proposalStatus.executed,
          signers: proposalStatus.signers.map((s: any) => s.toString()),
          databaseNeedsSignatures: normalizeRequiredSignatures((match as any).needsSignatures),
          databaseSigners: finalProposalSigners,
        });
        
        // If database says ready but on-chain says not ready, trust database
        // (on-chain check might be failing to read signers correctly)
        const dbNeedsSignatures = normalizeRequiredSignatures((match as any).needsSignatures);
        if (dbNeedsSignatures === 0 && proposalStatus.needsSignatures > 0) {
          console.warn('⚠️ Database shows ready but on-chain shows not ready - trusting database state', {
            matchId: match.id,
            proposalId: proposalIdString,
            databaseNeedsSignatures: dbNeedsSignatures,
            onChainNeedsSignatures: proposalStatus.needsSignatures,
            databaseSigners: finalProposalSigners.length,
            onChainSigners: proposalStatus.signers.length,
          });
          onChainReady = true; // Trust database
        }
      } catch (statusCheckError: any) {
        onChainCheckFailed = true;
        console.warn('⚠️ Failed to check on-chain proposal status (fallback) - trusting database state', {
          matchId: match.id,
          proposalId: proposalIdString,
          error: statusCheckError?.message || String(statusCheckError),
          databaseNeedsSignatures: normalizeRequiredSignatures((match as any).needsSignatures),
          databaseSigners: finalProposalSigners,
        });
        // Trust database state if on-chain check fails
        const dbNeedsSignatures = normalizeRequiredSignatures((match as any).needsSignatures);
        onChainReady = dbNeedsSignatures === 0;
      }

      // Trust database state: if database says needsSignatures === 0, proceed with execution
      const dbNeedsSignatures = normalizeRequiredSignatures((match as any).needsSignatures);
      const dbSaysReady = dbNeedsSignatures === 0 && (match as any).proposalStatus === 'READY_TO_EXECUTE';
      
      if (!hasFeeWalletSignature && !onChainReady && !dbSaysReady) {
        console.warn('⚠️ Skipping fallback execution - not ready in database or on-chain', {
          matchId: match.id,
          proposalId: proposalIdString,
          proposalSigners: finalProposalSigners,
          feeWalletApprovalError,
          dbNeedsSignatures,
          dbSaysReady,
          onChainReady,
        });
      } else if (feeWalletKeypair && (hasFeeWalletSignature || onChainReady || dbSaysReady)) {
        console.log('🔁 Auto-execute (fallback) using vault PDA', {
          matchId: match.id,
          proposalId: proposalIdString,
          vaultAddress: (match as any).squadsVaultAddress,
          vaultPda: (match as any).squadsVaultPda ?? null,
        });
        const executeResult = await squadsVaultService.executeProposal(
          (match as any).squadsVaultAddress,
          proposalIdString,
          feeWalletKeypair,
          (match as any).squadsVaultPda ?? undefined
        );
        
        if (executeResult.success) {
          const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
          const isTieRefund =
            !!(match as any).tieRefundProposalId &&
            String((match as any).tieRefundProposalId).trim() === proposalIdString;
          const isWinnerPayout =
            !!(match as any).payoutProposalId &&
            String((match as any).payoutProposalId).trim() === proposalIdString &&
            (match as any).winner &&
            (match as any).winner !== 'tie';

          const executionUpdates = buildProposalExecutionUpdates({
            executedAt,
            signature: executeResult.signature ?? null,
            isTieRefund,
            isWinnerPayout,
          });

          await persistExecutionUpdates(matchRepository, match.id, executionUpdates);
          applyExecutionUpdatesToMatch(match as any, executionUpdates);

          console.log('✅ Proposal executed successfully (fallback)', {
            matchId: match.id,
            proposalId: proposalIdString,
            executionSignature: executeResult.signature,
            slot: executeResult.slot,
            signers: finalProposalSigners,
            autoApproved,
          });

          if (isWinnerPayout) {
            try {
              if (!executeResult.signature) {
                console.warn('⚠️ Skipping bonus payout because execution signature is missing', {
                  matchId: match.id,
                  proposalId: proposalIdString
                });
              } else {
                const bonusResult = await disburseBonusIfEligible({
                  matchId: match.id,
                  winner: (match as any).winner,
                  entryFeeSol: entryFeeSolFallback,
                  entryFeeUsd: entryFeeUsdFallback,
                  solPriceAtTransaction: solPriceAtTransactionFallback,
                  alreadyPaid: bonusAlreadyPaidFallback,
                  existingSignature: bonusSignatureExistingFallback,
                  executionSignature: executeResult.signature,
                  executionTimestamp: executedAt,
                  executionSlot: executeResult.slot
                });

                if (bonusResult.triggered && bonusResult.success && bonusResult.signature) {
                  await matchRepository.query(`
                  UPDATE "match"
                  SET "bonusPaid" = true,
                      "bonusSignature" = $1,
                      "bonusAmount" = $2,
                      "bonusAmountUSD" = $3,
                      "bonusPercent" = $4,
                      "bonusTier" = $5,
                      "bonusPaidAt" = NOW(),
                      "solPriceAtTransaction" = COALESCE("solPriceAtTransaction", $6)
                  WHERE id = $7
                `, [
                    bonusResult.signature,
                    bonusResult.bonusSol ?? null,
                    bonusResult.bonusUsd ?? null,
                    bonusResult.bonusPercent ?? null,
                    bonusResult.tierId ?? null,
                    bonusResult.solPriceUsed ?? null,
                    match.id,
                  ]);

                  (match as any).bonusPaid = true;
                  (match as any).bonusSignature = bonusResult.signature;
                  (match as any).bonusAmount = bonusResult.bonusSol ?? null;
                  (match as any).bonusAmountUSD = bonusResult.bonusUsd ?? null;
                  (match as any).bonusPercent = bonusResult.bonusPercent ?? null;
                  (match as any).bonusTier = bonusResult.tierId ?? null;
                  if (bonusResult.solPriceUsed && !(match as any).solPriceAtTransaction) {
                    (match as any).solPriceAtTransaction = bonusResult.solPriceUsed;
                  }
                } else if (bonusResult.triggered && !bonusResult.success) {
                  console.warn('⚠️ Bonus payout attempted in fallback but not successful', {
                    matchId: match.id,
                    reason: bonusResult.reason,
                  });
                }
              }
            } catch (bonusError: any) {
              console.error('❌ Error processing bonus payout (fallback)', {
                matchId: match.id,
                error: bonusError?.message || String(bonusError),
              });
            }
          }
        } else {
          console.error('❌ Failed to execute proposal (fallback)', {
            matchId: match.id,
            proposalId: proposalIdString,
            error: executeResult.error,
            proposalSigners: finalProposalSigners,
            feeWalletAutoApproved: autoApproved,
            logs: executeResult.logs?.slice(-5),
          });
        }
      } else {
        console.warn('⚠️ Skipping automatic proposal execution (fallback) because fee wallet keypair is not configured', {
          matchId: match.id,
          proposalId: proposalIdString,
          proposalSigners: finalProposalSigners,
        });
      }
    } catch (executeError: any) {
      console.error('❌ Error executing proposal (fallback)', {
        matchId: match.id,
        error: executeError?.message || String(executeError),
      });
      // Don't fail the request - just log the error
    }
  }

    applyNoCacheHeaders();
    res.json({
    status: playerSpecificStatus,
      player1: match.player1,
      player2: match.player2,
      squadsVaultAddress: (match as any).squadsVaultAddress || (match as any).vaultAddress || null,
      squadsVaultPda: (match as any).squadsVaultPda || null,
      vaultAddress: (match as any).squadsVaultAddress || (match as any).vaultAddress || null,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      word: match.word,
      player1Result: match.getPlayer1Result(),
      player2Result: match.getPlayer2Result(),
      winner: match.winner,
      payout: payoutResult,
      isCompleted: match.isCompleted || !!existingResult,
      payoutProposalId: (match as any).payoutProposalId || null,
      tieRefundProposalId: (match as any).tieRefundProposalId || null,
      proposalStatus: (match as any).proposalStatus || null,
      proposalCreatedAt: (match as any).proposalCreatedAt || null,
      needsSignatures: normalizeRequiredSignatures((match as any).needsSignatures),
      proposalSigners: (match as any).proposalSigners || [],
      proposalExecutedAt: (match as any).proposalExecutedAt || null,
      proposalTransactionId: (match as any).proposalTransactionId || null,
      entryFeeUSD: (match as any).entryFeeUSD || null,
      solPriceAtTransaction: (match as any).solPriceAtTransaction || null,
      refundReason: (match as any).refundReason || null,
      refundedAt: (match as any).refundedAt || null,
      matchOutcome: (match as any).matchOutcome || null,
      bonus: {
        paid: !!((match as any).bonusPaid),
        signature: (match as any).bonusSignature || null,
        amountSol: (match as any).bonusAmount || null,
        amountUSD: (match as any).bonusAmountUSD || null,
        percent: (match as any).bonusPercent || 0,
        tier: (match as any).bonusTier || null,
        paidAt: (match as any).bonusPaidAt || null
      }
    });

  } catch (error: unknown) {
    console.error('❌ Error getting match status:', error);
    applyNoCacheHeaders();
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Check for pending winnings/refunds for a player
const checkPendingClaimsHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet || typeof wallet !== 'string') {
      return res.status(400).json({ error: 'Valid wallet address required' });
    }

    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in checkPendingClaimsHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }

    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find matches where player has pending winnings (completed matches with active proposals)
    // Exclude matches where proposalStatus = 'EXECUTED' or needsSignatures = 0
    // Use raw SQL to avoid issues with missing columns like proposalExpiresAt
    const pendingWinningsRaw = await matchRepository.query(`
      SELECT 
        id, "player1", "player2", "entryFee", winner, "isCompleted",
        "payoutProposalId", "proposalStatus", "proposalCreatedAt", 
        "needsSignatures", "player1Result", "player2Result"
      FROM "match"
      WHERE "isCompleted" = $1
        AND winner != $2
        AND winner IS NOT NULL
        AND "payoutProposalId" IS NOT NULL
        AND ("proposalStatus" = $3 OR "proposalStatus" IS NULL)
        AND "proposalStatus" != $4
        AND "needsSignatures" > 0
        AND ("player1" = $5 OR "player2" = $5)
    `, [true, 'tie', 'ACTIVE', 'EXECUTED', wallet]);
    
    // Convert raw results to Match entities
    const pendingWinnings = pendingWinningsRaw.map((row: any) => {
      const match = new Match();
      Object.assign(match, row);
      // Add helper methods
      (match as any).getPlayer1Result = () => {
        try {
          return row.player1Result ? JSON.parse(row.player1Result) : null;
        } catch {
          return null;
        }
      };
      (match as any).getPlayer2Result = () => {
        try {
          return row.player2Result ? JSON.parse(row.player2Result) : null;
        } catch {
          return null;
        }
      };
      return match;
    });

    // Find matches where player has pending refunds (tie/timeout but proposal not executed)
    // Exclude matches where proposalStatus = 'EXECUTED' or needsSignatures = 0
    // Use raw SQL to avoid issues with missing columns like proposalExpiresAt
    const pendingRefundsRaw = await matchRepository.query(`
      SELECT 
        id, "player1", "player2", "entryFee", winner, "isCompleted",
        "payoutProposalId", "proposalStatus", "proposalCreatedAt", 
        "needsSignatures", "proposalSigners"
      FROM "match"
      WHERE "isCompleted" = $1
        AND winner = $2
        AND "payoutProposalId" IS NOT NULL
        AND ("proposalStatus" = $3 OR "proposalStatus" IS NULL)
        AND "proposalStatus" != $4
        AND "needsSignatures" > 0
        AND ("player1" = $5 OR "player2" = $5)
    `, [true, 'tie', 'ACTIVE', 'EXECUTED', wallet]);
    
    // Convert raw results to Match entities
    const pendingRefunds = pendingRefundsRaw.map((row: any) => {
      const match = new Match();
      Object.assign(match, row);
      // Add helper method
      (match as any).getProposalSigners = () => {
        try {
          return row.proposalSigners ? JSON.parse(row.proposalSigners) : [];
        } catch {
          return [];
        }
      };
      return match;
    });

    // Check if player has any pending claims
    const hasPendingWinnings = pendingWinnings.length > 0;
    const hasPendingRefunds = pendingRefunds.length > 0;
    const hasAnyPendingClaims = hasPendingWinnings || hasPendingRefunds;

    // For refunds, check if ANY player has signed (refund can be executed by either player)
    let refundCanBeExecuted = false;
    if (hasPendingRefunds) {
      for (const refundMatch of pendingRefunds) {
        try {
          const signers = refundMatch.getProposalSigners ? refundMatch.getProposalSigners() : [];
          if (signers.length > 0) {
            refundCanBeExecuted = true;
            break;
          }
        } catch (err) {
          console.warn('Error getting proposal signers for match', refundMatch.id, err);
        }
      }
    }

    res.json({
      hasPendingClaims: hasAnyPendingClaims,
      hasPendingWinnings,
      hasPendingRefunds,
      refundCanBeExecuted,
      pendingWinnings: pendingWinnings.map(match => {
        let isWinner = false;
        if (match.payoutProposalId) {
          try {
            const player1Result = match.getPlayer1Result();
            const player2Result = match.getPlayer2Result();
            if (match.player1 === wallet && player1Result && player2Result) {
              isWinner = player1Result.numGuesses < player2Result.numGuesses;
            } else if (match.player2 === wallet && player1Result && player2Result) {
              isWinner = player2Result.numGuesses < player1Result.numGuesses;
            }
          } catch (err) {
            console.warn('Error determining winner for match', match.id, err);
          }
        }
        return {
          matchId: match.id,
          entryFee: match.entryFee,
          proposalId: match.payoutProposalId,
          proposalCreatedAt: match.proposalCreatedAt,
          needsSignatures: normalizeRequiredSignatures(match.needsSignatures),
          isWinner
        };
      }),
      pendingRefunds: pendingRefunds.map(match => ({
        matchId: match.id,
        entryFee: match.entryFee,
        proposalId: match.payoutProposalId,
        proposalCreatedAt: match.proposalCreatedAt,
        needsSignatures: normalizeRequiredSignatures(match.needsSignatures),
        refundAmount: match.entryFee * 0.95 // 95% refund for ties
      }))
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error checking pending claims:', errorMessage);
    console.error('❌ Error stack:', errorStack);
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      wallet: req.params?.wallet,
      errorName: error instanceof Error ? error.name : undefined,
    });
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};
// Check if a player has been matched (for polling)
const checkPlayerMatchHandler = async (req: any, res: any) => {
  try {
    // Ensure database is initialized
    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in checkPlayerMatchHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }

    const { wallet, walletAddress } = req.params;
    const walletParam = wallet || walletAddress;
    
    console.log('🔍 Checking if player has been matched:', walletParam);
    
    if (!walletParam) {
      console.log('❌ No wallet provided in request');
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Check for active matches with this player using raw SQL
    let activeMatches = [];
    let cancelledMatches = [];
    
    try {
      activeMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "player2",
          status,
          "player1Paid",
          "player2Paid",
          word,
          "squadsVaultAddress",
          "squadsVaultPda",
          "entryFee",
          "isCompleted"
        FROM "match" 
        WHERE (("player1" = $1 OR "player2" = $2) 
          AND "status" IN ($3, $4, $5, $6)
          AND ("isCompleted" = false OR "isCompleted" IS NULL)
          AND "status" != $7)
        LIMIT 1
      `, [walletParam, walletParam, 'active', 'escrow', 'matched', 'payment_required', 'completed']);

      // Also check for cancelled matches
      cancelledMatches = await matchRepository.query(`
        SELECT 
          id,
          "player1",
          "player2",
          status
        FROM "match" 
        WHERE (("player1" = $1 OR "player2" = $2) AND "status" = $3)
        LIMIT 1
      `, [walletParam, walletParam, 'cancelled']);
      
      console.log('✅ Database queries completed successfully');
    } catch (dbError: unknown) {
      console.error('❌ Database query error:', dbError);
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      const dbErrorStack = dbError instanceof Error ? dbError.stack : undefined;
      const dbErrorName = dbError instanceof Error ? dbError.name : undefined;
      console.error('❌ Error details:', {
        message: dbErrorMessage,
        stack: dbErrorStack,
        code: dbErrorName
      });
      return res.status(500).json({ error: 'Database query failed' });
    }
    
    if (activeMatches.length > 0) {
      const activeMatch = activeMatches[0];
      console.log('✅ Player has been matched:', {
        matchId: activeMatch.id,
        player1: activeMatch.player1,
        player2: activeMatch.player2,
        status: activeMatch.status,
        requestingWallet: wallet
      });
      
      // Also log all matches for this player for debugging
      let allPlayerMatches = [];
      try {
        allPlayerMatches = await matchRepository.query(`
          SELECT 
            id,
            status,
            "player1",
            "player2"
          FROM "match" 
          WHERE "player1" = $1 OR "player2" = $2
        `, [wallet, wallet]);
      } catch (debugError) {
        console.error('❌ Error fetching debug matches:', debugError);
        // Don't fail the request for debug data
      }
      
      console.log('🔍 All matches for player:', allPlayerMatches.map((m: any) => ({
        id: m.id,
        status: m.status,
        player1: m.player1,
        player2: m.player2
      })));
      
      // Determine the appropriate message based on status
      let message = '';
      if (activeMatch.status === 'escrow' || activeMatch.status === 'matched' || activeMatch.status === 'payment_required') {
        message = 'Match created - please pay your entry fee';
      } else if (activeMatch.status === 'active') {
        message = 'Already in active match';
      }
      
      res.json({
        matched: true,
        matchId: activeMatch.id,
        status: activeMatch.status,
        player1: activeMatch.player1,
        player2: activeMatch.player2,
        player1Paid: activeMatch.player1Paid,
        player2Paid: activeMatch.player2Paid,
        word: activeMatch.word,
        vaultAddress: activeMatch.squadsVaultAddress,
        squadsVaultAddress: activeMatch.squadsVaultAddress,
        squadsVaultPda: (activeMatch as any).squadsVaultPda || null,
        entryFee: activeMatch.entryFee,
        message: message
      });
    } else if (cancelledMatches.length > 0) {
      const cancelledMatch = cancelledMatches[0];
      console.log('❌ Player has cancelled match:', {
        matchId: cancelledMatch.id,
        player1: cancelledMatch.player1,
        player2: cancelledMatch.player2,
        status: cancelledMatch.status
      });
      
      res.json({
        matched: false,
        status: 'cancelled',
        message: 'Match was cancelled due to payment timeout'
      });
    } else {
      console.log('⏳ Player still waiting for match');
      
      // Check if there are any waiting matches this player could join
      let availableWaitingMatches = [];
      try {
        availableWaitingMatches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            "entryFee"
          FROM "match" 
          WHERE "status" = $1 AND "player2" IS NULL AND "player1" != $2
          ORDER BY "createdAt" ASC
          LIMIT 1
        `, ['waiting', wallet]);
      } catch (waitingError) {
        console.error('❌ Error checking waiting matches:', waitingError);
        // Continue without failing the request
      }
      
      if (availableWaitingMatches.length > 0) {
        const availableWaitingMatch = availableWaitingMatches[0];
        console.log('🎯 Found available waiting match, but not creating duplicate - Redis handles matchmaking:', {
          waitingEntryId: availableWaitingMatch.id,
          waitingPlayer: availableWaitingMatch.player1,
          entryFee: availableWaitingMatch.entryFee,
          requestingPlayer: wallet
        });
        
        // Don't create matches here - let Redis handle all matchmaking
        // This prevents duplicate matches from being created
      }
      
      // Also check for waiting matches to debug using raw SQL
      let waitingMatches = [];
      try {
        waitingMatches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            status
          FROM "match" 
          WHERE "player1" = $1 AND "status" = $2 AND "player2" IS NULL
          LIMIT 1
        `, [wallet, 'waiting']);
      } catch (waitingDebugError) {
        console.error('❌ Error checking waiting matches for debug:', waitingDebugError);
        // Don't fail the request for debug data
      }
      
      if (waitingMatches.length > 0) {
        const waitingMatch = waitingMatches[0];
        console.log('🔍 Player has waiting entry:', {
          matchId: waitingMatch.id,
          player1: waitingMatch.player1,
          status: waitingMatch.status
        });
      }
      
      // Check if player is waiting in Redis
      try {
        const { redisMatchmakingService } = require('../services/redisMatchmakingService');
        const redisMatch = await redisMatchmakingService.getPlayerMatch(walletParam);
        if (redisMatch) {
          console.log('🔍 Player has Redis match:', {
            matchId: redisMatch.matchId,
            player1: redisMatch.player1,
            player2: redisMatch.player2,
            status: redisMatch.status
          });
          
          // Return the Redis match data
          return res.json({ 
            matched: true, 
            matchId: redisMatch.matchId,
            player1: redisMatch.player1,
            player2: redisMatch.player2,
            entryFee: redisMatch.entryFee,
            status: redisMatch.status
          });
        }
      } catch (redisError) {
        console.error('❌ Error checking Redis match:', redisError);
        // Continue without failing the request
      }
      
      res.json({ matched: false });
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error checking player match:', errorMessage);
    console.error('❌ Error stack:', errorStack);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

const cancelMatchHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, reason } = req.body || {};

    const walletAddress =
      typeof wallet === 'string'
        ? wallet
        : wallet?.toString?.();

    if (!walletAddress) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    const normalizedWallet = walletAddress.toLowerCase();
    const { redisMatchmakingService } = require('../services/redisMatchmakingService');

    if (!matchId) {
      await redisMatchmakingService.evictPlayer(walletAddress);
      return res.json({
        success: true,
        status: 'queue_cancelled',
      });
    }

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      await redisMatchmakingService.cancelMatch(matchId);
      return res.status(404).json({ error: 'Match not found or already cancelled' });
    }

    const participantWallets = [match.player1, match.player2]
      .filter(Boolean)
      .map((value: string) => value.toLowerCase());

    if (!participantWallets.includes(normalizedWallet)) {
      return res.status(403).json({ error: 'Wallet not associated with this match' });
    }

    if (match.status === 'completed' || match.status === 'active' || match.isCompleted) {
      return res.status(400).json({ error: 'Cannot cancel an active or completed match' });
    }

    if (match.status === 'cancelled') {
      await redisMatchmakingService.cancelMatch(matchId);
      return res.json({
        success: true,
        status: 'cancelled',
        refundReason: match.refundReason || null,
        refundPending: !!(match.player1Paid || match.player2Paid),
      });
    }

    const cancellationReason = reason || (
      match.player1Paid || match.player2Paid
        ? 'player_cancelled_after_payment'
        : 'player_cancelled_before_payment'
    );

    const refundPending = !!(match.player1Paid || match.player2Paid);

    match.status = 'cancelled';
    match.matchOutcome = 'cancelled';
    match.refundReason = cancellationReason;

    if (refundPending) {
      await processAutomatedRefunds(match, cancellationReason);
    } else {
      match.player1Paid = false;
      match.player2Paid = false;
      match.refundedAt = new Date();
      await matchRepository.save(match);
    }

    await matchRepository.update(match.id, {
      status: 'cancelled',
      matchOutcome: 'cancelled',
      refundReason: cancellationReason,
    });

    try {
      const { deleteMatchmakingLock } = require('../utils/redisMatchmakingLocks');
      await deleteMatchmakingLock(matchId);
    } catch (lockError) {
      console.warn('⚠️ Failed to delete matchmaking lock for cancelled match', {
        matchId,
        error: lockError instanceof Error ? lockError.message : String(lockError),
      });
    }

    try {
      const { deleteGameState } = require('../utils/redisGameState');
      await deleteGameState(matchId);
    } catch (stateError) {
      console.warn('⚠️ Failed to delete game state for cancelled match', {
        matchId,
        error: stateError instanceof Error ? stateError.message : String(stateError),
      });
    }

    await redisMatchmakingService.cancelMatch(matchId);

    res.json({
      success: true,
      status: 'cancelled',
      refundPending,
      refundReason: cancellationReason,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error cancelling match:', error);
    res.status(500).json({
      error: 'Failed to cancel match',
      details: errorMessage,
    });
  }
};

// Confirm escrow payment and activate game
const confirmEscrowHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, escrowSignature } = req.body;
    
    console.log('💰 Confirming escrow payment:', { matchId, wallet, escrowSignature });
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find the match
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    if (match.status !== 'escrow') {
      return res.status(400).json({ error: 'Match is not in escrow status' });
    }
    
    if (match.player1 !== wallet && match.player2 !== wallet) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }
    
    // Update match to track escrow confirmations
    if (match.player1 === wallet) {
      match.player1EscrowConfirmed = true;
      match.player1EscrowSignature = escrowSignature;
    } else {
      match.player2EscrowConfirmed = true;
      match.player2EscrowSignature = escrowSignature;
    }
    
    // Check if both players have confirmed escrow
    if (match.player1EscrowConfirmed && match.player2EscrowConfirmed) {
      console.log('✅ Both players confirmed escrow, activating game');
      match.status = 'active';
      match.gameStartTime = new Date();
    }
    
    await matchRepository.save(match);
    
    res.json({
      success: true,
      status: match.status,
      message: match.status === 'active' ? 'Game activated!' : 'Escrow confirmed, waiting for opponent'
    });
    
  } catch (error: unknown) {
    console.error('❌ Error confirming escrow:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Server-side game guess tracking endpoint
const submitGameGuessHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, guess } = req.body;
    
    if (!matchId || !wallet || !guess) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate guess format (5 letters)
    if (!/^[A-Z]{5}$/.test(guess)) {
      return res.status(400).json({ error: 'Invalid guess format - must be 5 letters' });
    }

    // Allow any 5-letter word (no word list validation)
    // The game is about guessing, not about using specific words

    // Validate player is part of this match using raw SQL first
    // Check database before Redis to handle cases where Redis state was deleted prematurely
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const matchRows = await matchRepository.query(`
      SELECT id, "player1", "player2", "isCompleted", status, word
      FROM "match"
      WHERE id = $1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchRows[0];
    
    // Check if match is already completed in database
    if (match.isCompleted) {
      return res.status(400).json({ error: 'Game is already completed' });
    }
    
    // Check if match is in a valid state for guesses
    if (match.status !== 'active') {
      return res.status(400).json({ error: 'Game is not active' });
    }

    // Get server-side game state from Redis
    // If Redis state is missing but match exists and is active, try to restore it
    let serverGameState = await getGameState(matchId as string);
    if (!serverGameState) {
      // Redis state missing but match is active - restore from database
      console.warn('⚠️ Redis game state missing but match is active, restoring from database', {
        matchId,
        wallet,
        matchStatus: match.status
      });
      // Restore game state from database
      const { getRandomWord } = require('../wordList');
      const gameWord = match.word || getRandomWord();
      serverGameState = {
        startTime: Date.now(),
        player1StartTime: Date.now(),
        player2StartTime: Date.now(),
        player1Guesses: [],
        player2Guesses: [],
        player1Solved: false,
        player2Solved: false,
        word: gameWord,
        matchId: matchId as string,
        lastActivity: Date.now(),
        completed: false
      };
      // Save restored state to Redis
      await setGameState(matchId as string, serverGameState);
      console.log('✅ Restored game state from database for match:', matchId);
    }

    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;

    // Check if player already solved
    if (isPlayer1 && serverGameState.player1Solved) {
      return res.status(400).json({ error: 'Player 1 already solved the puzzle' });
    }
    if (!isPlayer1 && serverGameState.player2Solved) {
      return res.status(400).json({ error: 'Player 2 already solved the puzzle' });
    }

    // Check guess limit (7 guesses)
    if (playerGuesses.length >= 7) {
      return res.status(400).json({ error: 'Maximum 7 guesses reached' });
    }

    // Add guess to server state
    playerGuesses.push(guess);

    // Check if this guess solves the puzzle
    const solved = guess === serverGameState.word;
    if (isPlayer1) {
      serverGameState.player1Solved = solved;
    } else {
      serverGameState.player2Solved = solved;
    }
    
    // Save updated game state to Redis
    await setGameState(matchId as string, serverGameState);

    console.log(`📝 Server recorded guess for ${isPlayer1 ? 'Player 1' : 'Player 2'}:`, {
      matchId,
      wallet,
      guess,
      solved,
      totalGuesses: playerGuesses.length
    });

    res.json({
      success: true,
      guess,
      solved,
      totalGuesses: playerGuesses.length,
      remainingGuesses: 7 - playerGuesses.length
    });

  } catch (error: unknown) {
    console.error('❌ Error submitting guess:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Add server-side game state endpoint
const getGameStateHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet } = req.query;
    
    if (!matchId || !wallet) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate player is part of this match first using raw SQL
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const matchRows = await matchRepository.query(`
      SELECT id, "player1", "player2", status, word, "isCompleted", "gameStartTime", 
             "player1Result", "player2Result"
      FROM "match"
      WHERE id = $1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }

    const match = matchRows[0];

    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Get server-side game state from Redis
    let serverGameState = await getGameState(matchId as string);
    
    // CRITICAL: If Redis state exists, validate word matches database (database is source of truth)
    if (serverGameState && match?.word) {
      if (serverGameState.word !== match.word) {
        console.error(`❌ Word mismatch detected! Database: ${match.word}, Redis: ${serverGameState.word}`);
        // Fix Redis to match database
        serverGameState.word = match.word;
        await setGameState(matchId as string, serverGameState);
        console.log(`✅ Fixed Redis word to match database`);
      }
    }
    
    if (!serverGameState) {
      console.log(`❌ Game state not found for match ${matchId}`);
      console.log(`🔍 Active games: Check Redis for game states`);
      console.log(`🔍 Match status:`, match?.status);
      console.log(`🔍 Match completed:`, match?.isCompleted);
      
      // If match is completed, return completion status
      if (match?.isCompleted) {
        console.log(`✅ Match ${matchId} is completed, returning completion status`);
        return res.json({
          success: true,
          gameCompleted: true,
          matchCompleted: true,
          message: 'Game completed - results available'
        });
      }
      
      // If match is active but no game state, try to reinitialize
      if (match?.status === 'active') {
        console.log(`🔄 Attempting to reinitialize game state for match ${matchId}`);
        
        // CRITICAL: Always use database word as source of truth - never generate new word
        let word: string;
        if (match.word) {
          // Use existing word from database
          word = match.word;
          console.log(`✅ Using existing word from database: ${word}`);
        } else {
          // Only generate word if database doesn't have one (shouldn't happen, but handle gracefully)
          console.warn(`⚠️ No word in database for active match ${matchId}, generating new word`);
          word = getRandomWord();
          await matchRepository.query(`
            UPDATE "match"
            SET word = $1, "updatedAt" = $2
            WHERE id = $3
          `, [word, new Date(), matchId]);
          match.word = word;
        }
        
        const newGameState = {
          startTime: Date.now(),
          player1StartTime: Date.now(),
          player2StartTime: Date.now(),
          player1Guesses: [],
          player2Guesses: [],
          player1Solved: false,
          player2Solved: false,
          word: word, // Use word from database
          matchId: matchId,
          lastActivity: Date.now(),
          completed: false
        };
        
        // Update match directly in database using raw SQL
        if (!match.gameStartTime) {
          await matchRepository.query(`
            UPDATE "match"
            SET "gameStartTime" = $1, "updatedAt" = $2
            WHERE id = $3
          `, [new Date(), new Date(), matchId]);
          match.gameStartTime = new Date();
        }
        
        await setGameState(matchId as string, newGameState);
        console.log(`✅ Reinitialized game state for match ${matchId} using database word: ${word}`);
        
        // Use the new game state
        const reinitializedGameState = await getGameState(matchId as string);
        if (reinitializedGameState) {
          // Validate Redis word matches database word (database is source of truth)
          if (reinitializedGameState.word !== match.word) {
            console.error(`❌ Word mismatch in reinitialized state! Database: ${match.word}, Redis: ${reinitializedGameState.word}`);
            // Fix Redis to match database
            reinitializedGameState.word = match.word;
            await setGameState(matchId as string, reinitializedGameState);
            console.log(`✅ Fixed Redis word to match database`);
          }
          
          const isPlayer1 = wallet === match.player1;
          const playerGuesses = isPlayer1 ? reinitializedGameState.player1Guesses : reinitializedGameState.player2Guesses;
          
          // Game should remain active until BOTH players have finished
          // Don't check database results - game should remain active until both players finish guessing
          const bothPlayersFinished = (reinitializedGameState.player1Solved || reinitializedGameState.player1Guesses.length >= 7) && 
                                     (reinitializedGameState.player2Solved || reinitializedGameState.player2Guesses.length >= 7);
          
          return res.json({
            success: true,
            playerGuesses,
            totalGuesses: playerGuesses.length,
            remainingGuesses: 7 - playerGuesses.length,
            solved: isPlayer1 ? reinitializedGameState.player1Solved : reinitializedGameState.player2Solved,
            opponentSolved: isPlayer1 ? reinitializedGameState.player2Solved : reinitializedGameState.player1Solved,
            gameActive: !bothPlayersFinished, // Game active until both players finish
            targetWord: reinitializedGameState.word, // Include target word for color calculation
            gameCompleted: bothPlayersFinished // New field to indicate when both players are done
          });
        }
      }
      
      return res.status(404).json({ error: 'Game not found or already completed' });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerGuesses = isPlayer1 ? serverGameState.player1Guesses : serverGameState.player2Guesses;
    const opponentGuesses = isPlayer1 ? serverGameState.player2Guesses : serverGameState.player1Guesses;

    // Check if match is completed in database (more authoritative than Redis)
    const matchCompleted = match.isCompleted || false;
    
    // Return safe game state (don't reveal the word or opponent's guesses)
    // Game should remain active until BOTH players have finished (solved or run out of guesses)
    // Also check database results to ensure completion status is accurate
    // Parse player results from JSON strings (they're stored as JSON in the database)
    const player1Result = match.player1Result ? (typeof match.player1Result === 'string' ? JSON.parse(match.player1Result) : match.player1Result) : null;
    const player2Result = match.player2Result ? (typeof match.player2Result === 'string' ? JSON.parse(match.player2Result) : match.player2Result) : null;
    const bothPlayersFinished = (serverGameState.player1Solved || serverGameState.player1Guesses.length >= 7 || !!player1Result) && 
                               (serverGameState.player2Solved || serverGameState.player2Guesses.length >= 7 || !!player2Result);
    
    res.json({
      success: true,
      playerGuesses,
      totalGuesses: playerGuesses.length,
      remainingGuesses: 7 - playerGuesses.length,
      solved: isPlayer1 ? serverGameState.player1Solved : serverGameState.player2Solved,
      opponentSolved: isPlayer1 ? serverGameState.player2Solved : serverGameState.player1Solved,
      gameActive: !bothPlayersFinished && !matchCompleted, // Game active until both players finish OR match is completed
      targetWord: serverGameState.word, // Include target word for color calculation
      gameCompleted: bothPlayersFinished || matchCompleted // Indicate completion when both players done OR match marked complete
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting game state:', errorMessage);
    console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Server-side payment execution endpoint
const executePaymentHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, paymentType } = req.body;
    
    if (!matchId || !wallet || !paymentType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate payment type
    if (!['payout', 'refund'].includes(paymentType)) {
      return res.status(400).json({ error: 'Invalid payment type' });
    }

    // Get match data
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Validate player is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // Validate match is completed
    if (!match.isCompleted) {
      return res.status(400).json({ error: 'Match not completed' });
    }

    // Validate payout result exists
    if (!match.getPayoutResult()) {
      return res.status(400).json({ error: 'No payout result available' });
    }

    console.log('💰 Executing server-side payment:', {
      matchId,
      wallet,
      paymentType,
      payoutResult: match.getPayoutResult()
    });

    let paymentResult;
    
    // Direct payment approach - no server-side payment execution
    // Players handle their own payments through the frontend
    res.json({
      success: true,
      message: 'Direct payment approach - use frontend to send payments',
      paymentInstructions: match.getPayoutResult()?.paymentInstructions || null
    });

  } catch (error: unknown) {
    console.error('❌ Error executing payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Create escrow transaction endpoint
const createEscrowTransactionHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, escrowAddress, entryFee } = req.body;
    
    console.log('🔒 Creating escrow transaction:', { matchId, wallet, escrowAddress, entryFee });
    
    if (!matchId || !wallet || !escrowAddress || !entryFee) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Validate the match exists and player is part of it
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    if (match.player1 !== wallet && match.player2 !== wallet) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }
    
    if (match.status !== 'escrow') {
      return res.status(400).json({ error: 'Match is not in escrow status' });
    }
    
    // Create the escrow transaction
    const { transferToEscrow } = require('../services/payoutService');
    const entryFeeLamports = Number(entryFee) * 1000000000; // Convert to lamports
    
    const escrowResult = await transferToEscrow(wallet, escrowAddress, entryFeeLamports);
    
    if (!escrowResult.success) {
      console.error('❌ Failed to create escrow transaction:', escrowResult.error);
      return res.status(500).json({ error: 'Failed to create escrow transaction' });
    }
    
    console.log('✅ Escrow transaction created successfully');
    
    res.json({
      success: true,
      transaction: escrowResult.transaction,
      message: 'Escrow transaction created - please sign and submit'
    });
    
  } catch (error: unknown) {
    console.error('❌ Error creating escrow transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const cleanupStuckMatchesHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.body;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    console.log('🧹 Cleaning up stuck matches for wallet:', wallet);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up stuck matches for this wallet (EXCEPT escrow status - those are active matches)
    const stuckMatches = await matchRepository.find({
      where: [
        { player1: wallet, status: 'waiting' },
        { player2: wallet, status: 'waiting' },
        { player1: wallet, status: 'active' },
        { player2: wallet, status: 'active' }
        // Removed escrow status - those are active matches that should not be cleaned up
      ]
    });
    
    if (stuckMatches.length > 0) {
      console.log(`🧹 Removing ${stuckMatches.length} stuck matches for wallet ${wallet}`);
      await matchRepository.remove(stuckMatches);
      
      return res.json({
        success: true,
        message: `Cleaned up ${stuckMatches.length} stuck matches`,
        cleanedMatches: stuckMatches.length
      });
    } else {
      return res.json({
        success: true,
        message: 'No stuck matches found',
        cleanedMatches: 0
      });
    }
  } catch (error: unknown) {
    console.error('❌ Error cleaning up stuck matches:', error);
    res.status(500).json({ error: 'Failed to cleanup matches' });
  }
};
// Simple cleanup endpoint for production
const simpleCleanupHandler = async (req: any, res: any) => {
  try {
    console.log('🧹 Running simple cleanup...');
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up old waiting matches (only stale ones)
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const waitingMatches = await matchRepository.find({
      where: { 
        status: 'waiting',
        createdAt: LessThan(tenMinutesAgo)
      }
    });
    
    // Clean up old escrow matches (only stale ones)
    const escrowMatches = await matchRepository.find({
      where: { 
        status: 'escrow',
        createdAt: LessThan(tenMinutesAgo)
      }
    });
    
    let cleanedCount = 0;
    
    // NOTE: We do NOT clean up completed matches - they are kept for long-term storage and CSV downloads
    console.log(`📊 Found ${waitingMatches.length} stale waiting matches and ${escrowMatches.length} stale escrow matches to clean up`);
    
    if (waitingMatches.length > 0) {
      await matchRepository.remove(waitingMatches);
      cleanedCount += waitingMatches.length;
      console.log(`🧹 Cleaned up ${waitingMatches.length} waiting matches`);
    }
    
    if (escrowMatches.length > 0) {
      await matchRepository.remove(escrowMatches);
      cleanedCount += escrowMatches.length;
      console.log(`🧹 Cleaned up ${escrowMatches.length} escrow matches`);
    }
    
    // Clean up old payment_required matches and process refunds (only very old ones)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const paymentRequiredMatches = await matchRepository.find({
      where: { 
        status: 'payment_required',
        createdAt: LessThan(oneHourAgo) // Only remove very old payment_required matches
      }
    });
    
    if (paymentRequiredMatches.length > 0) {
      console.log(`🧹 Found ${paymentRequiredMatches.length} payment_required matches, processing refunds...`);
      
      // Process refunds for these matches before cleaning up
      for (const match of paymentRequiredMatches) {
        await processRefundsForFailedMatch(match);
      }
      
      await matchRepository.remove(paymentRequiredMatches);
      cleanedCount += paymentRequiredMatches.length;
      console.log(`🧹 Cleaned up ${paymentRequiredMatches.length} payment_required matches with refunds`);
    }
    
    // Clear in-memory games
    // Clear all Redis-based memory data
    console.log('🧹 Clearing all Redis memory data...');
    // Note: Individual cleanup is handled by the Redis memory manager
    // This is a placeholder for the old in-memory clear operations
    
          console.log(`🧹 Cleaned up ${cleanedCount} database matches`);
    
    res.json({ 
      success: true, 
      message: `Cleaned up ${cleanedCount} database matches`,
      cleanedDatabase: cleanedCount,
      cleanedMemory: 0 // Redis-based memory is handled separately
    });
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Simple cleanup failed:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to cleanup matches',
      details: errorMessage 
    });
  }
};

// New endpoint to force cleanup for a specific wallet (for testing)
const forceCleanupForWallet = async (req: any, res: any) => {
  try {
    const { wallet } = req.body;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }
    
    console.log(`🧹 Force cleanup requested for wallet: ${wallet}`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find all matches for this wallet
    const walletMatches = await matchRepository.find({
      where: [
        { player1: wallet },
        { player2: wallet }
      ]
    });
    
    if (walletMatches.length > 0) {
      console.log(`🧹 Found ${walletMatches.length} matches for ${wallet}, removing them`);
      await matchRepository.remove(walletMatches);
      console.log(`✅ Force cleaned up ${walletMatches.length} matches for ${wallet}`);
    }
    
    // Also cleanup stale waiting matches
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const staleWaitingMatches = await matchRepository.find({
      where: {
        status: 'waiting',
        createdAt: LessThan(fiveMinutesAgo)
      }
    });
    
    if (staleWaitingMatches.length > 0) {
      console.log(`🧹 Found ${staleWaitingMatches.length} stale waiting matches, removing them`);
      await matchRepository.remove(staleWaitingMatches);
      console.log(`✅ Cleaned up ${staleWaitingMatches.length} stale waiting matches`);
    }
    
    res.json({
      success: true,
      cleanedWalletMatches: walletMatches.length,
      cleanedStaleMatches: staleWaitingMatches.length,
      message: `Force cleaned up ${walletMatches.length} wallet matches and ${staleWaitingMatches.length} stale matches`
    });
  } catch (error: unknown) {
    console.error('❌ Error in force cleanup:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to force cleanup matches'
    });
  }
};

// Process refunds for failed matches
const processRefundsForFailedMatch = async (match: any) => {
  try {
    console.log(`💰 Processing refunds for failed match ${match.id}`);
    
    const { getFeeWalletKeypair } = require('../config/wallet');
    const { Connection, PublicKey, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    
    const feeWalletKeypair = getFeeWalletKeypair();
    if (!feeWalletKeypair) {
      console.error('❌ Fee wallet private key not available for refunds');
      return;
    }
    
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    
    // Ensure entryFee is available, fallback to 0.1 SOL if undefined
    const entryFee = match.entryFee || 0.1;
    const entryFeeLamports = Math.floor(entryFee * LAMPORTS_PER_SOL);
    
    // Calculate refund amount (entry fee minus network fee)
    const networkFeeLamports = Math.floor(0.0001 * LAMPORTS_PER_SOL); // 0.0001 SOL network fee
    const refundLamports = entryFeeLamports - networkFeeLamports;
    
    console.log(`💰 Refund calculation: ${entryFee} SOL - 0.0001 SOL = ${refundLamports / LAMPORTS_PER_SOL} SOL`);
    
    // Check fee wallet balance
    const feeWalletBalance = await connection.getBalance(feeWalletKeypair.publicKey);
    console.log(`💰 Fee wallet balance: ${feeWalletBalance / LAMPORTS_PER_SOL} SOL`);
    
    // Process refunds for players who paid
    if (match.player1Paid) {
      console.log(`💰 Processing refund for Player 1: ${match.player1} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      try {
        const refundTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: feeWalletKeypair.publicKey,
            toPubkey: new PublicKey(match.player1),
            lamports: refundLamports,
          })
        );
        
        const signature = await connection.sendTransaction(refundTx, [feeWalletKeypair]);
        await connection.confirmTransaction(signature);
        console.log(`✅ Refund sent to Player 1: ${signature} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
        console.error(`❌ Failed to refund Player 1: ${errorMessage}`);
      }
    }
    
    if (match.player2Paid) {
      console.log(`💰 Processing refund for Player 2: ${match.player2} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      try {
        const refundTx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: feeWalletKeypair.publicKey,
            toPubkey: new PublicKey(match.player2),
            lamports: refundLamports,
          })
        );
        
        const signature = await connection.sendTransaction(refundTx, [feeWalletKeypair]);
        await connection.confirmTransaction(signature);
        console.log(`✅ Refund sent to Player 2: ${signature} (${refundLamports / LAMPORTS_PER_SOL} SOL)`);
      } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
        console.error(`❌ Failed to refund Player 2: ${errorMessage}`);
      }
    }
    
    console.log(`✅ All refunds processed for match ${match.id} (0.0001 SOL fee deducted per refund)`);
    
  } catch (error: unknown) {
    console.error('❌ Error processing refunds:', error);
  }
};

// Automated refund system - handles all refund scenarios
const processAutomatedRefunds = async (match: any, reason: any = 'unknown') => {
  try {
    console.log(`💰 Processing automated refunds for match ${match.id} - Reason: ${reason}`);
    
    // Only process refunds if players actually paid
    if (!match.player1Paid && !match.player2Paid) {
      console.log(`💰 No refunds needed - no players paid for match ${match.id}`);
      return;
    }
    
    // Process refunds
    await processRefundsForFailedMatch(match);
    
    // Mark match as cancelled/refunded
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    await matchRepository.update(match.id, {
      status: 'cancelled',
      refundReason: reason,
      refundedAt: new Date()
    });
    
    console.log(`✅ Automated refunds completed for match ${match.id}`);
    
  } catch (error: unknown) {
    console.error(`❌ Error in automated refunds for match ${match.id}:`, error);
  }
};

// Payment confirmation endpoint
const confirmPaymentHandler = async (req: any, res: any) => {
  try {
    console.log('📥 Received confirm payment request:', {
      body: req.body,
      headers: req.headers,
      method: req.method,
      url: req.url
    });

    const { matchId, wallet, paymentSignature, smartContractData } = req.body;
    
    console.log('🔍 Parsed confirm payment data:', { 
      matchId, 
      wallet, 
      paymentSignature, 
      smartContractData: smartContractData ? 'Present' : 'Not present' 
    });
    
    if (!matchId || !wallet || !paymentSignature) {
      console.log('❌ Missing required fields:', { matchId: !!matchId, wallet: !!wallet, paymentSignature: !!paymentSignature });
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate wallet address format
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    // Get database repository
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Find the match
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    // Debug: Log current payment status before processing
    console.log(`🔍 Payment status BEFORE processing for match ${matchId}:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2,
      currentPlayer: wallet
    });

    // Validate player is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }

    // CRITICAL: Validate vault address exists and matches match record
    if (!match.squadsVaultAddress) {
      console.error(`❌ Missing vault address for match ${matchId}`);
      return res.status(400).json({ error: 'Match vault address not found. Please contact support.' });
    }

    const vaultDepositAddress =
      (match as any).squadsVaultPda ||
      squadsVaultService.deriveVaultPda(match.squadsVaultAddress);

    if (!vaultDepositAddress) {
      console.error(`❌ Unable to derive vault deposit address for match ${matchId}`, {
        multisig: match.squadsVaultAddress,
      });
      return res.status(400).json({ error: 'Unable to determine vault deposit address. Please contact support.' });
    }

    // Verify vault address exists on-chain
    try {
      const { Connection, PublicKey } = require('@solana/web3.js');
      const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com', 'confirmed');
      const vaultPublicKey = new PublicKey(match.squadsVaultAddress);
      const vaultAccount = await connection.getAccountInfo(vaultPublicKey);
      
      if (!vaultAccount) {
        console.error(`❌ Vault address does not exist on-chain: ${match.squadsVaultAddress}`);
        return res.status(400).json({ error: 'Invalid vault address - vault does not exist on-chain' });
      }
      
      console.log(`✅ Vault address verified on-chain: ${match.squadsVaultAddress}`);

      // Also ensure deposit vault PDA exists
      try {
        const depositPublicKey = new PublicKey(vaultDepositAddress);
        const depositAccount = await connection.getAccountInfo(depositPublicKey);
        if (!depositAccount) {
          console.warn(`⚠️ Vault deposit PDA does not exist yet, it will be created on first transaction: ${vaultDepositAddress}`);
        } else {
          console.log(`✅ Vault deposit PDA verified on-chain: ${vaultDepositAddress}`, {
            lamports: depositAccount.lamports / LAMPORTS_PER_SOL,
          });
        }
      } catch (depositCheckError: any) {
        console.warn('⚠️ Unable to verify vault deposit PDA on-chain', {
          vaultDepositAddress,
          error: depositCheckError?.message || String(depositCheckError),
        });
      }
    } catch (vaultError: any) {
      console.error(`❌ Error verifying vault address: ${vaultError?.message}`);
      return res.status(400).json({ error: `Invalid vault address: ${vaultError?.message}` });
    }

    // Determine which player this is
    const isPlayer1 = wallet === match.player1;
    const playerKey = isPlayer1 ? 'player1' : 'player2';

    // Check if already paid - but allow retries for better reliability
    if (isPlayer1 && match.player1Paid) {
      console.log(`⚠️ Player 1 already marked as paid for match ${matchId}`);
      // Return success instead of error to prevent frontend issues
      return res.json({
        success: true,
        status: match.status,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        message: 'Payment already confirmed'
      });
    }
    if (!isPlayer1 && match.player2Paid) {
      console.log(`⚠️ Player 2 already marked as paid for match ${matchId}`);
      // Return success instead of error to prevent frontend issues
      return res.json({
        success: true,
        status: match.status,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        message: 'Payment already confirmed'
      });
    }

    // CRITICAL: Check signature uniqueness to prevent replay attacks
    const { signatureTracker } = require('../utils/signatureTracker');
    const isUnique = await signatureTracker.isSignatureUnique(paymentSignature, matchId);
    
    if (!isUnique) {
      console.error(`❌ Payment signature already used: ${paymentSignature}`);
      return res.status(400).json({ 
        error: 'Payment signature has already been used. Please use a different transaction.',
        signature: paymentSignature
      });
    }

    // Enhanced transaction verification - use smart contract verification if available
    let verificationResult;
    
    console.log('🔍 Smart contract data received:', {
      hasSmartContractData: !!smartContractData,
      smartContractVerified: smartContractData?.smartContractVerified,
      matchPda: smartContractData?.matchPda,
      vaultPda: smartContractData?.vaultPda,
      verificationDetails: smartContractData?.verificationDetails
    });
    
    if (smartContractData && smartContractData.smartContractVerified) {
      // For smart contract payments, use the verification details from frontend
      console.log('🔗 Using smart contract payment verification');
      verificationResult = {
        verified: true,
        amount: match.entryFee,
        timestamp: smartContractData.verificationDetails?.blockTime,
        slot: smartContractData.verificationDetails?.slot,
        signature: paymentSignature,
        details: smartContractData.verificationDetails
      };
    } else {
      // For legacy payments, use the fee wallet verification service
      console.log('💰 Using legacy fee wallet payment verification');
      console.log('⚠️ Smart contract data missing or not verified, falling back to legacy verification');
      verificationResult = await paymentVerificationService.verifyPayment(
        paymentSignature, 
        wallet, 
        match.entryFee,
        {
          tolerance: 0.001,
          requireConfirmation: true,
          maxRetries: 3,
          timeout: 30000
        }
      );
    }

    if (!verificationResult.verified) {
      console.error('❌ Payment verification failed:', verificationResult.error);
      return res.status(400).json({ 
        error: 'Payment verification failed',
        details: verificationResult.error
      });
    }

    // CRITICAL: Verify payment transaction includes the correct vault address
    try {
      const { Connection, PublicKey } = require('@solana/web3.js');
      const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com', 'confirmed');
      const transaction = await connection.getTransaction(paymentSignature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        console.error(`❌ Payment transaction not found: ${paymentSignature}`);
        return res.status(400).json({ error: 'Payment transaction not found on blockchain' });
      }

      // Extract all account keys from transaction
      const accountKeys = transaction.transaction.message.accountKeys.map((key: any) => 
        typeof key === 'string' ? key : (key.pubkey ? key.pubkey.toString() : key.toString())
      );

      const vaultAddress = match.squadsVaultAddress;
      const vaultPdaAddress = vaultDepositAddress;
      const vaultInTransaction = accountKeys.includes(vaultPdaAddress);

      if (!vaultInTransaction) {
        console.error(`❌ Payment transaction does not include vault deposit address ${vaultPdaAddress}`);
        console.error(`Transaction account keys:`, accountKeys);
        return res.status(400).json({ 
          error: 'Payment transaction does not correspond to this match vault deposit address',
          expectedVault: vaultPdaAddress
        });
      }

      // Check if vault received funds (balance increased)
      const vaultPublicKey = new PublicKey(vaultPdaAddress);
      const vaultIndex = accountKeys.findIndex((key: string) => key === vaultPdaAddress);
      
      if (vaultIndex !== -1 && transaction.meta && transaction.meta.postBalances && transaction.meta.preBalances) {
        const vaultBalanceChange = transaction.meta.postBalances[vaultIndex] - transaction.meta.preBalances[vaultIndex];
        if (vaultBalanceChange <= 0) {
          console.warn(`⚠️ Vault deposit balance did not increase in payment transaction. Change: ${vaultBalanceChange}`);
        } else {
          console.log(`✅ Vault deposit PDA received ${vaultBalanceChange / 1e9} SOL in payment transaction`);
        }
      }

      console.log(`✅ Payment transaction verified to include correct vault deposit address: ${vaultPdaAddress}`);
    } catch (vaultVerifyError: any) {
      console.error(`❌ Error verifying vault address in transaction: ${vaultVerifyError?.message}`);
      // Don't fail payment if we can't verify - log warning but continue
      console.warn(`⚠️ Continuing with payment despite vault verification error`);
    }

    console.log(`✅ Payment verified for ${isPlayer1 ? 'Player 1' : 'Player 2'}:`, {
      matchId,
      wallet,
      paymentSignature,
      amount: verificationResult.amount,
      timestamp: verificationResult.timestamp,
      slot: verificationResult.slot,
      vaultAddress: match.squadsVaultAddress
    });

    // CRITICAL: Mark signature as used to prevent replay attacks
    await signatureTracker.markSignatureUsed(paymentSignature, matchId);

    // Mark player as paid (preserve existing payment status)
    if (isPlayer1) {
      match.player1Paid = true;
      if (paymentSignature) {
        match.player1PaymentSignature = paymentSignature;
      }
    } else {
      match.player2Paid = true;
      if (paymentSignature) {
        match.player2PaymentSignature = paymentSignature;
      }
    }
    
    // Update smart contract fields if present
    if (smartContractData) {
      if (smartContractData.matchPda) {
        match.matchPda = smartContractData.matchPda;
      }
      if (smartContractData.vaultPda) {
        match.vaultPda = smartContractData.vaultPda;
      }
      if (smartContractData.smartContractVerified !== undefined) {
        match.smartContractStatus = smartContractData.smartContractVerified ? 'verified' : 'unverified';
      }
    }
    
    // IMMEDIATELY save payment status to database so other player can see it
    await matchRepository.save(match);
    
    console.log(`✅ Marked ${isPlayer1 ? 'Player 1' : 'Player 2'} (${wallet}) as paid for match ${matchId}`);
    
    // Ensure we preserve both players' payment status
    console.log(`🔍 Current payment status after marking ${isPlayer1 ? 'Player 1' : 'Player 2'} as paid:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2
    });

    // Payment tracking updated
    console.log(`✅ Payment tracking updated for ${isPlayer1 ? 'Player 1' : 'Player 2'}`);

    // Send WebSocket event for payment received
    websocketService.broadcastToMatch(matchId, {
      type: WebSocketEventType.PAYMENT_RECEIVED,
      matchId,
      data: {
        player: isPlayer1 ? 'player1' : 'player2',
        wallet,
        amount: verificationResult.amount,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid
      },
      timestamp: new Date().toISOString()
    });

    console.log(`🔍 Payment status for match ${matchId}:`, {
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      player1: match.player1,
      player2: match.player2,
      currentPlayer: wallet
    });

    // Get fresh match data from database to ensure we have latest payment status
    const freshMatch = await matchRepository.findOne({ where: { id: matchId } });
    if (!freshMatch) {
      return res.status(404).json({ error: 'Match not found after payment' });
    }
    
    console.log(`🔍 Fresh match data after payment for match ${matchId}:`, {
      player1Paid: freshMatch.player1Paid,
      player2Paid: freshMatch.player2Paid,
      player1: freshMatch.player1,
      player2: freshMatch.player2,
      status: freshMatch.status,
      currentPlayer: wallet
    });
    
    // Check if both players have paid
    if (freshMatch.player1Paid && freshMatch.player2Paid) {
      try {
        const activationResult = await activateMatchIfReady(matchRepository, freshMatch, wallet, verificationResult);
        const activatedMatch = activationResult.match;
        const latestMatchState = await matchRepository.findOne({ where: { id: matchId } });
        const responseMatch = latestMatchState || activatedMatch;

        return res.json({
          success: true,
          status: responseMatch?.status || 'active',
          player1Paid: responseMatch?.player1Paid ?? true,
          player2Paid: responseMatch?.player2Paid ?? true,
          message: 'Game started!'
        });
      } catch (activationError: any) {
        console.error('❌ Error activating game after both payments:', activationError?.message || activationError);
        return res.status(500).json({ error: 'Failed to activate game' });
      }
    } else {
      console.log(`⏳ Waiting for other player to pay for match ${matchId}. Player1Paid: ${match.player1Paid}, Player2Paid: ${match.player2Paid}`);
      
      // Set a timeout for payment completion (1 minute)
      const paymentTimeout = setTimeout(async () => {
        try {
          console.log(`⏰ Payment timeout check for match ${matchId}`);
          const { AppDataSource } = require('../db/index');
          const timeoutMatchRepository = AppDataSource.getRepository(Match);
          const timeoutMatch = await timeoutMatchRepository.findOne({ where: { id: matchId } });
          
          if (timeoutMatch && timeoutMatch.status === 'payment_required' && (!timeoutMatch.player1Paid || !timeoutMatch.player2Paid)) {
            console.log(`⏰ Payment timeout for match ${matchId} - cancelling match and processing refunds`);
            
            // Process refunds for any players who paid
            await processRefundsForFailedMatch(timeoutMatch);
            
            // Mark match as cancelled
            timeoutMatch.status = 'cancelled';
            timeoutMatch.player1Paid = false;
            timeoutMatch.player2Paid = false;
            await timeoutMatchRepository.save(timeoutMatch);
            
            // Clean up any in-memory references
            await deleteGameState(matchId);
            await deleteMatchmakingLock(matchId);
            
            console.log(`✅ Match ${matchId} cancelled due to payment timeout`);
          }
        } catch (error: unknown) {
          console.error('❌ Error handling payment timeout:', error);
        }
      }, 60000); // 1 minute timeout
      
      // Store the timeout reference in Redis (since database might not have this field)
      if (!match.timeoutId) {
        match.timeoutId = paymentTimeout;
      }
      
      // Also store in Redis for cleanup
      if (!(await getMatchmakingLock(matchId)) !== null) {
        await setMatchmakingLock(matchId, {
          promise: Promise.resolve(),
          timestamp: Date.now(),
          wallet: wallet,
          entryFee: match.entryFee
        });
      }
    }

    console.log(`💾 Saving match ${matchId} to database:`, {
      status: match.status,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid
    });
    
    await matchRepository.save(match);
    
    console.log(`✅ Match ${matchId} saved successfully`);

    res.json({
      success: true,
      status: match.status,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      message: match.status === 'active' ? 'Game started!' : 'Waiting for other player to pay'
    });

  } catch (error: unknown) {
    console.error('❌ Error confirming payment:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Import Phase 2 services
const { websocketService } = require('../services/websocketService');
const { matchStateMachine } = require('../services/stateMachine');
const { paymentVerificationService } = require('../services/paymentVerificationService');
const { WebSocketEventType } = require('../services/websocketService');
const { enhancedLogger } = require('../utils/enhancedLogger');

const activateMatchIfReady = async (
  matchRepository: any,
  match: any,
  wallet: string,
  verificationContext?: any
) => {
  if (!match?.player1Paid || !match?.player2Paid) {
    return { activated: false, match };
  }

  const transitionSuccess = await matchStateMachine.transition(match, 'active' as any, {
    action: 'payment_complete',
    wallet,
    verificationResult: verificationContext
  });

  if (!transitionSuccess) {
    throw new Error(`State transition failed for match ${match.id}`);
  }

  const { getRandomWord } = require('../wordList');

  let word = match.word;
  if (!word) {
    word = getRandomWord();
    match.word = word;
  }

  const now = new Date();
  if (!match.gameStartTime) {
    match.gameStartTime = now;
  }
  if (!match.gameStartTimeUtc) {
    match.gameStartTimeUtc = now;
  }
  match.matchStatus = 'ACTIVE';

  await matchRepository.save(match);

  const newGameState = {
    startTime: Date.now(),
    player1StartTime: Date.now(),
    player2StartTime: Date.now(),
    player1Guesses: [],
    player2Guesses: [],
    player1Solved: false,
    player2Solved: false,
    word,
    matchId: match.id,
    lastActivity: Date.now(),
    completed: false
  };

  await setGameState(match.id, newGameState);

  const redisState = await getGameState(match.id);
  if (redisState && redisState.word !== word) {
    redisState.word = word;
    await setGameState(match.id, redisState);
  }

  const stats = await redisMemoryManager.getInstance().checkMemoryLimits();
  console.log(`🎮 Game started for match ${match.id}`);
  console.log(`🎮 Active games count: ${stats.activeGames}`);

  websocketService.broadcastToMatch(match.id, {
    type: WebSocketEventType.GAME_STARTED,
    matchId: match.id,
    data: {
      player1: match.player1,
      player2: match.player2,
      entryFee: match.entryFee,
      startTime: match.gameStartTime
    },
    timestamp: new Date().toISOString()
  });

  return { activated: true, match };
};

// WebSocket stats endpoint
const websocketStatsHandler = async (req: any, res: any) => {
  try {
    const stats = websocketService.getStats();
    res.json({
      timestamp: new Date().toISOString(),
      websocket: stats,
      services: {
        stateMachine: matchStateMachine.getStats(),
        paymentVerification: paymentVerificationService.getStats()
      }
    });
  } catch (error: unknown) {
    enhancedLogger.error('❌ WebSocket stats failed:', error);
    res.status(500).json({ error: 'Failed to get WebSocket stats' });
  }
};
// Enhanced payment verification function with idempotency
const verifyPaymentTransaction = async (signature: string, fromWallet: string, expectedAmount: number) => {
  try {
    const { Connection, PublicKey } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    
    console.log('🔍 ENHANCED: Verifying payment transaction:', {
      signature,
      fromWallet,
      expectedAmount,
      network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com'
    });
    
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!transaction) {
      return {
        verified: false,
        error: 'Transaction not found on blockchain'
      };
    }
    
    if (transaction.meta?.err) {
      return {
        verified: false,
        error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
      };
    }
    
    // Verify the transaction is a transfer to the fee wallet
    const feeWalletPublicKey = new PublicKey(process.env.FEE_WALLET_ADDRESS);
    const fromWalletPublicKey = new PublicKey(fromWallet);
    
    const preBalances = transaction.meta?.preBalances || [];
    const postBalances = transaction.meta?.postBalances || [];
    const accountKeys = transaction.transaction.message.accountKeys;
    
    // Find the fee wallet account index
    const feeWalletIndex = accountKeys.findIndex((key: any) => key.equals(feeWalletPublicKey));
    const fromWalletIndex = accountKeys.findIndex((key: any) => key.equals(fromWalletPublicKey));
    
    if (feeWalletIndex === -1 || fromWalletIndex === -1) {
      return {
        verified: false,
        error: 'Invalid transaction - fee wallet or from wallet not found in transaction'
      };
    }
    
    // Check if the fee wallet received the payment
    const feeWalletPreBalance = preBalances[feeWalletIndex] || 0;
    const feeWalletPostBalance = postBalances[feeWalletIndex] || 0;
    const feeWalletGain = feeWalletPostBalance - feeWalletPreBalance;
    
    const fromWalletPreBalance = preBalances[fromWalletIndex] || 0;
    const fromWalletPostBalance = postBalances[fromWalletIndex] || 0;
    const fromWalletLoss = fromWalletPreBalance - fromWalletPostBalance;
    
    console.log('🔍 ENHANCED: Payment verification details:', {
      feeWalletGain: feeWalletGain / 1000000000,
      fromWalletLoss: fromWalletLoss / 1000000000,
      expectedAmount: expectedAmount,
      signature: signature,
      slot: transaction.slot,
      blockTime: transaction.blockTime
    });
    
    // Verify the payment amount (with small tolerance for transaction fees)
    const tolerance = 0.001; // 0.001 SOL tolerance
    const expectedAmountLamports = expectedAmount * 1000000000;
    const minExpectedGain = expectedAmountLamports - (tolerance * 1000000000);
    
    if (feeWalletGain < minExpectedGain) {
      return {
        verified: false,
        error: 'Payment amount insufficient',
        details: {
          received: feeWalletGain / 1000000000,
          expected: expectedAmount,
          tolerance: tolerance
        }
      };
    }
    
    return {
      verified: true,
      amount: feeWalletGain / 1000000000,
      timestamp: transaction.blockTime,
      slot: transaction.slot,
      signature: signature,
      details: {
        feeWalletGain: feeWalletGain / 1000000000,
        fromWalletLoss: fromWalletLoss / 1000000000,
        transactionFee: transaction.meta?.fee ? transaction.meta.fee / 1000000000 : 0
      }
    };
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ ENHANCED: Payment verification error:', error);
    return {
      verified: false,
      error: `Verification failed: ${errorMessage}`
    };
  }
};

// Debug matches endpoint
const debugMatchesHandler = async (req: any, res: any) => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get all matches
    const allMatches = await matchRepository.find({
      order: { createdAt: 'DESC' },
      take: 20
    });
    
    // Get active games from Redis (placeholder - Redis doesn't have entries() method)
    const activeGamesList: any[] = []; // TODO: Implement Redis-based active games list
    
    res.json({
      timestamp: new Date().toISOString(),
      totalMatches: allMatches.length,
      activeGames: activeGamesList,
      matches: allMatches.map((match: any) => ({
        id: match.id,
        status: match.status,
        player1: match.player1,
        player2: match.player2,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
        entryFee: match.entryFee,
        createdAt: match.createdAt,
        updatedAt: match.updatedAt
      }))
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in debug matches:', error);
    res.status(500).json({ error: 'Debug failed' });
  }
};

// Memory monitoring endpoint
const memoryStatsHandler = async (req: any, res: any) => {
  try {
    const { AppDataSource } = require('../db/index');
    
    // Get database stats
    const matchRepository = AppDataSource.getRepository(Match);
    const totalMatches = await matchRepository.count();
    const waitingMatches = await matchRepository.count({ where: { status: 'waiting' } });
    const activeMatches = await matchRepository.count({ where: { status: 'active' } });
    const completedMatches = await matchRepository.count({ where: { status: 'completed' } });
    
    // Get memory stats from Redis
    const memoryStats = await redisMemoryManager.getInstance().checkMemoryLimits();
    
    res.json({
      timestamp: new Date().toISOString(),
      memory: memoryStats,
      database: {
        totalMatches,
        waitingMatches,
        activeMatches,
        completedMatches
      },
      warnings: memoryStats.warnings
    });
    
  } catch (error: unknown) {
    console.error('❌ Memory stats failed:', error);
    res.status(500).json({ error: 'Failed to get memory stats' });
  }
};

// Debug endpoint to check matchmaking state
const debugMatchmakingHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet parameter required' });
    }
    
    console.log('🔍 Debug matchmaking for wallet:', wallet);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get all matches for this wallet
    const allMatches = await matchRepository.find({
      where: [
        { player1: wallet },
        { player2: wallet }
      ],
      order: { createdAt: 'DESC' }
    });
    
    // Get waiting matches
    const waitingMatches = await matchRepository.find({
      where: { status: 'waiting' },
      order: { createdAt: 'ASC' }
    });
    
    // Check matchmaking locks
    const lockKey = `matchmaking_${wallet}`;
    const hasLock = (await getMatchmakingLock(lockKey)) !== null;
    const lockData = hasLock ? await getMatchmakingLock(lockKey) : null;
    
    res.json({
      wallet,
      timestamp: new Date().toISOString(),
      allMatches: allMatches.map((m: any) => ({
        id: m.id,
        status: m.status,
        player1: m.player1,
        player2: m.player2,
        entryFee: m.entryFee,
        createdAt: m.createdAt,
        player1Paid: m.player1Paid,
        player2Paid: m.player2Paid
      })),
      waitingMatches: waitingMatches.map((m: any) => ({
        id: m.id,
        player1: m.player1,
        entryFee: m.entryFee,
        createdAt: m.createdAt
      })),
      matchmakingLock: {
        hasLock,
        lockData: hasLock && lockData ? {
          timestamp: lockData.timestamp,
          wallet: lockData.wallet,
          entryFee: lockData.entryFee,
          age: Date.now() - lockData.timestamp
        } : null
      },
      memoryStats: await redisMemoryManager.getInstance().checkMemoryLimits()
    });
    
  } catch (error: unknown) {
    console.error('❌ Debug matchmaking failed:', error);
    res.status(500).json({ error: 'Failed to get debug info' });
  }
};

// Manual refund endpoint for testing
const manualRefundHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.body;
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID required' });
    }
    
    console.log(`💰 Manual refund requested for match: ${matchId}`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    console.log(`💰 Processing manual refund for match ${matchId}:`, {
      player1: match.player1,
      player2: match.player2,
      player1Paid: match.player1Paid,
      player2Paid: match.player2Paid,
      status: match.status
    });
    
    // Process refunds
    await processRefundsForFailedMatch(match);
    
    // Mark match as cancelled
    match.status = 'cancelled';
    await matchRepository.save(match);
    
    res.json({
      success: true,
      message: 'Manual refund processed successfully',
      matchId: matchId
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in manual refund:', error);
    res.status(500).json({ error: 'Failed to process manual refund' });
  }
};

// Manual execution endpoint to manually trigger proposal execution
const manualExecuteProposalHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.body;
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID required' });
    }
    
    console.log(`🚀 Manual execution requested for match: ${matchId}`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const proposalId = (match as any).payoutProposalId || (match as any).tieRefundProposalId;
    if (!proposalId) {
      return res.status(400).json({ error: 'No proposal found for this match' });
    }
    
    const proposalIdString = String(proposalId).trim();
    const proposalStatus = ((match as any).proposalStatus || '').toUpperCase();
    
    if (proposalStatus === 'EXECUTED') {
      return res.json({
        success: true,
        message: 'Proposal already executed',
        executionSignature: (match as any).proposalTransactionId || (match as any).refundTxHash || (match as any).payoutTxHash,
      });
    }
    
    if (!(match as any).squadsVaultAddress) {
      return res.status(400).json({ error: 'No vault address found for this match' });
    }
    
    const { getSquadsVaultService } = require('../services/squadsVaultService');
    const { getFeeWalletKeypair } = require('../config/wallet');
    const squadsVaultService = getSquadsVaultService();
    
    let feeWalletKeypair: any = null;
    try {
      feeWalletKeypair = getFeeWalletKeypair();
    } catch (keypairError: any) {
      return res.status(500).json({ 
        error: 'Fee wallet keypair unavailable',
        details: keypairError?.message || String(keypairError)
      });
    }
    
    console.log('🚀 Executing proposal manually', {
      matchId,
      proposalId: proposalIdString,
      vaultAddress: (match as any).squadsVaultAddress,
      vaultPda: (match as any).squadsVaultPda ?? null,
    });
    
    const executeResult = await squadsVaultService.executeProposal(
      (match as any).squadsVaultAddress,
      proposalIdString,
      feeWalletKeypair,
      (match as any).squadsVaultPda ?? undefined
    );
    
    if (!executeResult.success) {
      return res.status(500).json({
        error: 'Execution failed',
        details: executeResult.error,
        logs: executeResult.logs?.slice(-10),
      });
    }
    
    const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
    const isTieRefund =
      !!(match as any).tieRefundProposalId &&
      String((match as any).tieRefundProposalId).trim() === proposalIdString;
    const isWinnerPayout =
      !!(match as any).payoutProposalId &&
      String((match as any).payoutProposalId).trim() === proposalIdString &&
      (match as any).winner &&
      (match as any).winner !== 'tie';
    
    const executionUpdates = buildProposalExecutionUpdates({
      executedAt,
      signature: executeResult.signature ?? null,
      isTieRefund,
      isWinnerPayout,
    });
    
    await persistExecutionUpdates(matchRepository, matchId, executionUpdates);
    
    console.log('✅ Proposal executed successfully (manual)', {
      matchId,
      proposalId: proposalIdString,
      executionSignature: executeResult.signature,
      slot: executeResult.slot,
    });
    
    res.json({
      success: true,
      message: 'Proposal executed successfully',
      executionSignature: executeResult.signature,
      slot: executeResult.slot,
      executedAt: executedAt.toISOString(),
      matchId,
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in manual execution:', error);
    res.status(500).json({ 
      error: 'Failed to execute proposal',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

// Manual match endpoint to fix stuck matchmaking
const manualMatchHandler = async (req: any, res: any) => {
  try {
    const { player1, player2, entryFee } = req.body;
    
    if (!player1 || !player2 || !entryFee) {
      return res.status(400).json({ error: 'player1, player2, and entryFee required' });
    }
    
    console.log(`🎮 Manual match requested: ${player1} vs ${player2} with ${entryFee} SOL`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Clean up any existing waiting matches for these players
    const existingMatches = await matchRepository.find({
      where: [
        { player1: player1, status: 'waiting' },
        { player2: player1, status: 'waiting' },
        { player1: player2, status: 'waiting' },
        { player2: player2, status: 'waiting' }
      ]
    });
    
    if (existingMatches.length > 0) {
      console.log(`🧹 Cleaning up ${existingMatches.length} existing waiting matches`);
      await matchRepository.remove(existingMatches);
    }
    
    // Create a new match
    const newMatch = matchRepository.create({
      player1: player1,
      player2: player2,
      entryFee: entryFee,
    status: 'payment_required',
      createdAt: new Date(),
      updatedAt: new Date()
    });
    
    await matchRepository.save(newMatch);
    
    console.log(`✅ Manual match created: ${newMatch.id}`);
    
    res.json({
      success: true,
      message: 'Manual match created successfully',
      matchId: newMatch.id,
      player1: player1,
      player2: player2,
      entryFee: entryFee,
    status: 'vault_pending',
    squadsVaultAddress: null,
    vaultAddress: null
    });
    
  } catch (error: unknown) {
    console.error('❌ Error in manual match:', error);
    res.status(500).json({ error: 'Failed to create manual match' });
  }
};

// Manual endpoint to force proposal creation for stuck matches
const forceProposalCreationHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.body;
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID required' });
    }
    
    console.log(`🔧 Force proposal creation requested for match: ${matchId}`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get match using raw SQL to avoid proposalExpiresAt column issues
    const matchRows = await matchRepository.query(`
      SELECT 
        id, "player1", "player2", "entryFee", "squadsVaultAddress",
        "player1Result", "player2Result", winner, "isCompleted",
        "payoutProposalId", "tieRefundProposalId", "payoutResult"
      FROM "match"
      WHERE id = $1
      LIMIT 1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const matchRow = matchRows[0];
    const normalizedNeedsSignatures = normalizeRequiredSignatures(matchRow.needsSignatures);
    if (normalizedNeedsSignatures !== matchRow.needsSignatures) {
      try {
        await matchRepository.query(`
          UPDATE "match"
          SET "needsSignatures" = $1
          WHERE id = $2
        `, [normalizedNeedsSignatures, matchId]);
        console.log('🔧 Normalized needsSignatures during approval transaction build', {
          matchId,
          previous: matchRow.needsSignatures,
          normalized: normalizedNeedsSignatures,
        });
      } catch (normalizeError: any) {
        console.warn('⚠️ Failed to normalize needsSignatures during approval transaction build', {
          matchId,
          error: normalizeError?.message || String(normalizeError),
        });
      }
      matchRow.needsSignatures = normalizedNeedsSignatures;
    } else {
      matchRow.needsSignatures = normalizedNeedsSignatures;
    }

    const { getSquadsVaultService } = require('../services/squadsVaultService');
    const { getFeeWalletKeypair, getFeeWalletAddress, FEE_WALLET_ADDRESS } = require('../config/wallet');
    const squadsVaultService = getSquadsVaultService();
    const feeWalletAddress =
      typeof getFeeWalletAddress === 'function' ? getFeeWalletAddress() : FEE_WALLET_ADDRESS;
    
    if (!matchRow.squadsVaultAddress) {
      return res.status(400).json({ error: 'Match has no vault address' });
    }
    
    // Parse player results
    const player1Result = matchRow.player1Result ? (typeof matchRow.player1Result === 'string' ? JSON.parse(matchRow.player1Result) : matchRow.player1Result) : null;
    const player2Result = matchRow.player2Result ? (typeof matchRow.player2Result === 'string' ? JSON.parse(matchRow.player2Result) : matchRow.player2Result) : null;
    
    // Determine winner if not already set
    let winner = matchRow.winner;
    if (!winner && (player1Result || player2Result)) {
      console.log('🏆 Determining winner for stuck match...');
      const payoutResult = await determineWinnerAndPayout(matchId, player1Result, player2Result);
      winner = payoutResult?.winner || null;
      
      // Reload match to get updated winner
      const updatedRows = await matchRepository.query(`
        SELECT winner, "payoutResult"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [matchId]);
      if (updatedRows && updatedRows.length > 0) {
        winner = updatedRows[0].winner;
      }
    }
    
    if (!winner) {
      return res.status(400).json({ error: 'Cannot determine winner - no player results found' });
    }
    
    // Check if proposal already exists
    if (matchRow.payoutProposalId || matchRow.tieRefundProposalId) {
      return res.status(400).json({ 
        error: 'Proposal already exists',
        payoutProposalId: matchRow.payoutProposalId,
        tieRefundProposalId: matchRow.tieRefundProposalId
      });
    }
    
    // Acquire distributed lock to prevent race conditions
    const { getProposalLock, releaseProposalLock } = require('../utils/proposalLocks');
    const lockAcquired = await getProposalLock(matchId);
    
    if (!lockAcquired) {
      console.log('⚠️ Proposal lock not acquired (force proposal), another process may be creating proposal. Reloading match...');
      // Reload match to check if proposal was created by another process
      const reloadedRows = await matchRepository.query(`
        SELECT "payoutProposalId", "tieRefundProposalId"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [matchId]);
      if (reloadedRows && reloadedRows.length > 0 && (reloadedRows[0].payoutProposalId || reloadedRows[0].tieRefundProposalId)) {
        return res.json({
          success: true,
          message: 'Proposal was created by another process',
          matchId: matchId,
          proposalId: reloadedRows[0].payoutProposalId || reloadedRows[0].tieRefundProposalId,
          proposalType: reloadedRows[0].payoutProposalId ? 'winnerPayout' : 'tieRefund',
          winner: winner
        });
      }
      return res.status(429).json({ error: 'Another process is creating proposal, please try again' });
    }
    
    try {
      // Double-check proposal still doesn't exist after acquiring lock
      const checkRows = await matchRepository.query(`
        SELECT "payoutProposalId", "tieRefundProposalId"
        FROM "match"
        WHERE id = $1
        LIMIT 1
      `, [matchId]);
      if (checkRows && checkRows.length > 0 && (checkRows[0].payoutProposalId || checkRows[0].tieRefundProposalId)) {
        return res.json({
          success: true,
          message: 'Proposal already exists',
          matchId: matchId,
          proposalId: checkRows[0].payoutProposalId || checkRows[0].tieRefundProposalId,
          proposalType: checkRows[0].payoutProposalId ? 'winnerPayout' : 'tieRefund',
          winner: winner
        });
      }
      
      // Create proposal based on winner
      const { PublicKey } = require('@solana/web3.js');
      const { squadsVaultService } = require('../services/squadsVaultService');
      const { FEE_WALLET_ADDRESS } = require('../config/wallet');
      
      let proposalId = null;
      let proposalType = null;
      
      if (winner === 'tie') {
        // Create tie refund proposal
        console.log('💰 Creating tie refund proposal...');
        const tiePaymentStatus = {
          ...(matchRow.player1Paid !== undefined && { player1Paid: !!matchRow.player1Paid }),
          ...(matchRow.player2Paid !== undefined && { player2Paid: !!matchRow.player2Paid }),
        };

        const tieResult = await squadsVaultService.proposeTieRefund(
          matchRow.squadsVaultAddress,
          new PublicKey(matchRow.player1),
          new PublicKey(matchRow.player2),
          matchRow.entryFee,
          matchRow.squadsVaultPda ?? undefined,
          tiePaymentStatus
        );
        
        if (tieResult?.proposalId) {
          proposalId = tieResult.proposalId.toString();
          proposalType = 'tieRefund';
          
          await matchRepository.query(`
            UPDATE "match"
            SET "tieRefundProposalId" = $1, "proposalStatus" = 'pending', "proposalCreatedAt" = $2
            WHERE id = $3
          `, [proposalId, new Date(), matchId]);
        }
      } else {
        // Create winner payout proposal
        console.log('💰 Creating winner payout proposal...', { winner, player1: matchRow.player1, player2: matchRow.player2 });
        
        // Validate winner is a valid wallet address
        if (winner !== matchRow.player1 && winner !== matchRow.player2) {
          return res.status(400).json({ error: `Invalid winner: ${winner} is not one of the players` });
        }
        
        const totalPot = matchRow.entryFee * 2;
        const winnerAmount = totalPot * 0.95;
        const feeAmount = totalPot * 0.05;
        
        const payoutResult = await squadsVaultService.proposeWinnerPayout(
          matchRow.squadsVaultAddress,
          new PublicKey(winner),
          winnerAmount,
          new PublicKey(FEE_WALLET_ADDRESS),
        feeAmount,
        matchRow.squadsVaultPda ?? undefined
        );
        
        if (payoutResult?.proposalId) {
          proposalId = payoutResult.proposalId.toString();
          proposalType = 'winnerPayout';
          
          await matchRepository.query(`
            UPDATE "match"
            SET "payoutProposalId" = $1, "proposalStatus" = 'pending', "proposalCreatedAt" = $2
            WHERE id = $3
          `, [proposalId, new Date(), matchId]);
        }
      }
      
      if (!proposalId) {
        return res.status(500).json({ error: 'Failed to create proposal' });
      }
    
      console.log(`✅ Proposal created successfully: ${proposalId} (${proposalType})`);
      
      res.json({
        success: true,
        message: 'Proposal created successfully',
        matchId: matchId,
        proposalId: proposalId,
        proposalType: proposalType,
        winner: winner
      });
    } finally {
      await releaseProposalLock(matchId);
    }
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error forcing proposal creation:', errorMessage);
    res.status(500).json({ 
      error: 'Failed to create proposal',
      details: errorMessage 
    });
  }
};

// Database migration endpoint (for adding new columns)
const runMigrationHandler = async (req: any, res: any) => {
  try {
    console.log('🔄 Running database migration...');
    
    const { AppDataSource } = require('../db/index');
    
    // Run the migration SQL directly
    const migrationQueries = [

      // Payment signature columns
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1PaymentSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2PaymentSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "winnerPayoutSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1RefundSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2RefundSignature" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "matchOutcome" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "gameEndTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "matchDuration" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalFeesCollected" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "platformFee" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundReason" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundedAt" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1Moves" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2Moves" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1CompletionTime" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2CompletionTime" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "targetWord" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1Guesses" JSONB`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2Guesses" JSONB`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1PaymentTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2PaymentTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player1LastGuessTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "player2LastGuessTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundAmount" DECIMAL(10,6)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "payoutAmount" DECIMAL(10,6)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "disputeFlagged" BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "disputeNotes" TEXT`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "resolvedBy" VARCHAR`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "resolutionTime" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalRevenue" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalPayouts" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalRefunds" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "netRevenue" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "platformRevenue" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "networkFees" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "taxableIncome" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "fiscalYear" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "quarter" INTEGER`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "entryFeeUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "refundAmountUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "payoutAmountUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "platformFeeUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "totalFeesCollectedUSD" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "solPriceAtTransaction" DECIMAL(10,2)`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "transactionTimestamp" TIMESTAMP`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "actualNetworkFees" DECIMAL(10,6) DEFAULT 0`,
      `ALTER TABLE "match" ADD COLUMN IF NOT EXISTS "actualNetworkFeesUSD" DECIMAL(10,2) DEFAULT 0`
    ];
    
    for (const query of migrationQueries) {
      try {
        await AppDataSource.query(query);
        console.log(`✅ Executed: ${query}`);
      } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
        console.log(`⚠️ Column might already exist: ${errorMessage}`);
      }
    }
    
    console.log('✅ Database migration completed successfully');
    
    res.json({
      success: true,
      message: 'Database migration completed successfully',
      columnsAdded: [

        // Payment signature columns
        'player1PaymentSignature',
        'player2PaymentSignature', 
        'winnerPayoutSignature',
        'player1RefundSignature',
        'player2RefundSignature',
        'matchOutcome',
        'gameEndTime',
        'matchDuration',
        'totalFeesCollected',
        'platformFee',
        'refundReason',
        'refundedAt',
        'player1Moves',
        'player2Moves',
        'player1CompletionTime',
        'player2CompletionTime',
        'targetWord',
        'player1Guesses',
        'player2Guesses',
        'player1PaymentTime',
        'player2PaymentTime',
        'player1LastGuessTime',
        'player2LastGuessTime',
        'refundAmount',
        'payoutAmount',
        'disputeFlagged',
        'disputeNotes',
        'resolvedBy',
        'resolutionTime',
        'totalRevenue',
        'totalPayouts',
        'totalRefunds',
        'netRevenue',
        'platformRevenue',
        'networkFees',
        'taxableIncome',
        'fiscalYear',
        'quarter',
        'entryFeeUSD',
        'refundAmountUSD',
        'payoutAmountUSD',
        'platformFeeUSD',
        'totalFeesCollectedUSD',
        'solPriceAtTransaction',
        'transactionTimestamp',
        'actualNetworkFees',
        'actualNetworkFeesUSD'
      ]
    });
    
  } catch (error: unknown) {
    console.error('❌ Error running migration:', error);
    res.status(500).json({ error: 'Failed to run migration' });
  }
};

// Helper function to convert UTC to EST
const convertToEST = (date: any) => {
  if (!date) return '';
  const utcDate = new Date(date);
  const estDate = new Date(utcDate.toLocaleString("en-US", {timeZone: "America/New_York"}));
  return estDate.toISOString().replace('T', ' ').substring(0, 19);
};

// Cache for SOL price to reduce API calls
let solPriceCache = {
  price: null as number | null,
  timestamp: 0,
  expiresAt: 0
};
// Helper function to get SOL price in USD with robust fallback system
const getSolPriceUSD = async () => {
  const CACHE_DURATION_MS = 30000; // Cache for 30 seconds
  const now = Date.now();
  
  // Check cache first
  if (solPriceCache.price && solPriceCache.expiresAt > now) {
    return solPriceCache.price;
  }
  
  // Clear expired cache
  if (solPriceCache.expiresAt <= now) {
    solPriceCache = { price: null, timestamp: 0, expiresAt: 0 };
  }
  const TIMEOUT_MS = 5000; // 5 second timeout
  const MAX_RETRIES = 2;
  
  // Helper function to make a fetch request with timeout
  const fetchWithTimeout = async (url: string, options: any = {}) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
    
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Guess5-Game/1.0',
          'Accept': 'application/json',
          ...options.headers
        }
      });
      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  };

    // Try CoinGecko API with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
      
      if (!response.ok) {
        throw new Error(`CoinGecko API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.solana && data.solana.usd && typeof data.solana.usd === 'number' && data.solana.usd > 0) {
        const price = data.solana.usd;
        // Cache the successful result
        solPriceCache = {
          price,
          timestamp: now,
          expiresAt: now + CACHE_DURATION_MS
        };
        return price;
      }
      throw new Error('Invalid SOL price data from CoinGecko');
    } catch (error: unknown) {
      if (attempt === MAX_RETRIES) {
        console.error('❌ SOL price fetch failed from all sources');
      } else {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
    // Fallback: Try Binance API with retries
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await fetchWithTimeout('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
      
      if (!response.ok) {
        throw new Error(`Binance API returned ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      if (data.price && typeof data.price === 'string' && parseFloat(data.price) > 0) {
        const price = parseFloat(data.price);
        // Cache the successful result
        solPriceCache = {
          price,
          timestamp: now,
          expiresAt: now + CACHE_DURATION_MS
        };
        return price;
      }
      throw new Error('Invalid SOL price data from Binance');
    } catch (error: unknown) {
      if (attempt === MAX_RETRIES) {
        console.error('❌ SOL price fetch failed from all sources');
      } else {
        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  
    // Final fallback: Use recent match data to calculate SOL price
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get the most recent completed match with valid SOL price data
    const recentMatch = await matchRepository.findOne({
      where: {
        status: 'completed',
        solPriceAtTransaction: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatch && recentMatch.solPriceAtTransaction && recentMatch.solPriceAtTransaction > 0) {
      const price = recentMatch.solPriceAtTransaction;
      // Cache the fallback result
      solPriceCache = {
        price,
        timestamp: now,
        expiresAt: now + CACHE_DURATION_MS
      };
      return price;
    }
    
    // If no recent match with price, try to calculate from entry fee and USD amount
    const recentMatchWithUSD = await matchRepository.findOne({
      where: {
        status: 'completed',
        entryFeeUSD: Not(IsNull()),
        entryFee: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatchWithUSD && recentMatchWithUSD.entryFeeUSD && recentMatchWithUSD.entryFee && recentMatchWithUSD.entryFee > 0) {
      const calculatedPrice = recentMatchWithUSD.entryFeeUSD / recentMatchWithUSD.entryFee;
      if (calculatedPrice > 0) {
        // Cache the calculated fallback result
        solPriceCache = {
          price: calculatedPrice,
          timestamp: now,
          expiresAt: now + CACHE_DURATION_MS
        };
        return calculatedPrice;
      }
    }
    
    return null;
  } catch (dbError) {
    console.error('❌ Error getting fallback price from database:', dbError);
    return null;
  }
};

// Helper function to determine the correct network for explorer links
const getExplorerNetwork = () => {
  const network = (process.env.SOLANA_NETWORK && process.env.SOLANA_NETWORK.toLowerCase().includes('devnet')) ? 'devnet' : 'mainnet';
  console.log(`🔗 Network detection: SOLANA_NETWORK="${process.env.SOLANA_NETWORK}", detected="${network}"`);
  return network;
};

// Helper function to get the most recent SOL price from completed matches
const getRecentSolPriceFromMatches = async () => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Get the most recent completed match with valid SOL price data
    const recentMatch = await matchRepository.findOne({
      where: {
        status: 'completed',
        solPriceAtTransaction: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatch && recentMatch.solPriceAtTransaction) {
      return recentMatch.solPriceAtTransaction;
    }
    
    // If no recent match with price, try to calculate from entry fee and USD amount
    const recentMatchWithUSD = await matchRepository.findOne({
      where: {
        status: 'completed',
        entryFeeUSD: Not(IsNull()),
        entryFee: Not(IsNull())
      },
      order: {
        createdAt: 'DESC'
      }
    });
    
    if (recentMatchWithUSD && recentMatchWithUSD.entryFeeUSD && recentMatchWithUSD.entryFee) {
      return recentMatchWithUSD.entryFeeUSD / recentMatchWithUSD.entryFee;
    }
    
    return null;
  } catch (error) {
    console.error('❌ Error getting recent SOL price from matches:', error);
    return null;
  }
};

// Helper function to get transaction details from blockchain
const getTransactionDetails = async (signature: any) => {
  try {
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });
    
    if (!transaction) {
      console.log(`⚠️ Transaction not found: ${signature}`);
      return null;
    }
    
    // Get actual transaction fee (what Phantom charged)
    const actualFee = transaction.meta?.fee || 0;
    const feeInSOL = actualFee / LAMPORTS_PER_SOL;
    
    // Get transaction timestamp
    const blockTime = transaction.blockTime;
    const transactionDate = blockTime ? new Date(blockTime * 1000) : new Date();
    
    // Get SOL price at transaction time
    const solPrice = await getSolPriceUSD();
    
    // Create explorer links
    const network = getExplorerNetwork();
    const explorerLink = `https://explorer.solana.com/tx/${signature}?cluster=${network}`;
    const solscanLink = `https://solscan.io/tx/${signature}?cluster=${network}`;
    
    return {
      signature,
      actualFee: feeInSOL,
      actualFeeUSD: solPrice ? feeInSOL * solPrice : null,
      transactionDate,
      solPriceAtTime: solPrice,
      confirmed: transaction.meta?.err === null,
      slot: transaction.slot,
      blockTime: blockTime,
      explorerLink,
      solscanLink
    };
  } catch (error: unknown) {
    console.error(`❌ Error fetching transaction ${signature}:`, error);
    return null;
  }
};

// Helper function to verify and update match with blockchain data
const updateMatchWithBlockchainData = async (match: any) => {
  try {
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    let totalNetworkFees = 0;
    let totalNetworkFeesUSD = 0;
    let totalActualFees = 0;
    let totalActualFeesUSD = 0;
    
    // Verify player1 payment
    if (match.player1PaymentSignature) {
      const txDetails = await getTransactionDetails(match.player1PaymentSignature);
      if (txDetails) {
        match.player1PaymentTime = txDetails.transactionDate;
        match.player1PaymentBlockTime = txDetails.transactionDate;
        match.player1PaymentBlockNumber = txDetails.slot;
        match.player1PaymentConfirmed = txDetails.confirmed;
        match.player1PaymentFee = txDetails.actualFee;
        match.solPriceAtTransaction = txDetails.solPriceAtTime;
        match.entryFeeUSD = match.entryFee * (txDetails.solPriceAtTime || 0);
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player1 payment: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Verify player2 payment
    if (match.player2PaymentSignature) {
      const txDetails = await getTransactionDetails(match.player2PaymentSignature);
      if (txDetails) {
        match.player2PaymentTime = txDetails.transactionDate;
        match.player2PaymentBlockTime = txDetails.transactionDate;
        match.player2PaymentBlockNumber = txDetails.slot;
        match.player2PaymentConfirmed = txDetails.confirmed;
        match.player2PaymentFee = txDetails.actualFee;
        if (!match.solPriceAtTransaction) {
          match.solPriceAtTransaction = txDetails.solPriceAtTime;
          match.entryFeeUSD = match.entryFee * (txDetails.solPriceAtTime || 0);
        }
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player2 payment: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Verify winner payout
    if (match.winnerPayoutSignature) {
      const txDetails = await getTransactionDetails(match.winnerPayoutSignature);
      if (txDetails) {
        match.payoutAmount = match.entryFee * 2 * 0.95; // 95% of total entry fees
        match.payoutAmountUSD = match.payoutAmount * (txDetails.solPriceAtTime || 0);
        match.winnerPayoutBlockTime = txDetails.transactionDate;
        match.winnerPayoutBlockNumber = txDetails.slot;
        match.winnerPayoutConfirmed = txDetails.confirmed;
        match.winnerPayoutFee = txDetails.actualFee;
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified winner payout: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Verify refunds
    if (match.player1RefundSignature) {
      const txDetails = await getTransactionDetails(match.player1RefundSignature);
      if (txDetails) {
        match.refundAmount = match.entryFee - 0.0001; // Entry fee minus network fee
        match.refundAmountUSD = match.refundAmount * (txDetails.solPriceAtTime || 0);
        match.player1RefundBlockTime = txDetails.transactionDate;
        match.player1RefundBlockNumber = txDetails.slot;
        match.player1RefundConfirmed = txDetails.confirmed;
        match.player1RefundFee = txDetails.actualFee;
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player1 refund: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    if (match.player2RefundSignature) {
      const txDetails = await getTransactionDetails(match.player2RefundSignature);
      if (txDetails) {
        if (!match.refundAmount) {
          match.refundAmount = match.entryFee - 0.0001;
          match.refundAmountUSD = match.refundAmount * (txDetails.solPriceAtTime || 0);
        }
        match.player2RefundBlockTime = txDetails.transactionDate;
        match.player2RefundBlockNumber = txDetails.slot;
        match.player2RefundConfirmed = txDetails.confirmed;
        match.player2RefundFee = txDetails.actualFee;
        totalActualFees += txDetails.actualFee;
        totalActualFeesUSD += txDetails.actualFeeUSD || 0;
        console.log(`✅ Verified Player2 refund: ${txDetails.actualFee} SOL (${txDetails.actualFeeUSD} USD) - Block ${txDetails.slot}`);
      }
    }
    
    // Calculate financial totals
    match.totalFeesCollected = match.entryFee * 2;
    match.totalFeesCollectedUSD = match.totalFeesCollected * (match.solPriceAtTransaction || 0);
    match.platformFee = match.totalFeesCollected * 0.05; // 5% platform fee
    match.platformFeeUSD = match.platformFee * (match.solPriceAtTransaction || 0);
    match.actualNetworkFees = totalActualFees; // Actual blockchain fees from Phantom
    match.actualNetworkFeesUSD = totalActualFeesUSD; // Actual fees in USD
    match.networkFees = totalActualFees; // For backward compatibility
    match.totalRevenue = match.totalFeesCollected;
    match.totalPayouts = match.payoutAmount || 0;
    match.totalRefunds = (match.player1RefundSignature ? match.refundAmount : 0) + 
                        (match.player2RefundSignature ? match.refundAmount : 0);
    match.netRevenue = match.totalRevenue - match.totalPayouts - match.totalRefunds;
    match.platformRevenue = match.platformFee;
    match.taxableIncome = match.platformRevenue - match.actualNetworkFees; // Use actual network fees
    
    // Set fiscal info
    const fiscalInfo = getFiscalInfo(match.createdAt);
    match.fiscalYear = fiscalInfo.fiscalYear;
    match.quarter = fiscalInfo.quarter;
    
    // Save updated match
    await matchRepository.save(match);
    
    console.log(`💰 Updated match ${match.id} with blockchain data:`);
    console.log(`   Total actual fees: ${totalActualFees} SOL (${totalActualFeesUSD} USD)`);
    console.log(`   Taxable income: ${match.taxableIncome} SOL`);
    
    return match;
    
  } catch (error: unknown) {
    console.error('❌ Error updating match with blockchain data:', error);
    return null;
  }
};

// Helper function to calculate fiscal year and quarter
const getFiscalInfo = (date: any) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  const quarter = Math.ceil(month / 3);
  return { fiscalYear: year, quarter };
};
// Match report endpoint (exports to CSV) - Updated with high-impact security fixes
const generateReportHandler = async (req: any, res: any) => {
  try {
    // Default to 11/4/2025 to only include recent matches (after migration/testing)
    const { startDate = '2025-11-04', endDate } = req.query;
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Build date filter - use DATE() function for compatibility
    // >= includes the startDate (so 11/4/2025 and later matches)
    let dateFilter = `DATE("createdAt") >= '${startDate}'`;
    if (endDate) {
      dateFilter += ` AND DATE("createdAt") <= '${endDate}'`;
    }
    
    console.log(`📅 CSV Export Date Filter: ${dateFilter}`);
    
    // Try to get matches with all columns, but fallback to minimal query if columns don't exist
    let matches: any[];
    try {
      // First attempt: try with all new columns
      matches = await matchRepository.query(`
      SELECT 
        id,
        "player1",
        "player2",
        "entryFee",
          "entryFeeUSD",
        status,
        "squadsVaultAddress",
        "depositATx",
        "depositBTx",
        "depositAConfirmations",
        "depositBConfirmations",
        "gameStartTime",
        "gameStartTimeUtc",
        "gameEndTime",
        "gameEndTimeUtc",
        "player1Paid",
        "player2Paid",
        "player1Result",
        "player2Result",
        winner,
        "payoutResult",
          "payoutAmount",
          "payoutAmountUSD",
        "proposalTransactionId",
        "matchOutcome",
        "totalFeesCollected",
        "platformFee",
        "matchDuration",
        "refundReason",
        "refundedAt",
        "refundedAtUtc",
        "isCompleted",
        "createdAt",
        "updatedAt",
        "payoutProposalId",
          "tieRefundProposalId",
        "proposalStatus",
        "proposalCreatedAt",
          "proposalExecutedAt",
        "needsSignatures",
        "proposalSigners",
          "player1PaymentSignature",
          "player2PaymentSignature",
          "winnerPayoutSignature",
          "player1PaymentTime",
          "player2PaymentTime",
          "player1PaymentBlockTime",
          "player2PaymentBlockTime",
          "winnerPayoutBlockTime",
          "player1PaymentBlockNumber",
          "player2PaymentBlockNumber",
          "winnerPayoutBlockNumber",
          "solPriceAtTransaction",
          "bonusPaid",
          "bonusTier",
          "bonusPercent",
          "bonusAmount",
          "bonusAmountUSD",
          "bonusSignature",
          "bonusPaidAt"
      FROM "match" 
      WHERE ${dateFilter}
        AND "squadsVaultAddress" IS NOT NULL
        AND (
            -- Executed payouts (most complete data)
            ("proposalStatus" = 'EXECUTED' AND "proposalTransactionId" IS NOT NULL)
            OR
            -- Completed matches (may not have proposalStatus set yet)
          (status = 'completed' AND "isCompleted" = true)
          OR 
            -- Cancelled with refunds
            (status = 'cancelled' AND "proposalTransactionId" IS NOT NULL)
          OR
            -- Matches with transaction IDs (payouts executed)
            ("proposalTransactionId" IS NOT NULL)
          OR
            -- Matches with both players paid
            ("player1Paid" = true AND "player2Paid" = true)
            OR
            -- Matches with results (games that finished)
          ("player1Result" IS NOT NULL OR "player2Result" IS NOT NULL)
        )
      ORDER BY "createdAt" DESC
    `);
      console.log(`✅ Full query succeeded with ${matches.length} matches`);
      console.log(`📊 Query stats:`, {
        dateFilter,
        hasSquadsVault: matches.filter((m: any) => m.squadsVaultAddress).length,
        bothPaid: matches.filter((m: any) => m.player1Paid && m.player2Paid).length,
        executed: matches.filter((m: any) => m.proposalStatus === 'EXECUTED').length,
        completed: matches.filter((m: any) => m.status === 'completed').length,
      });
      
      // If no matches found, try relaxed query
      if (matches.length === 0) {
        console.log('⚠️ No matches with filters, trying relaxed query...');
        const relaxedMatches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            "player2",
            "entryFee",
            status,
            "squadsVaultAddress",
            "depositATx",
            "depositBTx",
            "player1Paid",
            "player2Paid",
            "player1Result",
            "player2Result",
            winner,
            "payoutResult",
            "proposalTransactionId",
            "isCompleted",
            "createdAt",
            "updatedAt",
            "payoutProposalId",
            "proposalStatus",
            "proposalCreatedAt",
            "proposalExecutedAt",
            "needsSignatures"
          FROM "match" 
          WHERE ${dateFilter}
            AND "squadsVaultAddress" IS NOT NULL
          ORDER BY "createdAt" DESC
          LIMIT 100
        `);
        console.log(`✅ Relaxed query found ${relaxedMatches.length} matches`);
        if (relaxedMatches.length > 0) {
          matches = relaxedMatches;
        }
      }
    } catch (queryError: any) {
      const errorMsg = queryError?.message || String(queryError);
      console.log(`⚠️ Full query failed, trying fallback: ${errorMsg}`);
      
      try {
        // Fallback: use only columns that definitely exist (from older migrations)
        matches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            "player2",
            "entryFee",
            status,
            "squadsVaultAddress",
            "depositATx",
            "depositBTx",
            "player1Paid",
            "player2Paid",
            "player1Result",
            "player2Result",
            winner,
            "payoutResult",
            "proposalTransactionId",
            "matchOutcome",
            "totalFeesCollected",
            "platformFee",
            "matchDuration",
            "refundReason",
            "refundedAt",
            "refundedAtUtc",
            "isCompleted",
            "createdAt",
            "updatedAt",
            "payoutProposalId",
            "proposalStatus",
            "proposalCreatedAt",
            "proposalExecutedAt",
            "needsSignatures",
            "proposalSigners",
            "gameStartTimeUtc",
            "gameEndTimeUtc"
          FROM "match" 
          WHERE ${dateFilter}
            AND "squadsVaultAddress" IS NOT NULL
            AND (
              -- Executed payouts
              ("proposalStatus" = 'EXECUTED' AND "proposalTransactionId" IS NOT NULL)
              OR
              -- Completed matches
              (status = 'completed' AND "isCompleted" = true)
              OR
              -- Matches with both players paid
              ("player1Paid" = true AND "player2Paid" = true)
              OR
              -- Matches with results
              ("player1Result" IS NOT NULL OR "player2Result" IS NOT NULL)
              OR
              -- Matches with transaction IDs
              ("proposalTransactionId" IS NOT NULL)
            )
          ORDER BY "createdAt" DESC
          LIMIT 100
        `);
        console.log(`✅ Fallback query succeeded with ${matches.length} matches`);
        console.log(`📊 Fallback query stats:`, {
          dateFilter,
          hasSquadsVault: matches.filter((m: any) => m.squadsVaultAddress).length,
          bothPaid: matches.filter((m: any) => m.player1Paid && m.player2Paid).length,
        });
      } catch (fallbackError: any) {
        const fallbackMsg = fallbackError?.message || String(fallbackError);
        console.log(`⚠️ Fallback query also failed, trying minimal query: ${fallbackMsg}`);
        
        // Ultra-minimal fallback: only absolute core columns
        matches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            "player2",
            "entryFee",
            status,
            "squadsVaultAddress",
            "depositATx",
            "depositBTx",
            "player1Paid",
            "player2Paid",
            "player1Result",
            "player2Result",
            winner,
            "payoutResult",
            "proposalTransactionId",
            "isCompleted",
            "createdAt",
            "updatedAt",
            "payoutProposalId",
            "proposalStatus",
            "proposalCreatedAt",
            "needsSignatures",
            "proposalSigners"
          FROM "match" 
          WHERE ${dateFilter}
            AND "squadsVaultAddress" IS NOT NULL
            AND (
              -- Executed payouts
              ("proposalStatus" = 'EXECUTED' AND "proposalTransactionId" IS NOT NULL)
              OR
              -- Completed matches
              (status = 'completed' AND "isCompleted" = true)
              OR
              -- Matches with both players paid
              ("player1Paid" = true AND "player2Paid" = true)
              OR
              -- Matches with results
              ("player1Result" IS NOT NULL OR "player2Result" IS NOT NULL)
              OR
              -- Matches with transaction IDs
              ("proposalTransactionId" IS NOT NULL)
            )
          ORDER BY "createdAt" DESC
          LIMIT 100
        `);
        console.log(`✅ Minimal query succeeded with ${matches.length} matches`);
        console.log(`📊 Minimal query stats:`, {
          dateFilter,
          hasSquadsVault: matches.filter((m: any) => m.squadsVaultAddress).length,
        });
      }
    }
    

    
    // Helper function to sanitize CSV values (prevent injection)
    const sanitizeCsvValue = (value: any) => {
      if (!value) return '';
      const str = String(value);
      // If value starts with =, +, -, or @, prefix with single quote
      if (/^[=\-+@]/.test(str)) {
        return `'${str}`;
      }
      return str;
    };
    
    // Helper function to generate row hash for integrity
    const generateRowHash = (match: any) => {
      const crypto = require('crypto');
      const data = `${match.id}${match.player1}${match.player2}${match.winner}${match.totalFeesCollected}${match.payoutTxHash || match.refundTxHash || ''}${match.updatedAt}`;
      return crypto.createHash('sha256').update(data).digest('hex');
    };
    
    // Helper function to convert to EST
    const convertToEST = (timestamp: any) => {
      if (!timestamp) return '';
      try {
        return new Date(timestamp).toLocaleString('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        });
      } catch (error: unknown) {
        return '';
      }
    };
    
    // Generate CSV headers - Financial tracking focused
    const csvHeaders = [
      // Core Match Info
      'Match ID',
      'Player 1 Wallet',
      'Player 2 Wallet', 
      'Entry Fee (SOL)',
      // 'Entry Fee (USD)', // Removed per user request
      'Total Pot (SOL)',
      'Match Status',
      'Winner',
      'Winner Amount (SOL)',
      'Winner Amount (USD)',
      // 'Platform Fee (SOL)', // Removed per user request
      'Fee Wallet Address',
      'Game Completed',
      
      // Bonus Tracking
      'Bonus Paid',
      'Bonus Tier',
      'Bonus Percent',
      'Bonus Amount (SOL)',
      'Bonus Amount (USD)',
      'Bonus Signature',
      'Bonus Paid At (EST)',
      
      // Vault & Deposits
      'Squads Vault Address',
      'Player 1 Deposit TX',
      'Player 2 Deposit TX',
      
      // Game Results
      'Player 1 Solved',
      'Player 1 Guesses',
      'Player 1 Time (sec)',
      'Player 1 Result Reason',
      'Player 2 Solved',
      'Player 2 Guesses',
      'Player 2 Time (sec)',
      'Player 2 Result Reason',
      
      // Timestamps
      'Match Created (EST)',
      'Game Started (EST)',
      // 'Game Ended (EST)', // Removed per user request (columns Z-AD)
      // 'Executed Transaction Hash', // Removed per user request (columns Z-AD)
      // 'Payout Proposal ID', // Removed per user request (columns Z-AD)
      // 'Tie Refund Proposal ID', // Removed per user request (columns Z-AD)
      // 'Proposal Status', // Removed per user request (columns Z-AD)
      'Proposal Created At',
      'Proposal Executed At',
      // 'Needs Signatures', // Removed per user request (column AL)
      
      // Explorer Links
      'Squads Vault Link',
      'Player 1 Deposit Link',
      'Player 2 Deposit Link',
      'Executed Transaction Link'
    ];
    
    // Get fee wallet address
    const { FEE_WALLET_ADDRESS } = require('../config/wallet');
    const feeWalletAddress = FEE_WALLET_ADDRESS;
    
    // Helper function to backfill execution signatures for old matches
    const backfillExecutionSignature = async (match: any) => {
      // Only backfill if proposal is EXECUTED but has invalid transaction ID
      // Check if proposalTransactionId is missing, too short, or is just a numeric proposal ID (not a transaction signature)
      const hasValidTxId = match.proposalTransactionId && 
                           match.proposalTransactionId.length > 40 && 
                           !/^\d+$/.test(match.proposalTransactionId); // Not just digits (proposal ID)
      
      if (match.proposalStatus === 'EXECUTED' && !hasValidTxId) {
        try {
          const { Connection, PublicKey } = require('@solana/web3.js');
          const { PROGRAM_ID: DEFAULT_SQDS_PROGRAM_ID, getTransactionPda } = require('@sqds/multisig');
          const connection = new Connection(
            process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
            'confirmed'
          );
          
          const proposalId = match.payoutProposalId || match.tieRefundProposalId;
          if (!proposalId || !match.squadsVaultAddress) return match;
          
          const multisigAddress = new PublicKey(match.squadsVaultAddress);
          const transactionIndex = BigInt(proposalId);
          
          // Derive transaction PDA using Squads helper to avoid seed mistakes
          let programIdForPda = DEFAULT_SQDS_PROGRAM_ID;
          if (process.env.SQUADS_PROGRAM_ID) {
            try {
              programIdForPda = new PublicKey(process.env.SQUADS_PROGRAM_ID);
            } catch (pidError) {
              console.warn('⚠️ Invalid SQUADS_PROGRAM_ID provided, falling back to default:', (pidError as Error).message);
            }
          }

          const [transactionPda] = getTransactionPda({
            multisigPda: multisigAddress,
            index: transactionIndex,
            programId: programIdForPda,
          });
          
          // Check if transaction account exists (if not, it's been executed)
          const transactionAccount = await connection.getAccountInfo(transactionPda);
          if (!transactionAccount) {
            // Transaction executed - find execution transaction by looking for recent transactions
            // from the vault, players (for tie refunds), or winner (for winner payouts)
            const vaultAddress = new PublicKey(match.squadsVaultAddress);
            const winnerAddress = match.winner && match.winner !== 'tie' ? new PublicKey(match.winner) : null;
            const player1Address = match.player1 ? new PublicKey(match.player1) : null;
            const player2Address = match.player2 ? new PublicKey(match.player2) : null;
            const feeWalletAddress = new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt');
            
            // Get recent transactions from vault (increase limit to 500 for better coverage)
            const vaultSignatures = await connection.getSignaturesForAddress(vaultAddress, { limit: 500 });
            
            // For tie matches, also check transactions from player addresses (they receive refunds)
            let playerSignatures: any[] = [];
            if (match.winner === 'tie' && player1Address && player2Address) {
              try {
                const p1Sigs = await connection.getSignaturesForAddress(player1Address, { limit: 200 });
                const p2Sigs = await connection.getSignaturesForAddress(player2Address, { limit: 200 });
                playerSignatures = [...p1Sigs, ...p2Sigs];
                console.log(`  📋 Checking ${playerSignatures.length} additional transactions from player addresses for tie match`);
              } catch (e) {
                console.log(`  ⚠️ Could not fetch player transactions: ${(e as Error).message}`);
              }
            }
            
            // Combine all signatures (remove duplicates)
            const allSignatures = [...vaultSignatures];
            const seenSignatures = new Set(vaultSignatures.map(s => s.signature));
            for (const sig of playerSignatures) {
              if (!seenSignatures.has(sig.signature)) {
                allSignatures.push(sig);
                seenSignatures.add(sig.signature);
              }
            }
            
            // Find the execution transaction by checking transactions that involve relevant addresses
            // Use proposal execution time if available, otherwise use proposal creation time
            const proposalExecutedAt = match.proposalExecutedAt ? new Date(match.proposalExecutedAt).getTime() : 0;
            const proposalCreatedAt = match.proposalCreatedAt ? new Date(match.proposalCreatedAt).getTime() : 0;
            const referenceTime = proposalExecutedAt || proposalCreatedAt;
            
            console.log(`🔍 Backfilling execution signature for match ${match.id}, proposalId: ${proposalId}, winner: ${match.winner}, referenceTime: ${referenceTime ? new Date(referenceTime).toISOString() : 'unknown'}, checking ${allSignatures.length} transactions (${vaultSignatures.length} from vault, ${playerSignatures.length} from players)`);
            
            // Track best candidate transaction
            let bestMatch: { signature: string; txTime: number; score: number } | null = null;
            
            for (const sigInfo of allSignatures) {
              try {
                const tx = await connection.getTransaction(sigInfo.signature, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0
                });
                
                if (tx && tx.meta && !tx.meta.err) {
                  const txTime = tx.blockTime ? tx.blockTime * 1000 : 0;
                  
                  // Check if transaction involves winner, players (for tie refunds), or fee wallet
                  const accountKeys = tx.transaction.message.accountKeys.map((key: any) => 
                    typeof key === 'string' ? key : key.pubkey.toString()
                  );
                  
                  // Check if relevant addresses are involved
                  const winnerInvolved = winnerAddress && accountKeys.includes(winnerAddress.toString());
                  const player1Involved = player1Address && accountKeys.includes(player1Address.toString());
                  const player2Involved = player2Address && accountKeys.includes(player2Address.toString());
                  const feeWalletInvolved = accountKeys.includes(feeWalletAddress.toString());
                  
                  // Check if transaction shows balance changes (indicates funds were transferred)
                  const hasBalanceChanges = tx.meta.postBalances && tx.meta.preBalances && 
                    tx.meta.postBalances.some((post: number, idx: number) => 
                      post !== tx.meta.preBalances[idx]
                    );
                  
                  // Calculate balance change magnitude (for tie refunds, both players should receive funds)
                  let balanceChangeScore = 0;
                  if (hasBalanceChanges && tx.meta.postBalances && tx.meta.preBalances) {
                    for (let i = 0; i < tx.meta.postBalances.length; i++) {
                      const change = tx.meta.postBalances[i] - tx.meta.preBalances[i];
                      if (change > 0) {
                        balanceChangeScore += change;
                      }
                    }
                  }
                  
                  // For tie matches, check if either player is involved (refunds)
                  // For winner matches, check if winner or fee wallet is involved
                  const isRelevantTransaction = (match.winner === 'tie' && (player1Involved || player2Involved || feeWalletInvolved)) ||
                                                 (winnerAddress && (winnerInvolved || feeWalletInvolved));
                  
                  // Time check: transaction should be within 2 hours before/after execution time
                  // Prefer transactions closer to execution time
                  let timeScore = 0;
                  let timeMatch = false;
                  if (referenceTime > 0) {
                    const timeDiff = Math.abs(txTime - referenceTime);
                    timeMatch = timeDiff <= 7200000; // 2 hour window
                    if (timeMatch) {
                      // Score higher for transactions closer to execution time (inverse of time diff)
                      timeScore = 1 / (1 + timeDiff / 1000); // Normalize to seconds
                    }
                  } else {
                    // If no reference time, accept any transaction with balance changes
                    timeMatch = true;
                    timeScore = 0.5;
                  }
                  
                  // Calculate overall score
                  const score = (isRelevantTransaction ? 10 : 0) + 
                                (hasBalanceChanges ? 5 : 0) + 
                                timeScore + 
                                (balanceChangeScore > 0 ? Math.min(Math.log10(balanceChangeScore / 1e9), 3) : 0); // Log scale for SOL amounts
                  
                  // Track best match
                  if (timeMatch && (isRelevantTransaction || hasBalanceChanges) && score > 0) {
                    if (!bestMatch || score > bestMatch.score) {
                      bestMatch = {
                        signature: sigInfo.signature,
                        txTime: txTime,
                        score: score
                      };
                      console.log(`  📌 Found candidate transaction: ${sigInfo.signature.substring(0, 16)}..., score: ${score.toFixed(2)}, time: ${new Date(txTime).toISOString()}, winner: ${winnerInvolved}, p1: ${player1Involved}, p2: ${player2Involved}, fee: ${feeWalletInvolved}, balanceChange: ${balanceChangeScore}`);
                    }
                  }
                }
              } catch (txError: any) {
                // Skip if we can't fetch this transaction
                continue;
              }
            }
            
            // Use best match if found
            if (bestMatch) {
              match.proposalTransactionId = bestMatch.signature;
              match.winnerPayoutSignature = bestMatch.signature;
    
              // Get full transaction details for block time/slot
              try {
                const finalTx = await connection.getTransaction(bestMatch.signature, {
                  commitment: 'confirmed',
                  maxSupportedTransactionVersion: 0
                });
                if (finalTx) {
                  match.winnerPayoutBlockTime = finalTx.blockTime ? new Date(finalTx.blockTime * 1000) : undefined;
                  match.winnerPayoutBlockNumber = finalTx.slot ? finalTx.slot.toString() : undefined;
                }
              } catch (e) {
                // Use best match time if we can't fetch full details
                match.winnerPayoutBlockTime = new Date(bestMatch.txTime);
              }
              
              // Save to database
              try {
                await matchRepository.save(match);
                console.log(`✅ Backfilled and saved execution signature for match ${match.id}: ${bestMatch.signature}, txTime: ${new Date(bestMatch.txTime).toISOString()}, score: ${bestMatch.score.toFixed(2)}`);
              } catch (saveError: any) {
                console.error(`❌ Failed to save backfilled signature for match ${match.id}:`, saveError?.message);
              }
            } else {
              console.log(`⚠️ Could not find execution transaction for match ${match.id} - checked ${allSignatures.length} transactions (${vaultSignatures.length} from vault, ${playerSignatures.length} from players)`);
            }
          }
        } catch (error: any) {
          console.error(`❌ Error backfilling execution signature for match ${match.id}:`, error?.message);
        }
      }
      return match;
    };
    
    // Generate CSV rows with available data
    // For CSV generation, only backfill a limited number of matches to avoid timeout
    // Process matches in batches and skip backfill for most matches (use cached data)
    const csvRows = await Promise.all(matches.map(async (match: any, index: number) => {
      // Only backfill first 10 matches to avoid timeout - others use existing data
      // If proposalTransactionId is already valid, skip backfill
      const hasValidTxId = match.proposalTransactionId && 
                           match.proposalTransactionId.length > 40 && 
                           !/^\d+$/.test(match.proposalTransactionId);
      
      let matchWithSignature = match;
      if (index < 10 && !hasValidTxId && match.proposalStatus === 'EXECUTED') {
        // Quick backfill with timeout for first few matches only
        try {
          matchWithSignature = await Promise.race([
            backfillExecutionSignature(match),
            new Promise((resolve) => setTimeout(() => resolve(match), 5000)) // 5 second timeout
          ]) as any;
        } catch (e) {
          // Use original match if backfill fails
          matchWithSignature = match;
        }
      } else {
        // Use existing match data for rest
        matchWithSignature = match;
      }
      
      // Determine explorer network
      const network = getExplorerNetwork();
      
      // Parse player results for meaningful data
      const player1Result = matchWithSignature.player1Result ? JSON.parse(matchWithSignature.player1Result) : null;
      const player2Result = matchWithSignature.player2Result ? JSON.parse(matchWithSignature.player2Result) : null;
      const payoutResult = matchWithSignature.payoutResult ? JSON.parse(matchWithSignature.payoutResult) : null;
      
      // Calculate total pot and amounts based on match status
      const totalPot = matchWithSignature.entryFee * 2;
      let winnerAmount = matchWithSignature.payoutAmount || 0;
      let winnerAmountUSD = matchWithSignature.payoutAmountUSD || 0;
      let platformFee = matchWithSignature.platformFee || 0;
      let winner = '';
      
      if (matchWithSignature.status === 'completed' && payoutResult) {
        winnerAmount = matchWithSignature.payoutAmount || payoutResult.winnerAmount || 0;
        winnerAmountUSD = matchWithSignature.payoutAmountUSD || 0;
        platformFee = matchWithSignature.platformFee || payoutResult.feeAmount || 0;
        winner = payoutResult.winner || matchWithSignature.winner || '';
      } else if (matchWithSignature.status === 'cancelled') {
        // For cancelled matches, show refund amounts
        winnerAmount = 0; // No winner
        winnerAmountUSD = 0;
        platformFee = 0; // No platform fee for cancelled matches
        winner = 'cancelled';
      }

      // Fee wallet payout transaction is same as executed transaction for completed matches
      // proposalTransactionId should be the execution transaction signature, not the proposal ID
      // Solana transaction signatures are base58 encoded, typically 88 characters, but we check for > 40 to be safe
      const feeWalletPayoutTx = (matchWithSignature.proposalStatus === 'EXECUTED' && matchWithSignature.proposalTransactionId && matchWithSignature.proposalTransactionId.length > 40 && !/^\d+$/.test(matchWithSignature.proposalTransactionId)) 
        ? matchWithSignature.proposalTransactionId 
        : '';
      
      // Winner payout signature should be the same as execution transaction
      // Only use if it's an actual signature (length > 40 and not just digits), not a proposal ID
      const winnerPayoutTx = (matchWithSignature.winnerPayoutSignature && matchWithSignature.winnerPayoutSignature.length > 40 && !/^\d+$/.test(matchWithSignature.winnerPayoutSignature)) 
        ? matchWithSignature.winnerPayoutSignature 
        : (matchWithSignature.proposalTransactionId && matchWithSignature.proposalTransactionId.length > 40 && !/^\d+$/.test(matchWithSignature.proposalTransactionId)) 
          ? matchWithSignature.proposalTransactionId 
          : '';
      
      return [
        // Core Match Info
        sanitizeCsvValue(matchWithSignature.id),
        sanitizeCsvValue(matchWithSignature.player1),
        sanitizeCsvValue(matchWithSignature.player2),
        sanitizeCsvValue(matchWithSignature.entryFee),
        // Entry Fee (USD) removed per user request
        sanitizeCsvValue(totalPot),
        sanitizeCsvValue(matchWithSignature.status),
        sanitizeCsvValue(winner),
        sanitizeCsvValue(winnerAmount),
        sanitizeCsvValue(winnerAmountUSD),
        // Platform Fee (SOL) removed per user request
        sanitizeCsvValue(feeWalletAddress),
        sanitizeCsvValue(matchWithSignature.status === 'completed' ? 'Yes' : 'No'),
        
        // Bonus Tracking
        sanitizeCsvValue(matchWithSignature.bonusPaid ? 'Yes' : 'No'),
        sanitizeCsvValue(matchWithSignature.bonusTier || ''),
        sanitizeCsvValue(matchWithSignature.bonusPercent ?? ''),
        sanitizeCsvValue(matchWithSignature.bonusAmount ?? ''),
        sanitizeCsvValue(matchWithSignature.bonusAmountUSD ?? ''),
        sanitizeCsvValue(matchWithSignature.bonusSignature || ''),
        sanitizeCsvValue(matchWithSignature.bonusPaidAt ? convertToEST(matchWithSignature.bonusPaidAt) : ''),
        
        // Vault & Deposits
        sanitizeCsvValue(matchWithSignature.squadsVaultAddress),
        sanitizeCsvValue(matchWithSignature.depositATx),
        sanitizeCsvValue(matchWithSignature.depositBTx),
        
        // Game Results
        sanitizeCsvValue((player1Result && player1Result.won) ? 'Yes' : (player1Result ? 'No' : 'N/A')),
        sanitizeCsvValue(player1Result && player1Result.numGuesses ? player1Result.numGuesses : ''),
        sanitizeCsvValue(player1Result && player1Result.totalTime ? Math.round(player1Result.totalTime / 1000) : ''),
        sanitizeCsvValue(player1Result && player1Result.reason ? player1Result.reason : ''),
        sanitizeCsvValue((player2Result && player2Result.won) ? 'Yes' : (player2Result ? 'No' : 'N/A')),
        sanitizeCsvValue(player2Result && player2Result.numGuesses ? player2Result.numGuesses : ''),
        sanitizeCsvValue(player2Result && player2Result.totalTime ? Math.round(player2Result.totalTime / 1000) : ''),
        sanitizeCsvValue(player2Result && player2Result.reason ? player2Result.reason : ''),
        
        // Timestamps
        convertToEST(matchWithSignature.createdAt),
        convertToEST(matchWithSignature.gameStartTimeUtc),
        // Game Ended (EST), Executed Transaction Hash, Payout Proposal ID, Tie Refund Proposal ID, Proposal Status removed per user request (columns Z-AD)
        
        // Proposal Info
        sanitizeCsvValue(matchWithSignature.proposalCreatedAt ? convertToEST(matchWithSignature.proposalCreatedAt) : ''),
        sanitizeCsvValue(matchWithSignature.proposalExecutedAt ? convertToEST(matchWithSignature.proposalExecutedAt) : ''),
        // Needs Signatures removed per user request (column AL)
        
        // Explorer Links
        matchWithSignature.squadsVaultAddress ? `https://explorer.solana.com/address/${matchWithSignature.squadsVaultAddress}?cluster=${network}` : '',
        matchWithSignature.depositATx ? `https://explorer.solana.com/tx/${matchWithSignature.depositATx}?cluster=${network}` : '',
        matchWithSignature.depositBTx ? `https://explorer.solana.com/tx/${matchWithSignature.depositBTx}?cluster=${network}` : '',
        (matchWithSignature.proposalTransactionId && matchWithSignature.proposalTransactionId.length > 40 && !/^\d+$/.test(matchWithSignature.proposalTransactionId)) ? `https://explorer.solana.com/tx/${matchWithSignature.proposalTransactionId}?cluster=${network}` : ''
      ];
    }));
    
    // Combine headers and rows
    const csvContent = [csvHeaders, ...csvRows]
      .map((row: any) => row.map((field: any) => `"${field || ''}"`).join(','))
      .join('\n');
    
    // Generate file hash for integrity
    const crypto = require('crypto');
    const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');
    
    // Set response headers for CSV download
    const filename = `Guess5.io_historical_data.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-File-Hash', fileHash);
    
    console.log(`✅ Secure report generated: ${filename} with ${matches.length} finished matches (completed games or cancelled games with refunds)`);
    console.log(`🔐 File integrity hash: ${fileHash}`);
    
    res.send(csvContent);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error generating secure report:', errorMessage);
    console.error('❌ Error stack:', errorStack);
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      errorName: error instanceof Error ? error.name : undefined,
      startDate: req.query?.startDate,
      endDate: req.query?.endDate,
    });
    
    // If the error is about missing columns, try a fallback query with only core columns
    if (errorMessage.includes('column') && (errorMessage.includes('does not exist') || errorMessage.includes('not found'))) {
      console.log('🔄 Attempting fallback query with core columns only...');
      try {
        const { AppDataSource } = require('../db/index');
        const matchRepository = AppDataSource.getRepository(Match);
        
        let dateFilter = `DATE("createdAt") >= '${req.query.startDate || '2025-08-16'}'`;
        if (req.query.endDate) {
          dateFilter += ` AND DATE("createdAt") <= '${req.query.endDate}'`;
        }
        
        // Fallback query with only columns that should definitely exist
        const fallbackMatches = await matchRepository.query(`
          SELECT 
            id,
            "player1",
            "player2",
            "entryFee",
            status,
            "squadsVaultAddress",
            "depositATx",
            "depositBTx",
            "player1Paid",
            "player2Paid",
            "player1Result",
            "player2Result",
            winner,
            "payoutResult",
            "proposalTransactionId",
            "matchOutcome",
            "totalFeesCollected",
            "platformFee",
            "matchDuration",
            "refundReason",
            "refundedAt",
            "refundedAtUtc",
            "isCompleted",
            "createdAt",
            "updatedAt",
            "payoutProposalId",
            "proposalStatus",
            "proposalCreatedAt",
            "proposalExecutedAt",
            "needsSignatures",
            "proposalSigners",
            "gameStartTimeUtc",
            "gameEndTimeUtc"
          FROM "match" 
          WHERE ${dateFilter}
            AND "squadsVaultAddress" IS NOT NULL
            AND "player1Paid" = true
            AND "player2Paid" = true
            AND (
              -- Executed payouts (winners or ties with refunds)
              (status = 'completed' AND "isCompleted" = true AND "proposalStatus" = 'EXECUTED' AND "proposalTransactionId" IS NOT NULL)
              OR
              -- Cancelled matches with refunds
              (status = 'cancelled' AND ("proposalTransactionId" IS NOT NULL))
              OR
              -- Any match with executed transaction
              ("proposalStatus" = 'EXECUTED' AND "proposalTransactionId" IS NOT NULL)
            )
          ORDER BY "createdAt" DESC
        `);
        
        // Get fee wallet address
        const { FEE_WALLET_ADDRESS } = require('../config/wallet');
        const feeWalletAddress = FEE_WALLET_ADDRESS;
        
        // Generate CSV with fallback data (missing new columns will be empty)
        const network = process.env.SOLANA_NETWORK?.includes('devnet') ? 'devnet' : 'mainnet-beta';
        const csvHeaders = [
          // Core Match Info
          'Match ID', 'Player 1 Wallet', 'Player 2 Wallet', 'Entry Fee (SOL)', 'Total Pot (SOL)',
          'Match Status', 'Winner', 'Winner Amount (SOL)', 'Fee Wallet Address', 'Game Completed',
          // Vault & Deposits
          'Squads Vault Address', 'Player 1 Deposit TX', 'Player 2 Deposit TX',
          // Game Results
          'Player 1 Solved', 'Player 1 Guesses', 'Player 1 Time (sec)', 'Player 1 Result Reason',
          'Player 2 Solved', 'Player 2 Guesses', 'Player 2 Time (sec)', 'Player 2 Result Reason',
          // Timestamps
          'Match Created (EST)', 'Game Started (EST)',
          // Proposal Info
          'Proposal Created At',
          // Explorer Links
          'Squads Vault Link', 'Player 1 Deposit Link', 'Player 2 Deposit Link',
          'Executed Transaction Link'
        ];
        
        const sanitizeCsvValue = (value: any) => {
          if (!value) return '';
          const str = String(value);
          if (/^[=\-+@]/.test(str)) return `'${str}`;
          return str;
        };
        
        const convertToEST = (timestamp: any) => {
          if (!timestamp) return '';
          try {
            const date = new Date(timestamp);
            return date.toLocaleString('en-US', { timeZone: 'America/New_York' });
          } catch {
            return '';
          }
        };
        
        // Helper function to calculate Entry Fee USD from SOL amount
        // Since entry fees are standardized (5, 20, 50, 100 USD), we can use a lookup
        const calculateEntryFeeUSD = (entryFeeSOL: number): number => {
          // Approximate SOL amounts for standard fees (at ~$158 SOL price)
          // Allow for some variance due to price fluctuations
          const feeLookup: { [key: number]: number } = {
            0.0316: 5,   // ~$5 at $158 SOL
            0.1266: 20,  // ~$20 at $158 SOL
            0.3165: 50,  // ~$50 at $158 SOL
            0.6320: 100  // ~$100 at $158 SOL
          };
          
          // Try exact match first
          if (feeLookup[entryFeeSOL]) {
            return feeLookup[entryFeeSOL];
          }
          
          // Try approximate match (within 5% variance)
          for (const [solAmount, usdAmount] of Object.entries(feeLookup)) {
            const sol = parseFloat(solAmount);
            if (Math.abs(entryFeeSOL - sol) / sol < 0.05) {
              return usdAmount;
            }
          }
          
          // If no match, return empty (will be blank in CSV)
          return 0;
        };
        
        const csvRows = fallbackMatches.map((match: any) => {
          const player1Result = match.player1Result ? JSON.parse(match.player1Result) : null;
          const player2Result = match.player2Result ? JSON.parse(match.player2Result) : null;
          const payoutResult = match.payoutResult ? JSON.parse(match.payoutResult) : null;
          const totalPot = match.entryFee * 2;
          const winnerAmount = match.platformFee ? totalPot - match.platformFee : (payoutResult?.winnerAmount || 0);
          const platformFee = match.platformFee || (payoutResult?.feeAmount || 0);
          const winner = payoutResult?.winner || match.winner || '';
          const entryFeeUSD = calculateEntryFeeUSD(match.entryFee);
          
          return [
            // Core Match Info
        sanitizeCsvValue(match.id),
        sanitizeCsvValue(match.player1),
        sanitizeCsvValue(match.player2),
        sanitizeCsvValue(match.entryFee),
            // Entry Fee (USD) removed per user request
        sanitizeCsvValue(totalPot),
        sanitizeCsvValue(match.status),
        sanitizeCsvValue(winner),
        sanitizeCsvValue(winnerAmount),
            // Platform Fee (SOL) removed per user request
            sanitizeCsvValue(feeWalletAddress),
        sanitizeCsvValue(match.status === 'completed' ? 'Yes' : 'No'),
            // Vault & Deposits
        sanitizeCsvValue(match.squadsVaultAddress),
        sanitizeCsvValue(match.depositATx),
        sanitizeCsvValue(match.depositBTx),
            // Game Results
        sanitizeCsvValue((player1Result && player1Result.won) ? 'Yes' : (player1Result ? 'No' : 'N/A')),
            sanitizeCsvValue(player1Result?.numGuesses || ''),
            sanitizeCsvValue(player1Result?.totalTime ? Math.round(player1Result.totalTime / 1000) : ''),
            sanitizeCsvValue(player1Result?.reason || ''),
        sanitizeCsvValue((player2Result && player2Result.won) ? 'Yes' : (player2Result ? 'No' : 'N/A')),
            sanitizeCsvValue(player2Result?.numGuesses || ''),
            sanitizeCsvValue(player2Result?.totalTime ? Math.round(player2Result.totalTime / 1000) : ''),
            sanitizeCsvValue(player2Result?.reason || ''),
            // Timestamps
        convertToEST(match.createdAt),
        convertToEST(match.gameStartTimeUtc),
            // Game Ended (EST), Executed Transaction Hash, Proposal ID, Proposal Status, Needs Signatures removed per user request
            // Proposal Info
        sanitizeCsvValue(match.proposalCreatedAt ? convertToEST(match.proposalCreatedAt) : ''),
            // Explorer Links
        match.squadsVaultAddress ? `https://explorer.solana.com/address/${match.squadsVaultAddress}?cluster=${network}` : '',
        match.depositATx ? `https://explorer.solana.com/tx/${match.depositATx}?cluster=${network}` : '',
        match.depositBTx ? `https://explorer.solana.com/tx/${match.depositBTx}?cluster=${network}` : '',
            match.proposalTransactionId ? `https://explorer.solana.com/tx/${match.proposalTransactionId}?cluster=${network}` : ''
      ];
    });
    
    const csvContent = [csvHeaders, ...csvRows]
      .map((row: any) => row.map((field: any) => `"${field || ''}"`).join(','))
      .join('\n');
    
    const crypto = require('crypto');
    const fileHash = crypto.createHash('sha256').update(csvContent).digest('hex');
        const filename = `Guess5.io_historical_data.csv`;
    
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-File-Hash', fileHash);
    
        console.log(`✅ Fallback report generated: ${filename} with ${fallbackMatches.length} matches`);
    res.send(csvContent);
        return;
      } catch (fallbackError: unknown) {
        console.error('❌ Fallback query also failed:', fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      }
    }
    
    res.status(500).json({ 
      error: 'Failed to generate secure report',
      details: process.env.NODE_ENV === 'development' ? errorMessage : undefined
    });
  }
};

// Blockchain verification endpoint
const verifyBlockchainDataHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;
    
    console.log(`🔍 Verifying blockchain data for match ${matchId}...`);
    
    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    // Update match with blockchain data
    const updatedMatch = await updateMatchWithBlockchainData(match);
    
    if (updatedMatch) {
      res.json({
        success: true,
        message: 'Match verified with blockchain data',
        match: {
          id: updatedMatch.id,
          totalFeesCollected: updatedMatch.totalFeesCollected,
          totalFeesCollectedUSD: updatedMatch.totalFeesCollectedUSD,
          platformFee: updatedMatch.platformFee,
          platformFeeUSD: updatedMatch.platformFeeUSD,
          networkFees: updatedMatch.networkFees,
          taxableIncome: updatedMatch.taxableIncome,
          solPriceAtTransaction: updatedMatch.solPriceAtTransaction
        }
      });
    } else {
      res.status(500).json({ error: 'Failed to verify blockchain data' });
    }
    
  } catch (error: unknown) {
    console.error('❌ Error verifying blockchain data:', error);
    res.status(500).json({ error: 'Failed to verify blockchain data' });
  }
};

// Track active SSE connections (count and response objects)
const activeSSEConnections = new Map<string, { count: number; lastActivity: number }>();
const activeSSEResponses = new Map<string, Set<any>>(); // Store actual response objects per wallet

// Cleanup stale connections every 5 minutes
setInterval(() => {
  const now = Date.now();
  const staleThreshold = 5 * 60 * 1000; // 5 minutes
  
  for (const [wallet, connection] of activeSSEConnections.entries()) {
    if (now - connection.lastActivity > staleThreshold) {
      console.log('🧹 Cleaning up stale SSE connection for wallet:', wallet);
      activeSSEConnections.delete(wallet);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Server-Sent Events endpoint for real-time wallet balance updates
const walletBalanceSSEHandler = async (req: any, res: any) => {
  try {
    const { wallet } = req.params;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Wallet address required' });
    }

    // Ensure database is initialized
    if (!AppDataSource || !AppDataSource.isInitialized) {
      console.error('❌ AppDataSource not initialized in walletBalanceSSEHandler');
      return res.status(500).json({ error: 'Database not initialized' });
    }
    
    // Check connection limits (max 5 connections per wallet - increased from 3)
    const walletConnections = activeSSEConnections.get(wallet) || { count: 0, lastActivity: Date.now() };
    if (walletConnections.count >= 5) {
      console.log('⚠️ Too many SSE connections for wallet:', wallet, 'count:', walletConnections.count);
      return res.status(429).json({ error: 'Too many connections for this wallet' });
    }
    
    // Store response object for this connection FIRST (before incrementing count)
    if (!activeSSEResponses.has(wallet)) {
      activeSSEResponses.set(wallet, new Set());
    }
    activeSSEResponses.get(wallet)!.add(res);
    
    // Update connection count AFTER storing response (so cleanup can happen)
    activeSSEConnections.set(wallet, { 
      count: walletConnections.count + 1, 
      lastActivity: Date.now() 
    });
    
    console.log('🔌 SSE connection requested for wallet:', wallet, 'active connections:', walletConnections.count + 1);
    
    // Determine allowed origin for CORS
    const requestOrigin = req.headers.origin;
    const corsOrigin = resolveCorsOrigin(requestOrigin);

    // Set SSE headers with proper CORS and connection keep-alive
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'Keep-Alive': 'timeout=300, max=1000', // Increased timeout to 5 minutes
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Headers': 'Cache-Control, Content-Type',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Credentials': 'true',
      'Vary': 'Origin',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY'
    });
    
    // Send initial connection message
    const connectionMessage = {
      type: 'connected',
      wallet: wallet,
      timestamp: new Date().toISOString()
    };
    
    res.write(`data: ${JSON.stringify(connectionMessage)}\n\n`);
    
    // Get initial balance
    const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com');
    const publicKey = new PublicKey(wallet);
    
    try {
      const balance = await connection.getBalance(publicKey);
      const balanceInSOL = balance / LAMPORTS_PER_SOL;
      
      const balanceMessage = {
        type: 'balance_update',
        wallet: wallet,
        balance: balanceInSOL,
        timestamp: new Date().toISOString()
      };
      
      res.write(`data: ${JSON.stringify(balanceMessage)}\n\n`);
    } catch (error: unknown) {
      console.error('❌ Error fetching initial balance:', error);
      const errorMessage = {
        type: 'error',
        wallet: wallet,
        message: 'Failed to fetch initial balance',
        timestamp: new Date().toISOString()
      };
      res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
    }
    
    // Set up periodic balance checks (every 30 seconds) and heartbeat (every 10 seconds)
    const balanceInterval = setInterval(async () => {
      try {
        const balance = await connection.getBalance(publicKey);
        const balanceInSOL = balance / LAMPORTS_PER_SOL;
        
        const balanceMessage = {
          type: 'balance_update',
          wallet: wallet,
          balance: balanceInSOL,
          timestamp: new Date().toISOString()
        };
        
        res.write(`data: ${JSON.stringify(balanceMessage)}\n\n`);
      } catch (error: unknown) {
        console.error('❌ Error fetching balance update:', error);
        const errorMessage = {
          type: 'error',
          wallet: wallet,
          message: 'Failed to fetch balance update',
          timestamp: new Date().toISOString()
        };
        res.write(`data: ${JSON.stringify(errorMessage)}\n\n`);
      }
    }, 30000); // Check every 30 seconds (reduced frequency)
    
    // Heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
      try {
        const heartbeatMessage = {
          type: 'heartbeat',
          wallet: wallet,
          timestamp: new Date().toISOString()
        };
        res.write(`data: ${JSON.stringify(heartbeatMessage)}\n\n`);
      } catch (error: unknown) {
        console.error('❌ Error sending heartbeat:', error);
        // If we can't send heartbeat, connection is likely dead
        clearInterval(balanceInterval);
        clearInterval(heartbeatInterval);
      }
    }, 10000); // Heartbeat every 10 seconds (more frequent)
    
    // Handle client disconnect
    req.on('close', () => {
      console.log('🔌 SSE connection closed for wallet:', wallet);
      clearInterval(balanceInterval);
      clearInterval(heartbeatInterval);
      
      // Remove response object
      const responses = activeSSEResponses.get(wallet);
      if (responses) {
        responses.delete(res);
        if (responses.size === 0) {
          activeSSEResponses.delete(wallet);
        }
      }
      
      // Decrement connection count
      const walletConnections = activeSSEConnections.get(wallet);
      if (walletConnections) {
        walletConnections.count = Math.max(0, walletConnections.count - 1);
        if (walletConnections.count === 0) {
          activeSSEConnections.delete(wallet);
        } else {
          activeSSEConnections.set(wallet, walletConnections);
        }
      }
    });
    
    // Handle server shutdown
    req.on('error', (error: any) => {
      console.error('❌ SSE connection error:', error);
      clearInterval(balanceInterval);
      clearInterval(heartbeatInterval);
      
      // Remove response object
      const responses = activeSSEResponses.get(wallet);
      if (responses) {
        responses.delete(res);
        if (responses.size === 0) {
          activeSSEResponses.delete(wallet);
        }
      }
      
      // Decrement connection count
      const walletConnections = activeSSEConnections.get(wallet);
      if (walletConnections) {
        walletConnections.count = Math.max(0, walletConnections.count - 1);
        if (walletConnections.count === 0) {
          activeSSEConnections.delete(wallet);
        } else {
          activeSSEConnections.set(wallet, walletConnections);
        }
      }
    });
    
    // Handle connection timeout
    req.setTimeout(300000, () => { // 5 minutes timeout
      console.log('⏰ SSE connection timeout for wallet:', wallet);
      clearInterval(balanceInterval);
      clearInterval(heartbeatInterval);
      if (!res.headersSent) {
        res.status(408).end();
      }
    });
    
  } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;
    console.error('❌ Error in wallet balance SSE handler:', error);
    
    // Clean up connection on error
    const wallet = req.params.wallet;
    if (wallet) {
      // Remove response object
      const responses = activeSSEResponses.get(wallet);
      if (responses) {
        responses.delete(res);
        if (responses.size === 0) {
          activeSSEResponses.delete(wallet);
        }
      }
      
      // Decrement connection count
      const walletConnections = activeSSEConnections.get(wallet);
      if (walletConnections) {
        walletConnections.count = Math.max(0, walletConnections.count - 1);
        if (walletConnections.count === 0) {
          activeSSEConnections.delete(wallet);
        } else {
          activeSSEConnections.set(wallet, walletConnections);
        }
      }
    }
    
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Internal server error',
        details: errorMessage,
        wallet: req.params.wallet 
      });
    } else {
      const errorMessageObj = {
        type: 'error',
        wallet: req.params.wallet || 'unknown',
        message: 'Internal server error',
        timestamp: new Date().toISOString()
      };
      try {
        res.write(`data: ${JSON.stringify(errorMessageObj)}\n\n`);
      } catch (writeError) {
        // Connection already closed, ignore
      }
    }
  }
};

// Multisig vault integration handlers

/**
 * Handle player deposit to multisig vault
 */
const depositToMultisigVaultHandler = async (req: any, res: any) => {
  try {
    const { matchId, playerWallet, amount, depositTxSignature } = req.body;

    if (!matchId || !playerWallet || !amount) {
      return res.status(400).json({ 
        error: 'Missing required fields: matchId, playerWallet, and amount' 
      });
    }

    console.log('💰 Processing multisig vault deposit request:', { matchId, playerWallet, amount, depositTxSignature });

    // Verify deposit on Solana using Squads service
    const result = await squadsVaultService.verifyDeposit(matchId, playerWallet, amount, depositTxSignature);

    if (result.success) {
      console.log('✅ Multisig vault deposit verified successfully:', {
        matchId,
        playerWallet,
        transactionId: result.transactionId
      });

      // Update payment status using TypeORM entities for consistency
      const { AppDataSource } = require('../db/index');
      const matchRepository = AppDataSource.getRepository(Match);
      const matchEntity = await matchRepository.findOne({ where: { id: matchId } });

      if (!matchEntity) {
        return res.status(404).json({
          success: false,
          error: 'Match not found'
        });
      }

      const isPlayer1 = playerWallet === matchEntity.player1;
      if (!isPlayer1 && playerWallet !== matchEntity.player2) {
        return res.status(403).json({ success: false, error: 'Player not part of this match' });
      }

      if (isPlayer1) {
        matchEntity.player1Paid = true;
        matchEntity.player1PaymentSignature = depositTxSignature || matchEntity.player1PaymentSignature;
        matchEntity.player1PaymentTime = new Date();
      } else {
        matchEntity.player2Paid = true;
        matchEntity.player2PaymentSignature = depositTxSignature || matchEntity.player2PaymentSignature;
        matchEntity.player2PaymentTime = new Date();
      }

      if (!matchEntity.matchStatus || matchEntity.matchStatus === 'PENDING') {
        matchEntity.matchStatus = 'PAYMENT_REQUIRED';
      }

      await matchRepository.save(matchEntity);
      console.log(`✅ Marked ${isPlayer1 ? 'Player 1' : 'Player 2'} (${playerWallet}) as paid for match ${matchId}`);

      let activated = false;
      try {
        const activationResult = await activateMatchIfReady(matchRepository, matchEntity, playerWallet);
        activated = activationResult.activated;
      } catch (activationError: any) {
        console.error('❌ Error activating game after deposit:', activationError?.message || activationError);
      }

      const refreshedMatch = await matchRepository.findOne({ where: { id: matchId } });
      const responseMatch = refreshedMatch || matchEntity;
      const bothPaid = !!(responseMatch?.player1Paid && responseMatch?.player2Paid);

      console.log(`🔍 Payment status for match ${matchId}:`, {
        player1Paid: responseMatch?.player1Paid,
        player2Paid: responseMatch?.player2Paid,
        status: responseMatch?.status,
        bothPaid,
        activated
      });

      websocketService.broadcastToMatch(matchId, {
        type: WebSocketEventType.PAYMENT_RECEIVED,
        matchId,
        data: {
          player: isPlayer1 ? 'player1' : 'player2',
          wallet: playerWallet,
          amount,
          player1Paid: responseMatch?.player1Paid,
          player2Paid: responseMatch?.player2Paid,
          status: responseMatch?.status
        },
        timestamp: new Date().toISOString()
      });

      res.json({
        success: true,
        message: activated ? 'Game started!' : 'Deposit verified successfully',
        transactionId: result.transactionId,
        matchId,
        playerWallet,
        player1Paid: responseMatch?.player1Paid ?? false,
        player2Paid: responseMatch?.player2Paid ?? false,
        status: responseMatch?.status ?? matchEntity.status,
        bothPaid
      });
    } else {
      console.error('❌ Multisig vault deposit failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in depositToMultisigVaultHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Handle match settlement on smart contract
 */
const settleMatchHandler = async (req: any, res: any) => {
  try {
    const { matchId, result } = req.body;

    if (!matchId || !result) {
      return res.status(400).json({ 
        error: 'Missing required fields: matchId and result' 
      });
    }

    // Validate result type
    const validResults = ['Player1', 'Player2', 'WinnerTie', 'LosingTie', 'Timeout', 'Error'];
    if (!validResults.includes(result)) {
      return res.status(400).json({ 
        error: `Invalid result type: ${result}. Must be one of: ${validResults.join(', ')}` 
      });
    }

    console.log('🏁 Processing smart contract settlement:', { matchId, result });

    // Get smart contract service
    const { getSmartContractService } = require('../services/smartContractService');
    const smartContractService = getSmartContractService();

    // Settle match
    const settlementResult = await smartContractService.settleMatch(matchId, result);

    if (settlementResult.success) {
      console.log('✅ Smart contract settlement processed successfully:', {
        matchId,
        result,
        transactionId: settlementResult.transactionId
      });

      // Update database match status
      try {
        const { AppDataSource } = require('../db/index');
        const { Match } = require('../models/Match');
        const matchRepository = AppDataSource.getRepository(Match);
        
        const match = await matchRepository.findOne({ where: { id: matchId } });
        if (match) {
          match.status = 'completed';
          match.smartContractStatus = 'Settled';
          match.winner = result === 'Player1' ? match.player1 : 
                        result === 'Player2' ? match.player2 : 'tie';
          match.isCompleted = true;
          match.matchOutcome = result;
          
          await matchRepository.save(match);
          console.log('✅ Database match status updated');
        }
      } catch (dbError) {
        console.error('⚠️ Failed to update database match status:', dbError);
        // Don't fail the request if database update fails
      }

      res.json({
        success: true,
        message: 'Match settled successfully on smart contract',
        transactionId: settlementResult.transactionId,
        matchId,
        result
      });
    } else {
      console.error('❌ Smart contract settlement failed:', settlementResult.error);
      res.status(500).json({
        success: false,
        error: settlementResult.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in settleMatchHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Get smart contract status for a match
 */
const getSmartContractStatusHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: matchId' 
      });
    }

    console.log('🔍 Getting smart contract status for match:', matchId);

    // Get smart contract service
    const { getSmartContractService } = require('../services/smartContractService');
    const smartContractService = getSmartContractService();

    // Get match status
    const statusResult = await smartContractService.getMatchStatus(new PublicKey(matchId));

    if (statusResult.success) {
      console.log('✅ Smart contract status retrieved:', {
        matchId,
        onChainStatus: statusResult.onChainStatus,
        vaultBalance: statusResult.vaultBalance
      });

      res.json({
        success: true,
        matchId,
        onChainStatus: statusResult.onChainStatus,
        vaultBalance: statusResult.vaultBalance,
        player1Deposited: statusResult.player1Deposited,
        player2Deposited: statusResult.player2Deposited
      });
    } else {
      console.error('❌ Failed to get smart contract status:', statusResult.error);
      res.status(500).json({
        success: false,
        error: statusResult.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in getSmartContractStatusHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};
/**
 * Verify a deposit transaction on the smart contract
 */
const verifyDepositHandler = async (req: any, res: any) => {
  try {
    const { matchId, playerWallet, transactionSignature } = req.body;

    if (!matchId || !playerWallet || !transactionSignature) {
      return res.status(400).json({ 
        error: 'Missing required fields: matchId, playerWallet, and transactionSignature' 
      });
    }

    console.log('🔍 Verifying deposit transaction:', { matchId, playerWallet, transactionSignature });

    // Get deposit service
    const { getSmartContractDepositService } = require('../services/smartContractDepositService');
    const depositService = getSmartContractDepositService();

    // Verify deposit
    const result = await depositService.verifyDeposit(matchId, playerWallet, transactionSignature);

    if (result.success) {
      console.log('✅ Deposit verification successful:', {
        matchId,
        playerWallet,
        deposited: result.deposited,
        transactionSignature: result.transactionSignature
      });

      res.json({
        success: true,
        deposited: result.deposited,
        transactionSignature: result.transactionSignature,
        matchId,
        playerWallet
      });
    } else {
      console.error('❌ Deposit verification failed:', result.error);
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in verifyDepositHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

/**
 * Get deposit status for a match
 */
const getDepositStatusHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ 
        error: 'Missing required parameter: matchId' 
      });
    }

    console.log('🔍 Getting deposit status for match:', matchId);

    // Get deposit service
    const { getSmartContractDepositService } = require('../services/smartContractDepositService');
    const depositService = getSmartContractDepositService();

    // Get deposit status
    const result = await depositService.getDepositStatus(matchId);

    if (result.success) {
      console.log('✅ Deposit status retrieved:', {
        matchId,
        player1Deposited: result.player1Deposited,
        player2Deposited: result.player2Deposited,
        vaultBalance: result.vaultBalance
      });

      res.json({
        success: true,
        matchId,
        player1Deposited: result.player1Deposited,
        player2Deposited: result.player2Deposited,
        vaultBalance: result.vaultBalance
      });
    } else {
      console.error('❌ Failed to get deposit status:', result.error);
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error in getDepositStatusHandler:', error);
    res.status(500).json({ 
      success: false,
      error: errorMessage 
    });
  }
};

// Admin endpoint to void/reset a problematic match
const voidMatchHandler = async (req: any, res: any) => {
  try {
    const { matchId } = req.params;
    
    if (!matchId) {
      return res.status(400).json({ error: 'Match ID required' });
    }

    console.log('🗑️ Voiding match:', matchId);

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Delete the match
    await matchRepository.remove(match);

    // Also clear Redis game state if it exists
    try {
      const { deleteGameState } = require('../utils/redisGameState');
      await deleteGameState(matchId);
    } catch (redisError) {
      console.warn('⚠️ Could not delete Redis game state:', redisError);
    }

    console.log('✅ Match voided successfully:', matchId);

    res.json({
      success: true,
      message: 'Match voided successfully',
      matchId
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error voiding match:', error);
    res.status(500).json({ error: 'Failed to void match', details: errorMessage });
  }
};

// Get approval transaction to sign (for frontend)
const getProposalApprovalTransactionHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet } = req.query;
    const { getFeeWalletAddress, FEE_WALLET_ADDRESS: CONFIG_FEE_WALLET } = require('../config/wallet');
    
    if (!matchId || !wallet) {
      return res.status(400).json({ error: 'Missing required fields: matchId, wallet' });
    }

    const { AppDataSource } = require('../db/index');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Use raw SQL to avoid issues with missing columns like proposalExpiresAt
    const matchRows = await matchRepository.query(`
      SELECT 
        id, "player1", "player2", "entryFee", status,
        "squadsVaultAddress", "payoutProposalId", "tieRefundProposalId",
        "proposalSigners", "proposalStatus", "needsSignatures"
      FROM "match"
      WHERE id = $1
      LIMIT 1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const matchRow = matchRows[0];
    const entryFeeSol = matchRow.entryFee ? Number(matchRow.entryFee) : 0;
    const entryFeeUsd = matchRow.entryFeeUSD ? Number(matchRow.entryFeeUSD) : undefined;
    const solPriceAtTransaction = matchRow.solPriceAtTransaction ? Number(matchRow.solPriceAtTransaction) : undefined;
    const bonusAlreadyPaid = matchRow.bonusPaid === true || matchRow.bonusPaid === 'true';
    const bonusSignatureExisting = matchRow.bonusSignature || null;

    // Verify player is part of this match
    const isPlayer1 = wallet === matchRow.player1;
    const isPlayer2 = wallet === matchRow.player2;
    
    if (!isPlayer1 && !isPlayer2) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }

    // Check if match has a payout proposal (either payout or tie refund)
    const hasPayoutProposal = !!matchRow.payoutProposalId;
    const hasTieRefundProposal = !!matchRow.tieRefundProposalId;
    let proposalId = matchRow.payoutProposalId || matchRow.tieRefundProposalId;
    
    if (!matchRow.squadsVaultAddress || !proposalId) {
      return res.status(400).json({ 
        error: 'No payout proposal exists for this match',
        hasPayoutProposal,
        hasTieRefundProposal,
        squadsVaultAddress: matchRow.squadsVaultAddress,
        payoutProposalId: matchRow.payoutProposalId,
        tieRefundProposalId: matchRow.tieRefundProposalId,
      });
    }
    
    // Ensure proposalId is a valid string/number that can be converted to BigInt
    if (proposalId === null || proposalId === undefined) {
      console.error('❌ proposalId is null or undefined');
      return res.status(400).json({ 
        error: 'Proposal ID is null or undefined',
        hasPayoutProposal,
        hasTieRefundProposal,
      });
    }
    
    // Convert to string and validate
    const proposalIdString = String(proposalId).trim();
    if (!proposalIdString || proposalIdString === 'null' || proposalIdString === 'undefined' || proposalIdString === '') {
      console.error('❌ Invalid proposalId value:', proposalIdString);
      return res.status(400).json({ 
        error: 'Invalid proposal ID format',
        proposalId: proposalIdString,
      });
    }
    
    // Try to parse as BigInt to validate it's a valid number
    try {
      BigInt(proposalIdString);
    } catch (bigIntError: any) {
      console.error('❌ proposalId cannot be converted to BigInt:', {
        proposalId: proposalIdString,
        error: bigIntError?.message,
      });
      return res.status(400).json({ 
        error: 'Proposal ID is not a valid number',
        proposalId: proposalIdString,
        details: bigIntError?.message,
      });
    }

    // Verify player hasn't already signed
    const signers = normalizeProposalSigners(matchRow.proposalSigners);
    const feeWalletAddress =
      typeof getFeeWalletAddress === 'function' ? getFeeWalletAddress() : CONFIG_FEE_WALLET;
    
    console.log('🔐 Current proposal signer snapshot (pre-processing)', {
      matchId,
      wallet,
      proposalId: proposalIdString,
      proposalStatus: matchRow.proposalStatus,
      needsSignatures: normalizeRequiredSignatures(matchRow.needsSignatures),
      existingSigners: signers,
    });

    if (signers.includes(wallet)) {
      return res.status(400).json({ error: 'You have already signed this proposal' });
    }

    // Build the approval transaction using Squads SDK (backend has access to rpc)
    const { Connection, PublicKey, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // CRITICAL: Use the same program ID that was used to create the multisig
    // Get it from the Squads service to ensure consistency
    const sqdsModule = require('@sqds/multisig');
    const { PROGRAM_ID } = sqdsModule;
    let programId;
    try {
      if (process.env.SQUADS_PROGRAM_ID) {
        try {
          programId = new PublicKey(process.env.SQUADS_PROGRAM_ID);
          console.log('✅ Using SQUADS_PROGRAM_ID from environment:', programId.toString());
        } catch (pkError: any) {
          console.warn('⚠️ Invalid SQUADS_PROGRAM_ID, using SDK default', pkError?.message);
          programId = PROGRAM_ID;
        }
      } else {
        programId = PROGRAM_ID;
        console.log('✅ Using SDK default PROGRAM_ID:', programId.toString());
      }
    } catch (progIdError: any) {
      console.error('❌ Failed to get program ID:', progIdError?.message);
      throw new Error(`Failed to get program ID: ${progIdError?.message || String(progIdError)}`);
    }

    console.log('🔍 Building approval transaction:', {
      matchId,
      wallet,
      squadsVaultAddress: matchRow.squadsVaultAddress,
      payoutProposalId: matchRow.payoutProposalId,
      tieRefundProposalId: matchRow.tieRefundProposalId,
      proposalId: proposalId,
      programId: programId.toString(),
    });

    let multisigAddress;
    let transactionIndex;
    let memberPublicKey;
    
    try {
      multisigAddress = new PublicKey(matchRow.squadsVaultAddress);
      // Use the validated proposalIdString
      transactionIndex = BigInt(proposalIdString);
      memberPublicKey = new PublicKey(wallet);
      
      console.log('✅ Created PublicKey instances:', {
        multisigAddress: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        memberPublicKey: memberPublicKey.toString(),
        proposalIdOriginal: proposalId,
        proposalIdType: typeof proposalId,
      });
    } catch (keyError: any) {
      console.error('❌ Failed to create PublicKey instances:', {
        error: keyError?.message,
        stack: keyError?.stack,
        squadsVaultAddress: matchRow.squadsVaultAddress,
        proposalId: proposalId,
        proposalIdType: typeof proposalId,
        wallet: wallet,
      });
      throw new Error(`Invalid address format: ${keyError?.message || String(keyError)}`);
    }

    // Get recent blockhash
    let blockhash;
    let lastValidBlockHeight;
    try {
      const blockhashResult = await connection.getLatestBlockhash('confirmed');
      blockhash = blockhashResult.blockhash;
      lastValidBlockHeight = blockhashResult.lastValidBlockHeight;
    } catch (blockhashError: any) {
      console.error('❌ Failed to get blockhash:', blockhashError?.message);
      throw new Error(`Failed to get blockhash: ${blockhashError?.message || String(blockhashError)}`);
    }

    const { instructions, generated, getProposalPda } = sqdsModule;

    let approveIx;
    try {
      if (instructions && typeof instructions.proposalApprove === 'function') {
        console.log('✅ Using SDK instructions.proposalApprove');
        approveIx = instructions.proposalApprove({
          multisigPda: multisigAddress,
          transactionIndex,
          member: memberPublicKey,
          programId,
        });
        console.log('✅ Approval instruction created via SDK');
      } else {
        throw new Error('instructions.proposalApprove not available in SDK');
      }
    } catch (sdkError: any) {
      console.warn('⚠️ SDK proposalApprove failed, falling back to generated helper:', sdkError?.message);

      try {
        const sqdsGenerated = generated?.instructions;
        if (!sqdsGenerated || typeof sqdsGenerated.createProposalApproveInstruction !== 'function') {
          throw new Error('createProposalApproveInstruction missing from SDK exports');
        }

        const [proposalPda] = getProposalPda({
          multisigPda: multisigAddress,
          transactionIndex,
          programId,
        });

        approveIx = sqdsGenerated.createProposalApproveInstruction(
          {
            multisig: multisigAddress,
            proposal: proposalPda,
            member: memberPublicKey,
          },
          { args: { memo: null } },
          programId,
        );
        console.log('✅ Approval instruction created via generated helper');
      } catch (fallbackError: any) {
        console.error('❌ Failed to build approval instruction via generated helper:', {
          error: fallbackError?.message,
          stack: fallbackError?.stack,
        });
        throw new Error(`Failed to build approval instruction: ${fallbackError?.message || String(fallbackError)}`);
      }
    }
    
    let messageV0;
    try {
      messageV0 = new TransactionMessage({
      payerKey: memberPublicKey,
      recentBlockhash: blockhash,
      instructions: [approveIx],
    }).compileToV0Message();
      console.log('✅ Transaction message compiled');
    } catch (msgError: any) {
      console.error('❌ Failed to compile transaction message:', {
        error: msgError?.message,
        stack: msgError?.stack,
      });
      throw new Error(`Failed to compile transaction message: ${msgError?.message || String(msgError)}`);
    }
    
    let transaction;
    try {
      transaction = new VersionedTransaction(messageV0);
      console.log('✅ Versioned transaction created');
    } catch (txError: any) {
      console.error('❌ Failed to create versioned transaction:', {
        error: txError?.message,
        stack: txError?.stack,
      });
      throw new Error(`Failed to create versioned transaction: ${txError?.message || String(txError)}`);
    }

    // Serialize the transaction for the frontend to sign
    let serialized;
    let base64Tx;
    try {
      serialized = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });
      base64Tx = Buffer.from(serialized).toString('base64');
      console.log('✅ Transaction serialized, length:', base64Tx.length);
    } catch (serializeError: any) {
      console.error('❌ Failed to serialize transaction:', {
        error: serializeError?.message,
        stack: serializeError?.stack,
      });
      throw new Error(`Failed to serialize transaction: ${serializeError?.message || String(serializeError)}`);
    }

    res.json({
      transaction: base64Tx,
      matchId,
      proposalId: proposalId,
      vaultAddress: matchRow.squadsVaultAddress,
    });

  } catch (error: unknown) {
    console.error('❌ Error building approval transaction:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      matchId: req.query?.matchId,
      wallet: req.query?.wallet,
    });
    res.status(500).json({ error: 'Failed to build approval transaction', details: errorMessage });
  }
};
const signProposalHandler = async (req: any, res: any) => {
  try {
    const { matchId, wallet, signedTransaction } = req.body;
    
    if (!matchId || !wallet || !signedTransaction) {
      return res.status(400).json({ error: 'Missing required fields: matchId, wallet, signedTransaction' });
    }

    const { AppDataSource } = require('../db/index');
    const { getFeeWalletKeypair, getFeeWalletAddress, FEE_WALLET_ADDRESS: CONFIG_FEE_WALLET } = require('../config/wallet');
    const matchRepository = AppDataSource.getRepository(Match);
    
    // Use raw SQL to avoid issues with missing columns like proposalExpiresAt
    const matchRows = await matchRepository.query(`
      SELECT 
        id, "player1", "player2", "entryFee", status,
        "squadsVaultAddress", "payoutProposalId", "tieRefundProposalId",
        "proposalSigners", "proposalStatus", "needsSignatures",
        "proposalExecutedAt", "gameEndTime", "gameEndTimeUtc",
        "player1Result", "player2Result", "matchStatus",
        winner, "entryFeeUSD", "solPriceAtTransaction",
        "bonusPaid", "bonusSignature", "bonusAmount", "bonusAmountUSD",
        "bonusPercent", "bonusTier"
      FROM "match"
      WHERE id = $1
      LIMIT 1
    `, [matchId]);
    
    if (!matchRows || matchRows.length === 0) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    const matchRow = matchRows[0];

    // Verify player is part of this match
    const isPlayer1 = wallet === matchRow.player1;
    const isPlayer2 = wallet === matchRow.player2;
    
    if (!isPlayer1 && !isPlayer2) {
      return res.status(403).json({ error: 'You are not part of this match' });
    }

    // Check if match has a payout proposal (either payout or tie refund)
    const hasPayoutProposal = !!matchRow.payoutProposalId;
    const hasTieRefundProposal = !!matchRow.tieRefundProposalId;
    let proposalId = matchRow.payoutProposalId || matchRow.tieRefundProposalId;
    
    if (!matchRow.squadsVaultAddress || !proposalId) {
      return res.status(400).json({ 
        error: 'No payout proposal exists for this match',
        hasPayoutProposal,
        hasTieRefundProposal,
        squadsVaultAddress: matchRow.squadsVaultAddress,
      });
    }
    
    // Validate proposalId
    if (proposalId === null || proposalId === undefined) {
      return res.status(400).json({ 
        error: 'Proposal ID is null or undefined',
        hasPayoutProposal,
        hasTieRefundProposal,
      });
    }
    
    const proposalIdString = String(proposalId).trim();
    if (!proposalIdString || proposalIdString === 'null' || proposalIdString === 'undefined' || proposalIdString === '') {
      return res.status(400).json({ 
        error: 'Invalid proposal ID format',
        proposalId: proposalIdString,
      });
    }

    // Check on-chain proposal state before attempting to sign
    try {
      const { PublicKey, Connection } = require('@solana/web3.js');
      const { PROGRAM_ID, getTransactionPda } = require('@sqds/multisig');
      
      const multisigAddress = new PublicKey(matchRow.squadsVaultAddress);
      const programId = process.env.SQUADS_PROGRAM_ID 
        ? new PublicKey(process.env.SQUADS_PROGRAM_ID)
        : PROGRAM_ID;
      
      // Try to get transaction PDA to verify it exists
      let transactionPda;
      try {
        const [pda] = getTransactionPda({
          multisigPda: multisigAddress,
          index: BigInt(proposalIdString),
          programId,
        });
        transactionPda = pda;
        console.log('✅ Transaction proposal PDA derived:', transactionPda.toString());

        // Try to fetch the transaction account to verify it exists and is in a valid state
        const connection = new Connection(
          process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
          'confirmed'
        );
        const transactionAccount = await connection.getAccountInfo(transactionPda);
        if (!transactionAccount) {
          // Transaction account doesn't exist - could be executed or cancelled
          // Check database status to see if it was executed
          const proposalStatus = matchRow.proposalStatus;
          const proposalExecutedAt = matchRow.proposalExecutedAt;
          
          if (proposalStatus === 'EXECUTED' || proposalExecutedAt) {
            console.log('✅ Proposal was already executed (transaction account closed)', {
              proposalId: proposalIdString,
              proposalStatus,
              proposalExecutedAt,
            });
            
            // Ensure needsSignatures is 0 if executed
            if (matchRow.needsSignatures > 0) {
              try {
                await matchRepository.query(`
                  UPDATE "match" 
                  SET "needsSignatures" = 0 
                  WHERE id = $1
                `, [matchId]);
                console.log('✅ Updated needsSignatures to 0 for executed proposal');
              } catch (dbUpdateError: any) {
                console.warn('⚠️ Failed to update needsSignatures:', dbUpdateError?.message);
              }
            }
            
            return res.json({
              success: true,
              message: 'Proposal was already executed. Payout has been completed.',
              proposalId: proposalIdString,
              proposalStatus: 'EXECUTED',
              executed: true,
            });
          }

          // If not executed, check if this is an old match (completed status)
          // For old matches, if transaction doesn't exist, it was likely executed
          const matchStatus = matchRow.status;
          const gameEndTime = matchRow.gameEndTime;
          const gameEndTimeUtc = matchRow.gameEndTimeUtc;
          const hasGameEnded = !!(gameEndTime || gameEndTimeUtc);
          
          // Check if match is completed based on multiple criteria
          const isOldMatch = matchStatus === 'completed' || 
                           matchStatus === 'settled' || 
                           hasGameEnded ||
                           matchRow.player1Result || 
                           matchRow.player2Result;
          
          // If transaction account doesn't exist and this looks like an old match,
          // assume it was executed (transaction accounts are closed after execution)
          if (isOldMatch || hasGameEnded) {
            console.log('ℹ️ Old match - transaction account not found, likely already executed', {
              matchId,
              matchStatus,
              matchStatusField: matchRow.matchStatus,
              hasGameEnded,
              gameEndTime,
              gameEndTimeUtc,
              proposalId: proposalIdString,
              proposalStatus,
              transactionPda: transactionPda.toString(),
            });
            
            // For old matches, assume execution happened if transaction doesn't exist
            // Update database status to reflect this
            try {
              await matchRepository.query(`
                UPDATE "match" 
                SET "proposalStatus" = 'EXECUTED',
                    "needsSignatures" = 0,
                    "proposalExecutedAt" = COALESCE("proposalExecutedAt", NOW())
                WHERE id = $1
              `, [matchId]);
              console.log('✅ Updated match proposal status to EXECUTED and needsSignatures to 0');
            } catch (dbUpdateError: any) {
              console.warn('⚠️ Failed to update proposal status in database:', dbUpdateError?.message);
            }
            
            return res.json({
              success: true,
              message: 'This proposal appears to have been executed previously. Your payout should have been completed.',
              proposalId: proposalIdString,
              proposalStatus: 'EXECUTED',
              executed: true,
              note: 'Transaction account was closed after execution. Please check your wallet balance to confirm payout.',
            });
          }
          
          // For active/new matches, return error
          console.warn('⚠️ Transaction account not found, but proposal not marked as executed', {
            proposalId: proposalIdString,
            proposalStatus,
            matchStatus,
            transactionPda: transactionPda.toString(),
          });
          return res.status(400).json({ 
            error: 'Transaction proposal does not exist on-chain. It may have been executed, cancelled, or never created.',
            proposalId: proposalIdString,
            proposalStatus: proposalStatus,
            matchStatus: matchStatus,
            transactionPda: transactionPda.toString(),
            suggestion: 'If this proposal was already executed, your payout should have been completed. Please check your wallet balance.',
          });
        }
        console.log('✅ Transaction proposal exists on-chain:', transactionPda.toString());
      } catch (pdaError: any) {
        console.warn('⚠️ Could not verify transaction on-chain:', pdaError?.message);
        // Continue anyway - might be a network issue
      }
    } catch (verifyError: any) {
      console.warn('⚠️ Could not verify proposal state:', verifyError?.message);
      // Continue anyway - might be a network issue
    }

    // Verify player hasn't already signed (make idempotent)
    const signers = normalizeProposalSigners(matchRow.proposalSigners);
    const feeWalletAddress =
      typeof getFeeWalletAddress === 'function' ? getFeeWalletAddress() : CONFIG_FEE_WALLET;
    
    if (signers.includes(wallet)) {
      console.log('✅ Player already signed proposal, returning success (idempotent)', {
        matchId,
        wallet,
        proposalId: proposalIdString,
        needsSignatures: normalizeRequiredSignatures(matchRow.needsSignatures),
        proposalStatus: matchRow.proposalStatus,
      });
      // Return success to prevent frontend retry loops
      return res.json({
        success: true,
        message: 'Proposal already signed',
        proposalId: proposalIdString,
        needsSignatures: matchRow.needsSignatures,
        proposalStatus: matchRow.proposalStatus,
      });
    }

    console.log('📝 Processing signed proposal:', {
      matchId,
      wallet,
      signedTransactionLength: signedTransaction?.length,
      squadsVaultAddress: matchRow.squadsVaultAddress,
      payoutProposalId: matchRow.payoutProposalId,
      tieRefundProposalId: matchRow.tieRefundProposalId,
      proposalId: proposalIdString,
    });

    // Submit the signed transaction
    const { Connection, VersionedTransaction } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // Deserialize the signed transaction
    let transaction;
    try {
    const signedTxBuffer = Buffer.from(signedTransaction, 'base64');
      transaction = VersionedTransaction.deserialize(signedTxBuffer);
      console.log('✅ Transaction deserialized successfully');
    } catch (deserializeError: any) {
      console.error('❌ Failed to deserialize signed transaction:', {
        error: deserializeError?.message,
        stack: deserializeError?.stack,
        signedTransactionLength: signedTransaction?.length,
      });
      throw new Error(`Failed to deserialize transaction: ${deserializeError?.message || String(deserializeError)}`);
    }
    
    // Send and confirm the transaction
    let signature;
    try {
      const serializedTx = transaction.serialize();
      console.log('📤 Sending signed transaction to network...');
      
      // First try with preflight (simulation)
      try {
        signature = await connection.sendRawTransaction(serializedTx, {
      skipPreflight: false,
      maxRetries: 3,
    });
        console.log('✅ Transaction sent, signature:', signature);
      } catch (preflightError: any) {
        // If preflight fails, try to get simulation logs
        console.warn('⚠️ Preflight simulation failed, attempting to get simulation logs...');
        try {
          const simulationResult = await connection.simulateTransaction(transaction, {
            replaceRecentBlockhash: true,
            sigVerify: false,
          });
          console.error('❌ Simulation details:', {
            err: simulationResult.value.err,
            logs: simulationResult.value.logs,
            accounts: simulationResult.value.accounts,
          });
        } catch (simError: any) {
          console.warn('⚠️ Could not get simulation details:', simError?.message);
        }
        
        // For old transactions, try skipping preflight (blockhash might be stale)
        console.log('🔄 Retrying with skipPreflight=true (blockhash may be stale)...');
        signature = await connection.sendRawTransaction(serializedTx, {
          skipPreflight: true,
          maxRetries: 3,
        });
        console.log('✅ Transaction sent (preflight skipped), signature:', signature);
      }
    } catch (sendError: any) {
      console.error('❌ Failed to send transaction:', {
        error: sendError?.message,
        stack: sendError?.stack,
        errorCode: sendError?.code,
        errorName: sendError?.name,
        logs: sendError?.logs,
      });
      
      // Try to extract more details from the error
      let errorMessage = sendError?.message || String(sendError);
      if (sendError?.logs && Array.isArray(sendError.logs)) {
        errorMessage += ` | Logs: ${sendError.logs.slice(-5).join('; ')}`;
      }
      if (sendError?.err) {
        errorMessage += ` | Error: ${JSON.stringify(sendError.err)}`;
      }
      
      throw new Error(`Failed to send transaction: ${errorMessage}`);
    }

    // Wait for confirmation with timeout
    let confirmation;
    let approvalSkippedDueToReady = false;
    try {
      console.log('⏳ Waiting for transaction confirmation...');
      
      // Add timeout to prevent hanging
      const confirmationPromise = connection.confirmTransaction(signature, 'confirmed');
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Transaction confirmation timeout after 30 seconds')), 30000);
      });
      
      confirmation = await Promise.race([confirmationPromise, timeoutPromise]) as any;
      console.log('✅ Transaction confirmed:', {
        signature,
        slot: confirmation.context.slot,
        hasError: !!confirmation.value.err,
      });
    } catch (confirmError: any) {
      const formattedError = formatError(confirmError);
      console.error('❌ Failed to confirm transaction:', {
        error: formattedError,
        rawError: confirmError,
        signature,
      });
      
      // If confirmation times out or fails, check transaction status directly
      if (confirmError?.message?.includes('timeout') || confirmError?.message?.includes('Timeout')) {
        console.log('⏳ Confirmation timed out, checking transaction status directly...');
        try {
          const txStatus = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
          if (txStatus?.value && !txStatus.value.err) {
            // Transaction succeeded!
            console.log('✅ Transaction confirmed via direct status check:', {
              signature,
              slot: txStatus.value.slot,
            });
            confirmation = {
              value: { err: null },
              context: { slot: txStatus.value.slot || 0 },
            };
          } else if (txStatus?.value?.err) {
            throw new Error(`Transaction failed: ${JSON.stringify(txStatus.value.err)}`);
          } else {
            // Transaction not found yet, might still be processing
            console.warn('⚠️ Transaction not found in history yet, may still be processing');
            // Continue with processing - the transaction might still succeed
            confirmation = {
              value: { err: null },
              context: { slot: 0 },
            };
          }
        } catch (statusError: any) {
          console.warn('⚠️ Failed to check transaction status directly:', statusError?.message);
          // Continue anyway - transaction might still succeed
          confirmation = {
            value: { err: null },
            context: { slot: 0 },
          };
        }
      }
      
      // Continue with existing error handling
      let statusHandled = false;
      let statusStringForError: string | null = null;
      try {
        const statusResponse = await connection.getSignatureStatuses([signature], {
          searchTransactionHistory: true,
        });
        const status = statusResponse?.value?.[0] || null;
        if (status) {
          if (!status.err) {
            console.warn('⚠️ confirmTransaction threw, but signature is confirmed via getSignatureStatuses', {
              signature,
              confirmationStatus: status.confirmationStatus,
              slot: status.slot,
            });
            confirmation = {
              context: { slot: status.slot || 0 },
              value: { err: null },
            } as any;
            statusHandled = true;
          } else {
            const statusErrString = stringifySafe(status.err);
            if (statusErrString.includes('"Custom":6008')) {
              approvalSkippedDueToReady = true;
              console.warn('⚠️ confirmTransaction threw, but status indicates proposal already ready/executed', {
                matchId,
                wallet,
                signature,
                proposalId: proposalIdString,
                statusErr: status.err,
                confirmationStatus: status.confirmationStatus,
                slot: status.slot,
              });
              confirmation = {
                context: { slot: status.slot || 0 },
                value: { err: status.err },
              } as any;
              statusHandled = true;
            } else {
              statusStringForError = stringifySafe(status);
            }
          }
        } else {
          statusStringForError = 'null';
        }
      } catch (statusError: any) {
        if (!statusHandled) {
          const formattedStatusError = formatError(statusError);
          throw new Error(`Failed to confirm transaction: ${formattedError} | statusError: ${formattedStatusError}`);
        }
      }

      if (!statusHandled) {
        const statusString = statusStringForError ?? 'null';
        throw new Error(`Failed to confirm transaction: ${formattedError} | status: ${statusString}`);
      }
    }
    
    if (confirmation.value.err) {
      const errorDetails = JSON.stringify(confirmation.value.err);
      if (errorDetails.includes('"Custom":6008')) {
        approvalSkippedDueToReady = true;
        console.warn('⚠️ Proposal approval skipped because it is already ready/executed on-chain', {
          matchId,
          wallet,
          signature,
          proposalId: proposalIdString,
          error: errorDetails,
        });
      } else {
        console.error('❌ Transaction failed on-chain:', {
          signature,
          error: errorDetails,
          slot: confirmation.context.slot,
        });
        throw new Error(`Transaction failed: ${errorDetails}`);
      }
    }

    if (approvalSkippedDueToReady) {
      console.log('✅ Proposal approval ignored because it was already ready/executed', {
        matchId,
        wallet,
        signature,
        proposalId: proposalIdString,
        payoutProposalId: matchRow.payoutProposalId,
        tieRefundProposalId: matchRow.tieRefundProposalId,
      });
    } else {
      console.log('✅ Proposal signed successfully', {
        matchId,
        wallet,
        signature,
        proposalId: proposalIdString,
        payoutProposalId: matchRow.payoutProposalId,
        tieRefundProposalId: matchRow.tieRefundProposalId,
      });
    }

    // Update match with new signer
    let newNeedsSignatures = 0;
    let newProposalStatus = 'READY_TO_EXECUTE';
    let cachedFeeWalletKeypair: any = null;
    let feeWalletAutoApproved = false;
    let feeWalletApprovalError: string | null = null;

    try {
      const hadFeeWalletSignature = signers.includes(feeWalletAddress);

      // Add wallet to signers list
      signers.push(wallet);

      const normalizedNeedsBefore = normalizeRequiredSignatures(matchRow.needsSignatures);
      const proposalStatusUpper = (matchRow.proposalStatus || '').toString().toUpperCase();
      const proposalAlreadyReady =
        normalizedNeedsBefore <= 1 ||
        proposalStatusUpper === 'READY_TO_EXECUTE' ||
        proposalStatusUpper === 'EXECUTED';

      if (!hadFeeWalletSignature && !proposalAlreadyReady && !approvalSkippedDueToReady) {
        try {
          cachedFeeWalletKeypair = getFeeWalletKeypair();
          console.log('🤝 Auto-approving proposal with fee wallet', {
            matchId,
            proposalId: proposalIdString,
            feeWallet: cachedFeeWalletKeypair.publicKey.toString(),
          });
          const approveResult = await squadsVaultService.approveProposal(
            matchRow.squadsVaultAddress,
            proposalIdString,
            cachedFeeWalletKeypair
          );

          if (approveResult.success) {
            feeWalletAutoApproved = true;
            signers.push(feeWalletAddress);
            console.log('✅ Fee wallet auto-approved proposal', {
              matchId,
              proposalId: proposalIdString,
              signature: approveResult.signature,
            });
            feeWalletAutoApproved = true;
          } else {
            feeWalletApprovalError = approveResult.error || 'Unknown error';
            const lowerError = (feeWalletApprovalError || '').toLowerCase();
            if (lowerError.includes('invalid proposal status') || lowerError.includes('6008')) {
              console.warn('⚠️ Fee wallet auto-approval skipped (already ready to execute)', {
                matchId,
                proposalId: proposalIdString,
                error: feeWalletApprovalError,
              });
              // Ensure we treat fee wallet as a signer since the proposal is already ready to execute
              signers.push(feeWalletAddress);
              feeWalletAutoApproved = true;
            } else {
              console.error('❌ Fee wallet auto-approval failed', {
                matchId,
                proposalId: proposalIdString,
                error: approveResult.error,
              });
            }
          }
        } catch (autoApproveError: any) {
          feeWalletApprovalError = autoApproveError?.message || String(autoApproveError);
          const lowerError = (feeWalletApprovalError || '').toLowerCase();
          if (lowerError.includes('invalid proposal status') || lowerError.includes('6008')) {
            console.warn('⚠️ Fee wallet auto-approval unavailable (already ready to execute)', {
              matchId,
              proposalId: proposalIdString,
              error: feeWalletApprovalError,
            });
            signers.push(feeWalletAddress);
            feeWalletAutoApproved = true;
          } else {
            console.warn('⚠️ Fee wallet auto-approval unavailable', {
              matchId,
              proposalId: proposalIdString,
              error: feeWalletApprovalError,
            });
          }
        }
      } else {
        // Fee wallet already signed OR proposal is already ready OR approval was skipped
        if (hadFeeWalletSignature) {
          // Fee wallet already signed previously - mark as approved
          feeWalletAutoApproved = true;
        } else if (proposalAlreadyReady || approvalSkippedDueToReady) {
          // Proposal is already ready to execute on-chain, so fee wallet must have signed
          // Verify on-chain before adding to signers
          try {
            const proposalStatus = await squadsVaultService.checkProposalStatus(
              matchRow.squadsVaultAddress,
              proposalIdString
            );
            
            if (proposalStatus && proposalStatus.needsSignatures === 0) {
              // Proposal has enough signatures on-chain, fee wallet must have signed
              feeWalletAutoApproved = true;
              signers.push(feeWalletAddress);
              console.log('✅ Fee wallet confirmed as signer (proposal ready on-chain)', {
                matchId,
                proposalId: proposalIdString,
                needsSignatures: proposalStatus.needsSignatures,
                signers: proposalStatus.signers.map(s => s.toString()),
              });
            } else {
              // Proposal not ready yet, fee wallet hasn't signed - don't add it
              console.warn('⚠️ Proposal not ready on-chain, fee wallet signature not confirmed', {
                matchId,
                proposalId: proposalIdString,
                needsSignatures: proposalStatus?.needsSignatures ?? 'unknown',
                signers: proposalStatus?.signers?.map(s => s.toString()) ?? [],
              });
            }
          } catch (verifyError: any) {
            console.warn('⚠️ Could not verify fee wallet signature on-chain, assuming not signed', {
              matchId,
              proposalId: proposalIdString,
              error: verifyError?.message,
            });
            // Don't add fee wallet to signers if we can't verify
          }
        }
      }

      // Only add fee wallet to signers if it actually signed on-chain
      // Don't add it unconditionally - this was causing the bug where database showed 2 signatures
      // but on-chain only had 1 signature
      if (feeWalletAutoApproved && !signers.includes(feeWalletAddress)) {
        signers.push(feeWalletAddress);
      }

      const uniqueSigners = Array.from(new Set(signers));
      const currentNeedsSignatures = normalizeRequiredSignatures(matchRow.needsSignatures);
      
      // Decrement for player signature
      newNeedsSignatures = Math.max(0, currentNeedsSignatures - 1);
      
      // Only decrement for fee wallet if it actually signed on-chain
      if (feeWalletAutoApproved && uniqueSigners.includes(feeWalletAddress)) {
        newNeedsSignatures = Math.max(0, newNeedsSignatures - 1);
      }
      newProposalStatus = newNeedsSignatures === 0 ? 'READY_TO_EXECUTE' : 'ACTIVE';

      console.log('🧾 Recording new proposal signature', {
        matchId,
        proposalId: proposalIdString,
        newSigner: wallet,
        updatedSigners: uniqueSigners,
        feeWalletAutoApproved,
        newNeedsSignatures,
        newProposalStatus,
        feeWalletApprovalError,
      });
      const updatedSignersJson = JSON.stringify(uniqueSigners);
      const persistedNeedsSignatures =
        newNeedsSignatures <= 0 ? 0 : normalizeRequiredSignatures(newNeedsSignatures);
      
      // Update database using raw SQL
      await matchRepository.query(`
        UPDATE "match" 
        SET "proposalSigners" = $1,
            "needsSignatures" = $2,
            "proposalStatus" = $3
        WHERE id = $4
      `, [updatedSignersJson, persistedNeedsSignatures, newProposalStatus, matchId]);
    
      const finalSigners = uniqueSigners;
      matchRow.proposalSigners = updatedSignersJson;
      matchRow.needsSignatures = newNeedsSignatures;
      matchRow.proposalStatus = newProposalStatus;
      console.log('🔐 Post-update signer summary', {
        matchId,
        proposalId: proposalIdString,
        finalSigners,
        newNeedsSignatures,
        persistedNeedsSignatures,
        newProposalStatus,
      });

      if (newNeedsSignatures === 0) {
        try {
          console.log('⚙️ All required signatures collected; attempting proposal execution', {
            matchId,
            proposalId: proposalIdString,
            finalSigners,
          });
          let feeWalletKeypair: any = cachedFeeWalletKeypair;
          if (!feeWalletKeypair) {
            try {
              feeWalletKeypair = getFeeWalletKeypair();
            } catch (keypairError: any) {
              console.warn('⚠️ Fee wallet keypair unavailable, skipping automatic proposal execution', {
                matchId,
                proposalId: proposalIdString,
                error: keypairError?.message || String(keypairError),
              });
            }
          }

          if (feeWalletKeypair) {
            console.log('🚀 Executing proposal with signer summary', {
              matchId,
              proposalId: proposalIdString,
              signers: finalSigners,
              needsSignaturesBeforeExecute: newNeedsSignatures,
              proposalStatusBeforeExecute: newProposalStatus,
              vaultAddress: matchRow.squadsVaultAddress,
              vaultPda: matchRow.squadsVaultPda ?? null,
            });
            const executeResult = await squadsVaultService.executeProposal(
              matchRow.squadsVaultAddress,
              proposalIdString,
              feeWalletKeypair,
              matchRow.squadsVaultPda ?? undefined
            );

            if (executeResult.success) {
              const executedAt = executeResult.executedAt ? new Date(executeResult.executedAt) : new Date();
              const isTieRefund =
                !!matchRow.tieRefundProposalId &&
                String(matchRow.tieRefundProposalId).trim() === proposalIdString;
              const isWinnerPayout =
                !!matchRow.payoutProposalId &&
                String(matchRow.payoutProposalId).trim() === proposalIdString &&
                matchRow.winner &&
                matchRow.winner !== 'tie';

              const executionUpdates = buildProposalExecutionUpdates({
                executedAt,
                signature: executeResult.signature ?? null,
                isTieRefund,
                isWinnerPayout,
              });

              await persistExecutionUpdates(matchRepository, matchId, executionUpdates);
              applyExecutionUpdatesToMatch(matchRow, executionUpdates);
              applyExecutionUpdatesToMatch(match as any, executionUpdates);
              newProposalStatus = 'EXECUTED';

              console.log('✅ Proposal executed successfully', {
                matchId,
                proposalId: proposalIdString,
                executionSignature: executeResult.signature,
                slot: executeResult.slot,
              });

              if (isWinnerPayout) {
                try {
                  if (!executeResult.signature) {
                    console.warn('⚠️ Skipping bonus payout because execution signature is missing', {
                      matchId,
                      proposalId: proposalIdString,
                    });
                  } else {
                    const bonusResult = await disburseBonusIfEligible({
                      matchId,
                      winner: matchRow.winner,
                      entryFeeSol,
                      entryFeeUsd,
                      solPriceAtTransaction,
                      alreadyPaid: bonusAlreadyPaid,
                      existingSignature: bonusSignatureExisting,
                      executionSignature: executeResult.signature,
                      executionTimestamp: executedAt,
                      executionSlot: executeResult.slot,
                    });

                    if (bonusResult.triggered && bonusResult.success && bonusResult.signature) {
                      await matchRepository.query(`
                        UPDATE "match"
                        SET "bonusPaid" = true,
                            "bonusSignature" = $1,
                            "bonusAmount" = $2,
                            "bonusAmountUSD" = $3,
                            "bonusPercent" = $4,
                            "bonusTier" = $5,
                            "bonusPaidAt" = NOW(),
                            "solPriceAtTransaction" = COALESCE("solPriceAtTransaction", $6)
                        WHERE id = $7
                      `, [
                        bonusResult.signature,
                        bonusResult.bonusSol ?? null,
                        bonusResult.bonusUsd ?? null,
                        bonusResult.bonusPercent ?? null,
                        bonusResult.tierId ?? null,
                        bonusResult.solPriceUsed ?? null,
                        matchId,
                      ]);

                      matchRow.bonusPaid = true;
                      matchRow.bonusSignature = bonusResult.signature;
                      matchRow.bonusAmount = bonusResult.bonusSol ?? null;
                      matchRow.bonusAmountUSD = bonusResult.bonusUsd ?? null;
                      matchRow.bonusPercent = bonusResult.bonusPercent ?? null;
                      matchRow.bonusTier = bonusResult.tierId ?? null;
                      if (bonusResult.solPriceUsed && !matchRow.solPriceAtTransaction) {
                        matchRow.solPriceAtTransaction = bonusResult.solPriceUsed;
                      }
                      applyExecutionUpdatesToMatch(match as any, {
                        bonusPaid: true,
                        bonusSignature: bonusResult.signature,
                        bonusAmount: bonusResult.bonusSol ?? null,
                        bonusAmountUSD: bonusResult.bonusUsd ?? null,
                        bonusPercent: bonusResult.bonusPercent ?? null,
                        bonusTier: bonusResult.tierId ?? null,
                        solPriceAtTransaction: bonusResult.solPriceUsed ?? matchRow.solPriceAtTransaction,
                      });
                    } else if (bonusResult.triggered && !bonusResult.success) {
                      console.warn('⚠️ Bonus payout attempted but not successful', {
                        matchId,
                        reason: bonusResult.reason,
                      });
                    }
                  }
                } catch (bonusError: any) {
                  console.error('❌ Error processing bonus payout', {
                    matchId,
                    error: bonusError?.message || String(bonusError),
                  });
                }
              }
            } else {
              console.error('❌ Failed to execute proposal', {
                matchId,
                proposalId: proposalIdString,
                error: executeResult.error,
                signers: finalSigners,
                needsSignatures: newNeedsSignatures,
                logs: executeResult.logs?.slice(-5),
              });
              
              // CRITICAL: If execution failed but proposal is ready, mark it as READY_TO_EXECUTE
              // so the fallback execution in getMatchStatusHandler can retry it
              if (newNeedsSignatures === 0 && newProposalStatus !== 'EXECUTED') {
                await matchRepository.query(`
                  UPDATE "match"
                  SET "proposalStatus" = 'READY_TO_EXECUTE'
                  WHERE id = $1
                `, [matchId]);
                console.warn('⚠️ Proposal marked as READY_TO_EXECUTE for fallback retry', {
                  matchId,
                  proposalId: proposalIdString,
                });
              } else {
                console.warn('⚠️ Proposal signed but execution failed. Will be retried on next status check.');
              }
            }
          } else {
            console.warn('⚠️ Skipping automatic execution because fee wallet keypair is not configured', {
              matchId,
              proposalId: proposalIdString,
            });
          }
        } catch (executeError: any) {
          console.error('❌ Error executing proposal', {
            matchId,
            proposalId: proposalIdString,
            error: executeError?.message || String(executeError),
          });
          
          // CRITICAL: If execution error occurred but proposal is ready, mark it as READY_TO_EXECUTE
          // so the fallback execution in getMatchStatusHandler can retry it
          if (newNeedsSignatures === 0 && newProposalStatus !== 'EXECUTED') {
            try {
              await matchRepository.query(`
                UPDATE "match"
                SET "proposalStatus" = 'READY_TO_EXECUTE'
                WHERE id = $1
              `, [matchId]);
              console.warn('⚠️ Proposal marked as READY_TO_EXECUTE for fallback retry after error', {
                matchId,
                proposalId: proposalIdString,
              });
            } catch (updateError: any) {
              console.error('❌ Failed to update proposal status for fallback retry', {
                matchId,
                error: updateError?.message || String(updateError),
              });
            }
          } else {
            console.warn('⚠️ Proposal signed but execution error occurred. Will be retried on next status check.');
          }
        }
      } else {
        console.log('⏳ Proposal still awaiting additional signatures before execution', {
          matchId,
          proposalId: proposalIdString,
          currentSigners: finalSigners,
          newNeedsSignatures,
          proposalStatus: newProposalStatus,
          feeWalletAutoApproved,
          feeWalletApprovalError,
        });
      }
      
      console.log('✅ Match updated with signer:', {
        matchId,
        wallet,
        needsSignatures: newNeedsSignatures <= 0 ? 0 : normalizeRequiredSignatures(newNeedsSignatures),
        proposalStatus: newProposalStatus,
      });
      
      // Notify opponent via SSE if they're connected (optional, non-critical)
      try {
        const opponentWallet = isPlayer1 ? matchRow.player2 : matchRow.player1;
        // activeSSEResponses is defined at module level (line ~6544), accessible via closure
        const opponentResponses = activeSSEResponses.get(opponentWallet);
        if (opponentResponses && opponentResponses.size > 0) {
        const eventData = {
          type: 'proposal_signed',
          matchId: matchId,
          signer: wallet,
          needsSignatures: newNeedsSignatures <= 0 ? 0 : normalizeRequiredSignatures(newNeedsSignatures),
          proposalStatus: newProposalStatus,
          message: 'Opponent has signed the transaction'
        };
          
          // Broadcast to all opponent's SSE connections
          opponentResponses.forEach((response: any) => {
            try {
              response.write(`data: ${JSON.stringify(eventData)}\n\n`);
              console.log(`📢 SSE notification sent to opponent ${opponentWallet} for match ${matchId}`);
            } catch (error: any) {
              console.error('❌ Failed to send SSE notification:', error);
              // Remove dead connection
              opponentResponses.delete(response);
            }
          });
        }
      } catch (sseError: any) {
        // SSE notification is non-critical, just log and continue
        console.warn('⚠️ Failed to send SSE notification:', sseError?.message);
      }
    } catch (dbError: any) {
      console.error('❌ Failed to update match in database:', {
        error: dbError?.message,
        stack: dbError?.stack,
        matchId,
        wallet,
      });
      // Don't fail the request if DB update fails - transaction was already submitted
      console.warn('⚠️ Transaction was submitted but database update failed');
    }

    res.json({
      success: true,
      message: 'Proposal signed successfully',
      signature,
      proposalId: proposalIdString,
      needsSignatures: newNeedsSignatures <= 0 ? 0 : normalizeRequiredSignatures(newNeedsSignatures),
      proposalStatus: newProposalStatus,
    });

  } catch (error: unknown) {
    console.error('❌ Error signing proposal:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('❌ Error details:', {
      message: errorMessage,
      stack: errorStack,
      matchId: req.body?.matchId,
      wallet: req.body?.wallet,
      hasSignedTransaction: !!req.body?.signedTransaction,
      signedTransactionLength: req.body?.signedTransaction?.length,
    });
    res.status(500).json({ error: 'Failed to sign proposal', details: errorMessage });
  }
};

module.exports = {
  requestMatchHandler,
  submitResultHandler,
  getMatchStatusHandler,
  getProposalApprovalTransactionHandler,
  signProposalHandler,
  checkPlayerMatchHandler,
  debugWaitingPlayersHandler,
  debugMatchesHandler,
  matchTestHandler,
  testRepositoryHandler,
  testDatabaseHandler,
  cleanupSelfMatchesHandler,
  confirmEscrowHandler,
  submitGameGuessHandler,
  getGameStateHandler,
  executePaymentHandler,
  createEscrowTransactionHandler,
  cleanupStuckMatchesHandler,
  simpleCleanupHandler,
  forceCleanupForWallet,
  confirmPaymentHandler,
  memoryStatsHandler,
  debugMatchmakingHandler,
  cancelMatchHandler,
  manualRefundHandler,
  manualMatchHandler,
  manualExecuteProposalHandler,
  clearMatchmakingDataHandler,
  forceProposalCreationHandler,
  runMigrationHandler,
  generateReportHandler,
  verifyBlockchainDataHandler,
  processAutomatedRefunds,
  walletBalanceSSEHandler,
  verifyPaymentTransaction,

  // findAndClaimWaitingPlayer, // Removed - replaced with Redis matchmaking
  websocketStatsHandler,

  // Multisig vault integration handlers
  depositToMultisigVaultHandler,
  checkPendingClaimsHandler,
  voidMatchHandler,
};