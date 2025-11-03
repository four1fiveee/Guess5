import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, TransactionMessage, SystemProgram } from '@solana/web3.js';
import { rpc, PROGRAM_ID, getMultisigPda, getProgramConfigPda, accounts, types } from '@sqds/multisig';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getFeeWalletKeypair, getFeeWalletAddress } from '../config/wallet';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAttestation } from '../models/MatchAttestation';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { AttestationData, kmsService } from './kmsService';
import { setGameState } from '../utils/redisGameState';

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
  needsSignatures?: number;
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
            // Preflight diagnostics and validations
            const cluster = process.env.SQUADS_NETWORK || 'devnet';
            const network = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
            const expectedProgramId = PROGRAM_ID?.toString?.() || 'unknown';

            const allKeys = {
              systemPublicKey: this.config.systemPublicKey?.toString?.(),
              player1: player1Pubkey?.toString?.(),
              player2: player2Pubkey?.toString?.(),
              feePayer: getFeeWalletKeypair().publicKey?.toString?.(),
              programId: expectedProgramId,
              cluster,
              network,
            };
            enhancedLogger.info('🔎 Preflight: env and key sanity', allKeys);

            // Validate PublicKey instances
            const isPk = (k: any) => k && typeof k.toBase58 === 'function';
            if (!isPk(this.config.systemPublicKey) || !isPk(player1Pubkey) || !isPk(player2Pubkey)) {
              const details = {
                systemOk: isPk(this.config.systemPublicKey),
                player1Ok: isPk(player1Pubkey),
                player2Ok: isPk(player2Pubkey),
              };
              enhancedLogger.error('❌ Invalid PublicKey inputs', details);
              return { success: false, error: 'Invalid PublicKey inputs for multisig creation' };
            }
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

      // Fetch program config to get treasury address (required for v2)
      let treasury: PublicKey | null = null;
      try {
        const [programConfigPda] = getProgramConfigPda({});
        const programConfig = await accounts.ProgramConfig.fromAccountAddress(
          this.connection,
          programConfigPda
        );
        treasury = programConfig.treasury;
        enhancedLogger.info('📋 Fetched treasury from ProgramConfig', {
          treasury: treasury.toString()
        });
      } catch (configErr: any) {
        enhancedLogger.warn('⚠️ Could not fetch ProgramConfig treasury, using null', {
          error: configErr?.message
        });
        // Use null if ProgramConfig fetch fails (some networks/configs may allow this)
        treasury = null;
      }

      // Define the multisig members with proper Permissions objects (required for v2)
      const squadsMembers = [
        { 
          key: this.config.systemPublicKey, 
          permissions: types.Permissions.all() // System has all permissions
        },
        { 
          key: player1Pubkey, 
          permissions: types.Permissions.fromPermissions([types.Permission.Vote]) // Player can vote
        },
        { 
          key: player2Pubkey, 
          permissions: types.Permissions.fromPermissions([types.Permission.Vote]) // Player can vote
        },
      ];

      // Diagnostics
      enhancedLogger.info('🧪 Squads create diagnostics', {
        programId: PROGRAM_ID.toString(),
        multisigPda: multisigPda.toString(),
        members: squadsMembers.map(m => ({ 
          key: m.key.toString(), 
          permissions: m.permissions.toString() // Permissions object as string
        })),
        threshold: this.config.threshold,
        feePayer: createKey.publicKey.toString(),
        creator: createKey.publicKey.toString(),
        configAuthority: this.config.systemPublicKey.toString(),
        treasury: treasury?.toString() || 'null',
        rentCollector: 'null',
      });

      // Extra strict parameter object (no undefined)
      const paramsPreview = {
        connection: '[Connection]',
        createKey: '[Keypair]',
        creator: '[Keypair]',
        multisigPda: multisigPda.toString(),
        configAuthority: this.config.systemPublicKey.toString(),
        timeLock: 0,
        members: squadsMembers.map(m => ({ 
          key: m.key.toString(), 
          permissions: m.permissions.toString() 
        })),
        threshold: this.config.threshold,
        rentCollector: 'null',
        treasury: treasury?.toString() || 'null',
        sendOptions: '{ skipPreflight: true }',
      };
      enhancedLogger.info('🧾 Squads v2 param preview', paramsPreview);

      // Create the multisig using v2 API (recommended by Squads docs for v4 protocol)
      let signature: string;
      try {
        // Use v2 API which is the current recommended approach for Squads Protocol v4
        // Reference: https://docs.squads.so/main/development
        signature = await rpc.multisigCreateV2({
          connection: this.connection,
          createKey, // Keypair for derivation
          creator: createKey, // Keypair that signs and pays fees
          multisigPda, // Explicitly pass the derived PDA
          configAuthority: this.config.systemPublicKey,
          timeLock: 0,
          members: squadsMembers,
          threshold: this.config.threshold,
          rentCollector: null, // Can be null or a PublicKey
          treasury: treasury, // From ProgramConfig or null
          sendOptions: { skipPreflight: true }, // Recommended by docs
        });
      } catch (createErr: any) {
        enhancedLogger.error('❌ multisigCreateV2 failed', {
          matchId,
          error: createErr?.message || String(createErr),
          stack: createErr?.stack,
          details: {
            programId: PROGRAM_ID.toString(),
            multisigPda: multisigPda.toString(),
            members: squadsMembers.map(m => ({ 
              key: m.key.toString(), 
              permissions: m.permissions.toString() 
            })),
            threshold: this.config.threshold,
            creator: createKey.publicKey.toString(),
            configAuthority: this.config.systemPublicKey.toString(),
            treasury: treasury?.toString() || 'null',
            rentCollector: 'null',
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
      
      // Create transfer instructions using SystemProgram
      const winnerLamports = Math.floor(winnerAmount * LAMPORTS_PER_SOL);
      const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
      
      // Create System Program transfer instruction for winner
      const winnerTransferIx = SystemProgram.transfer({
        fromPubkey: multisigAddress,
        toPubkey: winner,
        lamports: winnerLamports,
      });
      
      // Create System Program transfer instruction for fee
      const feeTransferIx = SystemProgram.transfer({
        fromPubkey: multisigAddress,
        toPubkey: feeWallet,
        lamports: feeLamports,
      });
      
      // Create transaction message and compile to V0
      const blockhash = (await this.connection.getLatestBlockhash()).blockhash;
      const transactionMessage = new TransactionMessage({
        payerKey: multisigAddress,
        recentBlockhash: blockhash,
        instructions: [winnerTransferIx, feeTransferIx],
      });
      
      // Compile to V0 message - Squads SDK needs compiled V0 message
      const compiledMessage = transactionMessage.compileToV0Message();
      
      // Create the Squads vault transaction
      enhancedLogger.info('📝 Creating vault transaction...', {
        multisigAddress: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        winner: winner.toString(),
        winnerAmount,
      });
      
      let signature: string;
      try {
        signature = await rpc.vaultTransactionCreate({
          connection: this.connection,
// @ts-ignore - feePayer type mismatch but works at runtime
          feePayer: this.config.systemPublicKey, // System pays for transaction creation
          multisigPda: multisigAddress,
          transactionIndex,
          creator: this.config.systemPublicKey,
          vaultIndex: 0, // First vault
          ephemeralSigners: 0, // No ephemeral signers needed
// @ts-ignore - compiledMessage (MessageV0) works at runtime despite type mismatch
          transactionMessage: compiledMessage,
          memo: `Winner payout: ${winner.toString()}`,
        });
      } catch (createError: any) {
        enhancedLogger.error('❌ vaultTransactionCreate failed', {
          error: createError?.message || String(createError),
          stack: createError?.stack,
          vaultAddress,
          winner: winner.toString(),
        });
        throw createError;
      }
      
      // Generate a numeric proposal ID for frontend compatibility
      const proposalId = transactionIndex.toString();
      
      enhancedLogger.info('✅ Vault transaction created successfully', {
        signature,
        proposalId,
      });
      
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
      
      // Create transfer instructions using SystemProgram
      const refundLamports = Math.floor(refundAmount * LAMPORTS_PER_SOL);
      
      // Create System Program transfer instruction for player 1
      const player1TransferIx = SystemProgram.transfer({
        fromPubkey: multisigAddress,
        toPubkey: player1,
        lamports: refundLamports,
      });
      
      // Create System Program transfer instruction for player 2
      const player2TransferIx = SystemProgram.transfer({
        fromPubkey: multisigAddress,
        toPubkey: player2,
        lamports: refundLamports,
      });
      
      // Create transaction message and compile to V0
      const blockhash2 = (await this.connection.getLatestBlockhash()).blockhash;
      const transactionMessage = new TransactionMessage({
        payerKey: multisigAddress,
        recentBlockhash: blockhash2,
        instructions: [player1TransferIx, player2TransferIx],
      });
      
      // Compile to V0 message - Squads SDK needs compiled V0 message
      const compiledMessage2 = transactionMessage.compileToV0Message();
      
      // Create the Squads vault transaction
      let signature: string;
      try {
        signature = await rpc.vaultTransactionCreate({
          connection: this.connection,
// @ts-ignore - feePayer type mismatch but works at runtime
          feePayer: this.config.systemPublicKey, // System pays for transaction creation
          multisigPda: multisigAddress,
          transactionIndex,
          creator: this.config.systemPublicKey,
          vaultIndex: 0, // First vault
          ephemeralSigners: 0, // No ephemeral signers needed
// @ts-ignore - compiledMessage2 (MessageV0) works at runtime despite type mismatch
          transactionMessage: compiledMessage2,
          memo: `Tie refund: ${player1.toString()}, ${player2.toString()}`,
        });
      } catch (createError: any) {
        enhancedLogger.error('❌ vaultTransactionCreate failed for tie refund', {
          error: createError?.message || String(createError),
          stack: createError?.stack,
          vaultAddress,
          player1: player1.toString(),
          player2: player2.toString(),
        });
        throw createError;
      }
      
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
      const signers: PublicKey[] = []; // No signers yet
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
   * Approve a Squads vault transaction proposal
   * This allows players (multisig members) to sign proposals
   */
  async approveProposal(
    vaultAddress: string,
    proposalId: string,
    signer: Keypair
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const transactionIndex = BigInt(proposalId);

      enhancedLogger.info('📝 Approving Squads proposal', {
        vaultAddress,
        proposalId,
        signer: signer.publicKey.toString(),
      });

      // Use rpc.vaultTransactionApprove to approve the transaction
      // @ts-ignore - vaultTransactionApprove exists in runtime but not in types
      const signature = await rpc.vaultTransactionApprove({
        connection: this.connection,
        feePayer: signer.publicKey,
        multisigPda: multisigAddress,
        transactionIndex,
        member: signer,
      });

      enhancedLogger.info('✅ Proposal approved', {
        vaultAddress,
        proposalId,
        signer: signer.publicKey.toString(),
        signature,
      });

      return { success: true, signature };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to approve proposal', {
        vaultAddress,
        proposalId,
        signer: signer.publicKey.toString(),
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Sign a proposal (for system signatures) - DEPRECATED, use approveProposal instead
   */
  async signProposal(
    vaultAddress: string,
    proposalId: string,
    signer: PublicKey
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Only allow system to use this deprecated method
      if (!signer.equals(this.config.systemPublicKey)) {
        return {
          success: false,
          error: 'Only system can sign proposals from backend. Use approveProposal for player signatures.',
        };
      }

      const feeWalletKeypair = getFeeWalletKeypair();
      return await this.approveProposal(vaultAddress, proposalId, feeWalletKeypair);

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
        
        // Initialize Redis game state for active gameplay
        try {
          const newGameState = {
            startTime: Date.now(),
            player1StartTime: Date.now(),
            player2StartTime: Date.now(),
            player1Guesses: [],
            player2Guesses: [],
            player1Solved: false,
            player2Solved: false,
            word: match.word,
            matchId: matchId,
            lastActivity: Date.now(),
            completed: false
          };
          await setGameState(matchId, newGameState);
          enhancedLogger.info('✅ Redis game state initialized for match', {
            matchId,
            word: match.word,
          });
        } catch (gameStateError: unknown) {
          const errorMessage = gameStateError instanceof Error ? gameStateError.message : String(gameStateError);
          enhancedLogger.error('❌ Failed to initialize Redis game state', {
            matchId,
            error: errorMessage,
          });
          // Continue anyway - game state can be reinitialized by getGameStateHandler if needed
        }
        
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
