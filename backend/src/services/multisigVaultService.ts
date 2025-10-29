import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAttestation } from '../models/MatchAttestation';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { AttestationData, kmsService } from './kmsService';

export interface MultisigVaultConfig {
  // DEPRECATED: This interface was never properly implemented
  // The system used deterministic keypairs instead of real multisig
  automatedSigner: PublicKey;
  coSigner: PublicKey;
  recoveryKey: PublicKey;
  threshold: number; // 2-of-3 multisig
}

export interface VaultCreationResult {
  success: boolean;
  vaultAddress?: string;
  error?: string;
}

export interface DepositResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface PayoutResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export class MultisigVaultService {
  private connection: Connection;
  private multisigConfig: MultisigVaultConfig;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // DEPRECATED: This multisig config was fake and never used
    // The system used deterministic keypairs instead of real multisig
    this.multisigConfig = {
      automatedSigner: new PublicKey(process.env.AUTOMATED_SIGNER_PUBKEY || ''),
      coSigner: new PublicKey(process.env.CO_SIGNER_PUBKEY || ''),
      recoveryKey: new PublicKey(process.env.RECOVERY_KEY_PUBKEY || ''),
      threshold: 2,
    };
  }

  /**
   * DEPRECATED: This method will be replaced by Squads Protocol integration
   * The deterministic keypair generation is CUSTODIAL and violates non-custodial requirements
   */
  async createVault(matchId: string, player1Wallet: string, player2Wallet: string, stakeAmount: number): Promise<VaultCreationResult> {
    enhancedLogger.error('❌ DEPRECATED: createVault() is CUSTODIAL and will be replaced by Squads Protocol');
    return {
      success: false,
      error: 'This method is deprecated. Use Squads Protocol for non-custodial vaults.',
    };
  }

  /**
   * Verify a deposit transaction on Solana
   * This checks if a player has actually sent money to the vault
   */
  async verifyDeposit(matchId: string, playerWallet: string, expectedAmount: number, depositTxSignature?: string): Promise<DepositResult> {
    try {
      enhancedLogger.info('🔍 Verifying deposit on Solana', {
        matchId,
        playerWallet,
        expectedAmount,
      });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match || !match.squadsVaultAddress) {
        return {
          success: false,
          error: 'Match or vault not found',
        };
      }

      // TypeScript assertion after null check
      const vaultAddress: string = match.squadsVaultAddress as string;
      const vaultPublicKey = new PublicKey(vaultAddress);

      // Check vault balance on Solana
      const balance = await this.connection.getBalance(vaultPublicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;

      enhancedLogger.info('💰 Current vault balance', {
        matchId,
        vaultAddress: match.squadsVaultAddress,
        balanceLamports: balance,
        balanceSOL,
      });

      // Track which player's deposit we're verifying
      const isPlayer1 = playerWallet === match.player1;
      const expectedLamports = expectedAmount * LAMPORTS_PER_SOL;
      const expectedTotalLamports = expectedAmount * 2 * LAMPORTS_PER_SOL;
      
      // Get current confirmation status to avoid overwriting
      const currentDepositA = match.depositAConfirmations ?? 0;
      const currentDepositB = match.depositBConfirmations ?? 0;
      
      // Save deposit transaction signature if provided
      if (depositTxSignature) {
        if (isPlayer1 && !match.depositATx) {
          match.depositATx = depositTxSignature;
          enhancedLogger.info('💾 Saved Player 1 deposit TX', { matchId, tx: depositTxSignature });
        } else if (!isPlayer1 && !match.depositBTx) {
          match.depositBTx = depositTxSignature;
          enhancedLogger.info('💾 Saved Player 2 deposit TX', { matchId, tx: depositTxSignature });
        }
      }
      
      // Determine which player's deposit to confirm based on who is calling AND balance changes
      // Use transaction signatures as the source of truth if available
      const hasExistingTx = isPlayer1 ? !!match.depositATx : !!match.depositBTx;
      
      // Only confirm deposits if we have sufficient balance AND either:
      // 1. This is the first verification for this player (balance changed from 0 to expected)
      // 2. OR we have a transaction signature confirming the deposit
      if (isPlayer1 && currentDepositA === 0) {
        // Player 1: Confirm if balance is at least one full deposit
        if (balance >= expectedLamports && (hasExistingTx || depositTxSignature)) {
          match.depositAConfirmations = 1;
          enhancedLogger.info('✅ Player 1 deposit confirmed', { 
            matchId, 
            balanceSOL,
            playerWallet,
            depositTx: depositTxSignature || match.depositATx
          });
        }
      } else if (!isPlayer1 && currentDepositB === 0) {
        // Player 2: Confirm if balance is at full pot AND we have a signature
        if (balance >= expectedTotalLamports && (hasExistingTx || depositTxSignature)) {
          match.depositBConfirmations = 1;
          enhancedLogger.info('✅ Player 2 deposit confirmed', { 
            matchId, 
            balanceSOL,
            playerWallet,
            depositTx: depositTxSignature || match.depositBTx
          });
          
          // If Player 2 deposited and we have full balance, Player 1 must have also deposited
          // But only update Player 1 if they haven't been confirmed yet
          if (currentDepositA === 0 && balance >= expectedTotalLamports && match.depositATx) {
            match.depositAConfirmations = 1;
            enhancedLogger.info('✅ Player 1 deposit also confirmed (both players deposited, found TX)', { 
              matchId,
              player1Tx: match.depositATx
            });
          }
        }
      } else {
        // Deposit already confirmed for this player, just log it
        enhancedLogger.info('✅ Deposit already confirmed for player', { 
          matchId,
          playerWallet,
          isPlayer1,
          currentDepositA,
          currentDepositB
        });
      }

      await matchRepository.save(match);

      // Both deposits confirmed - set match to active for game start
      if ((match.depositAConfirmations ?? 0) >= 1 && (match.depositBConfirmations ?? 0) >= 1) {
        enhancedLogger.info('🎮 Both deposits confirmed, activating match', {
          matchId,
          depositA: match.depositAConfirmations,
          depositB: match.depositBConfirmations,
          currentStatus: match.status,
        });
        
        match.matchStatus = 'READY';
        match.status = 'active'; // Set status to active so frontend can redirect to game
        
        // Ensure word is set if not already present
        if (!match.word) {
          const { getRandomWord } = require('../wordList');
          match.word = getRandomWord();
        }
        
        // Set game start time if not already set
        if (!match.gameStartTime) {
          match.gameStartTime = new Date();
        }
        
        await matchRepository.save(match);
        
        // Reload match to verify it was saved correctly
        const reloadedMatch = await matchRepository.findOne({ where: { id: matchId } });
        enhancedLogger.info('✅ Match activated and saved successfully', {
          matchId,
          status: reloadedMatch?.status,
          matchStatus: reloadedMatch?.matchStatus,
          word: reloadedMatch?.word,
          gameStartTime: reloadedMatch?.gameStartTime,
        });
      }

      await this.logAuditEvent(matchId, 'DEPOSIT_VERIFIED', {
        playerWallet,
        expectedAmount,
        actualBalance: balanceSOL,
        confirmations: isPlayer1 ? match.depositAConfirmations : match.depositBConfirmations,
      });

      return {
        success: true,
        transactionId: `verified_${matchId}_${Date.now()}`,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to verify deposit', {
        matchId,
        playerWallet,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * DEPRECATED: This method is CUSTODIAL and will be replaced by Squads Protocol proposals
   * The backend should not be able to unilaterally execute payouts
   */
  async processPayout(attestation: AttestationData): Promise<PayoutResult> {
    enhancedLogger.error('❌ DEPRECATED: processPayout() is CUSTODIAL and will be replaced by Squads Protocol proposals');
    return {
      success: false,
      error: 'This method is deprecated. Use Squads Protocol for non-custodial payouts.',
    };
  }

  /**
   * DEPRECATED: This method is CUSTODIAL and will be replaced by Squads Protocol proposals
   * The backend should not be able to unilaterally execute refunds
   */
  async processRefund(matchId: string, reason: string): Promise<PayoutResult> {
    enhancedLogger.error('❌ DEPRECATED: processRefund() is CUSTODIAL and will be replaced by Squads Protocol proposals');
    return {
      success: false,
      error: 'This method is deprecated. Use Squads Protocol for non-custodial refunds.',
    };
  }

  /**
   * Check vault balance and confirmations - REAL SOLANA QUERY
   */
  async checkVaultStatus(vaultAddress: string): Promise<{
    balance: number;
    confirmations: number;
    isReady: boolean;
  }> {
    try {
      // Check actual balance on Solana
      const vaultPublicKey = new PublicKey(vaultAddress);
      const balance = await this.connection.getBalance(vaultPublicKey, 'confirmed');
      
      // Get recent slot to calculate confirmations
      const slot = await this.connection.getSlot('confirmed');
      
      // For simplicity, we'll say it's ready if balance > 0
      // In production, you'd check transaction confirmations
      const isReady = balance > 0;

      enhancedLogger.info('💰 Vault status checked on Solana', {
        vaultAddress,
        balanceLamports: balance,
        balanceSOL: balance / LAMPORTS_PER_SOL,
        slot,
        isReady,
      });

      return {
        balance: balance,
        confirmations: isReady ? 1 : 0,
        isReady: isReady,
      };
    } catch (error) {
      enhancedLogger.error('❌ Failed to check vault status', {
        vaultAddress,
        error,
      });
      
      return {
        balance: 0,
        confirmations: 0,
        isReady: false,
      };
    }
  }

  /**
   * Log audit event
   */
  private async logAuditEvent(matchId: string, eventType: string, eventData: any): Promise<void> {
    try {
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);
      const auditLog = new MatchAuditLog();
      auditLog.matchId = matchId;
      auditLog.eventType = eventType;
      auditLog.eventData = eventData;
      await auditLogRepository.save(auditLog);
    } catch (error) {
      enhancedLogger.error('❌ Failed to log audit event', {
        matchId,
        eventType,
        error,
      });
    }
  }
}

// DEPRECATED: Do not instantiate this service
// Use squadsVaultService instead for non-custodial Squads Protocol integration
// export const multisigVaultService = new MultisigVaultService();
