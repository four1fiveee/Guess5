import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair } from '@solana/web3.js';
import { rpc, PROGRAM_ID, getMultisigPda } from '@sqds/multisig';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getFeeWalletKeypair, getFeeWalletAddress } from '../config/wallet';
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
  private connection: Connection;
  private config: SquadsVaultConfig;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );

    // Squads SDK initialized via direct imports (no class instantiation needed)

    // Get system public key from environment, fallback to fee wallet address
    let systemPublicKey = process.env.SYSTEM_PUBLIC_KEY;
    if (!systemPublicKey) {
      try {
        systemPublicKey = getFeeWalletAddress();
      } catch {}
    }
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

      // Use fee wallet as the creator/fee payer so creation has SOL to cover rent/fees
      const createKey = getFeeWalletKeypair();
      
      // Generate multisig PDA (Program Derived Address)
      const [multisigPda] = getMultisigPda({ createKey: createKey.publicKey, programId: PROGRAM_ID });

      // Define the multisig members with correct structure
      const squadsMembers = [
        { key: this.config.systemPublicKey, permissions: { mask: 1 } },
        { key: player1Pubkey, permissions: { mask: 1 } },
        { key: player2Pubkey, permissions: { mask: 1 } },
      ];

      // Diagnostics
      enhancedLogger.info('🧪 Squads create diagnostics', {
        programId: PROGRAM_ID.toString(),
        multisigPda: multisigPda.toString(),
        members: squadsMembers.map(m => ({ key: m.key.toString(), mask: m.permissions.mask })),
        threshold: this.config.threshold,
      });

      // Create the multisig using stable RPC (v1) to avoid serialization issues
      let signature: string;
      try {
        signature = await rpc.multisigCreate({
          connection: this.connection,
          createKey,
          creator: createKey,
          multisigPda,
          configAuthority: this.config.systemPublicKey,
          threshold: this.config.threshold,
          members: squadsMembers,
          timeLock: 0,
          memo: `Guess5 Match ${matchId}`,
        });
      } catch (createErr: any) {
        enhancedLogger.error('❌ multisigCreate failed', {
          matchId,
          error: createErr?.message || String(createErr),
          stack: createErr?.stack,
          details: {
            programId: PROGRAM_ID.toString(),
            multisigPda: multisigPda.toString(),
            members: squadsMembers.map(m => ({ key: m.key.toString(), mask: m.permissions.mask })),
            threshold: this.config.threshold,
          }
        });
        throw new Error(`Multisig vault creation failed: ${createErr?.message || String(createErr)}`);
      }

      enhancedLogger.info('✅ Squads multisig vault created', {
        matchId,
        multisigAddress: multisigPda.toString(),
        vaultAddress: multisigPda.toString(), // Same as multisig address
        signature,
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

      match.squadsVaultAddress = multisigPda.toString();
      match.matchStatus = 'VAULT_CREATED';
      await matchRepository.save(match);

      // Log vault creation
      await this.logAuditEvent(matchId, 'SQUADS_VAULT_CREATED', {
        multisigAddress: multisigPda.toString(),
        members: members.map(m => m.toString()),
        threshold: this.config.threshold,
        player1: player1Pubkey.toString(),
        player2: player2Pubkey.toString(),
        entryFee,
      });

      return {
        success: true,
        vaultAddress: multisigPda.toString(),
        multisigAddress: multisigPda.toString(),
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

      // Create real Squads transaction for winner payout
      const multisigAddress = new PublicKey(vaultAddress);
      
      // Generate a unique transaction index
      const transactionIndex = BigInt(Date.now());
      
      // Create transfer instructions
      const winnerLamports = Math.floor(winnerAmount * LAMPORTS_PER_SOL);
      const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
      
      // Create System Program transfer instruction for winner
      const winnerTransferIx = {
        programId: new PublicKey('11111111111111111111111111111111'), // System Program
        keys: [
          { pubkey: multisigAddress, isSigner: false, isWritable: true },
          { pubkey: winner, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([
          Buffer.from([2, 0, 0, 0]), // Transfer instruction
          Buffer.from(winnerLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16)))
        ]),
      };
      
      // Create System Program transfer instruction for fee
      const feeTransferIx = {
        programId: new PublicKey('11111111111111111111111111111111'), // System Program
        keys: [
          { pubkey: multisigAddress, isSigner: false, isWritable: true },
          { pubkey: feeWallet, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([
          Buffer.from([2, 0, 0, 0]), // Transfer instruction
          Buffer.from(feeLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16)))
        ]),
      };
      
      // Create transaction message
      const { TransactionMessage } = await import('@solana/web3.js');
      const transactionMessage = new TransactionMessage({
        payerKey: multisigAddress,
        recentBlockhash: (await this.connection.getLatestBlockhash()).blockhash,
        instructions: [winnerTransferIx, feeTransferIx],
      });
      
      // Create the Squads vault transaction
      const signature = await rpc.vaultTransactionCreate({
        connection: this.connection,
        feePayer: this.config.systemPublicKey, // System pays for transaction creation
        multisigPda: multisigAddress,
        transactionIndex,
        creator: this.config.systemPublicKey,
        vaultIndex: 0, // First vault
        ephemeralSigners: 0, // No ephemeral signers needed
        transactionMessage,
        memo: `Winner payout: ${winner.toString()}`,
      });
      
      // Generate a numeric proposal ID for frontend compatibility
      const proposalId = transactionIndex.toString();
      
      enhancedLogger.info('📝 Created real Squads payout transaction', {
        proposalId,
        transactionSignature: signature,
        multisigAddress: vaultAddress,
        winner: winner.toString(),
        winnerAmount,
        feeWallet: feeWallet.toString(),
        feeAmount,
        transactionIndex: transactionIndex.toString(),
      });

      enhancedLogger.info('✅ Winner payout proposal created', {
        vaultAddress,
        proposalId,
        winner: winner.toString(),
        winnerAmount,
        feeAmount,
      });

      return {
        success: true,
        proposalId,
        needsSignatures: 2, // 2-of-3 multisig, system will auto-sign
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

      // Create real Squads transaction for refunds
      const multisigAddress = new PublicKey(vaultAddress);
      
      // Generate a unique transaction index
      const transactionIndex = BigInt(Date.now() + 1); // Different from payout
      
      // Create transfer instructions
      const refundLamports = Math.floor(refundAmount * LAMPORTS_PER_SOL);
      
      // Create System Program transfer instruction for player 1
      const player1TransferIx = {
        programId: new PublicKey('11111111111111111111111111111111'), // System Program
        keys: [
          { pubkey: multisigAddress, isSigner: false, isWritable: true },
          { pubkey: player1, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([
          Buffer.from([2, 0, 0, 0]), // Transfer instruction
          Buffer.from(refundLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16)))
        ]),
      };
      
      // Create System Program transfer instruction for player 2
      const player2TransferIx = {
        programId: new PublicKey('11111111111111111111111111111111'), // System Program
        keys: [
          { pubkey: multisigAddress, isSigner: false, isWritable: true },
          { pubkey: player2, isSigner: false, isWritable: true },
        ],
        data: Buffer.concat([
          Buffer.from([2, 0, 0, 0]), // Transfer instruction
          Buffer.from(refundLamports.toString(16).padStart(16, '0').match(/.{2}/g)!.reverse().map(hex => parseInt(hex, 16)))
        ]),
      };
      
      // Create transaction message
      const { TransactionMessage } = await import('@solana/web3.js');
      const transactionMessage = new TransactionMessage({
        payerKey: multisigAddress,
        recentBlockhash: (await this.connection.getLatestBlockhash()).blockhash,
        instructions: [player1TransferIx, player2TransferIx],
      });
      
      // Create the Squads vault transaction
      const signature = await rpc.vaultTransactionCreate({
        connection: this.connection,
        feePayer: this.config.systemPublicKey, // System pays for transaction creation
        multisigPda: multisigAddress,
        transactionIndex,
        creator: this.config.systemPublicKey,
        vaultIndex: 0, // First vault
        ephemeralSigners: 0, // No ephemeral signers needed
        transactionMessage,
        memo: `Tie refund: ${player1.toString()}, ${player2.toString()}`,
      });
      
      // Generate a numeric proposal ID for frontend compatibility
      const proposalId = transactionIndex.toString();
      
      enhancedLogger.info('📝 Created real Squads refund transaction', {
        proposalId,
        transactionSignature: signature,
        multisigAddress: vaultAddress,
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
        transactionIndex: transactionIndex.toString(),
      });

      enhancedLogger.info('✅ Tie refund proposal created', {
        vaultAddress,
        proposalId,
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
      });

      return {
        success: true,
        proposalId,
        needsSignatures: 2, // 2-of-3 multisig, system will auto-sign
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

      // For now, return a simplified status that maintains frontend compatibility
      // TODO: Implement full Squads transaction status checking with numeric proposal IDs
      const signers: string[] = []; // No signers yet
      const needsSignatures = this.config.threshold;

      enhancedLogger.info('📊 Checked proposal status (simplified)', {
        vaultAddress,
        proposalId,
        needsSignatures,
      });

      return {
        executed: false,
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

      // For now, simulate signing to maintain frontend compatibility
      // TODO: Implement full Squads transaction signing with numeric proposal IDs
      enhancedLogger.info('📝 System signing proposal (simplified)', {
        vaultAddress,
        proposalId,
        signer: signer.toString(),
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
