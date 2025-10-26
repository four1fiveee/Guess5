import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAttestation } from '../models/MatchAttestation';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { AttestationData, kmsService } from './kmsService';

export interface MultisigVaultConfig {
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

    this.multisigConfig = {
      automatedSigner: new PublicKey(process.env.AUTOMATED_SIGNER_PUBKEY || ''),
      coSigner: new PublicKey(process.env.CO_SIGNER_PUBKEY || ''),
      recoveryKey: new PublicKey(process.env.RECOVERY_KEY_PUBKEY || ''),
      threshold: 2,
    };
  }

  /**
   * Create a new multisig vault for a match
   * This creates a simple wallet address (not a full multisig account yet)
   */
  async createVault(matchId: string, player1Wallet: string, player2Wallet: string, stakeAmount: number): Promise<VaultCreationResult> {
    try {
      enhancedLogger.info('🏦 Creating multisig vault', {
        matchId,
        player1Wallet,
        player2Wallet,
        stakeAmount,
      });

      // Generate unique vault address using match ID and timestamp
      // In production, this would create a real multisig account
      // For now, we generate a deterministic keypair from match data
      const vaultSeed = Buffer.from(`vault_${matchId}`);
      const vaultKeypair = Keypair.fromSeed(vaultSeed.subarray(0, 32));
      const vaultAddress = vaultKeypair.publicKey.toString();

      // Update match with vault address
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });
      
      if (!match) {
        return {
          success: false,
          error: 'Match not found',
        };
      }

      match.vaultAddress = vaultAddress;
      match.matchStatus = 'VAULT_CREATED';
      await matchRepository.save(match);

      // Log vault creation
      await this.logAuditEvent(matchId, 'VAULT_CREATED', {
        vaultAddress,
        player1Wallet,
        player2Wallet,
        stakeAmount,
        multisigConfig: this.multisigConfig,
      });

      enhancedLogger.info('✅ Multisig vault created', {
        matchId,
        vaultAddress,
      });

      return {
        success: true,
        vaultAddress,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to create multisig vault', {
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
   * Verify a deposit transaction on Solana
   * This checks if a player has actually sent money to the vault
   */
  async verifyDeposit(matchId: string, playerWallet: string, expectedAmount: number): Promise<DepositResult> {
    try {
      enhancedLogger.info('🔍 Verifying deposit on Solana', {
        matchId,
        playerWallet,
        expectedAmount,
      });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match || !match.vaultAddress) {
        return {
          success: false,
          error: 'Match or vault not found',
        };
      }

      // TypeScript assertion after null check
      const vaultAddress: string = match.vaultAddress as string;
      const vaultPublicKey = new PublicKey(vaultAddress);

      // Check vault balance on Solana
      const balance = await this.connection.getBalance(vaultPublicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;

      enhancedLogger.info('💰 Current vault balance', {
        matchId,
        vaultAddress: match.vaultAddress,
        balanceLamports: balance,
        balanceSOL,
      });

      // Check if we've reached the expected total (both players' stakes)
      const expectedTotalLamports = expectedAmount * 2 * LAMPORTS_PER_SOL;
      
      // Track which player's deposit we're verifying
      const isPlayer1 = playerWallet === match.player1;
      
      if (isPlayer1) {
        match.depositAConfirmations = balance >= (expectedAmount * LAMPORTS_PER_SOL) ? 1 : 0;
      } else {
        match.depositBConfirmations = balance >= expectedTotalLamports ? 1 : 0;
      }

      await matchRepository.save(match);

      // Both deposits confirmed
      if ((match.depositAConfirmations ?? 0) >= 1 && (match.depositBConfirmations ?? 0) >= 1) {
        match.matchStatus = 'READY';
        await matchRepository.save(match);
        
        enhancedLogger.info('✅ Both deposits confirmed', {
          matchId,
          totalBalance: balanceSOL,
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
   * Process payout based on attestation - REAL SOLANA TRANSACTION
   */
  async processPayout(attestation: AttestationData): Promise<PayoutResult> {
    try {
      enhancedLogger.info('💸 Processing vault payout with real Solana transaction', {
        matchId: attestation.match_id,
        winner: attestation.winner_address,
        reason: attestation.reason,
      });

      // Sign attestation with KMS
      const signingResult = await kmsService.signAttestation(attestation);
      
      if (!signingResult.success) {
        return {
          success: false,
          error: `KMS signing failed: ${signingResult.error}`,
        };
      }

      // Create attestation record
      const attestationRepository = AppDataSource.getRepository(MatchAttestation);
      const matchAttestation = new MatchAttestation();
      matchAttestation.matchId = attestation.match_id;
      matchAttestation.attestationJson = attestation;
      matchAttestation.attestationHash = signingResult.attestationHash!;
      matchAttestation.signedByKms = true;
      matchAttestation.kmsSignature = signingResult.signature;
      await attestationRepository.save(matchAttestation);

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: attestation.match_id } });

      if (!match || !match.vaultAddress) {
        return {
          success: false,
          error: 'Match or vault not found',
        };
      }

      // TypeScript assertion after null check
      const vaultAddress: string = match.vaultAddress as string;

      // Calculate payout amounts
      const totalStakeLamports = Math.floor(attestation.stake_lamports * 2); // Both players' stakes
      const feeLamports = Math.floor(totalStakeLamports * 0.05); // 5% fee
      const winnerAmountLamports = totalStakeLamports - feeLamports; // Rest to winner
      
      const feeWalletAddress = process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

      // Create real Solana transaction for payout
      const vaultPublicKey = new PublicKey(vaultAddress);
      
      // Validate winner address (should not be null for payout)
      if (!attestation.winner_address) {
        throw new Error('Winner address is required for payout');
      }
      
      const winnerPublicKey = new PublicKey(attestation.winner_address);
      const feeWalletPublicKey = new PublicKey(feeWalletAddress);

      // Generate vault keypair (we need this to sign the transaction)
      const vaultSeed = Buffer.from(`vault_${match.id}`);
      const vaultKeypair = Keypair.fromSeed(vaultSeed.subarray(0, 32));

      // Create transfer transactions
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: vaultPublicKey,
          toPubkey: winnerPublicKey,
          lamports: winnerAmountLamports,
        }),
        SystemProgram.transfer({
          fromPubkey: vaultPublicKey,
          toPubkey: feeWalletPublicKey,
          lamports: feeLamports,
        })
      );

      // Get recent blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = vaultPublicKey;

      // Sign with vault keypair
      transaction.sign(vaultKeypair);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize());
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      enhancedLogger.info('✅ Real payout transaction sent to Solana', {
        matchId: attestation.match_id,
        signature,
        winnerAmount: winnerAmountLamports / LAMPORTS_PER_SOL,
        feeAmount: feeLamports / LAMPORTS_PER_SOL,
      });

      // Update match with payout information
      match.payoutTxHash = signature;
      match.matchStatus = 'SETTLED';
      await matchRepository.save(match);

      // Log payout event
      await this.logAuditEvent(attestation.match_id, 'PAYOUT_PROCESSED', {
        attestationHash: signingResult.attestationHash,
        kmsSignature: signingResult.signature,
        payoutTxId: signature,
        winner: attestation.winner_address,
        winnerAmount: winnerAmountLamports / LAMPORTS_PER_SOL,
        feeAmount: feeLamports / LAMPORTS_PER_SOL,
        reason: attestation.reason,
      });

      return {
        success: true,
        transactionId: signature,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to process vault payout', {
        matchId: attestation.match_id,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Process refund for timeout or error scenarios - REAL SOLANA TRANSACTION
   */
  async processRefund(matchId: string, reason: string): Promise<PayoutResult> {
    try {
      enhancedLogger.info('🔄 Processing vault refund with real Solana transaction', {
        matchId,
        reason,
      });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match || !match.vaultAddress) {
        return {
          success: false,
          error: 'Match or vault not found',
        };
      }

      // TypeScript assertion after null check
      const vaultAddress: string = match.vaultAddress as string;

      // Refund both players their entry fee
      const refundAmountLamports = Math.floor(match.entryFee * LAMPORTS_PER_SOL);

      // Generate vault keypair
      const vaultSeed = Buffer.from(`vault_${match.id}`);
      const vaultKeypair = Keypair.fromSeed(vaultSeed.subarray(0, 32));
      const vaultPublicKey = new PublicKey(vaultAddress);

      // Create refund transaction
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: vaultPublicKey,
          toPubkey: new PublicKey(match.player1),
          lamports: refundAmountLamports,
        }),
        SystemProgram.transfer({
          fromPubkey: vaultPublicKey,
          toPubkey: new PublicKey(match.player2),
          lamports: refundAmountLamports,
        })
      );

      // Get recent blockhash
      const { blockhash } = await this.connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = vaultPublicKey;

      // Sign with vault keypair
      transaction.sign(vaultKeypair);

      // Send transaction
      const signature = await this.connection.sendRawTransaction(transaction.serialize());
      
      // Wait for confirmation
      await this.connection.confirmTransaction(signature, 'confirmed');

      enhancedLogger.info('✅ Real refund transaction sent to Solana', {
        matchId,
        signature,
        refundAmount: refundAmountLamports / LAMPORTS_PER_SOL,
        player1: match.player1,
        player2: match.player2,
      });

      // Update match with refund information
      match.refundTxHash = signature;
      match.matchStatus = 'REFUNDED';
      await matchRepository.save(match);

      // Log refund event
      await this.logAuditEvent(matchId, 'REFUND_PROCESSED', {
        reason,
        refundTxId: signature,
        refundAmount: refundAmountLamports / LAMPORTS_PER_SOL,
      });

      return {
        success: true,
        transactionId: signature,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to process vault refund', {
        matchId,
        reason,
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
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

// Export singleton instance
export const multisigVaultService = new MultisigVaultService();
