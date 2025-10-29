import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Squads } from '@sqds/multisig';
import { enhancedLogger } from '../utils/enhancedLogger';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAttestation } from '../models/MatchAttestation';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { AttestationData, kmsService } from './kmsService';

export interface SquadsVaultConfig {
  systemPublicKey: PublicKey; // Your system's public key (non-custodial)
  threshold: number; // 2-of-3 multisig
}

export interface VaultCreationResult {
  success: boolean;
  vaultAddress?: string;
  multisigAddress?: string;
  error?: string;
}

export interface ProposalResult {
  success: boolean;
  proposalId?: string;
  error?: string;
}

export interface ProposalStatus {
  executed: boolean;
  signers: PublicKey[];
  needsSignatures: number;
}

export class SquadsVaultService {
  private squads: Squads;
  private connection: Connection;
  private config: SquadsVaultConfig;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // Initialize Squads SDK
    this.squads = new Squads(this.connection);

    // Get system public key from environment
    const systemPublicKey = process.env.SYSTEM_PUBLIC_KEY;
    if (!systemPublicKey) {
      throw new Error('SYSTEM_PUBLIC_KEY environment variable is required');
    }

    this.config = {
      systemPublicKey: new PublicKey(systemPublicKey),
      threshold: 2, // 2-of-3 multisig
    };
  }

  /**
   * Create a new 2-of-3 multisig vault for a match
   * Signers: [system, player1, player2]
   * Threshold: 2 signatures required
   */
  async createMatchVault(
    matchId: string,
    player1Pubkey: PublicKey,
    player2Pubkey: PublicKey,
    entryFee: number
  ): Promise<VaultCreationResult> {
    try {
      enhancedLogger.info('🏦 Creating Squads multisig vault', {
        matchId,
        player1: player1Pubkey.toString(),
        player2: player2Pubkey.toString(),
        entryFee,
        system: this.config.systemPublicKey.toString(),
      });

      // Create 2-of-3 multisig: [system, player1, player2]
      const members = [
        this.config.systemPublicKey,
        player1Pubkey,
        player2Pubkey,
      ];

      // Create the multisig using Squads SDK
      const multisig = await this.squads.createMultisig({
        members,
        threshold: this.config.threshold,
        configAuthority: this.config.systemPublicKey, // System can manage the multisig
        timeLock: 0, // No time lock for immediate execution
        memo: `Guess5 Match ${matchId}`,
      });

      enhancedLogger.info('✅ Squads multisig vault created', {
        matchId,
        multisigAddress: multisig.multisigAddress.toString(),
        vaultAddress: multisig.multisigAddress.toString(), // Same as multisig address
      });

      // Update match with vault information
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });
      
      if (!match) {
        return {
          success: false,
          error: 'Match not found',
        };
      }

      match.squadsVaultAddress = multisig.multisigAddress.toString();
      match.matchStatus = 'VAULT_CREATED';
      await matchRepository.save(match);

      // Log vault creation
      await this.logAuditEvent(matchId, 'SQUADS_VAULT_CREATED', {
        multisigAddress: multisig.multisigAddress.toString(),
        members: members.map(m => m.toString()),
        threshold: this.config.threshold,
        player1: player1Pubkey.toString(),
        player2: player2Pubkey.toString(),
        entryFee,
      });

      return {
        success: true,
        vaultAddress: multisig.multisigAddress.toString(),
        multisigAddress: multisig.multisigAddress.toString(),
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to create Squads multisig vault', {
        matchId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Propose winner payout transaction
   * Requires 2 signatures: system + winner
   */
  async proposeWinnerPayout(
    vaultAddress: string,
    winner: PublicKey,
    winnerAmount: number,
    feeWallet: PublicKey,
    feeAmount: number
  ): Promise<ProposalResult> {
    try {
      enhancedLogger.info('💸 Proposing winner payout via Squads', {
        vaultAddress,
        winner: winner.toString(),
        winnerAmount,
        feeWallet: feeWallet.toString(),
        feeAmount,
      });

      const multisigAddress = new PublicKey(vaultAddress);
      
      // Create transfer transactions
      const winnerLamports = Math.floor(winnerAmount * LAMPORTS_PER_SOL);
      const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);

      // Create proposal for winner payout
      const proposal = await this.squads.createTransaction({
        multisig: multisigAddress,
        instructions: [
          {
            programId: '11111111111111111111111111111111', // System Program
            accounts: [
              { pubkey: multisigAddress, isSigner: false, isWritable: true },
              { pubkey: winner, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([
              2, 0, 0, 0, // Transfer instruction
              ...winnerLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16))
            ]),
          },
          {
            programId: '11111111111111111111111111111111', // System Program
            accounts: [
              { pubkey: multisigAddress, isSigner: false, isWritable: true },
              { pubkey: feeWallet, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([
              2, 0, 0, 0, // Transfer instruction
              ...feeLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16))
            ]),
          },
        ],
        memo: `Winner payout: ${winner.toString()}`,
      });

      enhancedLogger.info('✅ Winner payout proposal created', {
        vaultAddress,
        proposalId: proposal.transactionIndex.toString(),
        winner: winner.toString(),
        winnerAmount,
        feeAmount,
      });

      return {
        success: true,
        proposalId: proposal.transactionIndex.toString(),
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to propose winner payout', {
        vaultAddress,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Propose tie refund transaction
   * Requires 2 signatures: system + either player
   */
  async proposeTieRefund(
    vaultAddress: string,
    player1: PublicKey,
    player2: PublicKey,
    refundAmount: number
  ): Promise<ProposalResult> {
    try {
      enhancedLogger.info('🔄 Proposing tie refund via Squads', {
        vaultAddress,
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
      });

      const multisigAddress = new PublicKey(vaultAddress);
      const refundLamports = Math.floor(refundAmount * LAMPORTS_PER_SOL);

      // Create proposal for refunds
      const proposal = await this.squads.createTransaction({
        multisig: multisigAddress,
        instructions: [
          {
            programId: '11111111111111111111111111111111', // System Program
            accounts: [
              { pubkey: multisigAddress, isSigner: false, isWritable: true },
              { pubkey: player1, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([
              2, 0, 0, 0, // Transfer instruction
              ...refundLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16))
            ]),
          },
          {
            programId: '11111111111111111111111111111111', // System Program
            accounts: [
              { pubkey: multisigAddress, isSigner: false, isWritable: true },
              { pubkey: player2, isSigner: false, isWritable: true },
            ],
            data: Buffer.from([
              2, 0, 0, 0, // Transfer instruction
              ...refundLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16))
            ]),
          },
        ],
        memo: `Tie refund: ${player1.toString()}, ${player2.toString()}`,
      });

      enhancedLogger.info('✅ Tie refund proposal created', {
        vaultAddress,
        proposalId: proposal.transactionIndex.toString(),
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
      });

      return {
        success: true,
        proposalId: proposal.transactionIndex.toString(),
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to propose tie refund', {
        vaultAddress,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check proposal status
   */
  async checkProposalStatus(
    vaultAddress: string,
    proposalId: string
  ): Promise<ProposalStatus> {
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const transactionIndex = parseInt(proposalId);

      // Get transaction details from Squads
      const transaction = await this.squads.getTransaction({
        multisig: multisigAddress,
        transactionIndex,
      });

      const signers = transaction.signers || [];
      const needsSignatures = this.config.threshold - signers.length;

      return {
        executed: transaction.executed || false,
        signers,
        needsSignatures: Math.max(0, needsSignatures),
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to check proposal status', {
        vaultAddress,
        proposalId,
        error: errorMessage,
      });

      return {
        executed: false,
        signers: [],
        needsSignatures: this.config.threshold,
      };
    }
  }

  /**
   * Sign a proposal (for system signatures)
   */
  async signProposal(
    vaultAddress: string,
    proposalId: string,
    signer: PublicKey
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const transactionIndex = parseInt(proposalId);

      // Only allow system to sign proposals
      if (!signer.equals(this.config.systemPublicKey)) {
        return {
          success: false,
          error: 'Only system can sign proposals from backend',
        };
      }

      // Sign the transaction
      await this.squads.approveTransaction({
        multisig: multisigAddress,
        transactionIndex,
        signer: this.config.systemPublicKey,
      });

      enhancedLogger.info('✅ Proposal signed by system', {
        vaultAddress,
        proposalId,
        signer: signer.toString(),
      });

      return { success: true };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to sign proposal', {
        vaultAddress,
        proposalId,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Verify a deposit transaction on Solana
   * This checks if a player has actually sent money to the Squads vault
   */
  async verifyDeposit(matchId: string, playerWallet: string, expectedAmount: number, depositTxSignature?: string): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      enhancedLogger.info('🔍 Verifying deposit on Squads vault', {
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

      enhancedLogger.info('💰 Current Squads vault balance', {
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
  async checkVaultStatus(vaultAddress: string): Promise<{
    balance: number;
    confirmations: number;
    isReady: boolean;
  }> {
    try {
      const vaultPublicKey = new PublicKey(vaultAddress);
      const balance = await this.connection.getBalance(vaultPublicKey, 'confirmed');
      
      const isReady = balance > 0;

      enhancedLogger.info('💰 Squads vault status checked', {
        vaultAddress,
        balanceLamports: balance,
        balanceSOL: balance / LAMPORTS_PER_SOL,
        isReady,
      });

      return {
        balance: balance,
        confirmations: isReady ? 1 : 0,
        isReady: isReady,
      };
    } catch (error) {
      enhancedLogger.error('❌ Failed to check Squads vault status', {
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

// Export singleton instance
export const squadsVaultService = new SquadsVaultService();
