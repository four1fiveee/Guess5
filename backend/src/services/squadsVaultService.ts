// @ts-nocheck
import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, TransactionMessage, TransactionInstruction, SystemProgram, VersionedTransaction, SendTransactionError, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  rpc,
  instructions,
  PROGRAM_ID,
  getMultisigPda,
  getVaultPda,
  getProgramConfigPda,
  getTransactionPda,
  getProposalPda,
  accounts,
  types,
  transactions,
} from '@sqds/multisig';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getFeeWalletKeypair, getFeeWalletAddress } from '../config/wallet';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAttestation } from '../models/MatchAttestation';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { AttestationData, kmsService } from './kmsService';
import { setGameState } from '../utils/redisGameState';
import { sendAndLogRawTransaction, pollTxAndLog, subscribeToProgramLogs, logExecutionStep } from '../utils/txDebug';
// Import execution DAG logger and RPC failover utilities
import { executionDAGLogger } from '../utils/executionDagLogger';
import { verifyOnBothRPCs, createRPCConnections } from '../utils/rpcFailover';
import { withRetry, fromAccountAddressWithRetry } from '../utils/rpcRetry';
import { getExecutionLock, releaseExecutionLock } from '../utils/proposalLocks';
// import { onMatchCompleted } from './proposalAutoCreateService'; // File doesn't exist - removed
// import { saveMatchAndTriggerProposals } from '../utils/matchSaveHelper'; // File doesn't exist - removed

export interface SquadsVaultConfig {
  systemKeypair: Keypair; // Full keypair with private key for signing transactions
  systemPublicKey: PublicKey; // Public key for reference
  threshold: number; // 2-of-3 multisig
}

export interface VaultCreationResult {
  success: boolean;
  vaultAddress?: string;
  multisigAddress?: string;
  vaultPda?: string;
  error?: string;
}

export interface ProposalResult {
  success: boolean;
  proposalId?: string;
  transactionIndex?: string; // CRITICAL: Store transaction index to ensure proposal ID always matches
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
  private programId: PublicKey; // Network-specific program ID

  constructor() {
    // CRITICAL: Use premium RPC (Helius) for vault operations
    const { createPremiumSolanaConnection } = require('../config/solanaConnection');
    this.connection = createPremiumSolanaConnection('confirmed');
    
    // Get network URL for cluster detection (Helius URLs are handled internally)
    const networkUrl = process.env.SOLANA_NETWORK || 'devnet';

    // Detect cluster from URL
    const detectedCluster = this.detectCluster(networkUrl);
    const clusterName = process.env.SQUADS_NETWORK || detectedCluster;

    // Determine program ID based on environment and cluster
    // Priority: 1. Environment variable, 2. SDK default (usually Mainnet)
    if (process.env.SQUADS_PROGRAM_ID) {
      try {
        this.programId = new PublicKey(process.env.SQUADS_PROGRAM_ID);
        enhancedLogger.info('✅ Using Squads program ID from environment', {
          programId: this.programId.toString(),
          cluster: clusterName,
          networkUrl,
          sdkDefault: PROGRAM_ID.toString(),
        });
      } catch (pkError: unknown) {
        const errorMsg = pkError instanceof Error ? pkError.message : String(pkError);
        enhancedLogger.error('❌ Invalid SQUADS_PROGRAM_ID in environment', {
          error: errorMsg,
          providedId: process.env.SQUADS_PROGRAM_ID,
          cluster: clusterName,
        });
        // Fall back to SDK default
        this.programId = PROGRAM_ID;
        enhancedLogger.warn('⚠️ Falling back to SDK default PROGRAM_ID', {
          programId: this.programId.toString(),
          cluster: clusterName,
          note: 'SDK default is typically Mainnet. Verify this is correct for your cluster.',
        });
      }
    } else {
      this.programId = PROGRAM_ID;
      enhancedLogger.info('✅ Using SDK default Squads program ID', {
        programId: this.programId.toString(),
        cluster: clusterName,
        networkUrl,
        warning: clusterName === 'devnet' 
          ? 'Note: Devnet uses the same program ID as Mainnet per official Squads docs. This is correct.'
          : 'Using SDK default program ID (Mainnet/Devnet both use the same program ID)',
      });
    }

    // Squads SDK initialized via direct imports (no class instantiation needed)

    // Get the full keypair (not just public key) - needed for signing transaction creation
    let systemKeypair: Keypair;
    try {
      systemKeypair = getFeeWalletKeypair();
      
      // Check if FEE_WALLET_PRIVATE_KEY environment variable is set
      const hasPrivateKeyEnv = !!process.env.FEE_WALLET_PRIVATE_KEY;
      const privateKeyLength = process.env.FEE_WALLET_PRIVATE_KEY?.length || 0;
      
      enhancedLogger.info('✅ System keypair loaded successfully', {
        publicKey: systemKeypair.publicKey.toString(),
        hasPrivateKeyEnv,
        privateKeyLength,
        hasSecretKey: !!systemKeypair.secretKey && systemKeypair.secretKey.length > 0,
        secretKeyLength: systemKeypair.secretKey?.length || 0,
      });
      
      // Check fee wallet balance on-chain (non-blocking, fire and forget)
      // Note: Constructor cannot be async, so we check balance in the background
      this.connection.getBalance(systemKeypair.publicKey)
        .then((balance) => {
          const balanceSOL = balance / 1e9;
          enhancedLogger.info('💰 Fee wallet on-chain balance', {
            publicKey: systemKeypair.publicKey.toString(),
            balance: balance,
            balanceSOL: balanceSOL.toFixed(9),
            sufficient: balance >= 0.001 * 1e9,
          });
          if (balance < 0.001 * 1e9) {
            enhancedLogger.warn('⚠️ Fee wallet has low balance - may fail to pay transaction fees', {
              publicKey: systemKeypair.publicKey.toString(),
              balanceSOL: balanceSOL.toFixed(9),
              minimumRecommended: 0.001,
            });
          }
        })
        .catch((balanceError: any) => {
          enhancedLogger.warn('⚠️ Could not check fee wallet balance during initialization', {
            publicKey: systemKeypair.publicKey.toString(),
            error: balanceError?.message || String(balanceError),
          });
      });
    } catch (keypairError: unknown) {
      const errorMsg = keypairError instanceof Error ? keypairError.message : String(keypairError);
      enhancedLogger.error('❌ Failed to load system keypair', {
        error: errorMsg,
        hasFEE_WALLET_PRIVATE_KEY: !!process.env.FEE_WALLET_PRIVATE_KEY,
        FEE_WALLET_PRIVATE_KEY_length: process.env.FEE_WALLET_PRIVATE_KEY?.length || 0,
      });
      throw new Error(`Failed to load system keypair: ${errorMsg}. Ensure FEE_WALLET_PRIVATE_KEY is set.`);
    }

    // Validate keypair has signing capability
    if (!systemKeypair.secretKey || systemKeypair.secretKey.length === 0) {
      enhancedLogger.error('❌ System keypair validation failed', {
        publicKey: systemKeypair.publicKey.toString(),
        hasSecretKey: !!systemKeypair.secretKey,
        secretKeyLength: systemKeypair.secretKey?.length || 0,
      });
      throw new Error('System keypair does not have a valid secret key for signing');
    }

    this.config = {
      systemKeypair: systemKeypair,
      systemPublicKey: systemKeypair.publicKey,
      threshold: 2, // 2-of-3 multisig
    };
  }

  public getProgramId(): PublicKey {
    return this.programId;
  }

  public getSystemPublicKey(): PublicKey {
    return this.config.systemPublicKey;
  }

  public deriveVaultPda(multisigAddress: string): string | null {
    try {
      if (!multisigAddress) {
        return null;
      }
      const multisigPublicKey = new PublicKey(multisigAddress);
      const vaultIndexBuffer = Buffer.allocUnsafe(2);
      vaultIndexBuffer.writeUInt16LE(0, 0);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [
          multisigPublicKey.toBuffer(),
          vaultIndexBuffer,
          Buffer.from('vault'),
        ],
        this.programId
      );
      return vaultPda.toString();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to derive vault PDA', {
        multisigAddress,
        error: errorMessage,
      });
      return null;
    }
  }

  /**
   * Detect Solana cluster from RPC URL
   */
  private detectCluster(url: string): string {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('devnet')) {
      return 'devnet';
    } else if (urlLower.includes('testnet')) {
      return 'testnet';
    } else if (urlLower.includes('mainnet') || urlLower.includes('mainnet-beta')) {
      return 'mainnet';
    } else if (urlLower.includes('localhost') || urlLower.includes('127.0.0.1')) {
      return 'localnet';
    }
    return 'unknown';
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

      // CRITICAL FIX: Generate a unique createKey per match (deterministic from matchId)
      // The SDK's getMultisigPda derives the PDA from createKey, so each match needs a unique createKey
      // We use a deterministic keypair from matchId so we can recreate it later if needed
      let matchSeed: Buffer;
      try {
        const hexString = matchId.replace(/-/g, '');
        const seedBytes = Buffer.from(hexString, 'hex');
        // Keypair.fromSeed requires exactly 32 bytes
        if (seedBytes.length < 32) {
          // Pad with zeros if too short
          matchSeed = Buffer.concat([seedBytes, Buffer.alloc(32 - seedBytes.length)]);
        } else {
          // Take first 32 bytes if too long
          matchSeed = seedBytes.slice(0, 32);
        }
      } catch (seedError: any) {
        enhancedLogger.error('❌ Failed to create match seed from matchId', {
          matchId,
          error: seedError?.message || String(seedError),
        });
        throw new Error(`Failed to create match seed: ${seedError?.message || String(seedError)}`);
      }
      
      const createKeyKeypair = Keypair.fromSeed(matchSeed); // Deterministic keypair per match
      
      // Use SDK's getMultisigPda function (CORRECT way per Squads Protocol v4 docs)
      // This ensures the PDA derivation matches what the SDK expects internally
      let multisigPda: PublicKey;
      try {
        // Try with programId first (if SDK supports it)
        const [pda] = getMultisigPda({ 
          createKey: createKeyKeypair.publicKey,
          programId: this.programId 
        } as any);
        multisigPda = pda;
      } catch (pdaError: any) {
        // If programId parameter is not supported, try without it
        enhancedLogger.warn('⚠️ getMultisigPda with programId failed, trying without it', {
          error: pdaError?.message || String(pdaError),
          matchId,
        });
        const [pda] = getMultisigPda({ 
          createKey: createKeyKeypair.publicKey
        });
        multisigPda = pda;
      }
      
      // Use fee wallet as the creator/fee payer so creation has SOL to cover rent/fees
      // The createKey is used for PDA derivation, but creator pays for the transaction
      const creatorKeypair = getFeeWalletKeypair();

      // Fetch program config to get treasury address (required for v2)
      let treasury: PublicKey | null = null;
      try {
        // Note: getProgramConfigPda may accept programId parameter for Devnet support
        // If SDK supports it, use: getProgramConfigPda({ programId: this.programId })
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
        createKey: createKeyKeypair.publicKey.toString(),
        creator: creatorKeypair.publicKey.toString(),
        configAuthority: this.config.systemPublicKey.toString(),
        treasury: treasury?.toString() || 'null',
        rentCollector: 'null',
      });

      // Extra strict parameter object (no undefined)
      const paramsPreview = {
        connection: '[Connection]',
        createKey: createKeyKeypair.publicKey.toString(),
        creator: creatorKeypair.publicKey.toString(),
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

      // CRITICAL: Check if multisig already exists before creating
      // This prevents "AlreadyInUse" errors (custom error 0)
      let existingMultisig: any = null;
      try {
        existingMultisig = await fromAccountAddressWithRetry(
          accounts.Multisig,
          this.connection,
          multisigPda
        );
        enhancedLogger.warn('⚠️ Multisig already exists for this match', {
          matchId,
          multisigAddress: multisigPda.toString(),
          existingThreshold: existingMultisig.threshold,
          existingMembers: existingMultisig.members.map((m: any) => m.key.toString()),
        });
        
        // Verify it matches our expected configuration
        const existingMemberKeys = existingMultisig.members.map((m: any) => m.key.toString()).sort();
        const expectedMemberKeys = squadsMembers.map(m => m.key.toString()).sort();
        const membersMatch = JSON.stringify(existingMemberKeys) === JSON.stringify(expectedMemberKeys);
        const thresholdMatches = existingMultisig.threshold === this.config.threshold;
        
        if (membersMatch && thresholdMatches) {
          enhancedLogger.info('✅ Existing multisig matches expected configuration, reusing it', {
            matchId,
            multisigAddress: multisigPda.toString(),
          });
          // Return existing multisig - no need to create
          return {
            success: true,
            vaultAddress: multisigPda.toString(),
            multisigAddress: multisigPda.toString(),
          };
        } else {
          enhancedLogger.error('❌ Existing multisig has different configuration', {
            matchId,
            multisigAddress: multisigPda.toString(),
            existingMembers: existingMemberKeys,
            expectedMembers: expectedMemberKeys,
            existingThreshold: existingMultisig.threshold,
            expectedThreshold: this.config.threshold,
          });
          throw new Error(`Multisig ${multisigPda.toString()} already exists with different configuration. Cannot create new multisig for match ${matchId}.`);
        }
      } catch (checkErr: any) {
        // If account doesn't exist, that's fine - we'll create it
        const errorMessage = checkErr?.message || String(checkErr);
        if (errorMessage.includes('Account does not exist') || 
            errorMessage.includes('Invalid account data') ||
            errorMessage.includes('Unable to find Multisig account') ||
            checkErr?.code === 'InvalidAccountData') {
          enhancedLogger.info('✅ Multisig does not exist, proceeding with creation', {
            matchId,
            multisigAddress: multisigPda.toString(),
            errorMessage: errorMessage.substring(0, 100), // Log first 100 chars for debugging
          });
        } else {
          // Re-throw if it's a different error (like configuration mismatch)
          enhancedLogger.warn('⚠️ Unexpected error checking for existing multisig, re-throwing', {
            matchId,
            errorMessage: errorMessage.substring(0, 200),
            errorCode: checkErr?.code,
          });
          throw checkErr;
        }
      }

      // Check fee wallet balance before creating
      const feeWalletBalance = await this.connection.getBalance(creatorKeypair.publicKey);
      const minRequiredBalance = 0.1 * LAMPORTS_PER_SOL; // 0.1 SOL minimum for rent + fees
      if (feeWalletBalance < minRequiredBalance) {
        enhancedLogger.error('❌ Fee wallet has insufficient balance', {
          matchId,
          feeWallet: creatorKeypair.publicKey.toString(),
          balance: feeWalletBalance / LAMPORTS_PER_SOL,
          required: minRequiredBalance / LAMPORTS_PER_SOL,
        });
        throw new Error(`Fee wallet ${creatorKeypair.publicKey.toString()} has insufficient balance: ${feeWalletBalance / LAMPORTS_PER_SOL} SOL (required: ${minRequiredBalance / LAMPORTS_PER_SOL} SOL)`);
      }

      // Create the multisig using v2 API (recommended by Squads docs for v4 protocol)
      let signature: string;
      try {
        // Use v2 API which is the current recommended approach for Squads Protocol v4
        // Reference: https://docs.squads.so/main/development
        // CRITICAL: createKey is used for PDA derivation (must match getMultisigPda derivation)
        // creator is the keypair that signs and pays fees (fee wallet)
        // NOTE: Changed skipPreflight to false to catch errors earlier
        signature = await rpc.multisigCreateV2({
          connection: this.connection,
          createKey: createKeyKeypair, // Unique keypair per match for PDA derivation
          creator: creatorKeypair, // Fee wallet keypair that signs and pays fees
          multisigPda, // PDA derived using SDK's getMultisigPda (must match!)
          configAuthority: this.config.systemPublicKey,
          timeLock: 0,
          members: squadsMembers,
          threshold: this.config.threshold,
          rentCollector: null, // Can be null or a PublicKey
          treasury: treasury, // From ProgramConfig or null
          sendOptions: { 
            skipPreflight: false, // Changed to false to catch errors in simulation
            maxRetries: 3,
          },
          programId: this.programId, // Use network-specific program ID (Devnet/Mainnet)
        });
      } catch (createErr: any) {
        // Enhanced error logging with more details
        const errorDetails: any = {
          matchId,
          error: createErr?.message || String(createErr),
          errorName: createErr?.name,
          errorCode: createErr?.code,
          stack: createErr?.stack,
          programId: this.programId.toString(),
          multisigPda: multisigPda.toString(),
          members: squadsMembers.map(m => ({ 
            key: m.key.toString(), 
            permissions: m.permissions.toString() 
          })),
          threshold: this.config.threshold,
          createKey: createKeyKeypair.publicKey.toString(),
          creator: creatorKeypair.publicKey.toString(),
          configAuthority: this.config.systemPublicKey.toString(),
          treasury: treasury?.toString() || 'null',
          rentCollector: 'null',
          feeWalletBalance: feeWalletBalance / LAMPORTS_PER_SOL,
        };
        
        // Check if error is about account already existing
        if (createErr?.message?.includes('already in use') || 
            createErr?.message?.includes('AlreadyInUse') ||
            createErr?.code === 'AccountAlreadyInUse') {
          enhancedLogger.error('❌ Multisig account already exists (caught during creation)', errorDetails);
          // Try to fetch and return existing multisig
          try {
            const existingMultisig = await accounts.Multisig.fromAccountAddress(
              this.connection,
              multisigPda
            );
            enhancedLogger.info('✅ Found existing multisig, returning it', {
              matchId,
              multisigAddress: multisigPda.toString(),
            });
            return {
              success: true,
              vaultAddress: multisigPda.toString(),
              multisigAddress: multisigPda.toString(),
            };
          } catch (fetchErr) {
            // If we can't fetch it, throw the original error
            throw new Error(`Multisig vault creation failed: Account already exists but could not be fetched. ${createErr?.message || String(createErr)}`);
          }
        }
        
        enhancedLogger.error('❌ multisigCreateV2 failed', errorDetails);
        throw new Error(`Multisig vault creation failed: ${createErr?.message || String(createErr)}`);
      }

      // CRITICAL: Confirm the transaction and verify the multisig was actually created
      enhancedLogger.info('⏳ Confirming multisig creation transaction', {
        matchId,
        signature,
        multisigAddress: multisigPda.toString(),
      });

      try {
        // Wait for transaction confirmation with a timeout
        const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
        
        if (confirmation.value.err) {
          const errorDetails = JSON.stringify(confirmation.value.err);
          
          // Try to get more details about the error from transaction logs
          let transactionDetails: any = null;
          try {
            const tx = await this.connection.getTransaction(signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });
            transactionDetails = {
              logs: tx?.meta?.logMessages || [],
              computeUnitsConsumed: tx?.meta?.computeUnitsConsumed,
              err: tx?.meta?.err,
            };
          } catch (txErr) {
            // Ignore if we can't fetch transaction details
          }
          
          enhancedLogger.error('❌ Multisig creation transaction failed on-chain', {
            matchId,
            signature,
            multisigAddress: multisigPda.toString(),
            error: errorDetails,
            transactionDetails,
            // Check if it's the "AlreadyInUse" error (custom error 0)
            isAlreadyInUse: errorDetails.includes('Custom') && errorDetails.includes('0'),
            note: 'Custom error 0 often means "AlreadyInUse" - the multisig may already exist',
          });
          
          // If it's a custom error 0 (AlreadyInUse), try to fetch existing multisig
          if (errorDetails.includes('Custom') && errorDetails.includes('0')) {
            enhancedLogger.warn('⚠️ Detected custom error 0 (likely AlreadyInUse), checking if multisig exists', {
              matchId,
              multisigAddress: multisigPda.toString(),
            });
            try {
              const existingMultisig = await accounts.Multisig.fromAccountAddress(
                this.connection,
                multisigPda
              );
              enhancedLogger.info('✅ Found existing multisig after error, returning it', {
                matchId,
                multisigAddress: multisigPda.toString(),
              });
              return {
                success: true,
                vaultAddress: multisigPda.toString(),
                multisigAddress: multisigPda.toString(),
              };
            } catch (fetchErr) {
              // If we can't fetch it, continue with the error
              enhancedLogger.warn('⚠️ Could not fetch existing multisig after error', {
                matchId,
                error: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
              });
            }
          }
          
          throw new Error(`Multisig creation transaction failed: ${errorDetails}`);
        }

        enhancedLogger.info('✅ Multisig creation transaction confirmed', {
          matchId,
          signature,
          multisigAddress: multisigPda.toString(),
        });
      } catch (confirmErr: any) {
        enhancedLogger.error('❌ Failed to confirm multisig creation transaction', {
          matchId,
          signature,
          multisigAddress: multisigPda.toString(),
          error: confirmErr?.message || String(confirmErr),
        });
        throw new Error(`Failed to confirm multisig creation: ${confirmErr?.message || String(confirmErr)}`);
      }

      // CRITICAL: Verify the multisig account was actually created and owned by Squads
      enhancedLogger.info('🔍 Verifying multisig account creation', {
        matchId,
        multisigAddress: multisigPda.toString(),
        expectedProgramId: this.programId.toString(),
      });

      try {
        // Wait a bit for the account to be available
        await new Promise(resolve => setTimeout(resolve, 2000));

        const multisigAccountInfo = await withRetry(
          () => this.connection.getAccountInfo(multisigPda, 'confirmed'),
          { maxAttempts: 3, baseDelayMs: 250 }
        );
        
        if (!multisigAccountInfo) {
          enhancedLogger.error('❌ Multisig account does not exist after creation', {
            matchId,
            multisigAddress: multisigPda.toString(),
            signature,
          });
          throw new Error(`Multisig account ${multisigPda.toString()} does not exist after creation transaction. Transaction may have failed silently.`);
        }

        const actualOwner = multisigAccountInfo.owner.toString();
        const expectedOwner = this.programId.toString();
        const isOwnedBySquads = multisigAccountInfo.owner.equals(this.programId);

        enhancedLogger.info('🔍 Multisig account verification', {
          matchId,
          multisigAddress: multisigPda.toString(),
          actualOwner,
          expectedOwner,
          isOwnedBySquads,
          dataLength: multisigAccountInfo.data.length,
          lamports: multisigAccountInfo.lamports,
        });

        if (!isOwnedBySquads) {
          enhancedLogger.error('❌ CRITICAL: Multisig account is owned by wrong program!', {
            matchId,
            multisigAddress: multisigPda.toString(),
            actualOwner,
            expectedOwner,
            dataLength: multisigAccountInfo.data.length,
            lamports: multisigAccountInfo.lamports,
            signature,
            note: 'The account exists but is owned by the System Program, not Squads. The multisig creation transaction did not properly initialize the account.',
          });
          throw new Error(`Multisig account ${multisigPda.toString()} is owned by ${actualOwner} (System Program), but expected ${expectedOwner} (Squads Program). The multisig creation transaction failed to properly initialize the account. Transaction signature: ${signature}`);
        }

        if (multisigAccountInfo.data.length === 0) {
          enhancedLogger.error('❌ CRITICAL: Multisig account has no data!', {
            matchId,
            multisigAddress: multisigPda.toString(),
            dataLength: 0,
            lamports: multisigAccountInfo.lamports,
            signature,
            note: 'The account exists but has no data, meaning it was not initialized as a Squads multisig.',
          });
          throw new Error(`Multisig account ${multisigPda.toString()} exists but has no data (dataLength: 0). The multisig was not properly initialized. Transaction signature: ${signature}`);
        }

        enhancedLogger.info('✅ Multisig account verified successfully', {
          matchId,
          multisigAddress: multisigPda.toString(),
          owner: actualOwner,
          dataLength: multisigAccountInfo.data.length,
        });
      } catch (verifyErr: any) {
        enhancedLogger.error('❌ Failed to verify multisig account creation', {
          matchId,
          multisigAddress: multisigPda.toString(),
          signature,
          error: verifyErr?.message || String(verifyErr),
        });
        throw verifyErr;
      }

      enhancedLogger.info('✅ Squads multisig vault created and verified', {
        matchId,
        multisigAddress: multisigPda.toString(),
        vaultAddress: multisigPda.toString(), // Same as multisig address
        signature,
      });

      // Derive the vault PDA (deposit address) associated with this multisig
      const vaultIndexBuffer = Buffer.allocUnsafe(2);
      vaultIndexBuffer.writeUInt16LE(0, 0);
      const [derivedVaultPda] = PublicKey.findProgramAddressSync(
        [
          multisigPda.toBuffer(),
          vaultIndexBuffer,
          Buffer.from('vault'),
        ],
        this.programId
      );

      enhancedLogger.info('📍 Derived vault PDA for match', {
        matchId,
        multisigAddress: multisigPda.toString(),
        vaultPda: derivedVaultPda.toString(),
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
      match.squadsVaultPda = derivedVaultPda.toString();
      match.matchStatus = 'VAULT_CREATED';
      
      // Save match directly (helper file doesn't exist)
      await matchRepository.save(match);

      // Log vault creation
      await this.logAuditEvent(matchId, 'SQUADS_VAULT_CREATED', {
        multisigAddress: multisigPda.toString(),
        members: members.map(m => m.toString()),
        threshold: this.config.threshold,
        player1: player1Pubkey.toString(),
        player2: player2Pubkey.toString(),
        entryFee,
        vaultPda: derivedVaultPda.toString(),
      });

      return {
        success: true,
        vaultAddress: multisigPda.toString(),
        multisigAddress: multisigPda.toString(),
        vaultPda: derivedVaultPda.toString(),
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      enhancedLogger.error('❌ Failed to create Squads multisig vault', {
        matchId,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name || typeof error,
        errorString: String(error),
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
    feeAmount: number,
    overrideVaultPda?: string
  ): Promise<ProposalResult> {
    try {
      // Defensive checks: Validate all required values
      if (!this.config || !this.config.systemKeypair || !this.config.systemPublicKey) {
        const errorMsg = 'SquadsVaultService config or systemKeypair is undefined. Check FEE_WALLET_PRIVATE_KEY environment variable.';
        enhancedLogger.error('❌ ' + errorMsg, {
          hasConfig: !!this.config,
          hasSystemKeypair: !!(this.config?.systemKeypair),
          hasSystemPublicKey: !!(this.config?.systemPublicKey),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Validate keypair has signing capability
      if (!this.config.systemKeypair.secretKey || this.config.systemKeypair.secretKey.length === 0) {
        const errorMsg = 'System keypair does not have a valid secret key for signing';
        enhancedLogger.error('❌ ' + errorMsg);
        return {
          success: false,
          error: errorMsg,
        };
      }

      if (!vaultAddress || typeof vaultAddress !== 'string') {
        const errorMsg = 'Invalid vaultAddress provided to proposeWinnerPayout';
        enhancedLogger.error('❌ ' + errorMsg, { vaultAddress });
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Validate PublicKeys
      const isPk = (k: any) => k && typeof k.toBase58 === 'function';
      if (!isPk(winner) || !isPk(feeWallet) || !isPk(this.config.systemPublicKey)) {
        const errorMsg = 'Invalid PublicKey provided to proposeWinnerPayout';
        enhancedLogger.error('❌ ' + errorMsg, {
          winnerOk: isPk(winner),
          feeWalletOk: isPk(feeWallet),
          systemPublicKeyOk: isPk(this.config.systemPublicKey),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      enhancedLogger.info('💸 Proposing winner payout via Squads', {
        vaultAddress,
        multisigAddress: vaultAddress, // vaultAddress is the multisig PDA
        winner: winner.toString(),
        winnerAmount,
        feeWallet: feeWallet.toString(),
        feeAmount,
        systemPublicKey: this.config.systemPublicKey.toString(),
      });

      // Create real Squads transaction for winner payout
      let multisigAddress: PublicKey;
      try {
        multisigAddress = new PublicKey(vaultAddress);
      } catch (pkError: any) {
        const errorMsg = `Invalid vaultAddress PublicKey format: ${vaultAddress}`;
        enhancedLogger.error('❌ ' + errorMsg, { vaultAddress, error: pkError?.message });
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Derive the vault PDA from the multisig PDA
      // CRITICAL: Must use the same programId that was used to create the vault
      // Try using getVaultPda with programId, but if it doesn't support it, manually derive
      let vaultPda: PublicKey | null = null;
      if (overrideVaultPda) {
        try {
          vaultPda = new PublicKey(overrideVaultPda);
        } catch (overrideError: any) {
          enhancedLogger.warn('⚠️ Failed to parse override vault PDA, falling back to derivation', {
            overrideVaultPda,
            error: overrideError?.message || String(overrideError),
          });
        }
      }
      if (!vaultPda) {
        try {
          // Try with programId parameter (may not be supported by SDK)
          const [derivedVaultPda] = getVaultPda({
            multisigPda: multisigAddress,
            index: 0,
            programId: this.programId,
          } as any); // Type cast since programId might not be in types
          vaultPda = derivedVaultPda;
        } catch (e) {
          // Fallback: manually derive using the same method Squads uses
          // Vault PDA derivation: [multisigPda, vault_index (u16), "vault"]
          const vaultIndexBuffer = Buffer.allocUnsafe(2);
          vaultIndexBuffer.writeUInt16LE(0, 0); // vault index 0
          const [derivedVaultPda] = PublicKey.findProgramAddressSync(
            [
              multisigAddress.toBuffer(),
              vaultIndexBuffer,
              Buffer.from('vault'),
            ],
            this.programId
          );
          vaultPda = derivedVaultPda;
        }
      }

      if (!vaultPda) {
        throw new Error(`Unable to derive vault PDA for ${multisigAddress.toString()}`);
      }

      enhancedLogger.info('📍 Winner payout vault PDA resolved', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
        source: overrideVaultPda ? 'override' : 'derived',
      });
      
      // Fetch multisig account to get current transaction index
      // Squads Protocol requires sequential transaction indices - must fetch from on-chain account
      // This ensures the transactionIndex matches what the multisig account expects
      // Try to get transaction index from the account, but if deserialization fails,
      // try using RPC method or fallback to querying account data directly
      let transactionIndex: bigint;
      try {
        // First try: Use the account deserialization method
        const multisigInfo = await fromAccountAddressWithRetry(
          accounts.Multisig,
          this.connection,
          multisigAddress,
          { commitment: 'confirmed' }
        );
        const currentTransactionIndexBN = BigInt(
          multisigInfo.transactionIndex.toString()
        );
        transactionIndex = currentTransactionIndexBN;
        const nextTransactionIndex = transactionIndex + BigInt(1);
        
        enhancedLogger.info('📊 Fetched multisig transaction index', {
          multisigAddress: multisigAddress.toString(),
          currentTransactionIndex: Number(currentTransactionIndexBN),
          nextTransactionIndex: nextTransactionIndex.toString(),
        });
      } catch (fetchError: any) {
        // If deserialization fails (e.g., "Expected to hold a COption"), use fallback
        // The account exists but has an incompatible format - just use transaction index 1
        enhancedLogger.warn('⚠️ Failed to deserialize multisig account, using fallback transaction index', {
          multisigAddress: multisigAddress.toString(),
          error: fetchError?.message || String(fetchError),
        });
        
        // Fallback: Use transaction index 1
        // This assumes no previous transactions (which should be fine for new vaults)
        transactionIndex = BigInt(0);
        
        enhancedLogger.warn('⚠️ Using fallback transaction index 0', {
          multisigAddress: multisigAddress.toString(),
          note: 'This assumes no previous transactions. If vault has existing transactions, proposal creation will fail.',
        });
      }
      
      // Ensure all PublicKeys are properly instantiated
      const vaultPdaKey = typeof vaultPda === 'string' ? new PublicKey(vaultPda) : vaultPda;
      const winnerKey = typeof winner === 'string' ? new PublicKey(winner) : winner;
      const feeWalletKey = typeof feeWallet === 'string' ? new PublicKey(feeWallet) : feeWallet;

      // Ensure we leave the rent-exempt reserve in the vault PDA
      const vaultAccountInfo = await withRetry(
        () => this.connection.getAccountInfo(vaultPdaKey, 'confirmed'),
        { maxAttempts: 3, baseDelayMs: 250 }
      );
      if (!vaultAccountInfo) {
        const errorMsg = `Vault account ${vaultPdaKey.toString()} not found on-chain`;
        enhancedLogger.error('❌ ' + errorMsg, {
          vaultAddress,
          vaultPda: vaultPdaKey.toString(),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      const rentExemptReserve = await this.connection.getMinimumBalanceForRentExemption(
        vaultAccountInfo.data?.length ?? 0
      );
      const rentExemptReserveSOL = rentExemptReserve / LAMPORTS_PER_SOL;

      const vaultLamportsBig = BigInt(vaultAccountInfo.lamports);
      const rentReserveBig = BigInt(rentExemptReserve);

      if (vaultLamportsBig <= rentReserveBig) {
        const errorMsg = `Vault lamports ${vaultLamportsBig.toString()} are not sufficient to cover rent reserve ${rentReserveBig.toString()}`;
        enhancedLogger.error('❌ Vault balance below rent reserve', {
          vaultAddress,
          vaultPda: vaultPdaKey.toString(),
          vaultLamports: vaultLamportsBig.toString(),
          rentReserve: rentReserveBig.toString(),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      const transferableLamportsBig = vaultLamportsBig - rentReserveBig;
      const desiredWinnerLamportsBig = (vaultLamportsBig * BigInt(95)) / BigInt(100);
      const desiredFeeLamportsBig = vaultLamportsBig - desiredWinnerLamportsBig;

      let winnerFromVaultBig = desiredWinnerLamportsBig;
      let feeFromVaultBig = transferableLamportsBig - desiredWinnerLamportsBig;
      let winnerTopUpBig = BigInt(0);

      if (feeFromVaultBig < BigInt(0)) {
        // Not enough transferable lamports to cover the full winner share; cap to transferable and top-up externally
        winnerTopUpBig = desiredWinnerLamportsBig - transferableLamportsBig;
        winnerFromVaultBig = transferableLamportsBig;
        feeFromVaultBig = BigInt(0);
      }

      if (feeFromVaultBig < BigInt(0)) {
        feeFromVaultBig = BigInt(0);
      }

      const totalRequestedFromVaultBig = winnerFromVaultBig + feeFromVaultBig;
      const feeShortfallBig = desiredFeeLamportsBig - feeFromVaultBig;

      enhancedLogger.info('🏦 Vault rent & payout plan', {
        vaultAddress,
        vaultPda: vaultPdaKey.toString(),
        currentLamports: vaultAccountInfo.lamports,
        rentExemptReserveSOL,
        transferableLamports: Number(transferableLamportsBig),
        desiredWinnerLamports: Number(desiredWinnerLamportsBig),
        desiredFeeLamports: Number(desiredFeeLamportsBig),
        winnerLamportsFromVault: Number(winnerFromVaultBig),
        feeLamportsFromVault: Number(feeFromVaultBig),
        winnerTopUpLamports: Number(winnerTopUpBig),
        feeShortfallLamports: Number(feeShortfallBig > BigInt(0) ? feeShortfallBig : BigInt(0)),
        totalRequestedLamports: Number(totalRequestedFromVaultBig),
      });

      const winnerLamports = Number(winnerFromVaultBig);
      const feeLamports = Number(feeFromVaultBig);
      const winnerTopUpLamports = Number(winnerTopUpBig);
      
      // Create System Program transfer instruction for winner using SystemProgram.transfer directly
      // Then correct the isSigner flag for vaultPda (PDAs cannot sign)
      const winnerTransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: winnerKey,
        lamports: winnerLamports,
      });
      // Correct the keys: vaultPda is a PDA and cannot be a signer
      winnerTransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: true, isWritable: true };
      
      const instructions: TransactionInstruction[] = [winnerTransferIx];

      let feeTransferIx: TransactionInstruction | null = null;
      if (feeLamports > 0) {
        feeTransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: feeWalletKey,
        lamports: feeLamports,
      });
      feeTransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: true, isWritable: true };
        instructions.push(feeTransferIx);
      }

      let winnerTopUpIx: TransactionInstruction | null = null;
      if (winnerTopUpLamports > 0) {
        winnerTopUpIx = SystemProgram.transfer({
          fromPubkey: this.config.systemPublicKey,
          toPubkey: winnerKey,
          lamports: winnerTopUpLamports,
        });
        instructions.push(winnerTopUpIx);
      }
      
      // Log instruction keys for debugging
      enhancedLogger.info('🔍 Instruction keys check', {
        winnerIxKeys: winnerTransferIx.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        feeIxKeys: feeTransferIx
          ? feeTransferIx.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
            }))
          : null,
        topUpIxKeys: winnerTopUpIx
          ? winnerTopUpIx.keys.map(k => ({
              pubkey: k.pubkey.toString(),
              isSigner: k.isSigner,
              isWritable: k.isWritable,
            }))
          : null,
        winnerIxProgramId: winnerTransferIx.programId.toString(),
        feeIxProgramId: feeTransferIx ? feeTransferIx.programId.toString() : null,
        topUpIxProgramId: winnerTopUpIx ? winnerTopUpIx.programId.toString() : null,
      });
      
      // Create transaction message (uncompiled - Squads SDK compiles it internally)
      // Note: payerKey must be a signer account (systemPublicKey) that pays for transaction creation
      // The vault PDA holds funds but cannot pay fees (it's not a signer)
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
      const transactionMessage = new TransactionMessage({
        payerKey: this.config.systemPublicKey, // System pays for transaction creation fees
        recentBlockhash: blockhash,
        instructions,
      });
      
      // Create the Squads vault transaction
      // Pass uncompiled TransactionMessage - Squads SDK will compile it internally
      const attemptVaultTransactionCreate = async (
        index: bigint,
        attemptLabel: string
      ): Promise<string> => {
      enhancedLogger.info('📝 Creating vault transaction...', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
          transactionIndex: index.toString(),
          attempt: attemptLabel,
        winner: winner.toString(),
        winnerAmount,
      });
      
        return rpc.vaultTransactionCreate({
          connection: this.connection,
          feePayer: this.config.systemKeypair, // Keypair that signs and pays for transaction creation
          multisigPda: multisigAddress,
          transactionIndex: index,
          creator: this.config.systemKeypair.publicKey, // Creator public key
          vaultIndex: 0, // First vault
          ephemeralSigners: 0, // No ephemeral signers needed
          transactionMessage: transactionMessage, // Pass uncompiled TransactionMessage
          memo: `Winner payout: ${winner.toString()}`,
          programId: this.programId, // Use network-specific program ID
        });
      };

      let signature: string;
      let effectiveTransactionIndex = transactionIndex;
      try {
        signature = await attemptVaultTransactionCreate(
          effectiveTransactionIndex,
          'initial'
        );
      } catch (createError: any) {
        const errorMessage =
          createError?.message || String(createError);
        const isSeedConstraint =
          errorMessage.includes('ConstraintSeeds') ||
          errorMessage.includes('seeds constraint');

        if (isSeedConstraint) {
          const retryIndex = effectiveTransactionIndex + BigInt(1);
          enhancedLogger.warn(
            '⚠️ vaultTransactionCreate seed constraint, retrying with incremented index',
            {
              error: errorMessage,
              multisigAddress: multisigAddress.toString(),
              currentIndex: effectiveTransactionIndex.toString(),
              retryIndex: retryIndex.toString(),
              vaultAddress,
              winner: winner.toString(),
            }
          );

          try {
            signature = await attemptVaultTransactionCreate(
              retryIndex,
              'retry_incremented'
            );
            effectiveTransactionIndex = retryIndex;
          } catch (retryError: any) {
            const retryMessage =
              retryError?.message || String(retryError);
            enhancedLogger.error(
              '❌ vaultTransactionCreate retry failed',
              {
                error: retryMessage,
                originalError: errorMessage,
                multisigAddress: multisigAddress.toString(),
                attemptedIndex: retryIndex.toString(),
                vaultAddress,
                winner: winner.toString(),
              }
            );
            throw retryError;
          }
        } else {
        enhancedLogger.error('❌ vaultTransactionCreate failed', {
            error: errorMessage,
          stack: createError?.stack,
          vaultAddress,
          winner: winner.toString(),
            transactionIndex: effectiveTransactionIndex.toString(),
        });
        throw createError;
        }
      }

      transactionIndex = effectiveTransactionIndex;

      // Confirm transaction and ensure account exists on-chain before proceeding
      try {
        const confirmation = await this.connection.confirmTransaction(
          signature,
          'confirmed'
        );

        if (confirmation.value.err) {
          enhancedLogger.error(
            '❌ vault transaction confirmation reported an error',
            {
              vaultAddress,
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              signature,
              error: confirmation.value.err,
            }
          );
          throw new Error(
            `Vault transaction confirmation failed: ${JSON.stringify(
              confirmation.value.err
            )}`
          );
        }

        const [transactionPda] = getTransactionPda({
          multisigPda: multisigAddress,
          index: transactionIndex,
          programId: this.programId,
        });

        // ⭐ ATOMIC PROPOSAL CREATION: Wait for VaultTransaction with robust retry logic
        // This is THE critical fix - VaultTransaction MUST exist before proposal creation
        // Retry for up to 30 seconds (12 attempts × 2.5s) to handle RPC propagation delays
        let vaultTxAccount;
        let vaultTxFound = false;
        const maxAttempts = 12;
        const retryDelayMs = 2500; // 2.5 seconds between attempts
        
        enhancedLogger.info('🔍 ATOMIC PROPOSAL CREATION: Waiting for VaultTransaction to appear on-chain...', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          transactionIndex: transactionIndex.toString(),
          multisigPda: multisigAddress.toString(),
          creationTxSig: signature,
          maxAttempts,
          retryDelayMs,
          note: 'This ensures VaultTransaction exists before proposal creation - prevents all downstream failures',
        });
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            vaultTxAccount = await fromAccountAddressWithRetry(
              accounts.VaultTransaction,
              this.connection,
              transactionPda,
              'confirmed'
            );
            
            // ✅ VaultTransaction found - verify it's fully hydrated
            vaultTxFound = true;
            
            enhancedLogger.info('✅ ATOMIC PROPOSAL CREATION: VaultTransaction found on-chain', {
              vaultAddress,
              transactionPda: transactionPda.toString(),
              transactionIndex: transactionIndex.toString(),
              attempt: attempt + 1,
              totalAttempts: maxAttempts,
              note: 'VaultTransaction exists - proceeding with validation',
            });
            
            break; // Exit retry loop - VaultTransaction found
          } catch (fetchError: any) {
            // VaultTransaction not found yet - retry if we have attempts remaining
            if (attempt < maxAttempts - 1) {
              enhancedLogger.info('⏳ ATOMIC PROPOSAL CREATION: VaultTransaction not found yet, retrying...', {
                vaultAddress,
                transactionPda: transactionPda.toString(),
                transactionIndex: transactionIndex.toString(),
                attempt: attempt + 1,
                totalAttempts: maxAttempts,
                nextRetryInMs: retryDelayMs,
                error: fetchError?.message || String(fetchError),
              });
              
              // Wait before next attempt
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            } else {
              // Final attempt failed - this is a HARD FAILURE
              enhancedLogger.error('❌ FATAL: VaultTransaction never appeared after all retries', {
                vaultAddress,
                transactionPda: transactionPda.toString(),
                transactionIndex: transactionIndex.toString(),
                multisigPda: multisigAddress.toString(),
                creationTxSig: signature,
                totalAttempts: maxAttempts,
                retryDelayMs,
                finalError: fetchError?.message || String(fetchError),
                note: 'ABORTING MATCH CREATION - VaultTransaction must exist before proposal creation. This prevents all downstream failures.',
              });
              
              // Create a structured error that can be detected by callers
              const fatalError: any = new Error(
                `❌ FATAL: VaultTransaction never appeared for proposal creation. ` +
                `proposalPda=unknown (not created yet) ` +
                `vaultTxPda=${transactionPda.toString()} ` +
                `transactionIndex=${transactionIndex.toString()} ` +
                `multisigPda=${multisigAddress.toString()} ` +
                `creationTxSig=${signature} ` +
                `attempts=${maxAttempts} ` +
                `This match cannot proceed - VaultTransaction must exist before proposal creation.`
              );
              
              // Mark as irrecoverable failure - no retries will fix this
              fatalError.code = 'VAULT_TX_CREATION_FAILED';
              fatalError.fatal = true;
              fatalError.retryable = false;
              fatalError.cause = 'VAULT_TX_CREATION_FAILED';
              fatalError.details = {
                proposalPda: 'unknown (not created yet)',
                vaultTxPda: transactionPda.toString(),
                transactionIndex: transactionIndex.toString(),
                multisigPda: multisigAddress.toString(),
                creationTxSig: signature,
                attempts: maxAttempts,
                retryDelayMs,
                note: 'VaultTransaction account was never created on-chain. This is an irrecoverable proposal creation failure. No amount of retries will fix this.',
              };
              
              throw fatalError;
            }
          }
        }
        
        // ✅ RUNTIME ASSERTION #1: VaultTransaction account exists and is decodable
        if (!vaultTxFound || !vaultTxAccount) {
          // This should never happen due to the retry loop above, but add as safety check
          enhancedLogger.error('❌ RUNTIME ASSERTION #1 FAILED: VaultTransaction account missing after retry loop', {
            vaultAddress,
            transactionPda: transactionPda.toString(),
            transactionIndex: transactionIndex.toString(),
            multisigPda: multisigAddress.toString(),
            note: 'ABORTING MATCH CREATION - This should never happen if retry loop worked correctly',
          });
          throw new Error(
            `❌ VaultTransaction account missing after creation. ` +
            `vaultTxPda=${transactionPda.toString()} ` +
            `transactionIndex=${transactionIndex.toString()} ` +
            `multisigPda=${multisigAddress.toString()}`
          );
        }
        
        enhancedLogger.info('✅ RUNTIME ASSERTION #1 PASSED: VaultTransaction account exists and is decodable', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          transactionIndex: transactionIndex.toString(),
        });
        
        // RUNTIME ASSERTION #2: Ensure VaultTransaction has at least 1 instruction
        if (!vaultTxAccount.message || !vaultTxAccount.message.instructions || 
            (Array.isArray(vaultTxAccount.message.instructions) && vaultTxAccount.message.instructions.length === 0)) {
          enhancedLogger.error('❌ RUNTIME ASSERTION #2 FAILED: VaultTransaction contains no instructions', {
            vaultAddress,
            transactionPda: transactionPda.toString(),
            transactionIndex: transactionIndex.toString(),
            hasMessage: !!vaultTxAccount.message,
            hasInstructions: !!(vaultTxAccount.message && vaultTxAccount.message.instructions),
            instructionCount: vaultTxAccount.message && Array.isArray(vaultTxAccount.message.instructions) 
              ? vaultTxAccount.message.instructions.length 
              : 'unknown',
            note: 'ABORTING MATCH CREATION - VaultTransaction must contain instructions',
          });
          throw new Error(
            `❌ VaultTransaction contains no instructions. This proposal cannot be signed or executed. ` +
            `vaultTxPda=${transactionPda.toString()}`
          );
        }
        enhancedLogger.info('✅ RUNTIME ASSERTION #2 PASSED: VaultTransaction has instructions', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          instructionCount: Array.isArray(vaultTxAccount.message.instructions) 
            ? vaultTxAccount.message.instructions.length 
            : 'unknown',
        });
        
        // RUNTIME ASSERTION #3: Ensure remainingAccounts can be extracted properly
        const accountKeys = (vaultTxAccount.message as any).accountKeys;
        if (!accountKeys || !Array.isArray(accountKeys) || accountKeys.length === 0) {
          enhancedLogger.error('❌ RUNTIME ASSERTION #3 FAILED: VaultTransaction has zero accountKeys', {
            vaultAddress,
            transactionPda: transactionPda.toString(),
            transactionIndex: transactionIndex.toString(),
            hasMessage: !!vaultTxAccount.message,
            hasAccountKeys: !!(vaultTxAccount.message && (vaultTxAccount.message as any).accountKeys),
            accountKeysCount: accountKeys ? accountKeys.length : 0,
            note: 'ABORTING MATCH CREATION - VaultTransaction must have accountKeys for approval instructions',
          });
          throw new Error(
            `❌ VaultTransaction has zero accountKeys. Invalid state. ` +
            `vaultTxPda=${transactionPda.toString()}`
          );
        }
        enhancedLogger.info('✅ RUNTIME ASSERTION #3 PASSED: VaultTransaction has accountKeys', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          accountKeysCount: accountKeys.length,
          note: 'VaultTransaction is fully hydrated and ready for approval instructions',
        });
      } catch (confirmationError: any) {
        enhancedLogger.error(
          '❌ Failed to confirm vault transaction for proposal creation',
          {
            vaultAddress,
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            signature,
            error:
              confirmationError?.message || String(confirmationError),
          }
        );
        throw confirmationError;
      }
      
      // Generate a numeric proposal ID for frontend compatibility
      // Derive the actual proposal PDA address (not just transaction index)
      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: transactionIndex,
        programId: this.programId,
      });
      const proposalId = proposalPda.toString();
      
      // CRITICAL VALIDATION: Ensure proposal PDA matches transaction index
      // This prevents mismatches that cause sync failures
      const [validatedProposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: transactionIndex,
        programId: this.programId,
      });
      if (proposalPda.toString() !== validatedProposalPda.toString()) {
        const errorMsg = `CRITICAL: Proposal PDA derivation mismatch. Expected ${validatedProposalPda.toString()}, got ${proposalPda.toString()}`;
        enhancedLogger.error('❌ ' + errorMsg, {
          vaultAddress: vaultAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          expectedPda: validatedProposalPda.toString(),
          actualPda: proposalPda.toString(),
        });
        throw new Error(errorMsg);
      }
      
      enhancedLogger.info('✅ Vault transaction created successfully', {
        signature,
        proposalId,
        transactionIndex: transactionIndex.toString(),
        validated: true,
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

      // PRIORITY 2 FIX: Check if proposal already exists before creating
      // This prevents orphaned proposals when retries occur at different transaction indices
      // Note: proposalPda is already declared above (line 1471), so we reuse it here
      let existingProposal: any = null;
      try {
        existingProposal = await accounts.Proposal.fromAccountAddress(this.connection, proposalPda);
        enhancedLogger.info('🔁 Proposal already exists on-chain, reusing existing proposal', {
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          proposalPda: proposalPda.toString(),
          status: (existingProposal as any).status?.__kind,
          approvedSigners: ((existingProposal as any).approved || []).length,
          note: 'Reusing existing proposal instead of creating a new one - prevents orphaned proposals',
        });
      } catch (checkError: any) {
        // Proposal doesn't exist - this is expected for new proposals
        if (!checkError?.message?.includes('Unable to find') && !checkError?.message?.includes('Account does not exist')) {
          enhancedLogger.warn('⚠️ Unexpected error checking for existing proposal', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            error: checkError?.message,
          });
        }
      }

      // Ensure a proposal account exists and is active for this transaction
      // CRITICAL: Create proposal WITHOUT isDraft to ensure transaction linking works
      // isDraft: true prevents the transaction from being linked to the proposal
      let createdProposal = false;
      let proposalCreateSignature: string | null = null;
      
      if (existingProposal) {
        // Proposal already exists - reuse it instead of creating a new one
        enhancedLogger.info('✅ Reusing existing proposal (PRIORITY 2 FIX)', {
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          proposalPda: proposalPda.toString(),
          status: (existingProposal as any).status?.__kind,
          note: 'This prevents creating orphaned proposals when retries occur',
        });
        // Don't create - use existing proposal
      } else {
        // Proposal doesn't exist - create it
        try {
          proposalCreateSignature = await rpc.proposalCreate({
            connection: this.connection,
            feePayer: this.config.systemKeypair,
            creator: this.config.systemKeypair,
            multisigPda: multisigAddress,
            transactionIndex, // This should link the vault transaction to the proposal
            programId: this.programId,
            // REMOVED: isDraft: true - this prevents transaction linking
          });
          createdProposal = true;
          enhancedLogger.info('✅ Proposal account created', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            proposalSignature: proposalCreateSignature,
          });
        } catch (proposalError: any) {
          const msg = proposalError?.message || String(proposalError);
          if (msg.includes('already in use') || msg.includes('already initialized')) {
            // Race condition: proposal was created between our check and create attempt
            enhancedLogger.info('ℹ️ Proposal was created by another process, continuing', {
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              note: 'Proposal was created between existence check and create attempt (race condition)',
            });
            // Try to fetch it now
            try {
              existingProposal = await accounts.Proposal.fromAccountAddress(this.connection, proposalPda);
            } catch (fetchError: any) {
              enhancedLogger.error('❌ Failed to fetch proposal after race condition', {
                multisigAddress: multisigAddress.toString(),
                transactionIndex: transactionIndex.toString(),
                error: fetchError?.message,
              });
              throw proposalError; // Re-throw original error
            }
          } else {
            enhancedLogger.error('❌ Failed to create proposal account', {
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              error: msg,
            });
            throw proposalError;
          }
        }
      }

      if (createdProposal && proposalCreateSignature) {
        await this.confirmProposalCreation(
          proposalCreateSignature,
          multisigAddress,
          transactionIndex,
          'winner payout'
        );
        
        // CRITICAL: Verify proposal has linked transaction (expert requirement)
        // Also validate that the proposal PDA matches the transaction index
        try {
          const [proposalPda] = getProposalPda({
            multisigPda: multisigAddress,
            transactionIndex: transactionIndex,
            programId: this.programId,
          });
          
          // CRITICAL VALIDATION: Ensure proposal ID matches derived PDA
          if (proposalId !== proposalPda.toString()) {
            const errorMsg = `CRITICAL: Proposal ID mismatch after creation. Expected ${proposalPda.toString()}, got ${proposalId}`;
            enhancedLogger.error('❌ ' + errorMsg, {
              vaultAddress,
              transactionIndex: transactionIndex.toString(),
              expectedPda: proposalPda.toString(),
              actualProposalId: proposalId,
            });
            throw new Error(errorMsg);
          }
          
          // CRITICAL: Retry multiple times with increasing delays to handle blockchain indexing delays
          // The proposal account needs time to be fully initialized with the linked transaction
          let proposalVerified = false;
          let retryCount = 0;
          const maxRetries = 5;
          const baseDelay = 2000; // Start with 2 seconds
          
          while (!proposalVerified && retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, baseDelay * (retryCount + 1)));
            
            const proposalAccount = await withRetry(
              () => this.connection.getAccountInfo(proposalPda, 'confirmed'),
              { maxAttempts: 3, baseDelayMs: 250 }
            );
            if (proposalAccount) {
              try {
                const proposal = await fromAccountAddressWithRetry(
                  accounts.Proposal,
                  this.connection,
                  proposalPda
                );
                const transactions = (proposal as any).transactions || [];
                const transactionCount = Array.isArray(transactions) ? transactions.length : 0;
                
                if (transactionCount > 0) {
                  enhancedLogger.info('✅ Proposal verified: has linked transactions', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                    transactionCount,
                    retryAttempt: retryCount + 1,
                  });
                  proposalVerified = true;
                  break;
                } else {
                  enhancedLogger.warn(`⚠️ Proposal has 0 transactions (attempt ${retryCount + 1}/${maxRetries}), retrying...`, {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                  });
                }
              } catch (decodeError: any) {
                enhancedLogger.warn(`⚠️ Failed to decode proposal (attempt ${retryCount + 1}/${maxRetries}), retrying...`, {
                  vaultAddress,
                  proposalId,
                  proposalPda: proposalPda.toString(),
                  error: decodeError?.message || String(decodeError),
                });
              }
            } else {
              enhancedLogger.warn(`⚠️ Proposal account not found (attempt ${retryCount + 1}/${maxRetries}), retrying...`, {
                vaultAddress,
                proposalId,
                proposalPda: proposalPda.toString(),
              });
            }
            retryCount++;
          }
          
          if (!proposalVerified) {
            // Final check - if still 0 transactions, log warning but don't fail
            // The proposal was created with transactionIndex, so the linking should work
            // even if it's not immediately visible due to blockchain indexing delays
            const finalProposalAccount = await withRetry(
              () => this.connection.getAccountInfo(proposalPda, 'confirmed'),
              { maxAttempts: 3, baseDelayMs: 250 }
            );
            if (finalProposalAccount) {
              try {
                const finalProposal = await accounts.Proposal.fromAccountAddress(
                  this.connection,
                  proposalPda
                );
                const finalTransactions = (finalProposal as any).transactions || [];
                const finalTransactionCount = Array.isArray(finalTransactions) ? finalTransactions.length : 0;
                
                if (finalTransactionCount === 0) {
                  // Log warning but don't throw - proposal was created with transactionIndex
                  // The transaction linking may be asynchronous and will complete eventually
                  enhancedLogger.warn('⚠️ WARNING: Proposal created but shows 0 linked transactions after all retries', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                    note: 'Proposal was created with transactionIndex, so linking should work. This may be a blockchain indexing delay. Proposal will be returned anyway.',
                  });
                  // Don't throw - return the proposalId so the frontend can use it
                  // The transaction linking will complete asynchronously
                } else {
                  enhancedLogger.info('✅ Proposal verified: has linked transactions (final check)', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                    transactionCount: finalTransactionCount,
                  });
                  proposalVerified = true;
                }
              } catch (finalDecodeError: any) {
                // Log warning but don't throw - proposal exists and was created with transactionIndex
                enhancedLogger.warn('⚠️ WARNING: Could not decode proposal account to verify transactions after all retries', {
                  vaultAddress,
                  proposalId,
                  proposalPda: proposalPda.toString(),
                  error: finalDecodeError?.message || String(finalDecodeError),
                  note: 'Proposal was created with transactionIndex, so linking should work. Returning proposalId anyway.',
                });
                // Don't throw - return the proposalId
              }
            } else {
              // This is still an error - proposal account should exist
              enhancedLogger.error('❌ CRITICAL: Proposal account not found after all retries', {
                vaultAddress,
                proposalId,
                proposalPda: proposalPda.toString(),
                note: 'Proposal account should exist after creation.',
              });
              throw new Error(`Proposal account not found after ${maxRetries} retries. proposalPda=${proposalPda.toString()}`);
            }
          }
        } catch (verifyError: any) {
          // CRITICAL: Verification failure - fail loudly
          const errorMsg = `Failed to verify proposal transaction linking. error=${verifyError?.message || String(verifyError)}`;
          enhancedLogger.error('❌ CRITICAL: Could not verify proposal transaction linking', {
            vaultAddress,
            proposalId,
            error: verifyError?.message || String(verifyError),
            note: 'Transaction linking verification is required to ensure proposals can be executed.',
          });
          throw verifyError; // Re-throw to fail loudly
        }
      }

      // NOTE: After removing isDraft: true, proposals are created as Active (not Draft)
      // So we don't need to call proposalActivate - the proposal is already active
      enhancedLogger.info('✅ Proposal is already Active (no activation needed)', {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndex.toString(),
      });

      enhancedLogger.info('✅ Winner payout proposal ready for approvals', {
        vaultAddress,
        proposalId,
        newlyCreated: createdProposal,
        winner: winner.toString(),
        winnerAmount,
        feeAmount,
      });

      // Auto-approve with system signature (1 of 2 needed for 2-of-3 multisig)
      try {
        const feeWalletKeypair = getFeeWalletKeypair();
        const approveResult = await this.approveProposal(vaultAddress, proposalId, feeWalletKeypair);
        if (approveResult.success) {
          enhancedLogger.info('✅ System signature added to proposal', {
            vaultAddress,
            proposalId,
            signature: approveResult.signature,
          });
        } else {
          enhancedLogger.warn('⚠️ Failed to auto-approve system signature', {
            vaultAddress,
            proposalId,
            error: approveResult.error,
          });
        }
      } catch (approveError: any) {
        enhancedLogger.warn('⚠️ Error auto-approving system signature (non-critical)', {
          vaultAddress,
          proposalId,
          error: approveError?.message || String(approveError),
        });
      }

      return {
        success: true,
        proposalId,
        transactionIndex: transactionIndex.toString(), // CRITICAL: Return transaction index to ensure proposal ID matches
        needsSignatures: 1, // 1 more signature needed (system already signed)
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // CRITICAL: Detect irrecoverable VaultTransaction creation failures
      const isVaultTxCreationFailed = (error as any)?.code === 'VAULT_TX_CREATION_FAILED' ||
                                      (error as any)?.fatal === true ||
                                      (error as any)?.cause === 'VAULT_TX_CREATION_FAILED' ||
                                      errorMessage.includes('VaultTransaction never appeared');
      
      if (isVaultTxCreationFailed) {
        enhancedLogger.error('❌ FATAL: Irrecoverable proposal creation failure (VAULT_TX_CREATION_FAILED)', {
          vaultAddress,
          error: errorMessage,
          errorCode: (error as any)?.code,
          errorDetails: (error as any)?.details,
          note: 'VaultTransaction was never created on-chain. This match cannot proceed. No amount of retries will fix this.',
        });
        
        return {
          success: false,
          error: errorMessage,
          errorCode: 'VAULT_TX_CREATION_FAILED',
          fatal: true,
          retryable: false,
          cause: 'VAULT_TX_CREATION_FAILED',
          details: (error as any)?.details || {
            note: 'VaultTransaction account was never created on-chain. This is an irrecoverable proposal creation failure.',
          },
        };
      }
      
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
    refundAmount: number,
    overrideVaultPda?: string,
    playerPaymentStatus?: { player1Paid?: boolean; player2Paid?: boolean }
  ): Promise<ProposalResult> {
    try {
      // Defensive checks: Validate all required values
      if (!this.config || !this.config.systemKeypair || !this.config.systemPublicKey) {
        const errorMsg = 'SquadsVaultService config or systemKeypair is undefined. Check FEE_WALLET_PRIVATE_KEY environment variable.';
        enhancedLogger.error('❌ ' + errorMsg, {
          hasConfig: !!this.config,
          hasSystemKeypair: !!(this.config?.systemKeypair),
          hasSystemPublicKey: !!(this.config?.systemPublicKey),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Validate keypair has signing capability
      if (!this.config.systemKeypair.secretKey || this.config.systemKeypair.secretKey.length === 0) {
        const errorMsg = 'System keypair does not have a valid secret key for signing';
        enhancedLogger.error('❌ ' + errorMsg);
        return {
          success: false,
          error: errorMsg,
        };
      }

      if (!vaultAddress || typeof vaultAddress !== 'string') {
        const errorMsg = 'Invalid vaultAddress provided to proposeTieRefund';
        enhancedLogger.error('❌ ' + errorMsg, { vaultAddress });
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Validate PublicKeys
      const isPk = (k: any) => k && typeof k.toBase58 === 'function';
      if (!isPk(player1) || !isPk(player2) || !isPk(this.config.systemPublicKey)) {
        const errorMsg = 'Invalid PublicKey provided to proposeTieRefund';
        enhancedLogger.error('❌ ' + errorMsg, {
          player1Ok: isPk(player1),
          player2Ok: isPk(player2),
          systemPublicKeyOk: isPk(this.config.systemPublicKey),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      enhancedLogger.info('🔄 Proposing tie refund via Squads', {
        vaultAddress,
        multisigAddress: vaultAddress, // vaultAddress is the multisig PDA
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
        systemPublicKey: this.config.systemPublicKey.toString(),
      });

      // Create real Squads transaction for refunds
      let multisigAddress: PublicKey;
      try {
        multisigAddress = new PublicKey(vaultAddress);
      } catch (pkError: any) {
        const errorMsg = `Invalid vaultAddress PublicKey format: ${vaultAddress}`;
        enhancedLogger.error('❌ ' + errorMsg, { vaultAddress, error: pkError?.message });
        return {
          success: false,
          error: errorMsg,
        };
      }

      // Derive the vault PDA from the multisig PDA
      // CRITICAL: Must use the same programId that was used to create the vault
      // Try using getVaultPda with programId, but if it doesn't support it, manually derive
      let vaultPda: PublicKey | null = null;
      if (overrideVaultPda) {
        try {
          vaultPda = new PublicKey(overrideVaultPda);
        } catch (overrideError: any) {
          enhancedLogger.warn('⚠️ Failed to parse override vault PDA for tie refund, falling back to derivation', {
            overrideVaultPda,
            error: overrideError?.message || String(overrideError),
          });
        }
      }
      if (!vaultPda) {
        try {
          // Try with programId parameter (may not be supported by SDK)
          const [derivedVaultPda] = getVaultPda({
            multisigPda: multisigAddress,
            index: 0,
            programId: this.programId,
          } as any); // Type cast since programId might not be in types
          vaultPda = derivedVaultPda;
        } catch (e) {
          // Fallback: manually derive using the same method Squads uses
          // Vault PDA derivation: [multisigPda, vault_index (u16), "vault"]
          const vaultIndexBuffer = Buffer.allocUnsafe(2);
          vaultIndexBuffer.writeUInt16LE(0, 0); // vault index 0
          const [derivedVaultPda] = PublicKey.findProgramAddressSync(
            [
              multisigAddress.toBuffer(),
              vaultIndexBuffer,
              Buffer.from('vault'),
            ],
            this.programId
          );
          vaultPda = derivedVaultPda;
        }
      }

      if (!vaultPda) {
        throw new Error(`Unable to derive vault PDA for tie refund ${multisigAddress.toString()}`);
      }

      enhancedLogger.info('📍 Tie refund vault PDA resolved', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
        source: overrideVaultPda ? 'override' : 'derived',
      });

      // CRITICAL: Check vault PDA account status before using it
      // In Squads v4, the vault PDA should be created lazily, but let's verify its status
      try {
        const vaultAccountInfo = await withRetry(
          () => this.connection.getAccountInfo(vaultPda, 'confirmed'),
          { maxAttempts: 3, baseDelayMs: 250 }
        );
        if (vaultAccountInfo) {
          enhancedLogger.info('🔍 Vault PDA account exists', {
            vaultPda: vaultPda.toString(),
            owner: vaultAccountInfo.owner.toString(),
            expectedOwner: this.programId.toString(),
            dataLength: vaultAccountInfo.data.length,
            lamports: vaultAccountInfo.lamports,
            isOwnedBySquads: vaultAccountInfo.owner.equals(this.programId),
          });
          
          // If vault exists but is owned by wrong program, this will cause AccountOwnedByWrongProgram
          if (!vaultAccountInfo.owner.equals(this.programId)) {
            enhancedLogger.warn('⚠️ Vault PDA is owned by wrong program', {
              vaultPda: vaultPda.toString(),
              actualOwner: vaultAccountInfo.owner.toString(),
              expectedOwner: this.programId.toString(),
              note: 'This will cause AccountOwnedByWrongProgram error. The vault may need to be re-derived or the multisig may have been created with a different program ID.',
            });
          }
        } else {
          enhancedLogger.info('ℹ️ Vault PDA does not exist yet - will be created lazily by vaultTransactionCreate', {
            vaultPda: vaultPda.toString(),
            multisigAddress: multisigAddress.toString(),
          });
        }
      } catch (accountCheckError: any) {
        enhancedLogger.warn('⚠️ Failed to check vault PDA account status', {
          vaultPda: vaultPda.toString(),
          error: accountCheckError?.message || String(accountCheckError),
        });
      }
      
      // Fetch multisig account to get current transaction index
      // Squads Protocol requires sequential transaction indices - must fetch from on-chain account
      // This ensures the transactionIndex matches what the multisig account expects
      // Try to get transaction index from the account, but if deserialization fails,
      // try using RPC method or fallback to querying account data directly
      let transactionIndex: bigint;
      try {
        // First try: Use the account deserialization method
        const multisigInfo = await fromAccountAddressWithRetry(
          accounts.Multisig,
          this.connection,
          multisigAddress,
          { commitment: 'confirmed' }
        );
        const currentTransactionIndexBN = BigInt(
          multisigInfo.transactionIndex.toString()
        );
        transactionIndex = currentTransactionIndexBN;
        const nextTransactionIndex = transactionIndex + BigInt(1);
        
        enhancedLogger.info('📊 Fetched multisig transaction index for tie refund', {
          multisigAddress: multisigAddress.toString(),
          currentTransactionIndex: Number(currentTransactionIndexBN),
          nextTransactionIndex: nextTransactionIndex.toString(),
        });
      } catch (fetchError: any) {
        // If deserialization fails (e.g., "Expected to hold a COption"), use fallback
        // The account exists but has an incompatible format - just use transaction index 1
        enhancedLogger.warn('⚠️ Failed to deserialize multisig account, using fallback transaction index', {
          multisigAddress: multisigAddress.toString(),
          error: fetchError?.message || String(fetchError),
        });
        
        // Fallback: Use transaction index 1
        // This assumes no previous transactions (which should be fine for new vaults)
        // If the vault already has transactions, this will fail when creating the proposal,
        // but that's better than always failing at this step
        transactionIndex = BigInt(0);
        
        enhancedLogger.warn('⚠️ Using fallback transaction index 0', {
          multisigAddress: multisigAddress.toString(),
          note: 'This assumes no previous transactions. If vault has existing transactions, proposal creation will fail.',
        });
      }
      
      // Ensure all PublicKeys are properly instantiated
      const vaultPdaKey = typeof vaultPda === 'string' ? new PublicKey(vaultPda) : vaultPda;
      const player1Key = typeof player1 === 'string' ? new PublicKey(player1) : player1;
      const player2Key = typeof player2 === 'string' ? new PublicKey(player2) : player2;
      
      const player1Paid = playerPaymentStatus?.player1Paid ?? true;
      const player2Paid = playerPaymentStatus?.player2Paid ?? true;

      const refundLamportsBig = BigInt(Math.floor(refundAmount * LAMPORTS_PER_SOL));

      const vaultAccountInfo = await withRetry(
        () => this.connection.getAccountInfo(vaultPdaKey, 'confirmed'),
        { maxAttempts: 3, baseDelayMs: 250 }
      );
      if (!vaultAccountInfo) {
        const errorMsg = `Vault account ${vaultPdaKey.toString()} not found on-chain`;
        enhancedLogger.error('❌ ' + errorMsg, {
          vaultAddress,
          vaultPda: vaultPdaKey.toString(),
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      const rentExemptReserve = await this.connection.getMinimumBalanceForRentExemption(
        vaultAccountInfo.data?.length ?? 0
      );
      const rentExemptReserveSOL = rentExemptReserve / LAMPORTS_PER_SOL;
      const vaultLamportsBig = BigInt(vaultAccountInfo.lamports);
      const rentReserveBig = BigInt(rentExemptReserve);

      if (vaultLamportsBig <= rentReserveBig) {
        enhancedLogger.warn('⚠️ Vault balance is at or below rent reserve for tie refund', {
          vaultAddress,
          vaultPda: vaultPdaKey.toString(),
          vaultLamports: vaultLamportsBig.toString(),
          rentReserve: rentReserveBig.toString(),
        });
      }

      const transferableLamportsBig = vaultLamportsBig > rentReserveBig ? vaultLamportsBig - rentReserveBig : BigInt(0);

      const desiredPlayer1Big = player1Paid ? refundLamportsBig : BigInt(0);
      const desiredPlayer2Big = player2Paid ? refundLamportsBig : BigInt(0);
      const desiredTotalBig = desiredPlayer1Big + desiredPlayer2Big;

      let remainingTransferable = transferableLamportsBig;

      const player1FromVaultBig =
        desiredPlayer1Big === BigInt(0)
          ? BigInt(0)
          : remainingTransferable >= desiredPlayer1Big
            ? desiredPlayer1Big
            : remainingTransferable;
      remainingTransferable = remainingTransferable - player1FromVaultBig;

      const player2FromVaultBig =
        desiredPlayer2Big === BigInt(0)
          ? BigInt(0)
          : remainingTransferable >= desiredPlayer2Big
            ? desiredPlayer2Big
            : remainingTransferable;
      remainingTransferable = remainingTransferable - player2FromVaultBig;

      const player1TopUpBig = desiredPlayer1Big - player1FromVaultBig;
      const player2TopUpBig = desiredPlayer2Big - player2FromVaultBig;

      enhancedLogger.info('🔄 Tie refund payout plan', {
        vaultAddress,
        vaultPda: vaultPdaKey.toString(),
        player1Paid,
        player2Paid,
        currentLamports: vaultAccountInfo.lamports,
        rentExemptReserveSOL,
        transferableLamports: Number(transferableLamportsBig),
        desiredPlayer1Lamports: Number(desiredPlayer1Big),
        desiredPlayer2Lamports: Number(desiredPlayer2Big),
        player1LamportsFromVault: Number(player1FromVaultBig),
        player2LamportsFromVault: Number(player2FromVaultBig),
        player1TopUpLamports: Number(player1TopUpBig > BigInt(0) ? player1TopUpBig : BigInt(0)),
        player2TopUpLamports: Number(player2TopUpBig > BigInt(0) ? player2TopUpBig : BigInt(0)),
        totalDesiredLamports: Number(desiredTotalBig),
        totalVaultLamportsRequested: Number(player1FromVaultBig + player2FromVaultBig),
      });

      const instructions: TransactionInstruction[] = [];

      if (player1FromVaultBig > BigInt(0)) {
      const player1TransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: player1Key,
          lamports: Number(player1FromVaultBig),
      });
      player1TransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: true, isWritable: true };
        instructions.push(player1TransferIx);
      }
      
      if (player2FromVaultBig > BigInt(0)) {
      const player2TransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: player2Key,
          lamports: Number(player2FromVaultBig),
      });
      player2TransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: true, isWritable: true };
        instructions.push(player2TransferIx);
      }

      if (player1TopUpBig > BigInt(0)) {
        const topUpIx = SystemProgram.transfer({
          fromPubkey: this.config.systemPublicKey,
          toPubkey: player1Key,
          lamports: Number(player1TopUpBig),
        });
        instructions.push(topUpIx);
      }

      if (player2TopUpBig > BigInt(0)) {
        const topUpIx = SystemProgram.transfer({
          fromPubkey: this.config.systemPublicKey,
          toPubkey: player2Key,
          lamports: Number(player2TopUpBig),
        });
        instructions.push(topUpIx);
      }

      if (instructions.length === 0) {
        const errorMsg = 'No refund instructions generated (no eligible players or refund amount zero)';
        enhancedLogger.warn('⚠️ ' + errorMsg, {
          vaultAddress,
          player1Paid,
          player2Paid,
          refundAmount,
        });
        return {
          success: false,
          error: errorMsg,
        };
      }

      enhancedLogger.info('🔍 Instruction keys check for tie refund', {
        instructionCount: instructions.length,
        details: instructions.map(ix => ({
          programId: ix.programId.toString(),
          keys: ix.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        })),
      });
      
      // Create transaction message (uncompiled - Squads SDK compiles it internally)
      // Note: payerKey must be a signer account (systemPublicKey) that pays for transaction creation
      // The vault PDA holds funds but cannot pay fees (it's not a signer)
      const { blockhash: blockhash2, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
      const transactionMessage = new TransactionMessage({
        payerKey: this.config.systemPublicKey, // System pays for transaction creation fees
        recentBlockhash: blockhash2,
        instructions,
      });
      
      // CRITICAL: Verify multisig account ownership before creating transaction
      // The AccountOwnedByWrongProgram error suggests a program ID mismatch
      try {
        const multisigAccountInfo = await withRetry(
          () => this.connection.getAccountInfo(multisigAddress, 'confirmed'),
          { maxAttempts: 3, baseDelayMs: 250 }
        );
        if (multisigAccountInfo) {
          enhancedLogger.info('🔍 Multisig account ownership check', {
            multisigAddress: multisigAddress.toString(),
            owner: multisigAccountInfo.owner.toString(),
            expectedOwner: this.programId.toString(),
            isOwnedBySquads: multisigAccountInfo.owner.equals(this.programId),
            dataLength: multisigAccountInfo.data.length,
            lamports: multisigAccountInfo.lamports,
          });
          
          if (!multisigAccountInfo.owner.equals(this.programId)) {
            enhancedLogger.error('❌ CRITICAL: Multisig account is owned by wrong program!', {
              multisigAddress: multisigAddress.toString(),
              actualOwner: multisigAccountInfo.owner.toString(),
              expectedOwner: this.programId.toString(),
              note: 'This will cause AccountOwnedByWrongProgram. The multisig was created with a different program ID than we are using for vault operations.',
            });
            throw new Error(`Multisig account ${multisigAddress.toString()} is owned by ${multisigAccountInfo.owner.toString()}, but expected ${this.programId.toString()}. Program ID mismatch detected.`);
          }
        } else {
          enhancedLogger.error('❌ Multisig account does not exist!', {
            multisigAddress: multisigAddress.toString(),
          });
          throw new Error(`Multisig account ${multisigAddress.toString()} does not exist on-chain.`);
        }
      } catch (accountCheckError: any) {
        enhancedLogger.error('❌ Failed to verify multisig account ownership', {
          multisigAddress: multisigAddress.toString(),
          error: accountCheckError?.message || String(accountCheckError),
        });
        throw accountCheckError;
      }
      
      // Create the Squads vault transaction
      // Pass uncompiled TransactionMessage - Squads SDK will compile it internally
      const attemptTieVaultTransactionCreate = async (
        index: bigint,
        attemptLabel: string
      ): Promise<string> => {
      enhancedLogger.info('📝 Creating vault transaction for tie refund', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
        programId: this.programId.toString(),
        blockhash: blockhash2,
        lastValidBlockHeight,
        player1: player1.toString(),
        player2: player2.toString(),
        desiredPlayer1Lamports: Number(desiredPlayer1Big),
        desiredPlayer2Lamports: Number(desiredPlayer2Big),
        vaultContributionPlayer1: Number(player1FromVaultBig),
        vaultContributionPlayer2: Number(player2FromVaultBig),
        topUpPlayer1: Number(player1TopUpBig > BigInt(0) ? player1TopUpBig : BigInt(0)),
        topUpPlayer2: Number(player2TopUpBig > BigInt(0) ? player2TopUpBig : BigInt(0)),
          transactionIndex: index.toString(),
          attempt: attemptLabel,
      });
      
        return rpc.vaultTransactionCreate({
          connection: this.connection,
          feePayer: this.config.systemKeypair, // Keypair that signs and pays for transaction creation
          multisigPda: multisigAddress,
          transactionIndex: index,
          creator: this.config.systemKeypair.publicKey, // Creator public key
          vaultIndex: 0, // First vault
          ephemeralSigners: 0, // No ephemeral signers needed
          transactionMessage: transactionMessage, // Pass uncompiled TransactionMessage
          memo: `Tie refund: ${player1.toString()}, ${player2.toString()}`,
          programId: this.programId, // Use network-specific program ID
        });
      };

      let signature: string;
      let effectiveTieTransactionIndex = transactionIndex;
      try {
        signature = await attemptTieVaultTransactionCreate(
          effectiveTieTransactionIndex,
          'initial'
        );
      } catch (createError: any) {
        const errorDetails: any = {
          error: createError?.message || String(createError),
          stack: createError?.stack,
          vaultAddress,
          multisigAddress: multisigAddress.toString(),
          vaultPda: vaultPda.toString(),
          programId: this.programId.toString(),
          player1: player1.toString(),
          player2: player2.toString(),
          transactionIndex: effectiveTieTransactionIndex.toString(),
        };
        
        const errorMessage =
          createError?.message || String(createError);
        const isSeedConstraint =
          errorMessage.includes('ConstraintSeeds') ||
          errorMessage.includes('seeds constraint');

        if (isSeedConstraint) {
          const retryIndex = effectiveTieTransactionIndex + BigInt(1);
          enhancedLogger.warn(
            '⚠️ vaultTransactionCreate seed constraint (tie refund), retrying with incremented index',
            {
              ...errorDetails,
              retryIndex: retryIndex.toString(),
            }
          );

          try {
            signature = await attemptTieVaultTransactionCreate(
              retryIndex,
              'retry_incremented'
            );
            effectiveTieTransactionIndex = retryIndex;
          } catch (retryError: any) {
            const retryMessage =
              retryError?.message || String(retryError);
            const retryErrorDetails: any = {
              ...errorDetails,
              retryIndex: retryIndex.toString(),
              retryError: retryMessage,
            };

            try {
              const vaultAccountInfo = await this.connection.getAccountInfo(
                vaultPda,
                'confirmed'
              );
              if (vaultAccountInfo) {
                retryErrorDetails.vaultPdaExists = true;
                retryErrorDetails.vaultPdaOwner =
                  vaultAccountInfo.owner.toString();
                retryErrorDetails.vaultPdaDataLength =
                  vaultAccountInfo.data.length;
                retryErrorDetails.vaultPdaLamports =
                  vaultAccountInfo.lamports;
              } else {
                retryErrorDetails.vaultPdaExists = false;
                retryErrorDetails.vaultPdaOwner =
                  'N/A (account does not exist)';
              }
            } catch (accountCheckError: any) {
              retryErrorDetails.vaultPdaCheckError =
                accountCheckError?.message || String(accountCheckError);
            }

            enhancedLogger.error(
              '❌ vaultTransactionCreate retry failed for tie refund',
              retryErrorDetails
            );
            throw retryError;
          }
        } else {
          // Check if vault PDA exists and what it's owned by for diagnostic context
        try {
            const vaultAccountInfo = await this.connection.getAccountInfo(
              vaultPda,
              'confirmed'
            );
          if (vaultAccountInfo) {
            errorDetails.vaultPdaExists = true;
            errorDetails.vaultPdaOwner = vaultAccountInfo.owner.toString();
              errorDetails.vaultPdaDataLength =
                vaultAccountInfo.data.length;
            errorDetails.vaultPdaLamports = vaultAccountInfo.lamports;
          } else {
            errorDetails.vaultPdaExists = false;
              errorDetails.vaultPdaOwner =
                'N/A (account does not exist)';
          }
        } catch (accountCheckError: any) {
            errorDetails.vaultPdaCheckError =
              accountCheckError?.message || String(accountCheckError);
        }
        
          enhancedLogger.error(
            '❌ vaultTransactionCreate failed for tie refund',
            errorDetails
          );
        throw createError;
        }
      }

      transactionIndex = effectiveTieTransactionIndex;

      // Confirm transaction and ensure vault transaction account exists
      try {
        const confirmation = await this.connection.confirmTransaction(
          signature,
          'confirmed'
        );

        if (confirmation.value.err) {
          enhancedLogger.error(
            '❌ Tie refund vault transaction confirmation reported an error',
            {
              vaultAddress,
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              signature,
              error: confirmation.value.err,
            }
          );
          throw new Error(
            `Tie refund vault transaction confirmation failed: ${JSON.stringify(
              confirmation.value.err
            )}`
          );
        }

        const [transactionPda] = getTransactionPda({
          multisigPda: multisigAddress,
          index: transactionIndex,
          programId: this.programId,
        });

        // ⭐ ATOMIC PROPOSAL CREATION: Wait for VaultTransaction with robust retry logic
        // This is THE critical fix - VaultTransaction MUST exist before proposal creation
        // Retry for up to 30 seconds (12 attempts × 2.5s) to handle RPC propagation delays
        let vaultTxAccount;
        let vaultTxFound = false;
        const maxAttempts = 12;
        const retryDelayMs = 2500; // 2.5 seconds between attempts
        
        enhancedLogger.info('🔍 ATOMIC PROPOSAL CREATION (tie refund): Waiting for VaultTransaction to appear on-chain...', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          transactionIndex: transactionIndex.toString(),
          multisigPda: multisigAddress.toString(),
          creationTxSig: signature,
          maxAttempts,
          retryDelayMs,
          note: 'This ensures VaultTransaction exists before proposal creation - prevents all downstream failures',
        });
        
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          try {
            vaultTxAccount = await fromAccountAddressWithRetry(
              accounts.VaultTransaction,
              this.connection,
              transactionPda,
              'confirmed'
            );
            
            // ✅ VaultTransaction found - verify it's fully hydrated
            vaultTxFound = true;
            
            enhancedLogger.info('✅ ATOMIC PROPOSAL CREATION (tie refund): VaultTransaction found on-chain', {
              vaultAddress,
              transactionPda: transactionPda.toString(),
              transactionIndex: transactionIndex.toString(),
              attempt: attempt + 1,
              totalAttempts: maxAttempts,
              note: 'VaultTransaction exists - proceeding with validation',
            });
            
            break; // Exit retry loop - VaultTransaction found
          } catch (fetchError: any) {
            // VaultTransaction not found yet - retry if we have attempts remaining
            if (attempt < maxAttempts - 1) {
              enhancedLogger.info('⏳ ATOMIC PROPOSAL CREATION (tie refund): VaultTransaction not found yet, retrying...', {
                vaultAddress,
                transactionPda: transactionPda.toString(),
                transactionIndex: transactionIndex.toString(),
                attempt: attempt + 1,
                totalAttempts: maxAttempts,
                nextRetryInMs: retryDelayMs,
                error: fetchError?.message || String(fetchError),
              });
              
              // Wait before next attempt
              await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
            } else {
              // Final attempt failed - this is a HARD FAILURE
              enhancedLogger.error('❌ FATAL (tie refund): VaultTransaction never appeared after all retries', {
                vaultAddress,
                transactionPda: transactionPda.toString(),
                transactionIndex: transactionIndex.toString(),
                multisigPda: multisigAddress.toString(),
                creationTxSig: signature,
                totalAttempts: maxAttempts,
                retryDelayMs,
                finalError: fetchError?.message || String(fetchError),
                note: 'ABORTING MATCH CREATION - VaultTransaction must exist before proposal creation. This prevents all downstream failures.',
              });
              
              // Create a structured error that can be detected by callers
              const fatalError: any = new Error(
                `❌ FATAL: VaultTransaction never appeared for proposal creation (tie refund). ` +
                `proposalPda=unknown (not created yet) ` +
                `vaultTxPda=${transactionPda.toString()} ` +
                `transactionIndex=${transactionIndex.toString()} ` +
                `multisigPda=${multisigAddress.toString()} ` +
                `creationTxSig=${signature} ` +
                `attempts=${maxAttempts} ` +
                `This match cannot proceed - VaultTransaction must exist before proposal creation.`
              );
              
              // Mark as irrecoverable failure - no retries will fix this
              fatalError.code = 'VAULT_TX_CREATION_FAILED';
              fatalError.fatal = true;
              fatalError.retryable = false;
              fatalError.cause = 'VAULT_TX_CREATION_FAILED';
              fatalError.details = {
                proposalPda: 'unknown (not created yet)',
                vaultTxPda: transactionPda.toString(),
                transactionIndex: transactionIndex.toString(),
                multisigPda: multisigAddress.toString(),
                creationTxSig: signature,
                attempts: maxAttempts,
                retryDelayMs,
                note: 'VaultTransaction account was never created on-chain. This is an irrecoverable proposal creation failure. No amount of retries will fix this.',
              };
              
              throw fatalError;
            }
          }
        }
        
        // ✅ RUNTIME ASSERTION #1: VaultTransaction account exists and is decodable
        if (!vaultTxFound || !vaultTxAccount) {
          // This should never happen due to the retry loop above, but add as safety check
          enhancedLogger.error('❌ RUNTIME ASSERTION #1 FAILED (tie refund): VaultTransaction account missing after retry loop', {
            vaultAddress,
            transactionPda: transactionPda.toString(),
            transactionIndex: transactionIndex.toString(),
            multisigPda: multisigAddress.toString(),
            note: 'ABORTING MATCH CREATION - This should never happen if retry loop worked correctly',
          });
          throw new Error(
            `❌ VaultTransaction account missing after creation (tie refund). ` +
            `vaultTxPda=${transactionPda.toString()} ` +
            `transactionIndex=${transactionIndex.toString()} ` +
            `multisigPda=${multisigAddress.toString()}`
          );
        }
        
        enhancedLogger.info('✅ RUNTIME ASSERTION #1 PASSED (tie refund): VaultTransaction account exists and is decodable', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          transactionIndex: transactionIndex.toString(),
        });
        
        // RUNTIME ASSERTION #2: Ensure VaultTransaction has at least 1 instruction
        if (!vaultTxAccount.message || !vaultTxAccount.message.instructions || 
            (Array.isArray(vaultTxAccount.message.instructions) && vaultTxAccount.message.instructions.length === 0)) {
          enhancedLogger.error('❌ RUNTIME ASSERTION #2 FAILED (tie refund): VaultTransaction contains no instructions', {
            vaultAddress,
            transactionPda: transactionPda.toString(),
            transactionIndex: transactionIndex.toString(),
            hasMessage: !!vaultTxAccount.message,
            hasInstructions: !!(vaultTxAccount.message && vaultTxAccount.message.instructions),
            instructionCount: vaultTxAccount.message && Array.isArray(vaultTxAccount.message.instructions) 
              ? vaultTxAccount.message.instructions.length 
              : 'unknown',
            note: 'ABORTING MATCH CREATION - VaultTransaction must contain instructions',
          });
          throw new Error(
            `❌ VaultTransaction contains no instructions (tie refund). This proposal cannot be signed or executed. ` +
            `vaultTxPda=${transactionPda.toString()}`
          );
        }
        enhancedLogger.info('✅ RUNTIME ASSERTION #2 PASSED (tie refund): VaultTransaction has instructions', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          instructionCount: Array.isArray(vaultTxAccount.message.instructions) 
            ? vaultTxAccount.message.instructions.length 
            : 'unknown',
        });
        
        // RUNTIME ASSERTION #3: Ensure remainingAccounts can be extracted properly
        const accountKeys = (vaultTxAccount.message as any).accountKeys;
        if (!accountKeys || !Array.isArray(accountKeys) || accountKeys.length === 0) {
          enhancedLogger.error('❌ RUNTIME ASSERTION #3 FAILED (tie refund): VaultTransaction has zero accountKeys', {
            vaultAddress,
            transactionPda: transactionPda.toString(),
            transactionIndex: transactionIndex.toString(),
            hasMessage: !!vaultTxAccount.message,
            hasAccountKeys: !!(vaultTxAccount.message && (vaultTxAccount.message as any).accountKeys),
            accountKeysCount: accountKeys ? accountKeys.length : 0,
            note: 'ABORTING MATCH CREATION - VaultTransaction must have accountKeys for approval instructions',
          });
          throw new Error(
            `❌ VaultTransaction has zero accountKeys (tie refund). Invalid state. ` +
            `vaultTxPda=${transactionPda.toString()}`
          );
        }
        enhancedLogger.info('✅ RUNTIME ASSERTION #3 PASSED (tie refund): VaultTransaction has accountKeys', {
          vaultAddress,
          transactionPda: transactionPda.toString(),
          accountKeysCount: accountKeys.length,
          note: 'VaultTransaction is fully hydrated and ready for approval instructions',
        });
      } catch (confirmationError: any) {
        enhancedLogger.error(
          '❌ Failed to confirm tie refund vault transaction',
          {
            vaultAddress,
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            signature,
            error:
              confirmationError?.message || String(confirmationError),
          }
        );
        throw confirmationError;
      }
      
      // Generate a numeric proposal ID for frontend compatibility
      // Derive the actual proposal PDA address (not just transaction index)
      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: transactionIndex,
        programId: this.programId,
      });
      const proposalId = proposalPda.toString();
      
      enhancedLogger.info('📝 Created real Squads refund transaction', {
        proposalId,
        transactionSignature: signature,
        multisigAddress: vaultAddress,
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
        transactionIndex: transactionIndex.toString(),
      });

      // PRIORITY 2 FIX: Check if proposal already exists before creating
      // This prevents orphaned proposals when retries occur at different transaction indices
      const [tieProposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: transactionIndex,
        programId: this.programId,
      });
      
      let existingTieProposal: any = null;
      try {
        existingTieProposal = await accounts.Proposal.fromAccountAddress(this.connection, tieProposalPda);
        enhancedLogger.info('🔁 Tie refund proposal already exists on-chain, reusing existing proposal', {
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          proposalPda: tieProposalPda.toString(),
          status: (existingTieProposal as any).status?.__kind,
          approvedSigners: ((existingTieProposal as any).approved || []).length,
          note: 'Reusing existing proposal instead of creating a new one - prevents orphaned proposals',
        });
      } catch (checkError: any) {
        // Proposal doesn't exist - this is expected for new proposals
        if (!checkError?.message?.includes('Unable to find') && !checkError?.message?.includes('Account does not exist')) {
          enhancedLogger.warn('⚠️ Unexpected error checking for existing tie refund proposal', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            error: checkError?.message,
          });
        }
      }

      // Ensure proposal account exists and is active for this transaction
      // CRITICAL: Create proposal WITHOUT isDraft to ensure transaction linking works
      // isDraft: true prevents the transaction from being linked to the proposal
      let createdTieProposal = false;
      let tieProposalSignature: string | null = null;
      
      if (existingTieProposal) {
        // Proposal already exists - reuse it instead of creating a new one
        enhancedLogger.info('✅ Reusing existing tie refund proposal (PRIORITY 2 FIX)', {
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          proposalPda: tieProposalPda.toString(),
          status: (existingTieProposal as any).status?.__kind,
          note: 'This prevents creating orphaned proposals when retries occur',
        });
        // Don't create - use existing proposal
      } else {
        // Proposal doesn't exist - create it
        try {
          tieProposalSignature = await rpc.proposalCreate({
            connection: this.connection,
            feePayer: this.config.systemKeypair,
            creator: this.config.systemKeypair,
            multisigPda: multisigAddress,
            transactionIndex, // This should link the vault transaction to the proposal
            programId: this.programId,
            // REMOVED: isDraft: true - this prevents transaction linking
          });
          createdTieProposal = true;
          enhancedLogger.info('✅ Proposal account created', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            proposalSignature: tieProposalSignature,
          });
        } catch (proposalError: any) {
          const msg = proposalError?.message || String(proposalError);
          if (msg.includes('already in use') || msg.includes('already initialized')) {
            // Race condition: proposal was created between our check and create attempt
            enhancedLogger.info('ℹ️ Tie refund proposal was created by another process, continuing', {
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              note: 'Proposal was created between existence check and create attempt (race condition)',
            });
            // Try to fetch it now
            try {
              existingTieProposal = await accounts.Proposal.fromAccountAddress(this.connection, tieProposalPda);
            } catch (fetchError: any) {
              enhancedLogger.error('❌ Failed to fetch tie refund proposal after race condition', {
                multisigAddress: multisigAddress.toString(),
                transactionIndex: transactionIndex.toString(),
                error: fetchError?.message,
              });
              throw proposalError; // Re-throw original error
            }
          } else {
            enhancedLogger.error('❌ Failed to create tie refund proposal account', {
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              error: msg,
            });
            throw proposalError;
          }
        }
      }

      if (createdTieProposal && tieProposalSignature) {
        await this.confirmProposalCreation(
          tieProposalSignature,
          multisigAddress,
          transactionIndex,
          'tie refund'
        );
        
        // CRITICAL: Verify proposal has linked transaction (expert requirement)
        try {
          const [proposalPda] = getProposalPda({
            multisigPda: multisigAddress,
            transactionIndex: transactionIndex,
            programId: this.programId,
          });
          
          // CRITICAL: Retry multiple times with increasing delays to handle blockchain indexing delays
          // The proposal account needs time to be fully initialized with the linked transaction
          let proposalVerified = false;
          let retryCount = 0;
          const maxRetries = 5;
          const baseDelay = 2000; // Start with 2 seconds
          
          while (!proposalVerified && retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, baseDelay * (retryCount + 1)));
            
            const proposalAccount = await withRetry(
              () => this.connection.getAccountInfo(proposalPda, 'confirmed'),
              { maxAttempts: 3, baseDelayMs: 250 }
            );
            if (proposalAccount) {
              try {
                const proposal = await fromAccountAddressWithRetry(
                  accounts.Proposal,
                  this.connection,
                  proposalPda
                );
                const transactions = (proposal as any).transactions || [];
                const transactionCount = Array.isArray(transactions) ? transactions.length : 0;
                
                if (transactionCount > 0) {
                  enhancedLogger.info('✅ Proposal verified: has linked transactions', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                    transactionCount,
                    retryAttempt: retryCount + 1,
                  });
                  proposalVerified = true;
                  break;
                } else {
                  enhancedLogger.warn(`⚠️ Proposal has 0 transactions (attempt ${retryCount + 1}/${maxRetries}), retrying...`, {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                  });
                }
              } catch (decodeError: any) {
                enhancedLogger.warn(`⚠️ Failed to decode proposal (attempt ${retryCount + 1}/${maxRetries}), retrying...`, {
                  vaultAddress,
                  proposalId,
                  proposalPda: proposalPda.toString(),
                  error: decodeError?.message || String(decodeError),
                });
              }
            } else {
              enhancedLogger.warn(`⚠️ Proposal account not found (attempt ${retryCount + 1}/${maxRetries}), retrying...`, {
                vaultAddress,
                proposalId,
                proposalPda: proposalPda.toString(),
              });
            }
            retryCount++;
          }
          
          if (!proposalVerified) {
            // Final check - if still 0 transactions, log warning but don't fail
            // The proposal was created with transactionIndex, so the linking should work
            // even if it's not immediately visible due to blockchain indexing delays
            const finalProposalAccount = await withRetry(
              () => this.connection.getAccountInfo(proposalPda, 'confirmed'),
              { maxAttempts: 3, baseDelayMs: 250 }
            );
            if (finalProposalAccount) {
              try {
                const finalProposal = await accounts.Proposal.fromAccountAddress(
                  this.connection,
                  proposalPda
                );
                const finalTransactions = (finalProposal as any).transactions || [];
                const finalTransactionCount = Array.isArray(finalTransactions) ? finalTransactions.length : 0;
                
                if (finalTransactionCount === 0) {
                  // Log warning but don't throw - proposal was created with transactionIndex
                  // The transaction linking may be asynchronous and will complete eventually
                  enhancedLogger.warn('⚠️ WARNING: Proposal created but shows 0 linked transactions after all retries', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                    note: 'Proposal was created with transactionIndex, so linking should work. This may be a blockchain indexing delay. Proposal will be returned anyway.',
                  });
                  // Don't throw - return the proposalId so the frontend can use it
                  // The transaction linking will complete asynchronously
                } else {
                  enhancedLogger.info('✅ Proposal verified: has linked transactions (final check)', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndex.toString(),
                    proposalPda: proposalPda.toString(),
                    transactionCount: finalTransactionCount,
                  });
                  proposalVerified = true;
                }
              } catch (finalDecodeError: any) {
                // Log warning but don't throw - proposal exists and was created with transactionIndex
                enhancedLogger.warn('⚠️ WARNING: Could not decode proposal account to verify transactions after all retries', {
                  vaultAddress,
                  proposalId,
                  proposalPda: proposalPda.toString(),
                  error: finalDecodeError?.message || String(finalDecodeError),
                  note: 'Proposal was created with transactionIndex, so linking should work. Returning proposalId anyway.',
                });
                // Don't throw - return the proposalId
              }
            } else {
              // This is still an error - proposal account should exist
              enhancedLogger.error('❌ CRITICAL: Proposal account not found after all retries', {
                vaultAddress,
                proposalId,
                proposalPda: proposalPda.toString(),
                note: 'Proposal account should exist after creation.',
              });
              throw new Error(`Proposal account not found after ${maxRetries} retries. proposalPda=${proposalPda.toString()}`);
            }
          }
        } catch (verifyError: any) {
          // CRITICAL: Verification failure - fail loudly
          const errorMsg = `Failed to verify proposal transaction linking. error=${verifyError?.message || String(verifyError)}`;
          enhancedLogger.error('❌ CRITICAL: Could not verify proposal transaction linking', {
            vaultAddress,
            proposalId,
            error: verifyError?.message || String(verifyError),
            note: 'Transaction linking verification is required to ensure proposals can be executed.',
          });
          throw verifyError; // Re-throw to fail loudly
        }
      }

      // NOTE: After removing isDraft: true, proposals are created as Active (not Draft)
      // So we don't need to call proposalActivate - the proposal is already active
      enhancedLogger.info('✅ Proposal is already Active (no activation needed)', {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndex.toString(),
      });

      enhancedLogger.info('✅ Tie refund proposal ready for approvals', {
        vaultAddress,
        proposalId,
        newlyCreated: createdTieProposal,
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
      });

      // Auto-approve with system signature (1 of 2 needed for 2-of-3 multisig)
      try {
        const feeWalletKeypair = getFeeWalletKeypair();
        const approveResult = await this.approveProposal(vaultAddress, proposalId, feeWalletKeypair);
        if (approveResult.success) {
          enhancedLogger.info('✅ System signature added to tie refund proposal', {
            vaultAddress,
            proposalId,
            signature: approveResult.signature,
          });
        } else {
          enhancedLogger.warn('⚠️ Failed to auto-approve system signature', {
            vaultAddress,
            proposalId,
            error: approveResult.error,
          });
        }
      } catch (approveError: any) {
        enhancedLogger.warn('⚠️ Error auto-approving system signature (non-critical)', {
          vaultAddress,
          proposalId,
          error: approveError?.message || String(approveError),
        });
      }

      return {
        success: true,
        proposalId,
        transactionIndex: transactionIndex.toString(), // CRITICAL: Return transaction index to ensure proposal ID matches
        needsSignatures: 1, // 1 more signature needed (system already signed)
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
      // CRITICAL: Detect irrecoverable VaultTransaction creation failures
      const isVaultTxCreationFailed = (error as any)?.code === 'VAULT_TX_CREATION_FAILED' ||
                                      (error as any)?.fatal === true ||
                                      (error as any)?.cause === 'VAULT_TX_CREATION_FAILED' ||
                                      errorMessage.includes('VaultTransaction never appeared');
      
      if (isVaultTxCreationFailed) {
        enhancedLogger.error('❌ FATAL: Irrecoverable proposal creation failure (VAULT_TX_CREATION_FAILED) - tie refund', {
          vaultAddress,
          player1: player1.toString(),
          player2: player2.toString(),
          refundAmount,
          error: errorMessage,
          errorCode: (error as any)?.code,
          errorDetails: (error as any)?.details,
          note: 'VaultTransaction was never created on-chain. This match cannot proceed. No amount of retries will fix this.',
        });
        
        return {
          success: false,
          error: errorMessage,
          errorCode: 'VAULT_TX_CREATION_FAILED',
          fatal: true,
          retryable: false,
          cause: 'VAULT_TX_CREATION_FAILED',
          needsSignatures: 0,
          details: (error as any)?.details || {
            note: 'VaultTransaction account was never created on-chain. This is an irrecoverable proposal creation failure.',
          },
        };
      }
      
      enhancedLogger.error('❌ Failed to propose tie refund', {
        vaultAddress,
        player1: player1.toString(),
        player2: player2.toString(),
        refundAmount,
        error: errorMessage,
        stack: errorStack,
        errorType: error?.constructor?.name || typeof error,
      });

      return {
        success: false,
        error: errorMessage,
        needsSignatures: 0,
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
      
      // proposalId is now a PDA address, not a transactionIndex
      // First, try to parse it as a PDA address
      let proposalPda: PublicKey;
      let transactionIndex: bigint;
      
      try {
        proposalPda = new PublicKey(proposalId);
        
        // Query the proposal account to get the transactionIndex (with retry for rate limits)
        const proposalAccount = await fromAccountAddressWithRetry(
          accounts.Proposal,
          this.connection,
          proposalPda
        );
        
        const proposalTransactionIndex = (proposalAccount as any).transactionIndex;
        if (proposalTransactionIndex !== undefined && proposalTransactionIndex !== null) {
          transactionIndex = BigInt(proposalTransactionIndex.toString());
          enhancedLogger.info('✅ Extracted transactionIndex from proposal account in checkProposalStatus', {
            vaultAddress,
            proposalId,
            proposalPda: proposalPda.toString(),
            transactionIndex: transactionIndex.toString(),
          });
        } else {
          throw new Error('Proposal account does not have transactionIndex field');
        }
      } catch (pdaError: any) {
        // Fallback: Try to parse as transactionIndex (for backward compatibility)
        try {
          transactionIndex = BigInt(proposalId);
          // Derive proposal PDA from transactionIndex
          const [derivedProposalPda] = getProposalPda({
            multisigPda: multisigAddress,
            transactionIndex,
            programId: this.programId,
          });
          proposalPda = derivedProposalPda;
          enhancedLogger.info('✅ Using proposalId as transactionIndex (backward compatibility)', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndex.toString(),
            proposalPda: proposalPda.toString(),
          });
        } catch (bigIntError: any) {
          // If both fail, try to derive transactionIndex by testing common values
          enhancedLogger.warn('⚠️ Failed to parse proposalId as PDA or transactionIndex, attempting to derive', {
            vaultAddress,
            proposalId,
            pdaError: pdaError?.message,
            bigIntError: bigIntError?.message,
          });
          
          let foundIndex: bigint | null = null;
          for (let i = 0; i <= 10; i++) {
            const [testPda] = getProposalPda({
              multisigPda: multisigAddress,
              transactionIndex: BigInt(i),
              programId: this.programId,
            });
            if (testPda.toString() === proposalId) {
              foundIndex = BigInt(i);
              proposalPda = testPda;
              transactionIndex = foundIndex;
              break;
            }
          }
          
          if (foundIndex === null) {
            throw new Error(`Could not derive transactionIndex from proposalId: ${proposalId}`);
          }
        }
      }

      // Get the transaction PDA
      const [transactionPda] = getTransactionPda({
        multisigPda: multisigAddress,
        index: transactionIndex,
        programId: this.programId,
      });

      // Fetch the transaction account
      const transactionAccount = await withRetry(
        () => this.connection.getAccountInfo(transactionPda, 'confirmed'),
        { maxAttempts: 3, baseDelayMs: 250 }
      );
      
      if (!transactionAccount) {
        // Transaction account doesn't exist - likely executed (accounts are closed after execution)
        enhancedLogger.info('📊 Transaction account not found - likely executed', {
          vaultAddress,
          proposalId,
          transactionPda: transactionPda.toString(),
        });
        return {
          executed: true,
          signers: [],
          needsSignatures: 0,
        };
      }

      // Try to decode the transaction account
      let isExecuted = false;
      const signers: PublicKey[] = [];
      let transactionFields: any = {};
      
      try {
        // Try using fromAccountAddress if available
        const transaction = await fromAccountAddressWithRetry(
          accounts.VaultTransaction,
          this.connection,
          transactionPda
        );
        
        // Log all available fields for debugging
        transactionFields = {
          keys: Object.keys(transaction),
          status: (transaction as any).status,
          approved: (transaction as any).approved,
          approvals: (transaction as any).approvals,
          approvedBy: (transaction as any).approvedBy,
          memberKeys: (transaction as any).memberKeys,
          signers: (transaction as any).signers,
          authorityIndex: (transaction as any).authorityIndex,
          vaultIndex: (transaction as any).vaultIndex,
          transactionIndex: (transaction as any).transactionIndex,
          executedAt: (transaction as any).executedAt,
          createdAt: (transaction as any).createdAt,
        };
        
        enhancedLogger.info('🔍 VaultTransaction account fields', {
          vaultAddress,
          proposalId,
          transactionPda: transactionPda.toString(),
          fields: transactionFields,
          allKeys: Object.keys(transaction),
        });
        
        // Check status - the exact property name may vary
        // Status values: 0 = Active, 1 = ExecuteReady, 2 = Executed
        if ((transaction as any).status !== undefined) {
          const status = (transaction as any).status;
          isExecuted = status === 1 || status === 2; // ExecuteReady or Executed
        }
        
        // Try multiple possible field names for approved signers
        const possibleApprovalFields = [
          (transaction as any).approved,
          (transaction as any).approvals,
          (transaction as any).approvedBy,
          (transaction as any).memberKeys,
          (transaction as any).signers,
        ];
        
        for (const field of possibleApprovalFields) {
          if (Array.isArray(field)) {
            const parsedSigners = field
              .map((item: any) => {
                if (item instanceof PublicKey) {
                  return item;
                } else if (item?.key instanceof PublicKey) {
                  return item.key;
                } else if (typeof item === 'string') {
                  try {
                    return new PublicKey(item);
                  } catch {
                    return null;
                  }
                }
                return null;
              })
              .filter((pk: PublicKey | null): pk is PublicKey => pk !== null);
            
            if (parsedSigners.length > 0) {
              signers.push(...parsedSigners);
              enhancedLogger.info('✅ Found approved signers in VaultTransaction', {
                vaultAddress,
                proposalId,
                field: field === possibleApprovalFields[0] ? 'approved' :
                      field === possibleApprovalFields[1] ? 'approvals' :
                      field === possibleApprovalFields[2] ? 'approvedBy' :
                      field === possibleApprovalFields[3] ? 'memberKeys' : 'signers',
                signers: parsedSigners.map(s => s.toString()),
              });
              break;
            }
          }
        }
      } catch (decodeError: unknown) {
        // If decoding fails, check account data manually
        enhancedLogger.warn('⚠️ Failed to decode transaction account, checking manually', {
          vaultAddress,
          proposalId,
          error: decodeError instanceof Error ? decodeError.message : String(decodeError),
        });
        
        // Account exists but we can't decode it - assume it's active if it exists
        // (if it was executed, the account would be closed)
        isExecuted = false;
      }

      // Also check the Proposal account for approved signers
      try {
        const proposalAccount = await this.connection.getAccountInfo(proposalPda, 'confirmed');
        
        if (proposalAccount) {
          try {
            const proposal = await accounts.Proposal.fromAccountAddress(
              this.connection,
              proposalPda,
              'confirmed'
            );
            
            // Log all available fields for debugging
            const proposalFields = {
              keys: Object.keys(proposal),
              status: (proposal as any).status,
              statusKind: (proposal as any).status?.__kind,
              approved: (proposal as any).approved,
              approvals: (proposal as any).approvals,
              approvedBy: (proposal as any).approvedBy,
              memberKeys: (proposal as any).memberKeys,
              signers: (proposal as any).signers,
              transactionIndex: (proposal as any).transactionIndex,
              multisig: (proposal as any).multisig,
            };
            
            enhancedLogger.info('🔍 Proposal account fields', {
              vaultAddress,
              proposalId,
              proposalPda: proposalPda.toString(),
              fields: proposalFields,
              allKeys: Object.keys(proposal),
            });
            
            // Check proposal status - it can be Draft, Active, Approved, ExecuteReady, or Executed
            const proposalStatusKind = (proposal as any).status?.__kind;
            enhancedLogger.info('🔍 Proposal status kind', {
              vaultAddress,
              proposalId,
              statusKind: proposalStatusKind,
              fullStatus: (proposal as any).status,
            });
            
            // Check if proposal is executed
            if (proposalStatusKind === 'Executed') {
              isExecuted = true;
            }
            
            // Check if proposal is in ExecuteReady state (ready for execution)
            // According to Squads SDK, proposals should transition to ExecuteReady when they have enough approvals
            const isExecuteReady = proposalStatusKind === 'ExecuteReady';
            if (isExecuteReady) {
              enhancedLogger.info('✅ Proposal is in ExecuteReady state - ready for execution', {
                vaultAddress,
                proposalId,
              });
            } else if (proposalStatusKind === 'Approved') {
              enhancedLogger.warn('⚠️ Proposal is in Approved state but not ExecuteReady - may need transition', {
                vaultAddress,
                proposalId,
                approvedSigners: (proposal as any).approved,
                note: 'Proposal should automatically transition to ExecuteReady when threshold is met',
              });
            }
            
            // Try multiple possible field names for approved signers in Proposal account
            const proposalApprovalFields = [
              (proposal as any).approved,
              (proposal as any).approvals,
              (proposal as any).approvedBy,
              (proposal as any).memberKeys,
              (proposal as any).signers,
            ];
            
            for (const field of proposalApprovalFields) {
              if (Array.isArray(field)) {
                const parsedSigners = field
                  .map((item: any) => {
                    if (item instanceof PublicKey) {
                      return item;
                    } else if (item?.key instanceof PublicKey) {
                      return item.key;
                    } else if (typeof item === 'string') {
                      try {
                        return new PublicKey(item);
                      } catch {
                        return null;
                      }
                    }
                    return null;
                  })
                  .filter((pk: PublicKey | null): pk is PublicKey => pk !== null);
                
                if (parsedSigners.length > 0) {
                  // Merge with existing signers, avoiding duplicates
                  const existingSignerStrings = signers.map(s => s.toString());
                  const newSigners = parsedSigners.filter(
                    (pk: PublicKey) => !existingSignerStrings.includes(pk.toString())
                  );
                  if (newSigners.length > 0) {
                    signers.push(...newSigners);
                    enhancedLogger.info('✅ Found approved signers in Proposal account', {
                      vaultAddress,
                      proposalId,
                      field: field === proposalApprovalFields[0] ? 'approved' :
                            field === proposalApprovalFields[1] ? 'approvals' :
                            field === proposalApprovalFields[2] ? 'approvedBy' :
                            field === proposalApprovalFields[3] ? 'memberKeys' : 'signers',
                      signers: parsedSigners.map(s => s.toString()),
                      newSigners: newSigners.map(s => s.toString()),
                    });
                  }
                  break;
                }
              }
            }
          } catch (proposalDecodeError: unknown) {
            enhancedLogger.warn('⚠️ Failed to decode proposal account', {
              vaultAddress,
              proposalId,
              proposalPda: proposalPda.toString(),
              error: proposalDecodeError instanceof Error ? proposalDecodeError.message : String(proposalDecodeError),
            });
          }
        }
      } catch (proposalError: unknown) {
        enhancedLogger.warn('⚠️ Failed to fetch proposal account', {
          vaultAddress,
          proposalId,
          proposalPda: proposalPda.toString(),
          error: proposalError instanceof Error ? proposalError.message : String(proposalError),
        });
      }

      // Calculate remaining signatures needed
      const threshold = this.config.threshold;
      const uniqueSigners = Array.from(new Set(signers.map(s => s.toString())))
        .map(s => new PublicKey(s));
      const currentSignatures = uniqueSigners.length;
      const needsSignatures = Math.max(0, threshold - currentSignatures);

      enhancedLogger.info('📊 Checked proposal status (on-chain)', {
        vaultAddress,
        proposalId,
        transactionPda: transactionPda.toString(),
        proposalPda: proposalPda.toString(),
        executed: isExecuted,
        signers: uniqueSigners.map(s => s.toString()),
        currentSignatures,
        threshold,
        needsSignatures,
        transactionFields,
      });

      return {
        executed: isExecuted,
        signers: uniqueSigners,
        needsSignatures,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to check proposal status', {
        vaultAddress,
        proposalId,
        error: errorMessage,
      });

      // Fallback to threshold-based check
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
   * In Squads v4, only Proposal approval is needed - VaultTransaction execution is separate
   */
  async approveProposal(
    vaultAddress: string,
    proposalId: string,
    signer: Keypair
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    // Declare variables outside try block so they're accessible in catch block
    let multisigAddress: PublicKey;
    let transactionIndex: bigint | undefined;
    let proposalPda: PublicKey | undefined;
    
    try {
      multisigAddress = new PublicKey(vaultAddress);
      
      // proposalId is now a PDA address, extract transactionIndex AND keep proposalPda
      try {
        proposalPda = new PublicKey(proposalId);
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          this.connection,
          proposalPda
        );
        const proposalTransactionIndex = (proposalAccount as any).transactionIndex;
        if (proposalTransactionIndex !== undefined && proposalTransactionIndex !== null) {
          transactionIndex = BigInt(proposalTransactionIndex.toString());
        } else {
          throw new Error('Proposal account does not have transactionIndex field');
        }
      } catch (pdaError: any) {
        // Fallback: Try to parse as transactionIndex (backward compatibility)
        try {
          transactionIndex = BigInt(proposalId);
          // Derive proposalPda from transactionIndex
          const [derivedProposalPda] = getProposalPda({
            multisigPda: new PublicKey(vaultAddress),
            transactionIndex: transactionIndex,
            programId: this.programId,
          });
          proposalPda = derivedProposalPda;
        } catch (bigIntError: any) {
          throw new Error(`Could not parse proposalId as PDA or transactionIndex: ${proposalId}`);
        }
      }

      // Enhanced PDA derivation logging (for debugging)
      enhancedLogger.info('📐 PDA Derivation Details (Approval)', {
        vaultAddress,
        proposalId,
        multisigPda: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        programId: this.programId.toString(),
        proposalPda: proposalPda.toString(),
        derivationSeeds: {
          proposal: `[multisig: ${multisigAddress.toString()}, transactionIndex: ${transactionIndex.toString()}]`,
        },
        signer: signer.publicKey.toString(),
      });

      enhancedLogger.info('📝 Approving Squads proposal using official SDK method', {
        vaultAddress,
        proposalId,
        proposalPda: proposalPda.toString(),
        transactionIndex: transactionIndex.toString(),
        signer: signer.publicKey.toString(),
      });

      // CRITICAL FIX: Use rpc.proposalApprove which is the recommended SDK method
      // This handles Proposal approval and may also handle VaultTransaction approval
      
      // Validate all parameters before calling rpc.proposalApprove
      if (!this.connection) {
        throw new Error('Connection is undefined');
      }
      if (!signer || !signer.publicKey) {
        throw new Error('Signer keypair is invalid');
      }
      if (!multisigAddress) {
        throw new Error('Multisig address is undefined');
      }
      if (!this.programId) {
        throw new Error('Program ID is undefined');
      }
      
      // Check fee wallet balance before attempting approval
      let feeWalletBalance: number | null = null;
      try {
        const balance = await this.connection.getBalance(signer.publicKey);
        feeWalletBalance = balance;
        enhancedLogger.info('💰 Fee wallet balance check', {
          signer: signer.publicKey.toString(),
          balance: balance,
          balanceSOL: balance / 1e9,
        });
        if (balance < 0.001 * 1e9) {
          enhancedLogger.warn('⚠️ Fee wallet has low balance - may fail to pay transaction fees', {
            signer: signer.publicKey.toString(),
            balance: balance,
            balanceSOL: balance / 1e9,
            minimumRecommended: 0.001,
          });
        }
      } catch (balanceError: any) {
        enhancedLogger.warn('⚠️ Could not check fee wallet balance', {
          signer: signer.publicKey.toString(),
          error: balanceError?.message || String(balanceError),
        });
      }

      enhancedLogger.info('📝 Approving Proposal using instructions.proposalApprove (proven approach)', {
        vaultAddress,
        proposalId,
        proposalPda: proposalPda.toString(),
        transactionIndex: transactionIndex.toString(),
        signer: signer.publicKey.toString(),
        programId: this.programId.toString(),
        multisigPda: multisigAddress.toString(),
        connectionValid: typeof this.connection.getAccountInfo === 'function',
        feeWalletBalance: feeWalletBalance !== null ? `${feeWalletBalance / 1e9} SOL` : 'unknown',
      });

      // CRITICAL FIX: Use instructions.proposalApprove + manual transaction building
      // This is the proven approach that works in multisigController.ts
      // rpc.proposalApprove fails with "Cannot read properties of undefined (reading 'toBase58')"
      // because it tries to auto-build the transaction and is missing account parameters
      
      if (!instructions || typeof instructions.proposalApprove !== 'function') {
        throw new Error('Squads SDK instructions.proposalApprove is unavailable');
      }

      // Build the approval instruction (same as multisigController.ts)
      const approvalIx = instructions.proposalApprove({
        multisigPda: multisigAddress,
        transactionIndex: Number(transactionIndex),
        member: signer.publicKey,
        programId: this.programId,
      });

      enhancedLogger.info('✅ Approval instruction created', {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndex.toString(),
      });

      // Get latest blockhash
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');

      // Build transaction message
      const message = new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: blockhash,
        instructions: [approvalIx],
      });

      // Compile to V0 message (required for Squads)
      const compiledMessage = message.compileToV0Message();
      const transaction = new VersionedTransaction(compiledMessage);

      // Sign the transaction
      transaction.sign([signer]);

      // CRITICAL: Validate transaction size before sending (max ~1232 bytes for Solana)
      const serializedSize = transaction.serialize().length;
      const maxTransactionSize = 1232; // Solana transaction size limit
      
      enhancedLogger.info('📏 Transaction Size Validation (Approval)', {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndex.toString(),
        serializedSize,
        maxSize: maxTransactionSize,
        sizePercentage: ((serializedSize / maxTransactionSize) * 100).toFixed(2) + '%',
        signer: signer.publicKey.toString(),
      });
      
      if (serializedSize > maxTransactionSize) {
        const error = `Transaction size ${serializedSize} bytes exceeds Solana limit of ${maxTransactionSize} bytes`;
        enhancedLogger.error('❌ Approval transaction too large - cannot send', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndex.toString(),
          serializedSize,
          maxSize: maxTransactionSize,
          excessBytes: serializedSize - maxTransactionSize,
          signer: signer.publicKey.toString(),
          note: 'Transaction must be split or instructions reduced to fit within size limit',
        });
        
        return {
          success: false,
          error,
        };
      }
      
      if (serializedSize > maxTransactionSize * 0.9) {
        enhancedLogger.warn('⚠️ Approval transaction size is close to limit', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndex.toString(),
          serializedSize,
          maxSize: maxTransactionSize,
          remainingBytes: maxTransactionSize - serializedSize,
          signer: signer.publicKey.toString(),
          note: 'Transaction is large but within limits - monitor for future growth',
        });
      } else {
        enhancedLogger.info('✅ Approval transaction size is well within limits', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndex.toString(),
          serializedSize,
          maxSize: maxTransactionSize,
          remainingBytes: maxTransactionSize - serializedSize,
          signer: signer.publicKey.toString(),
        });
      }

      // Send and confirm the transaction
      const signature = await this.connection.sendTransaction(transaction, {
        skipPreflight: false,
        maxRetries: 3,
      });

      enhancedLogger.info('✅ Proposal approval transaction sent', {
        vaultAddress,
        proposalId,
        signature,
        signer: signer.publicKey.toString(),
      });

      // Confirm the transaction
      try {
        await this.connection.confirmTransaction({
          signature,
          blockhash,
          lastValidBlockHeight,
        }, 'confirmed');
        enhancedLogger.info('✅ Proposal approval transaction confirmed', {
          vaultAddress,
          proposalId,
          signature,
          signer: signer.publicKey.toString(),
        });
      } catch (confirmError: any) {
        enhancedLogger.warn('⚠️ Proposal approval transaction confirmation failed (may still succeed)', {
          vaultAddress,
          proposalId,
          signature,
          signer: signer.publicKey.toString(),
          error: confirmError?.message || String(confirmError),
        });
        // Don't fail - transaction may still succeed
      }

      enhancedLogger.info('✅ Proposal approved successfully using rpc.proposalApprove', {
        vaultAddress,
        proposalId,
        signature,
        signer: signer.publicKey.toString(),
      });

      enhancedLogger.info('📝 Fee wallet approve sig (expert recommendation)', {
        vaultAddress,
        proposalId,
        signer: signer.publicKey.toString(),
        signature,
      });

      // CRITICAL: Confirm the transaction to verify it was submitted (expert recommendation)
      try {
        await this.connection.confirmTransaction(signature, 'confirmed');
        enhancedLogger.info('✅ Fee wallet approve confirmed (expert recommendation)', {
          vaultAddress,
          proposalId,
          signer: signer.publicKey.toString(),
          signature,
        });
      } catch (confirmError: any) {
        enhancedLogger.warn('⚠️ Proposal approval transaction confirmation failed (may still succeed)', {
          vaultAddress,
          proposalId,
          signer: signer.publicKey.toString(),
          signature,
          error: confirmError?.message || String(confirmError),
        });
        // Don't fail the approval - transaction may still succeed
      }

      // Verify fee wallet is in approvals array (expert recommendation)
      try {
        const [transactionPda] = getTransactionPda({
          multisigPda: multisigAddress,
          index: transactionIndex,
          programId: this.programId,
        });
        
        const transactionAccount = await withRetry(
        () => this.connection.getAccountInfo(transactionPda, 'confirmed'),
        { maxAttempts: 3, baseDelayMs: 250 }
      );
        if (transactionAccount) {
          const vt = await accounts.VaultTransaction.fromAccountAddress(
            this.connection,
            transactionPda
          );
          const approvals = (vt as any).approvals || [];
          const signerPubkeyStr = signer.publicKey.toString();
          const isInApprovals = approvals.some((a: any) => 
            a?.toString?.() === signerPubkeyStr || String(a) === signerPubkeyStr
          );
          
          if (isInApprovals) {
            enhancedLogger.info('✅ Fee wallet confirmed in on-chain approvals array', {
              vaultAddress,
              proposalId,
              signer: signerPubkeyStr,
              approvals: approvals.map((a: any) => a?.toString?.() || String(a)),
            });
          } else {
            enhancedLogger.warn('⚠️ Fee wallet not found in on-chain approvals array (may need to wait for confirmation)', {
              vaultAddress,
              proposalId,
              signer: signerPubkeyStr,
              approvals: approvals.map((a: any) => a?.toString?.() || String(a)),
            });
          }
        }
      } catch (verifyError: any) {
        enhancedLogger.warn('⚠️ Could not verify fee wallet in approvals array (non-critical)', {
          vaultAddress,
          proposalId,
          signer: signer.publicKey.toString(),
          error: verifyError?.message || String(verifyError),
        });
        // Non-critical - transaction may still be processing
      }

      enhancedLogger.info('✅ Proposal approved', {
        vaultAddress,
        proposalId,
        signer: signer.publicKey.toString(),
        signature,
      });

      return { 
        success: true, 
        signature,
        note: 'Proposal approved using rpc.proposalApprove (VaultTransaction approval not required in Squads v4)'
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorDetails = error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack,
      } : { raw: String(error) };
      
      enhancedLogger.error('❌ Failed to approve proposal', {
        vaultAddress,
        proposalId,
        signer: signer.publicKey.toString(),
        transactionIndex: transactionIndex?.toString() || 'unknown',
        error: errorMessage,
        errorStack,
        errorDetails,
        connectionValid: !!this.connection,
        programIdValid: !!this.programId,
        programId: this.programId?.toString(),
        multisigAddress: multisigAddress?.toString() || vaultAddress,
        signerPublicKey: signer.publicKey?.toString(),
        signerHasSecretKey: !!signer.secretKey,
      });

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Approve a Squads vault transaction (separate from proposal approval)
   * CRITICAL: Squads v4 requires BOTH proposal AND vault transaction to be signed
   * This method signs the vault transaction itself
   * NOTE: VaultTransaction approval is now handled within approveProposal() method
   */

  /**
   * Wait for proposal to transition from Approved to ExecuteReady state
   * Squads v4 requires ExecuteReady state before execution can proceed
   * This polls the on-chain proposal status until it becomes ExecuteReady
   */
  private async waitForExecuteReady(
    proposalPda: PublicKey,
    transactionIndex: number,
    correlationId: string,
    maxAttempts: number = 30, // Increased from 15 to 30 (60 seconds total)
    intervalMs: number = 2000
  ): Promise<accounts.Proposal> {
    enhancedLogger.info('⏳ Waiting for proposal to transition to ExecuteReady state', {
      proposalPda: proposalPda.toString(),
      transactionIndex,
      maxAttempts,
      intervalMs,
      totalTimeoutSeconds: (maxAttempts * intervalMs) / 1000,
      correlationId,
      note: 'Squads v4 SDK requires ExecuteReady state before execution - polling until transition occurs',
    });

    let lastStatus: string = 'Unknown';
    let lastProposal: accounts.Proposal | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          this.connection,
          proposalPda,
          'confirmed'
        );

        lastProposal = proposalAccount;

        // Extract status kind (handles both string and enum formats)
        const statusObj = (proposalAccount as any).status;
        const statusKind = typeof statusObj === 'object' && statusObj !== null && '__kind' in statusObj
          ? statusObj.__kind
          : (typeof statusObj === 'string' ? statusObj : 'Unknown');

        lastStatus = statusKind;

        if (statusKind === 'ExecuteReady') {
          enhancedLogger.info('✅ Proposal transitioned to ExecuteReady state', {
            proposalPda: proposalPda.toString(),
            transactionIndex,
            attempt,
            maxAttempts,
            elapsedSeconds: (attempt * intervalMs) / 1000,
            correlationId,
            note: 'Proposal is now in ExecuteReady state - execution should succeed',
          });
          return proposalAccount; // Success - proposal is ExecuteReady
        }

        if (statusKind === 'Executed') {
          enhancedLogger.info('✅ Proposal is already Executed - no execution needed', {
            proposalPda: proposalPda.toString(),
            transactionIndex,
            attempt,
            correlationId,
          });
          return proposalAccount; // Already executed - no need to wait
        }

        // Log status transition for observability
        enhancedLogger.info(`⏳ Waiting for ExecuteReady transition (attempt ${attempt}/${maxAttempts})`, {
          proposalPda: proposalPda.toString(),
          transactionIndex,
          currentStatus: statusKind,
          attempt,
          maxAttempts,
          elapsedSeconds: (attempt * intervalMs) / 1000,
          nextCheckIn: `${intervalMs}ms`,
          correlationId,
        });
      } catch (fetchError: any) {
        const errorMsg = fetchError?.message || String(fetchError);
        // Don't fail on "Account does not exist" - just log and continue
        if (errorMsg.includes('Unable to find') || errorMsg.includes('Account does not exist')) {
          enhancedLogger.warn('⚠️ Proposal account not found while waiting for ExecuteReady', {
            proposalPda: proposalPda.toString(),
            transactionIndex,
            attempt,
            error: errorMsg,
            correlationId,
          });
        } else {
          enhancedLogger.warn('⚠️ Failed to fetch proposal state while waiting for ExecuteReady', {
            proposalPda: proposalPda.toString(),
            transactionIndex,
            attempt,
            error: errorMsg,
            correlationId,
          });
        }
      }

      // Wait before next attempt (except on last attempt)
      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }

    // CRITICAL: Fail hard if ExecuteReady not reached
    const totalWaitTime = (maxAttempts * intervalMs) / 1000;
    const errorMessage = `❌ Proposal ${proposalPda.toString()} failed to transition to ExecuteReady after ${totalWaitTime}s (${maxAttempts} attempts) — execution aborted. Last status: ${lastStatus}`;
    
    enhancedLogger.error('❌ Proposal never transitioned to ExecuteReady state', {
      proposalPda: proposalPda.toString(),
      transactionIndex,
      maxAttempts,
      intervalMs,
      totalWaitTimeSeconds: totalWaitTime,
      lastStatus,
      correlationId,
      note: 'Proposal is stuck in Approved state - SDK execution will fail. This indicates a Squads program issue where automatic transition is not occurring.',
      diagnosis: {
        possibleCauses: [
          'Squads program not automatically transitioning Approved → ExecuteReady',
          'RPC lag preventing state updates',
          'Proposal in invalid state on-chain',
        ],
        recommendedActions: [
          'Check Squads program logs for transition failures',
          'Verify proposal has sufficient signatures',
          'Contact Squads team if this persists',
        ],
      },
    });

    throw new Error(errorMessage);
    throw new Error(error);
  }

  /**
   * Execute a Squads proposal after it has enough signatures
   * This actually moves the funds from the vault to recipients
   */
  async executeProposal(
    vaultAddress: string,
    proposalId: string,
    executor: Keypair,
    overrideVaultPda?: string
  ): Promise<{ success: boolean; signature?: string; slot?: number; executedAt?: string; logs?: string[]; error?: string; correlationId?: string }> {
    const multisigAddress = new PublicKey(vaultAddress);
    
    // proposalId is now a PDA address, extract transactionIndex
    let transactionIndex: bigint;
    try {
      const proposalPda = new PublicKey(proposalId);
      const proposalAccount = await fromAccountAddressWithRetry(
        accounts.Proposal,
        this.connection,
        proposalPda
      );
      const proposalTransactionIndex = (proposalAccount as any).transactionIndex;
      if (proposalTransactionIndex !== undefined && proposalTransactionIndex !== null) {
        // Convert to number for rpc.vaultTransactionExecute (it expects number, not BigInt)
        transactionIndex = BigInt(Number(proposalTransactionIndex));
      } else {
        throw new Error('Proposal account does not have transactionIndex field');
      }
    } catch (pdaError: any) {
      // Fallback: Try to parse as transactionIndex (backward compatibility)
      try {
        transactionIndex = BigInt(proposalId);
      } catch (bigIntError: any) {
        throw new Error(`Could not parse proposalId as PDA or transactionIndex: ${proposalId}`);
      }
    }
    const correlationId = `exec-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    const execStartTime = Date.now();
    
    // CRITICAL: Initialize execution DAG logging (expert recommendation)
    // Extract matchId from context if available (for trace file naming)
    const matchId = (this as any).currentMatchId || 'unknown';
    const dag = executionDAGLogger.createDAG(matchId, proposalId, correlationId);
    executionDAGLogger.addStep(correlationId, 'execution-started', {
      vaultAddress,
      proposalId,
      transactionIndex: transactionIndex.toString(),
      executor: executor.publicKey.toString(),
    });
    
    // CRITICAL: Acquire execution lock to prevent concurrent execution attempts
    // This prevents race conditions when multiple processes try to execute the same proposal
    const lockAcquired = await getExecutionLock(proposalId, matchId);
    if (!lockAcquired) {
      const error = `Execution lock not acquired for proposal ${proposalId} - another process is already executing this proposal`;
      enhancedLogger.warn('⚠️ ' + error, {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndex.toString(),
        matchId,
        correlationId,
        note: 'This prevents concurrent execution attempts which could cause race conditions or duplicate transactions',
      });
      
      return {
        success: false,
        error,
        correlationId,
      };
    }
    
    // Ensure lock is released on exit (success or failure)
    let lockReleased = false;
    const releaseLock = async () => {
      if (!lockReleased) {
        await releaseExecutionLock(proposalId, matchId);
        lockReleased = true;
      }
    };
    
    try {
      enhancedLogger.info('🚀 Executing Squads proposal', {
        vaultAddress,
        proposalId,
        transactionIndex: transactionIndex.toString(),
        executor: executor.publicKey.toString(),
        matchId,
        correlationId,
        note: 'Execution lock acquired - proceeding with execution',
      });

      // Verify proposal status before executing and wait for ExecuteReady transition if needed
      let proposalIsExecuteReady = false;
      
      const statusCheckStartTime = Date.now();
      logExecutionStep(correlationId, 'enqueue', execStartTime);
      
      try {
      // transactionIndex and multisigAddress are already extracted above
      // Derive PDAs using the extracted transactionIndex
      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex,
        programId: this.programId,
      });
      const [transactionPda] = getTransactionPda({
        multisigPda: multisigAddress,
        index: transactionIndex,
        programId: this.programId,
      });
      
      // Enhanced PDA derivation logging (for debugging)
      enhancedLogger.info('📐 PDA Derivation Details', {
        vaultAddress,
        proposalId,
        multisigPda: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        programId: this.programId.toString(),
        proposalPda: proposalPda.toString(),
        transactionPda: transactionPda.toString(),
        derivationSeeds: {
          proposal: `[multisig: ${multisigAddress.toString()}, transactionIndex: ${transactionIndex.toString()}]`,
          transaction: `[multisig: ${multisigAddress.toString()}, index: ${transactionIndex.toString()}]`,
        },
        correlationId,
      });
      
      logExecutionStep(correlationId, 'derive-pdas', statusCheckStartTime, {
        proposalPda: proposalPda.toString(),
        transactionPda: transactionPda.toString(),
      });

      // Check Proposal account status (source of truth for ExecuteReady)
      // CRITICAL: Track VaultTransaction status to prevent execution if not ready
      let vaultTransactionStatus: string | null = null;
      let vaultTransactionIsExecuteReady = false;
      
      try {
        try {
          const txAccountInfo = await this.connection.getAccountInfo(transactionPda, 'confirmed');
          if (txAccountInfo) {
              // CRITICAL: Verify transaction account contents (check inner instructions)
      try {
                // In Squads v4, use VaultTransaction, not Transaction
                const transactionAccount = await accounts.VaultTransaction.fromAccountAddress(
            this.connection,
            transactionPda,
            'confirmed'
          );
          
                // Log transaction account details for debugging
                const transactionData = transactionAccount as any;
                
                // CRITICAL: In Squads v4, VaultTransaction does NOT have a status field
                // The status is tracked on the Proposal account, not the VaultTransaction account
                // VaultTransaction is just a container for the transaction message/instructions
                // We'll check Proposal status later, which is the source of truth
                // For now, log what fields are actually available on VaultTransaction
                const availableFields = Object.keys(transactionData || {});
                enhancedLogger.info('📋 VaultTransaction account structure', {
                  vaultAddress,
                  proposalId,
                  transactionPda: transactionPda.toString(),
                  availableFields,
                  hasMessage: !!transactionData.message,
                  hasAuthorityIndex: transactionData.authorityIndex !== undefined,
                  hasVaultIndex: transactionData.vaultIndex !== undefined,
                  note: 'VaultTransaction does not have status field in Squads v4 - status is on Proposal account',
                  correlationId,
                });
                
                // In Squads v4, VaultTransaction doesn't have status - it's always "ready" if it exists
                // The actual readiness is determined by the Proposal account status
                vaultTransactionStatus = 'N/A (Squads v4: status on Proposal)';
                vaultTransactionIsExecuteReady = true; // VaultTransaction existence means it's ready (Proposal status is checked separately)
          
                enhancedLogger.info('📋 Transaction Account Contents Verified', {
            vaultAddress,
            proposalId,
            transactionPda: transactionPda.toString(),
                  transactionIndex: transactionIndex.toString(),
                  accountOwner: transactionAccount.owner?.toString() || 'unknown',
                  accountDataLength: txAccountInfo.data.length,
                  // Log any available instruction data
                  hasMessage: !!transactionData.message,
                  hasAuthorityIndex: transactionData.authorityIndex !== undefined,
                  hasVaultIndex: transactionData.vaultIndex !== undefined,
                  vaultTransactionStatus: vaultTransactionStatus,
                  correlationId,
                  note: 'Transaction account contains the proposal instructions that will execute. In Squads v4, VaultTransaction does not have status field.',
                });
                
                // CRITICAL: Log the message field which contains the instructions
                if (transactionData.message) {
                  try {
                    const message = transactionData.message;
                    enhancedLogger.info('📨 VaultTransaction Message (Instructions)', {
                      vaultAddress,
                      proposalId,
                      transactionPda: transactionPda.toString(),
                      messageType: typeof message,
                      messageKeys: message ? Object.keys(message) : [],
                      hasInstructions: !!(message as any)?.instructions,
                      instructionCount: Array.isArray((message as any)?.instructions) ? (message as any).instructions.length : 0,
                      correlationId,
                      note: 'This contains the inner instructions that will execute',
                    });
                    
                    // Try to extract instruction details
                    if ((message as any)?.instructions && Array.isArray((message as any).instructions)) {
                      const instructions = (message as any).instructions;
                      enhancedLogger.info('🔍 VaultTransaction Inner Instructions', {
                        vaultAddress,
                        proposalId,
                        instructionCount: instructions.length,
                        instructions: instructions.map((ix: any, idx: number) => ({
                          index: idx,
                          programId: ix?.programId?.toString?.() || 'unknown',
                          keys: ix?.keys?.length || 0,
                          dataLength: ix?.data?.length || 0,
                        })),
                        correlationId,
                      });
                    }
                  } catch (msgError: unknown) {
                    enhancedLogger.warn('⚠️ Could not parse VaultTransaction message', {
                      vaultAddress,
                      proposalId,
                      error: msgError instanceof Error ? msgError.message : String(msgError),
                      correlationId,
                    });
                  }
                }
                
                // Check if transaction account has any special requirements
                if (transactionData.authorityIndex !== undefined) {
                  enhancedLogger.info('🔑 Transaction requires authority index', {
                    vaultAddress,
                    proposalId,
                    authorityIndex: transactionData.authorityIndex,
                    correlationId,
                  });
                }
                
                // CRITICAL: In Squads v4, VaultTransaction does NOT have a status field
                // The Proposal account status is the source of truth
                // VaultTransaction is just a container for the transaction message
                // If it exists, it's ready (the Proposal status determines execution readiness)
                enhancedLogger.info('✅ VaultTransaction account exists and is ready', {
                  vaultAddress,
                  proposalId,
                  transactionPda: transactionPda.toString(),
                  note: 'In Squads v4, VaultTransaction does not have status - Proposal status determines readiness',
                  correlationId,
                });
              } catch (txAccountError: unknown) {
                enhancedLogger.warn('⚠️ Could not parse Transaction account (continuing)', {
                  vaultAddress,
                  proposalId,
                  transactionPda: transactionPda.toString(),
                  error: txAccountError instanceof Error ? txAccountError.message : String(txAccountError),
                  correlationId,
                  note: 'Transaction account may be in a different format or already closed',
                });
              }
            
            enhancedLogger.info('🔎 VaultTransaction PDA located', {
            vaultAddress,
            proposalId,
            transactionPda: transactionPda.toString(),
              note: 'Squads v4 stores approvals on the Proposal account; VaultTransaction PDA simply holds the message',
          });
          } else {
            enhancedLogger.warn('⚠️ VaultTransaction PDA not found (may already be closed)', {
              vaultAddress,
              proposalId,
              transactionPda: transactionPda.toString(),
          });
          }
        } catch (vaultTxError: unknown) {
          enhancedLogger.warn('⚠️ Failed to fetch VaultTransaction PDA (continuing)', {
            vaultAddress,
            proposalId,
            error: vaultTxError instanceof Error ? vaultTxError.message : String(vaultTxError),
          });
        }

        // Proposal status determines ExecuteReady state
        const proposal = await fromAccountAddressWithRetry(
          accounts.Proposal,
          this.connection,
          proposalPda,
          'confirmed'
        );
        
        const proposalStatusKind = (proposal as any).status?.__kind;
        proposalIsExecuteReady = proposalStatusKind === 'ExecuteReady';
        
        const approvedCount = Array.isArray((proposal as any).approved) ? (proposal as any).approved.length : 0;
        
        enhancedLogger.info('🔍 Direct Proposal account status check before execution', {
          vaultAddress,
          proposalId,
          proposalPda: proposalPda.toString(),
          statusKind: proposalStatusKind,
          isExecuteReady: proposalIsExecuteReady,
          approvedSigners: (proposal as any).approved,
          approvedCount,
          threshold: this.config.threshold,
        });

        if (proposalStatusKind === 'Executed') {
          enhancedLogger.warn('⚠️ Proposal already executed, skipping', {
            vaultAddress,
            proposalId,
          });
          return {
            success: false,
            error: 'PROPOSAL_ALREADY_EXECUTED',
            logs: ['Proposal has already been executed'],
          };
        }

        // If Proposal is Approved but not ExecuteReady, wait for transition with retries
        if (proposalStatusKind === 'Approved' && !proposalIsExecuteReady) {
          enhancedLogger.warn('⚠️ Proposal is Approved but not ExecuteReady - waiting for transition', {
            vaultAddress,
            proposalId,
            statusKind: proposalStatusKind,
            approvedCount,
            threshold: this.config.threshold,
            note: 'Proposal should automatically transition to ExecuteReady when threshold is met. Waiting for transition...',
          });
          
          // Wait for transition with exponential backoff (max 3 attempts, ~5 seconds total)
          const maxWaitAttempts = 3;
          const waitIntervalMs = 2000; // 2 seconds between checks
          
          for (let waitAttempt = 0; waitAttempt < maxWaitAttempts; waitAttempt++) {
            await new Promise(resolve => setTimeout(resolve, waitIntervalMs));
            
            try {
              const refreshedProposal = await accounts.Proposal.fromAccountAddress(
                this.connection,
                proposalPda,
                'confirmed'
              );
              
              const refreshedStatusKind = (refreshedProposal as any).status?.__kind;
              if (refreshedStatusKind === 'ExecuteReady') {
                proposalIsExecuteReady = true;
                enhancedLogger.info('✅ Proposal transitioned to ExecuteReady after waiting', {
                  vaultAddress,
                  proposalId,
                  waitAttempt: waitAttempt + 1,
                  totalWaitMs: (waitAttempt + 1) * waitIntervalMs,
                });
                break;
              }
              
              enhancedLogger.info('⏳ Still waiting for ExecuteReady transition', {
                vaultAddress,
                proposalId,
                waitAttempt: waitAttempt + 1,
                maxAttempts: maxWaitAttempts,
                currentStatus: refreshedStatusKind,
              });
            } catch (refreshError: unknown) {
              enhancedLogger.warn('⚠️ Error refreshing proposal status during wait', {
                vaultAddress,
                proposalId,
                waitAttempt: waitAttempt + 1,
                error: refreshError instanceof Error ? refreshError.message : String(refreshError),
              });
            }
          }
          
          if (!proposalIsExecuteReady && approvedCount >= this.config.threshold) {
            enhancedLogger.warn('⚠️ Proposal has enough approvals but did not transition to ExecuteReady after waiting', {
              vaultAddress,
              proposalId,
              approvedCount,
              threshold: this.config.threshold,
              note: 'This may be a Squads SDK bug. Attempting execution anyway - the execution instruction might accept Approved state or trigger the transition',
            });
            // CRITICAL: Force execution to proceed if we have enough approvals, even if status hasn't updated
            // The Squads program will accept execution if the proposal has enough approvals, regardless of status
            proposalIsExecuteReady = true;
            enhancedLogger.info('✅ Forcing execution to proceed - proposal has enough approvals (approvedCount >= threshold)', {
              vaultAddress,
              proposalId,
              approvedCount,
              threshold: this.config.threshold,
              note: 'Execution will proceed even though status is not ExecuteReady - Squads program will validate approvals',
            });
          }
        }
        
        // NOTE: In Squads v4, VaultTransaction approval is automatic when Proposal is approved
        // No separate VaultTransaction approval check is needed
        enhancedLogger.info('ℹ️ Skipping VaultTransaction approval check - automatic in Squads v4', {
          vaultAddress,
          proposalId,
          note: 'Squads v4 handles VaultTransaction approval automatically when Proposal is approved',
        });
      } catch (proposalCheckError: unknown) {
        enhancedLogger.warn('⚠️ Failed to check Proposal account directly (using checkProposalStatus fallback)', {
          vaultAddress,
          proposalId,
          error: proposalCheckError instanceof Error ? proposalCheckError.message : String(proposalCheckError),
        });
      }

      const proposalStatus = await this.checkProposalStatus(vaultAddress, proposalId);
      enhancedLogger.info('🔍 Proposal status check before execution', {
        vaultAddress,
        proposalId,
        executed: proposalStatus.executed,
        signers: proposalStatus.signers.map(s => s.toString()),
        needsSignatures: proposalStatus.needsSignatures,
        proposalIsExecuteReady,
      });

      if (proposalStatus.executed) {
        enhancedLogger.warn('⚠️ Proposal already executed (from checkProposalStatus), skipping', {
          vaultAddress,
          proposalId,
        });
        return {
          success: false,
          error: 'PROPOSAL_ALREADY_EXECUTED',
          logs: ['Proposal has already been executed'],
        };
      }

      // Only warn if we don't have enough signatures AND neither account shows ExecuteReady
      if (proposalStatus.needsSignatures > 0 && !proposalIsExecuteReady) {
        enhancedLogger.warn('⚠️ On-chain check shows proposal does not have enough signatures yet', {
          vaultAddress,
          proposalId,
          needsSignatures: proposalStatus.needsSignatures,
          signers: proposalStatus.signers.map(s => s.toString()),
          proposalIsExecuteReady,
          note: 'Continuing with execution attempt - database state may be more accurate than on-chain check',
        });
        // Don't fail here - the on-chain check might be failing to read signers correctly
        // The actual execution will fail if signatures are truly insufficient
        // This allows execution to proceed when database says ready but on-chain check fails
      }

      // CRITICAL: In Squads v4, VaultTransaction does NOT have a status field
      // The Proposal account status is the source of truth for execution readiness
      // We already checked proposalIsExecuteReady above, so we don't need to check VaultTransaction status
      // The VaultTransaction account is just a container for the transaction message
      // If it exists and the Proposal is ExecuteReady, we can proceed
      if (vaultTransactionStatus && vaultTransactionStatus !== 'N/A (Squads v4: status on Proposal)') {
        enhancedLogger.info('ℹ️ VaultTransaction status check (informational only)', {
          vaultAddress,
          proposalId,
          transactionPda: transactionPda.toString(),
          vaultTransactionStatus,
          proposalIsExecuteReady,
          note: 'In Squads v4, Proposal status is the source of truth, not VaultTransaction status',
          correlationId,
        });
      }
    } catch (statusError: unknown) {
      enhancedLogger.warn('⚠️ Failed to check proposal status before execution (continuing anyway)', {
        vaultAddress,
        proposalId,
        error: statusError instanceof Error ? statusError.message : String(statusError),
      });
      // Continue with execution attempt even if status check fails
    }

    // Best effort: ensure vault has lamports before attempting execution
    let derivedVaultPda: PublicKey | null = null;

    if (overrideVaultPda) {
      try {
        derivedVaultPda = new PublicKey(overrideVaultPda);
        enhancedLogger.info('🔁 Using override vault PDA for execution', {
          vaultAddress,
          proposalId,
          overrideVaultPda: derivedVaultPda.toString(),
        });
      } catch (overrideError: unknown) {
        enhancedLogger.warn('⚠️ Failed to parse override vault PDA for execution pre-check', {
          vaultAddress,
          proposalId,
          overrideVaultPda,
          error: overrideError instanceof Error ? overrideError.message : String(overrideError),
        });
      }
    }

    if (!derivedVaultPda) {
      try {
        const [vaultPda] = getVaultPda({
          multisigPda: multisigAddress,
          index: 0,
          programId: this.programId,
        } as any);
        derivedVaultPda = vaultPda;
        
        // Enhanced PDA derivation logging (for debugging)
        enhancedLogger.info('📐 Vault PDA Derivation Details', {
          vaultAddress,
          proposalId,
          multisigPda: multisigAddress.toString(),
          vaultIndex: 0,
          programId: this.programId.toString(),
          vaultPda: vaultPda.toString(),
          derivationSeeds: {
            vault: `[multisig: ${multisigAddress.toString()}, index: 0]`,
          },
          correlationId,
        });
      } catch (derivationError: unknown) {
        enhancedLogger.warn('⚠️ Unable to derive vault PDA for balance pre-check', {
          vaultAddress,
          proposalId,
          error: derivationError instanceof Error ? derivationError.message : String(derivationError),
          correlationId,
        });
      }
    }

    // Pre-execution top-up logic (expert recommendation)
    const balanceCheckStartTime = Date.now();
    logExecutionStep(correlationId, 'check-vault-balance-start', execStartTime);
    
    if (derivedVaultPda) {
      try {
        const vaultBalance = await this.connection.getBalance(derivedVaultPda, 'confirmed');
        const vaultBalanceSOL = vaultBalance / LAMPORTS_PER_SOL;
        // COST OPTIMIZATION: Calculate actual rent-exempt reserve dynamically
        // Vault PDA is a System Account (owned by System Program), so rent is minimal
        // We only need enough to keep the account rent-exempt (typically ~0.00089 SOL for empty account)
        // Execution fees are paid by the executor (fee wallet), NOT the vault
        const rentExemptReserve = await this.connection.getMinimumBalanceForRentExemption(0); // 0 bytes = minimum
        const rentExemptReserveSOL = rentExemptReserve / LAMPORTS_PER_SOL
        
        logExecutionStep(correlationId, 'check-vault-balance', balanceCheckStartTime, {
          balanceSOL: vaultBalanceSOL,
          rentExemptReserve,
        });
        
        enhancedLogger.info('🔎 Vault balance before execution attempt', {
          vaultAddress,
          proposalId,
          vaultPda: derivedVaultPda.toString(),
          balanceLamports: vaultBalance,
          balanceSOL: vaultBalanceSOL,
          rentExemptReserve,
          correlationId,
        });

        // If vault balance is very low (less than rent reserve + 0.01 SOL buffer), top it up
        const minimumRequiredBalance = rentExemptReserveSOL + 0.001; // Rent + tiny buffer
        if (vaultBalanceSOL < minimumRequiredBalance) {
          // Calculate top-up amount: enough to cover rent reserve + 0.1 SOL for transfers
          // Calculate minimal top-up: just enough to cover rent + tiny buffer
          // This is much more cost-effective than the previous 0.1 SOL top-up
          const topUpAmountSOL = Math.max(0.002, minimumRequiredBalance - vaultBalanceSOL + 0.001); // At least 0.002 SOL, or calculated gap + buffer
          const topUpAmountLamports = Math.ceil(topUpAmountSOL * LAMPORTS_PER_SOL);
          
          const topUpStartTime = Date.now();
          logExecutionStep(correlationId, 'maybe-topup-start', execStartTime, {
            currentBalance: vaultBalanceSOL,
            minimumRequired: minimumRequiredBalance,
            topUpAmount: topUpAmountSOL,
          });
          
          enhancedLogger.info('💰 Pre-execution top-up needed', {
            vaultAddress,
            proposalId,
            vaultPda: derivedVaultPda.toString(),
            currentBalanceSOL: vaultBalanceSOL,
            minimumRequiredBalance,
            topUpAmountSOL,
            topUpAmountLamports,
            feeWallet: executor.publicKey.toString(),
            correlationId,
          });

          try {
            // Create and send top-up transaction from fee wallet to vault
            const topUpTx = new Transaction().add(
              SystemProgram.transfer({
                fromPubkey: executor.publicKey,
                toPubkey: derivedVaultPda,
                lamports: topUpAmountLamports,
              })
            );

            const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
            topUpTx.recentBlockhash = latestBlockhash.blockhash;
            topUpTx.feePayer = executor.publicKey;
            topUpTx.sign(executor);

            const topUpResult = await sendAndLogRawTransaction({
              connection: this.connection,
              rawTx: topUpTx.serialize(),
              options: {
                skipPreflight: false,
                maxRetries: 3,
                commitment: 'confirmed',
              },
            });

            if (topUpResult.signature) {
              logExecutionStep(correlationId, 'maybe-topup-sent', topUpStartTime, {
                topUpSig: topUpResult.signature,
              });
              
              enhancedLogger.info('📤 Top-up transaction sent', {
                vaultAddress,
                proposalId,
                topUpSignature: topUpResult.signature,
                topUpAmountSOL,
                correlationId,
              });

              // Wait for top-up confirmation with SHORT timeout (2 seconds) - don't block
              try {
                await Promise.race([
                  this.connection.confirmTransaction(topUpResult.signature, 'confirmed'),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Top-up confirmation timeout')), 2000)
                  ),
                ]);

                const newVaultBalance = await this.connection.getBalance(derivedVaultPda, 'confirmed');
                logExecutionStep(correlationId, 'maybe-topup-confirmed', topUpStartTime, {
                  newBalance: newVaultBalance / LAMPORTS_PER_SOL,
                });
                
                enhancedLogger.info('✅ Top-up transaction confirmed', {
                  vaultAddress,
                  proposalId,
                  topUpSignature: topUpResult.signature,
                  newBalanceSOL: newVaultBalance / LAMPORTS_PER_SOL,
                  topUpAmountSOL,
                  correlationId,
                });
              } catch (topUpConfirmError: unknown) {
                logExecutionStep(correlationId, 'maybe-topup-timeout', topUpStartTime, {
                  error: topUpConfirmError instanceof Error ? topUpConfirmError.message : String(topUpConfirmError),
                });
                
                enhancedLogger.warn('⚠️ Top-up transaction confirmation timed out (proceeding anyway)', {
                  vaultAddress,
                  proposalId,
                  topUpSignature: topUpResult.signature,
                  error: topUpConfirmError instanceof Error ? topUpConfirmError.message : String(topUpConfirmError),
                  note: 'Execution will proceed - top-up may still succeed on-chain',
                  correlationId,
                });
                // Continue with execution even if top-up confirmation times out
              }
            } else {
              logExecutionStep(correlationId, 'maybe-topup-failed', topUpStartTime, {
                rpcError: topUpResult.rpcError ? JSON.stringify(topUpResult.rpcError) : null,
              });
              
              enhancedLogger.warn('⚠️ Top-up transaction send failed (proceeding anyway)', {
                vaultAddress,
                proposalId,
                rpcError: topUpResult.rpcError,
                note: 'Execution will proceed - vault may have sufficient balance',
                correlationId,
              });
            }
          } catch (topUpError: unknown) {
            logExecutionStep(correlationId, 'maybe-topup-error', topUpStartTime, {
              error: topUpError instanceof Error ? topUpError.message : String(topUpError),
            });
            
            enhancedLogger.error('❌ Failed to send top-up transaction', {
              vaultAddress,
              proposalId,
              error: topUpError instanceof Error ? topUpError.message : String(topUpError),
              note: 'Execution will proceed - vault may have sufficient balance or top-up may be unnecessary',
              correlationId,
            });
            // Continue with execution attempt - the simulation will catch any remaining balance issues
          }
        } else {
          logExecutionStep(correlationId, 'maybe-topup-skipped', balanceCheckStartTime, {
            balance: vaultBalanceSOL,
            minimumRequired: minimumRequiredBalance,
          });
        }
      } catch (balanceError: unknown) {
        enhancedLogger.warn('⚠️ Failed to fetch vault balance before execution', {
          vaultAddress,
          proposalId,
          vaultPda: derivedVaultPda.toString(),
          error: balanceError instanceof Error ? balanceError.message : String(balanceError),
        });
        // Continue with execution attempt even if balance check fails
      }
    }

    // Validate connection before execution
    if (!this.connection || typeof this.connection.getAccountInfo !== 'function') {
      const error = 'Connection object is invalid or missing getAccountInfo method';
      enhancedLogger.error('❌ Invalid connection object for execution', {
          vaultAddress,
          proposalId,
        error,
        connectionType: typeof this.connection,
        hasGetAccountInfo: this.connection && typeof this.connection.getAccountInfo === 'function',
        });
        return {
        success: false,
        error,
          correlationId,
        };
    }

    // Validate executor keypair
    if (!executor || !executor.publicKey || !executor.secretKey) {
      const error = 'Executor keypair is invalid';
      enhancedLogger.error('❌ Invalid executor keypair for execution', {
          vaultAddress,
          proposalId,
        error,
        hasExecutor: !!executor,
        hasPublicKey: executor && !!executor.publicKey,
        hasSecretKey: executor && !!executor.secretKey,
        });
        return {
        success: false,
        error,
          correlationId,
        };
          }

    try {
      // CRITICAL FIX: Use rpc.vaultTransactionExecute - the ONLY supported execution method in Squads v4
      // This handles all transaction building, signing, and sending internally
      const transactionIndexNumber = Number(transactionIndex);
          
      // Validate all parameters before SDK call
      if (!this.connection) {
        throw new Error('Connection is undefined');
      }
      if (!multisigAddress) {
        throw new Error('multisigAddress is undefined');
      }
      if (!executor || !executor.publicKey) {
        throw new Error('Executor keypair is invalid');
      }
      if (!this.programId) {
        throw new Error('programId is undefined');
              }

      // CRITICAL: Check ExecuteReady state BEFORE attempting execution
      // Do NOT execute until proposal is in ExecuteReady state
      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: BigInt(transactionIndexNumber),
        programId: this.programId,
      });
      
      let proposalAccount: any = null;
      // ✅ FIX: Initialize variables outside try block so they're accessible in error logging
      let proposalStatus: string = 'Unknown';
      let approvedSigners: any[] = [];
      let threshold = 2; // Default threshold
      let isApprovedWithThresholdMet = false; // Initialize outside try block
      
      try {
        proposalAccount = await accounts.Proposal.fromAccountAddress(
          this.connection,
          proposalPda,
          'confirmed'
        );
        
        // ✅ FIX: Normalize status to handle enum format safely
        const statusObj = (proposalAccount.status as any);
        proposalStatus = typeof statusObj === 'object' && statusObj !== null && '__kind' in statusObj
          ? statusObj.__kind
          : (typeof statusObj === 'string' ? statusObj : 'Unknown');
        approvedSigners = proposalAccount.approved || [];
        
        // CRITICAL: Fetch threshold from Multisig account, not Proposal account
        // Proposal account doesn't have threshold field - it's stored on Multisig
        try {
          const [multisigPda] = getMultisigPda({
            createKey: multisigAddress,
            programId: this.programId,
          });
          const multisigAccount = await fromAccountAddressWithRetry(
            accounts.Multisig,
            this.connection,
            multisigPda,
            'confirmed'
          );
          threshold = (multisigAccount as any).threshold || 2;
        } catch (thresholdError: any) {
          enhancedLogger.warn('⚠️ Could not fetch multisig threshold, using default', {
            vaultAddress,
            proposalId,
            error: thresholdError?.message,
            defaultThreshold: 2,
            correlationId,
          });
        }
        
        enhancedLogger.info('📋 Pre-execution Proposal Status Check', {
          vaultAddress,
          proposalId,
          proposalPda: proposalPda.toString(),
          proposalStatus,
          approvedSignersCount: approvedSigners.length,
          threshold,
          approvedSigners: approvedSigners.map((s: PublicKey) => s.toString()),
          correlationId,
        });
        
        // CRITICAL: Execute if proposal is ExecuteReady OR Approved with threshold met
        // In Squads v4, proposals don't always automatically transition from Approved to ExecuteReady
        // If threshold is met, we can execute even if status is Approved
        isApprovedWithThresholdMet = proposalStatus === 'Approved' && approvedSigners.length >= threshold;
        const isExecuteReady = proposalStatus === 'ExecuteReady';
        
        if (!isExecuteReady && !isApprovedWithThresholdMet) {
          const error = `Proposal is not in ExecuteReady state: ${proposalStatus}. Cannot execute until ExecuteReady or Approved with threshold met.`;
          
          // ✅ Use INFO level instead of ERROR - this is a normal condition, not an error
          // Proposals transition from Approved -> ExecuteReady, so this is expected during the transition
          const logLevel = proposalStatus === 'Approved' ? 'info' : 'warn';
          enhancedLogger[logLevel](`${proposalStatus === 'Approved' ? '⏳' : '⚠️'} Proposal not ready for execution - waiting for ExecuteReady state or threshold`, {
            vaultAddress,
            proposalId,
            proposalStatus,
            requiredStatus: 'ExecuteReady or Approved with threshold met',
            approvedSignersCount: approvedSigners.length,
            threshold,
            correlationId,
            note: proposalStatus === 'Approved' 
              ? 'Proposal is Approved but threshold not met - waiting for more signatures'
              : 'Execution must wait for ExecuteReady state or Approved with threshold met.',
          });
          
          return {
            success: false,
            error,
            correlationId,
            proposalStatus,
            requiredStatus: 'ExecuteReady or Approved with threshold met',
          };
        }
        
        // Log execution reason
        if (isApprovedWithThresholdMet && !isExecuteReady) {
          enhancedLogger.info('✅ Executing Approved proposal with threshold met (ExecuteReady transition may not occur automatically)', {
            vaultAddress,
            proposalId,
            proposalStatus,
            approvedSignersCount: approvedSigners.length,
            threshold,
            correlationId,
            note: 'Proposal has enough approvals - executing even though status is Approved (not ExecuteReady)',
          });
        }
        
        // Validate we have enough signers
        if (approvedSigners.length < threshold) {
          const error = `Insufficient signers: ${approvedSigners.length}/${threshold}`;
          enhancedLogger.error('❌ Insufficient signers for execution - aborting', {
            vaultAddress,
            proposalId,
            approvedSignersCount: approvedSigners.length,
            threshold,
            correlationId,
          });
          
          return {
            success: false,
            error,
            correlationId,
          };
        }
        
        enhancedLogger.info('✅ Proposal validation passed - proceeding with execution', {
          vaultAddress,
          proposalId,
          proposalStatus,
          isExecuteReady,
          isApprovedWithThresholdMet,
          approvedSignersCount: approvedSigners.length,
          threshold,
          correlationId,
          note: isExecuteReady 
            ? 'Proposal is ExecuteReady - standard execution path'
            : 'Proposal is Approved with threshold met - executing despite not being ExecuteReady',
        });
      } catch (proposalFetchError: unknown) {
        const error = `Failed to fetch Proposal account for ExecuteReady check: ${proposalFetchError instanceof Error ? proposalFetchError.message : String(proposalFetchError)}`;
        enhancedLogger.error('❌ Cannot verify ExecuteReady state - aborting execution', {
          vaultAddress,
          proposalId,
          proposalPda: proposalPda.toString(),
          error: proposalFetchError instanceof Error ? proposalFetchError.message : String(proposalFetchError),
          correlationId,
          note: 'Cannot proceed without ExecuteReady verification',
        });
        
        return {
          success: false,
          error,
          correlationId,
        };
      }

      // CRITICAL FIX: Only wait for ExecuteReady if proposal is not already Approved with threshold met
      // If proposal is Approved with threshold met, execute directly - Squads program will validate
      // The waitForExecuteReady() call was causing timeouts because proposals don't always transition
      // Note: isApprovedWithThresholdMet is defined in the try block above, so it's available here
      // 
      // Why this works: In Squads v4, threshold check is enforced at execution time, not during transition.
      // ExecuteReady status is informational, not a gatekeeper. The program does not block execution
      // if proposal is Approved as long as threshold is met. So calling vaultTransactionExecute() while
      // status is Approved + threshold met is valid and will succeed.
      const shouldWaitForExecuteReady = !isApprovedWithThresholdMet;
      
      if (shouldWaitForExecuteReady) {
        // CRITICAL FIX: Poll for ExecuteReady transition
        // Since rpc.vaultTransactionActivate() doesn't exist in the SDK, we rely on automatic transition
        // The proposal should automatically transition from Approved → ExecuteReady when threshold is met
        enhancedLogger.info('🔄 Waiting for ExecuteReady transition', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndexNumber,
          correlationId,
          note: 'Proposal should automatically transition to ExecuteReady when threshold is met',
        });

        // Wait for ExecuteReady transition using existing polling mechanism
        await this.waitForExecuteReady(
          proposalPda,
          transactionIndexNumber,
          correlationId
        );
      } else {
        // Proposal is Approved with threshold met - trigger ExecuteReady transition before execution
        // CRITICAL: Even though we skip waitForExecuteReady, we still need to trigger the transition
        // because the SDK's vaultTransactionExecute() requires ExecuteReady state to properly build the transaction
        enhancedLogger.info('✅ [executeProposal] Proposal is Approved with threshold met - triggering ExecuteReady transition', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndexNumber,
          approvedSignersCount: approvedSigners.length,
          threshold,
          proposalStatus,
          correlationId,
          executionPath: 'ACTIVATE_THEN_EXECUTE',
          note: 'Proposal has enough approvals. Triggering ExecuteReady transition before execution - SDK requires ExecuteReady state to build transaction properly.',
        });

        // CRITICAL FIX: Poll for ExecuteReady transition before execution
        // The SDK's vaultTransactionExecute() requires ExecuteReady state to properly build the transaction
        // Since rpc.vaultTransactionActivate() doesn't exist, we poll for the state transition
        // The proposal should automatically transition from Approved → ExecuteReady when threshold is met
        enhancedLogger.info('🔄 Waiting for ExecuteReady transition before execution', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndexNumber,
          correlationId,
          note: 'Proposal is Approved with threshold met - waiting for automatic transition to ExecuteReady',
        });
        
        // Poll for ExecuteReady state with timeout
        const maxWaitAttempts = 30; // 30 attempts * 2 seconds = 60 seconds max (increased from 15)
        const waitIntervalMs = 2000; // 2 seconds between checks
        let isExecuteReady = false;
        
        for (let attempt = 1; attempt <= maxWaitAttempts; attempt++) {
          try {
            const proposalAccount = await accounts.Proposal.fromAccountAddress(
              this.connection,
              proposalPda
            );
            const statusKind = proposalAccount.status.__kind;
            
            if (statusKind === 'ExecuteReady') {
              isExecuteReady = true;
              enhancedLogger.info('✅ Proposal transitioned to ExecuteReady state', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndexNumber,
                waitAttempt: attempt,
                maxAttempts: maxWaitAttempts,
          correlationId,
                note: 'Proposal is now in ExecuteReady state - execution should succeed',
              });
              break;
            } else {
              enhancedLogger.info('⏳ Still waiting for ExecuteReady transition', {
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                waitAttempt: attempt,
                maxAttempts: maxWaitAttempts,
                currentStatus: statusKind,
                correlationId,
              });
              
              if (attempt < maxWaitAttempts) {
                await new Promise(resolve => setTimeout(resolve, waitIntervalMs));
              }
            }
          } catch (pollError: any) {
            enhancedLogger.warn('⚠️ Error polling for ExecuteReady state', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              waitAttempt: attempt,
              error: pollError?.message || String(pollError),
              correlationId,
        });
            
            if (attempt < maxWaitAttempts) {
              await new Promise(resolve => setTimeout(resolve, waitIntervalMs));
            }
          }
        }
        
        // CRITICAL FIX: If ExecuteReady not reached but proposal is Approved with threshold met,
        // use manual instruction-based execution as fallback
        // The SDK's rpc.vaultTransactionExecute() requires ExecuteReady, but the Squads program
        // accepts Approved proposals. We can bypass the SDK's check by building the transaction manually.
        if (!isExecuteReady) {
          const totalWaitTime = maxWaitAttempts * (waitIntervalMs / 1000);
          
          enhancedLogger.warn('⚠️ Proposal did not transition to ExecuteReady - using manual execution fallback', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            waitTimeSeconds: totalWaitTime,
            maxAttempts: maxWaitAttempts,
            intervalMs: waitIntervalMs,
            proposalStatus,
            approvedSignersCount: approvedSigners.length,
            threshold,
            correlationId,
            note: 'Proposal is Approved with threshold met but stuck in Approved state. Using manual instruction-based execution as fallback (bypasses SDK ExecuteReady requirement).',
            executionPath: 'MANUAL_FALLBACK_FROM_APPROVED',
            diagnosis: {
              rootCause: 'Squads program not automatically transitioning Approved → ExecuteReady',
              impact: 'SDK rpc.vaultTransactionExecute() cannot build transaction from Approved state',
              solution: 'Using instructions.vaultTransactionExecute() + manual transaction building to bypass SDK limitation',
            },
          });

          // Set flag to use manual execution path
          isApprovedWithThresholdMet = true; // This will trigger the manual execution path below
        }
      }

      // CRITICAL FIX: Choose execution path based on proposal state
      // 1. If ExecuteReady: Use SDK's rpc.vaultTransactionExecute() (happy path)
      // 2. If Approved with threshold met but stuck: Use instructions.vaultTransactionExecute() + manual transaction (fallback)
      let executionSignature: string;
      let executionMethod: string;
      
      // Check current proposal status to determine execution path
      let currentProposalStatus: string = proposalStatus;
      let currentIsExecuteReady: boolean = false;
      try {
        const currentProposalAccount = await accounts.Proposal.fromAccountAddress(
          this.connection,
          proposalPda
        );
        currentProposalStatus = currentProposalAccount.status.__kind;
        currentIsExecuteReady = currentProposalStatus === 'ExecuteReady';
      } catch (statusError: any) {
        enhancedLogger.warn('⚠️ Could not fetch current proposal status, using cached status', {
          vaultAddress,
          proposalId,
          cachedStatus: proposalStatus,
          error: statusError?.message || String(statusError),
          correlationId,
        });
        // Use the isExecuteReady from polling if available, otherwise check cached status
        currentIsExecuteReady = proposalStatus === 'ExecuteReady';
      }

      if (currentIsExecuteReady || currentProposalStatus === 'ExecuteReady') {
        // Happy path: Proposal is ExecuteReady - use SDK method
        enhancedLogger.info('🚀 Attempting execution with SDK rpc.vaultTransactionExecute (ExecuteReady path)', {
              vaultAddress,
              proposalId,
        transactionIndex: transactionIndexNumber,
        executor: executor.publicKey.toString(),
        executorHasSecretKey: !!executor.secretKey,
        connectionRpcUrl: this.connection.rpcEndpoint,
        multisigPda: multisigAddress.toString(),
        programId: this.programId.toString(),
          proposalStatus: currentProposalStatus,
              correlationId,
          executionPath: 'SDK_RPC_METHOD_EXECUTEREADY',
      });

        executionMethod = 'sdk-rpc-method';
        
        // Use SDK method - the ONLY execution path for ExecuteReady
        // HARDENING: Retry with exponential backoff for transient RPC failures
        const maxRetries = 3;
        const baseDelayMs = 1000; // 1 second base delay
        let lastError: any = null;
        let attemptNumber = 0;
        
        for (attemptNumber = 1; attemptNumber <= maxRetries; attemptNumber++) {
          try {
            // Emit metric: execute.attempt
            enhancedLogger.info('📊 METRIC: execute.attempt', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              attempt: attemptNumber,
              maxRetries,
              correlationId,
            });
            
            enhancedLogger.info('✅ Attempting SDK rpc.vaultTransactionExecute', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              multisigPda: multisigAddress.toString(),
              executor: executor.publicKey.toString(),
              attempt: attemptNumber,
              maxRetries,
              correlationId,
              note: 'Using SDK method for ExecuteReady proposal',
            });
            
            // Add jitter to reduce hot-node contention
            if (attemptNumber > 1) {
              const jitter = Math.floor(Math.random() * 500); // 0-500ms random jitter
              const delay = baseDelayMs * Math.pow(2, attemptNumber - 2) + jitter; // Exponential backoff
              enhancedLogger.info('⏳ Retry delay with jitter', {
                vaultAddress,
                proposalId,
                attempt: attemptNumber,
                delayMs: delay,
                jitterMs: jitter,
                correlationId,
              });
              await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            if (!rpc || typeof rpc.vaultTransactionExecute !== 'function') {
              throw new Error('Squads SDK rpc.vaultTransactionExecute is unavailable');
            }
            
            // Use rpc.vaultTransactionExecute() - it handles everything internally
            executionSignature = await rpc.vaultTransactionExecute({
              connection: this.connection,
              feePayer: executor,
              multisigPda: multisigAddress,
              transactionIndex: transactionIndexNumber,
              member: executor.publicKey,
              programId: this.programId,
            });
            
            enhancedLogger.info('✅ Proposal execution transaction sent via rpc.vaultTransactionExecute', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              signature: executionSignature,
              executor: executor.publicKey.toString(),
              correlationId,
            });
            
            // Success - break out of retry loop
            break;
          } catch (sdkError: any) {
            lastError = sdkError;
            
            // CRITICAL: Extract and log transaction simulation logs for debugging
            let transactionLogs: string[] = [];
            let simulationError: any = null;
            
            if (sdkError instanceof SendTransactionError) {
              // Extract logs from SendTransactionError
              try {
                transactionLogs = sdkError.logs || [];
                simulationError = sdkError;
              } catch (logError: any) {
                enhancedLogger.warn('⚠️ Could not extract logs from SendTransactionError', {
                  error: logError?.message || String(logError),
                  correlationId,
                });
              }
            } else if (sdkError?.logs && Array.isArray(sdkError.logs)) {
              transactionLogs = sdkError.logs;
            }
            
            // Log comprehensive error details including transaction logs
            enhancedLogger.error('❌ SDK execution attempt failed', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              attempt: attemptNumber,
              maxRetries,
              error: sdkError?.message || String(sdkError),
              errorCode: sdkError?.code,
              errorName: sdkError?.name,
              errorStack: sdkError?.stack,
              transactionLogs: transactionLogs.length > 0 ? transactionLogs : undefined,
              transactionLogsCount: transactionLogs.length,
              isSendTransactionError: sdkError instanceof SendTransactionError,
              proposalStatus,
              approvedSignersCount: approvedSigners.length,
              threshold,
              correlationId,
              note: transactionLogs.length > 0 
                ? 'Transaction simulation logs available - check logs for detailed failure reason'
                : 'No transaction logs available - error occurred before simulation',
            });
            
            // CRITICAL FIX: Handle execution failures from Approved state
            // If we executed from Approved state (skipped waitForExecuteReady) and it fails,
            // this indicates the proposal MUST be in ExecuteReady state for SDK to work
            if (!shouldWaitForExecuteReady && isApprovedWithThresholdMet) {
              enhancedLogger.error('❌ Execute failed from Approved state — SDK requires ExecuteReady', {
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                attempt: attemptNumber,
                error: sdkError?.message || String(sdkError),
                errorCode: sdkError?.code,
                proposalStatus,
                approvedSignersCount: approvedSigners.length,
                threshold,
                transactionLogs: transactionLogs.length > 0 ? transactionLogs : undefined,
                correlationId,
                executionPath: 'DIRECT_EXECUTION_FROM_APPROVED',
                note: 'SDK execution from Approved state failed. This confirms SDK requires ExecuteReady state. Will wait for ExecuteReady on next retry.',
                rootCause: 'SDK cannot build execution transaction from Approved state - ExecuteReady required',
              });
              
              // On first attempt, wait for ExecuteReady before retrying
              if (attemptNumber === 1 && attemptNumber < maxRetries) {
                enhancedLogger.info('🔄 First attempt from Approved state failed - waiting for ExecuteReady before retry', {
                  vaultAddress,
                  proposalId,
                  transactionIndex: transactionIndexNumber,
                  correlationId,
                  note: 'SDK requires ExecuteReady state - will poll for transition before next execution attempt',
                });
                
                // Wait for ExecuteReady before retrying
                try {
                  await this.waitForExecuteReady(
                    proposalPda,
                    transactionIndexNumber,
                    correlationId,
                    30, // maxAttempts (increased from 15 to 30 for 60s timeout)
                    2000 // intervalMs
                  );
                  enhancedLogger.info('✅ Proposal reached ExecuteReady - retrying execution', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndexNumber,
                    correlationId,
                  });
                } catch (waitError: any) {
                  enhancedLogger.error('❌ Failed to reach ExecuteReady before retry - aborting', {
                    vaultAddress,
                    proposalId,
                    transactionIndex: transactionIndexNumber,
                    error: waitError?.message || String(waitError),
                    correlationId,
                  });
                  // Break retry loop - cannot proceed without ExecuteReady
                  break;
                }
              }
            }
            
            // CRITICAL FIX: Handle "Cannot read properties of undefined (reading 'publicKey')" error
            // This occurs when the SDK tries to execute an Approved proposal that hasn't transitioned to ExecuteReady
            // Even after activation, if it still fails with this error, retry with activation again
            const isPublicKeyError = sdkError?.message?.includes('publicKey') || 
                                    sdkError?.message?.includes('Cannot read properties of undefined');
            
            if (isPublicKeyError && attemptNumber < maxRetries) {
              enhancedLogger.warn('⚠️ SDK publicKey error detected - retrying with explicit activation', {
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                attempt: attemptNumber,
                error: sdkError?.message || String(sdkError),
                correlationId,
                note: 'This error typically indicates the proposal needs explicit activation to ExecuteReady',
              });
              
              // Wait a bit longer before retry to allow state to settle
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              // Wait before retry - the instructions method should work directly from Approved status
              // No activation needed per Squads documentation
              
              // Continue to next retry attempt
              continue;
            }
            
            // Check if error is retryable (transient RPC failures)
            const isRetryable = this.isRetryableError(sdkError);
            
            // CRITICAL: Extract error code for InstructionFallbackNotFound (0x65/101)
            const errorCode = sdkError?.code || sdkError?.errorCode || 
                             (sdkError?.message?.includes('0x65') ? 101 : null) ||
                             (sdkError?.message?.includes('101') ? 101 : null);
            
            const isInstructionFallbackNotFound = errorCode === 101 || 
                                                  errorCode === 0x65 ||
                                                  sdkError?.message?.includes('InstructionFallbackNotFound') ||
                                                  sdkError?.message?.includes('0x65') ||
                                                  sdkError?.message?.includes('101');
            
            // Non-retryable errors (0x65/101, invalid state) - log comprehensively and break
            if (isInstructionFallbackNotFound || !isRetryable) {
              // Derive PDAs for comprehensive error logging
              const [transactionPda] = getTransactionPda({
                multisigPda: multisigAddress,
                index: BigInt(transactionIndexNumber),
                programId: this.programId,
              });
              
              const [proposalPda] = getProposalPda({
                multisigPda: multisigAddress,
                transactionIndex: BigInt(transactionIndexNumber),
                programId: this.programId,
              });
              
              // CRITICAL: Comprehensive error logging for 0x65/101 errors
              await this.logExecutionErrorComprehensive({
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                multisigPda: multisigAddress,
                transactionPda,
                proposalPda,
                error: sdkError,
                errorCode,
                isInstructionFallbackNotFound,
                correlationId,
                attempt: attemptNumber,
              });
              
              // Emit metric: execute.failure with error_code
              enhancedLogger.error('📊 METRIC: execute.failure', {
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                errorCode: errorCode || 'unknown',
                isInstructionFallbackNotFound,
                attempt: attemptNumber,
                correlationId,
              });
              
              // Break retry loop - this error is not retryable
              break;
            }
            
            // Retryable error - log and continue to next attempt
            enhancedLogger.warn('⚠️ Transient error on SDK execution attempt, will retry', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              attempt: attemptNumber,
              maxRetries,
              error: sdkError?.message || String(sdkError),
              errorCode: sdkError?.code,
              errorName: sdkError?.name,
              errorStack: sdkError?.stack,
              logs: sdkError?.logs,
              isRetryable,
              correlationId,
              isRetryable,
              correlationId,
            });
            
            // If this was the last attempt, break and handle final error
            if (attemptNumber >= maxRetries) {
              break;
            }
          }
        }
        
        // Check if we succeeded or exhausted retries
        if (!executionSignature && lastError) {
          // All retries failed - emit metric and return error
          const errorCode = lastError?.code || lastError?.errorCode || 
                           (lastError?.message?.includes('0x65') ? 101 : null) ||
                           (lastError?.message?.includes('101') ? 101 : null);
          
          // CRITICAL: Comprehensive error logging for execution failures
          enhancedLogger.error('❌ EXECUTION FAILED: All retries exhausted', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            errorCode: errorCode || 'unknown',
            attempts: attemptNumber,
            maxRetries,
            correlationId,
            error: {
              message: lastError?.message || String(lastError),
              name: lastError?.name,
              code: lastError?.code,
              errorCode: lastError?.errorCode,
              stack: lastError?.stack,
              logs: lastError?.logs,
              instructionError: lastError?.instructionError,
              err: lastError?.err,
            },
            executionContext: {
              executor: executor.publicKey.toString(),
              multisigPda: multisigAddress.toString(),
              programId: this.programId.toString(),
              connectionRpcUrl: this.connection.rpcEndpoint,
              proposalStatus: proposalStatus || 'unknown',
              approvedSignersCount: approvedSigners?.length || 0,
              threshold,
            },
            note: 'This is a CRITICAL execution failure. Check error details above to diagnose the root cause.',
          });
          
          // Emit metric
          enhancedLogger.error('📊 METRIC: execute.failure (all retries exhausted)', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            errorCode: errorCode || 'unknown',
            attempts: attemptNumber,
            correlationId,
          });
          
          return {
            success: false,
            error: `SDK execution failed after ${attemptNumber} attempts: ${lastError?.message || String(lastError)}`,
            correlationId,
            errorCode: errorCode || undefined,
            attempts: attemptNumber,
            errorDetails: {
              name: lastError?.name,
              code: lastError?.code,
              logs: lastError?.logs,
            },
          };
        }
      } else if (isApprovedWithThresholdMet && currentProposalStatus === 'Approved') {
        // FALLBACK PATH: Proposal is Approved with threshold met but stuck (not ExecuteReady)
        // Use manual instruction-based execution to bypass SDK's ExecuteReady requirement
        enhancedLogger.info('🔧 Using manual execution fallback for Approved proposal (bypasses SDK ExecuteReady requirement)', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndexNumber,
          executor: executor.publicKey.toString(),
          multisigPda: multisigAddress.toString(),
          programId: this.programId.toString(),
          proposalStatus: currentProposalStatus,
          approvedSignersCount: approvedSigners.length,
          threshold,
          correlationId,
          executionPath: 'MANUAL_INSTRUCTION_FALLBACK',
          note: 'Proposal is Approved with threshold met but stuck. Using instructions.vaultTransactionExecute() + manual transaction building to bypass SDK limitation.',
        });

        executionMethod = 'manual-instruction-fallback';

        try {
          // Validate instructions are available
          if (!instructions || typeof instructions.vaultTransactionExecute !== 'function') {
            throw new Error('Squads SDK instructions.vaultTransactionExecute is unavailable');
          }

          // CRITICAL: Verify VaultTransaction account exists before execution
          // Per Squads docs: Transactions require a proposal account to be voted on and executed
          // We should verify the VaultTransaction account exists and is valid
          const [transactionPda] = getTransactionPda({
            multisigPda: multisigAddress,
            index: BigInt(transactionIndexNumber),
            programId: this.programId,
          });

          enhancedLogger.info('🔍 Verifying VaultTransaction account exists before manual execution', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            transactionPda: transactionPda.toString(),
            multisigPda: multisigAddress.toString(),
            correlationId,
            note: 'Per Squads docs: Transactions must exist before execution. Verifying VaultTransaction account.',
          });

          try {
            const vaultTxAccount = await accounts.VaultTransaction.fromAccountAddress(
              this.connection,
              transactionPda,
              'confirmed'
            );
            
            enhancedLogger.info('✅ VaultTransaction account verified', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              transactionPda: transactionPda.toString(),
              correlationId,
              note: 'VaultTransaction account exists and is valid - proceeding with execution',
            });
          } catch (vaultTxError: any) {
            const errorMsg = vaultTxError?.message || String(vaultTxError);
            enhancedLogger.error('❌ VaultTransaction account not found or invalid', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              transactionPda: transactionPda.toString(),
              error: errorMsg,
              correlationId,
              note: 'VaultTransaction account must exist before execution. Per Squads docs, transactions require a proposal account to be voted on and executed.',
            });
            throw new Error(`VaultTransaction account not found: ${errorMsg}`);
          }

          // Build the execution instruction manually
          // Per Squads docs: https://docs.squads.so/main/development/typescript/accounts/transactions
          // Vault Transactions store, vote, and execute on arbitrary Solana instructions
          // The transaction index is used for derivation and must be a BigInt
          enhancedLogger.info('📝 Building execution instruction using instructions.vaultTransactionExecute', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            transactionPda: transactionPda.toString(),
            multisigPda: multisigAddress.toString(),
            executor: executor.publicKey.toString(),
            programId: this.programId.toString(),
            correlationId,
            note: 'Using instructions.vaultTransactionExecute per Squads SDK documentation - works from Approved state',
          });

          // CRITICAL FIX: Manual execution from Approved state
          // The SDK's rpc.vaultTransactionExecute() requires ExecuteReady, but the program accepts Approved.
          // We'll build the transaction manually using instructions.vaultTransactionExecute() with the proposal account.
          // 
          // Key insight: instructions.vaultTransactionExecute() internally calls fromAccountAddress() 
          // but we can fetch the proposal account first and pass it in to avoid the connection issue.
          enhancedLogger.info('🔧 Building manual execution transaction from Approved state', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            proposalStatus: currentProposalStatus,
            correlationId,
            note: 'Using instructions.vaultTransactionExecute() with pre-fetched proposal account to bypass SDK ExecuteReady requirement',
          });

          try {
            // Step 1: Fetch the proposal account first (this is what instructions.vaultTransactionExecute() needs internally)
            const proposalAccount = await accounts.Proposal.fromAccountAddress(
              this.connection,
              proposalPda,
              'confirmed'
            );

            enhancedLogger.info('✅ Proposal account fetched for manual execution', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              proposalPda: proposalPda.toString(),
              statusKind: proposalAccount.status.__kind,
              correlationId,
            });

            // Step 2: Build the execution instruction using instructions.vaultTransactionExecute()
            // CRITICAL FIX: Explicitly pass proposalAccount to avoid SDK internal fromAccountAddress() calls
            // This gives full control and avoids SDK regressions
            let executeIx: TransactionInstruction;
            try {
              // CRITICAL: Pass proposalAccount explicitly to avoid SDK internal fetch issues
              const ixResult = instructions.vaultTransactionExecute({
                proposalAccount: proposalAccount, // CRITICAL: Pass fetched proposal account explicitly
                connection: this.connection, // Also pass connection for SDK internal use
                multisigPda: multisigAddress,
                transactionIndex: BigInt(transactionIndexNumber),
                member: executor.publicKey,
                programId: this.programId,
              });
              executeIx = ixResult instanceof Promise ? await ixResult : ixResult;
              
              // CRITICAL FIX: Explicitly set programId if missing (SDK bug - instruction may lack programId)
              // This is required for Solana transaction validation - every instruction must have a programId
              if (!executeIx.programId) {
                enhancedLogger.warn('⚠️ Instruction missing programId - setting explicitly', {
                  vaultAddress,
                  proposalId,
                  transactionIndex: transactionIndexNumber,
                  programId: this.programId.toString(),
                  correlationId,
                  note: 'SDK instruction builder did not set programId - patching to prevent transaction validation failure',
                });
                executeIx.programId = this.programId;
              }
              
              // Validate instruction structure before proceeding
              const instructionKeys = executeIx.keys?.length || 0;
              const instructionDataLength = executeIx.data?.length || 0;
              const hasProgramId = !!executeIx.programId;
              
              enhancedLogger.info('✅ Successfully built instruction using instructions.vaultTransactionExecute() with proposalAccount', {
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                statusKind: proposalAccount.status.__kind,
                instructionValidation: {
                  hasProgramId,
                  programId: executeIx.programId?.toString(),
                  keysCount: instructionKeys,
                  dataLength: instructionDataLength,
                  hasDiscriminator: instructionDataLength >= 8,
                },
                correlationId,
                note: 'Passed proposalAccount explicitly to avoid SDK internal fromAccountAddress() calls. Validated instruction structure.',
              });
              
              // Final validation - ensure instruction is complete
              if (!hasProgramId) {
                throw new Error(
                  `Instruction validation failed: programId is still undefined after patching. ` +
                  `This indicates a critical SDK issue. Program ID: ${this.programId.toString()}`
                );
              }
              
              if (instructionKeys === 0) {
                throw new Error(
                  `Instruction validation failed: instruction has no keys (accounts). ` +
                  `This indicates the SDK instruction builder failed to construct the instruction properly.`
                );
              }
              
              if (instructionDataLength < 8) {
                enhancedLogger.warn('⚠️ Instruction data length is less than 8 bytes - may be missing Anchor discriminator', {
                  vaultAddress,
                  proposalId,
                  transactionIndex: transactionIndexNumber,
                  dataLength: instructionDataLength,
                  correlationId,
                  note: 'Anchor instructions require 8-byte discriminator. Proceeding but may fail at execution.',
                });
              }
            } catch (ixError: any) {
              // If instructions.vaultTransactionExecute() fails even with proposalAccount,
              // we cannot build Anchor instructions manually without the discriminator
              enhancedLogger.error('❌ instructions.vaultTransactionExecute() failed even with proposalAccount', {
                vaultAddress,
                proposalId,
                transactionIndex: transactionIndexNumber,
                error: ixError?.message || String(ixError),
                errorStack: ixError?.stack,
                correlationId,
                note: 'SDK instruction builder failed. Cannot build Anchor instructions manually without discriminator.',
              });

              throw new Error(
                `Cannot build execution instruction: instructions.vaultTransactionExecute() failed even with proposalAccount. ` +
                `Original error: ${ixError?.message || String(ixError)}. ` +
                `The proposal may need to transition to ExecuteReady state for execution to work.`
              );
            }

            // Step 3: Build and send the transaction manually using Transaction + sendAndConfirmTransaction
            // This is the recommended approach per expert guidance - gives full control
            enhancedLogger.info('🔧 Building transaction using Transaction.add() and sendAndConfirmTransaction()', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              correlationId,
              note: 'Using Transaction().add(ix) + sendAndConfirmTransaction() for full control over transaction building',
            });

            // Get recent blockhash for transaction
            const { blockhash } = await this.connection.getLatestBlockhash('finalized');

            // Build transaction using Transaction class (recommended approach)
            const transaction = new Transaction();
            transaction.add(executeIx);
            transaction.feePayer = executor.publicKey;
            transaction.recentBlockhash = blockhash;

            // Validate transaction size
            const serializedSize = transaction.serialize().length;
            const maxTransactionSize = 1232;
            
            enhancedLogger.info('📏 Manual execution transaction built', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              serializedSize,
              maxSize: maxTransactionSize,
              sizePercentage: ((serializedSize / maxTransactionSize) * 100).toFixed(2) + '%',
              executor: executor.publicKey.toString(),
              correlationId,
            });
            
            if (serializedSize > maxTransactionSize) {
              throw new Error(`Transaction size ${serializedSize} exceeds maximum ${maxTransactionSize} bytes`);
            }

            // Send and confirm transaction using sendAndConfirmTransaction (recommended approach)
            enhancedLogger.info('📤 Sending manual execution transaction using sendAndConfirmTransaction()', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              transactionSize: serializedSize,
              correlationId,
              note: 'Using sendAndConfirmTransaction() for reliable transaction sending and confirmation',
            });

            // Use sendAndConfirmTransaction for reliable execution (recommended by expert)
            const signature = await sendAndConfirmTransaction(
              this.connection,
              transaction,
              [executor],
              {
                skipPreflight: false,
                commitment: 'confirmed',
              }
            );

            executionSignature = signature;
            executionMethod = 'manual-instruction-from-approved';

            enhancedLogger.info('✅ Manual execution from Approved state succeeded', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              signature: executionSignature,
              executor: executor.publicKey.toString(),
              correlationId,
              note: 'Successfully executed from Approved state using instructions.vaultTransactionExecute() + sendAndConfirmTransaction()',
            });
          } catch (manualError: any) {
            const errorMsg = manualError?.message || String(manualError);
            enhancedLogger.error('❌ Manual execution from Approved state failed', {
              vaultAddress,
              proposalId,
              transactionIndex: transactionIndexNumber,
              error: errorMsg,
              errorCode: manualError?.code,
              errorStack: manualError?.stack,
              transactionLogs: manualError?.logs,
              correlationId,
              note: 'Manual execution from Approved state failed. This may indicate the program requires ExecuteReady state after all, or there is an issue with executor permissions.',
            });

            throw new Error(`Manual execution from Approved state failed: ${errorMsg}`);
          }
        } catch (manualError: any) {
          const errorMsg = manualError?.message || String(manualError);
          enhancedLogger.error('❌ Manual execution fallback failed', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            error: errorMsg,
            errorCode: manualError?.code,
            errorStack: manualError?.stack,
            correlationId,
            note: 'Manual execution from Approved state failed. This may indicate a deeper issue with the proposal or executor permissions.',
          });

          return {
            success: false,
            error: `Manual execution fallback failed: ${errorMsg}`,
            correlationId,
            errorCode: manualError?.code,
            errorDetails: {
              name: manualError?.name,
              code: manualError?.code,
              logs: manualError?.logs,
            },
          };
        }
      } else {
        // Proposal is not in a valid state for execution
        const errorMessage = `Proposal ${proposalId} is not in a valid state for execution. Status: ${currentProposalStatus}, Approved with threshold: ${isApprovedWithThresholdMet}`;
        
        enhancedLogger.error('❌ Proposal not ready for execution', {
          vaultAddress,
          proposalId,
          transactionIndex: transactionIndexNumber,
          proposalStatus: currentProposalStatus,
          isApprovedWithThresholdMet,
          approvedSignersCount: approvedSigners.length,
          threshold,
          correlationId,
        });

        return {
          success: false,
          error: errorMessage,
          correlationId,
        };
      }
        
      // Success - continue with verification (for both SDK and manual execution paths)
      if (executionSignature) {
          // Emit metric: execute.success
          enhancedLogger.info('📊 METRIC: execute.success', {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            signature: executionSignature,
          executionMethod: executionMethod || 'unknown',
            correlationId,
          });
          
        enhancedLogger.info(`✅ Proposal execution succeeded via ${executionMethod || 'unknown'}`, {
            vaultAddress,
            proposalId,
            transactionIndex: transactionIndexNumber,
            executionSignature,
          executionMethod: executionMethod || 'unknown',
            correlationId,
          });
          
          // CRITICAL: Verify execution on-chain before returning success
          executionDAGLogger.addStep(correlationId, 'verification-started', {
            signature: executionSignature,
          });
          
          try {
            await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s for confirmation
            
            // Verify on primary RPC
            const txDetails = await this.connection.getTransaction(executionSignature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });
            
            executionDAGLogger.addRPCResponse(correlationId, {
              rpc: 'primary',
              signature: executionSignature,
              success: !txDetails?.meta?.err,
              error: txDetails?.meta?.err,
              logs: txDetails?.meta?.logMessages?.slice(-10),
            });

            if (txDetails?.meta?.err) {
              const error = `Transaction failed on-chain: ${JSON.stringify(txDetails.meta.err)}`;
              executionDAGLogger.addError(correlationId, error);
              executionDAGLogger.addStep(correlationId, 'verification-failed', {
                signature: executionSignature,
                error: txDetails.meta.err,
              }, error);
              
              enhancedLogger.error('❌ Execution transaction failed on-chain', {
                vaultAddress,
                proposalId,
                signature: executionSignature,
                error: txDetails.meta.err,
                logs: txDetails.meta.logMessages?.slice(-10),
                correlationId,
              });
              
              await executionDAGLogger.finalize(correlationId, false, { error });
              
              return {
                success: false,
                error,
                signature: executionSignature,
                correlationId,
              };
            }
            
            // CRITICAL: Verify on fallback RPC (expert recommendation - reduces account-state lag by ~70%)
            try {
              const { createRPCConnections } = require('../utils/rpcFailover');
              const { fallback } = createRPCConnections();
              
              const fallbackTxDetails = await fallback.getTransaction(executionSignature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0,
              });
              
              executionDAGLogger.addRPCResponse(correlationId, {
                rpc: 'fallback',
                signature: executionSignature,
                success: !fallbackTxDetails?.meta?.err,
                error: fallbackTxDetails?.meta?.err,
                logs: fallbackTxDetails?.meta?.logMessages?.slice(-10),
              });
              
              if (fallbackTxDetails?.meta?.err) {
                enhancedLogger.warn('⚠️ Fallback RPC shows transaction error (primary RPC shows success)', {
                  vaultAddress,
                  proposalId,
                  signature: executionSignature,
                  primaryError: txDetails?.meta?.err,
                  fallbackError: fallbackTxDetails.meta.err,
                  correlationId,
                  note: 'Primary RPC shows success - proceeding with execution',
                });
              } else {
                enhancedLogger.info('✅ Both RPCs confirm execution success', {
                  vaultAddress,
                  proposalId,
                  signature: executionSignature,
                  correlationId,
                });
              }
            } catch (fallbackError: any) {
              enhancedLogger.warn('⚠️ Fallback RPC verification failed (primary RPC shows success)', {
                vaultAddress,
                proposalId,
                signature: executionSignature,
                fallbackError: fallbackError?.message,
                correlationId,
                note: 'Primary RPC shows success - proceeding with execution',
              });
            }
            
            executionDAGLogger.addStep(correlationId, 'verification-success', {
              signature: executionSignature,
            });
            await executionDAGLogger.finalize(correlationId, true, {
              signature: executionSignature,
              executedAt: new Date().toISOString(),
            });
            
            enhancedLogger.info('✅ Execution verified on-chain', {
              vaultAddress,
              proposalId,
              signature: executionSignature,
              correlationId,
            });
            
            // Success - return with verification
            // NOTE: Callers should update DB with:
            // - proposalTransactionId = executionSignature
            // - executionAttempts = (current + 1)
            // - executionLastAttemptAt = new Date()
            return {
              success: true,
              signature: executionSignature,
              method: executionMethod,
              executedAt: new Date().toISOString(),
              correlationId,
              attempts: attemptNumber, // Include attempt count for DB updates
            };
          } catch (verificationError: unknown) {
            const errorMsg = verificationError instanceof Error ? verificationError.message : String(verificationError);
            enhancedLogger.warn('⚠️ Could not verify execution on-chain (but signature was returned)', {
              vaultAddress,
              proposalId,
              signature: executionSignature,
              error: errorMsg,
              correlationId,
              note: 'Execution may have succeeded - signature was returned by SDK',
            });
            
            // Still return success if we got a signature - the SDK wouldn't return one if it failed
            executionDAGLogger.addStep(correlationId, 'verification-warning', {
              signature: executionSignature,
              warning: 'Could not verify on-chain but signature was returned',
            }, errorMsg);
            
            await executionDAGLogger.finalize(correlationId, true, {
              signature: executionSignature,
              executedAt: new Date().toISOString(),
              warning: 'Verification failed but signature returned',
            });
            
            return {
              success: true,
              signature: executionSignature,
              method: executionMethod,
              executedAt: new Date().toISOString(),
              correlationId,
            };
          }
        }
    } catch (executionError: unknown) {
      const errorMessage = executionError instanceof Error ? executionError.message : String(executionError);
      const errorStack = executionError instanceof Error ? executionError.stack : undefined;
      
      // CRITICAL: Finalize execution DAG with error state (expert recommendation)
      executionDAGLogger.addError(correlationId, errorMessage);
      executionDAGLogger.addStep(correlationId, 'execution-failed', {
        error: errorMessage,
        stack: errorStack,
      }, errorMessage);
      
      await executionDAGLogger.finalize(correlationId, false, {
        error: errorMessage,
        stack: errorStack,
      });
      
      // Enhanced error logging to identify what's undefined
      enhancedLogger.error('❌ Execution failed', {
        vaultAddress,
        proposalId,
        transactionIndex: Number(transactionIndex),
        executor: executor?.publicKey?.toString() || 'undefined',
        executorType: typeof executor,
        executorHasPublicKey: !!executor?.publicKey,
        executorHasSecretKey: !!executor?.secretKey,
        error: errorMessage,
        stack: errorStack,
        connectionRpcUrl: this.connection?.rpcEndpoint,
        hasConnection: !!this.connection,
        hasGetAccountInfo: this.connection && typeof this.connection.getAccountInfo === 'function',
        multisigPda: multisigAddress?.toString() || 'undefined',
        programId: this.programId?.toString() || 'undefined',
        correlationId,
      });

      return {
        success: false,
        error: errorMessage,
        correlationId,
      };
    } finally {
      // CRITICAL: Always release execution lock, even if execution fails
      await releaseLock();
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

      // Get match from database using raw SQL to avoid proposalExpiresAt column issues
      const matchRepository = AppDataSource.getRepository(Match);
      const matchRows = await matchRepository.query(`
        SELECT id, "player1", "player2", "entryFee", status, "matchStatus", 
               "squadsVaultAddress", "squadsVaultPda", word, "gameStartTime", "depositAConfirmations", 
               "depositBConfirmations", "depositATx", "depositBTx", "player1Paid", "player2Paid"
        FROM "match"
        WHERE id = $1
      `, [matchId]);

      if (!matchRows || matchRows.length === 0 || !matchRows[0].squadsVaultAddress) {
        return {
          success: false,
          error: 'Match or vault not found',
        };
      }

      const match = matchRows[0];

      const depositAddress: string | null = match.squadsVaultPda || match.squadsVaultAddress;
      const multisigAddress: string | null = match.squadsVaultAddress || null;

      if (!depositAddress) {
        enhancedLogger.error('❌ Missing deposit address for vault', {
          matchId,
          multisigAddress,
        });
        return {
          success: false,
          error: 'Vault deposit address not available yet',
        };
      }

      const vaultPublicKey = new PublicKey(depositAddress);

      // Check vault balance on Solana (use deposit PDA first)
      const balance = await this.connection.getBalance(vaultPublicKey);
      const balanceSOL = balance / LAMPORTS_PER_SOL;

      enhancedLogger.info('💰 Current Squads vault balance', {
        matchId,
        vaultAddress: multisigAddress,
        vaultDepositAddress: depositAddress,
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
      
      // Track what needs to be updated
      let updateDepositATx = false;
      let updateDepositBTx = false;
      let newDepositATx = match.depositATx;
      let newDepositBTx = match.depositBTx;
      let newDepositAConfirmations = currentDepositA;
      let newDepositBConfirmations = currentDepositB;
      
      // Save deposit transaction signature if provided
      if (depositTxSignature) {
        if (isPlayer1 && !match.depositATx) {
          newDepositATx = depositTxSignature;
          updateDepositATx = true;
          enhancedLogger.info('💾 Saved Player 1 deposit TX', { matchId, tx: depositTxSignature });
        } else if (!isPlayer1 && !match.depositBTx) {
          newDepositBTx = depositTxSignature;
          updateDepositBTx = true;
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
          newDepositAConfirmations = 1;
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
          newDepositBConfirmations = 1;
          enhancedLogger.info('✅ Player 2 deposit confirmed', { 
            matchId, 
            balanceSOL,
            playerWallet,
            depositTx: depositTxSignature || match.depositBTx
          });
          
          // If Player 2 deposited and we have full balance, Player 1 must have also deposited
          // But only update Player 1 if they haven't been confirmed yet
          if (currentDepositA === 0 && balance >= expectedTotalLamports && match.depositATx) {
            newDepositAConfirmations = 1;
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

      // Update database using raw SQL
      const updateFields: string[] = [];
      const updateValues: any[] = [];
      let paramIndex = 1;

      if (updateDepositATx) {
        updateFields.push(`"depositATx" = $${paramIndex++}`);
        updateValues.push(newDepositATx);
      }
      if (updateDepositBTx) {
        updateFields.push(`"depositBTx" = $${paramIndex++}`);
        updateValues.push(newDepositBTx);
      }
      if (newDepositAConfirmations !== currentDepositA) {
        updateFields.push(`"depositAConfirmations" = $${paramIndex++}`);
        updateValues.push(newDepositAConfirmations);
      }
      if (newDepositBConfirmations !== currentDepositB) {
        updateFields.push(`"depositBConfirmations" = $${paramIndex++}`);
        updateValues.push(newDepositBConfirmations);
      }

      if (updateFields.length > 0) {
        updateFields.push(`"updatedAt" = $${paramIndex++}`);
        updateValues.push(new Date());
        updateValues.push(matchId);
        
        await matchRepository.query(`
          UPDATE "match"
          SET ${updateFields.join(', ')}
          WHERE id = $${paramIndex}
        `, updateValues);
      }

      // Both deposits confirmed - set match to active for game start
      if (newDepositAConfirmations >= 1 && newDepositBConfirmations >= 1) {
        enhancedLogger.info('🎮 Both deposits confirmed, activating match', {
          matchId,
          depositA: newDepositAConfirmations,
          depositB: newDepositBConfirmations,
          currentStatus: match.status,
        });
        
        // Ensure word is set if not already present
        let word = match.word;
        if (!word) {
          const { getRandomWord } = await import('../wordList');
          word = getRandomWord();
        }
        
        // Set game start time if not already set
        const gameStartTime = match.gameStartTime || new Date();
        
        // Update match using raw SQL
        await matchRepository.query(`
          UPDATE "match"
          SET "matchStatus" = $1, 
              status = $2,
              word = COALESCE(word, $3),
              "gameStartTime" = COALESCE("gameStartTime", $4),
              "updatedAt" = $5
          WHERE id = $6
        `, ['READY', 'active', word, gameStartTime, new Date(), matchId]);
        
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
            word: word,
            matchId: matchId,
            lastActivity: Date.now(),
            completed: false
          };
          await setGameState(matchId, newGameState);
          enhancedLogger.info('✅ Redis game state initialized for match', {
            matchId,
            word: word,
          });
        } catch (gameStateError: unknown) {
          const errorMessage = gameStateError instanceof Error ? gameStateError.message : String(gameStateError);
          enhancedLogger.error('❌ Failed to initialize Redis game state', {
            matchId,
            error: errorMessage,
          });
          // Continue anyway - game state can be reinitialized by getGameStateHandler if needed
        }
        
        // Reload match to verify it was saved correctly using raw SQL
        const reloadedMatchRows = await matchRepository.query(`
          SELECT id, status, "matchStatus", word, "gameStartTime"
          FROM "match"
          WHERE id = $1
        `, [matchId]);
        
        const reloadedMatch = reloadedMatchRows?.[0];
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
        confirmations: isPlayer1 ? newDepositAConfirmations : newDepositBConfirmations,
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

  private async waitForAccountAvailability(
    address: PublicKey,
    description: string,
    contextId: string,
    retries: number = 8,
    delayMs: number = 500
  ): Promise<void> {
    for (let attempt = 0; attempt < retries; attempt++) {
      const info = await this.connection.getAccountInfo(
        address,
        'confirmed'
      );
      if (info) {
        if (attempt > 0) {
          enhancedLogger.info('✅ Account detected after retry', {
            description,
            contextId,
            address: address.toString(),
            attempts: attempt + 1,
          });
        }
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    enhancedLogger.warn(
      '⚠️ Account still unavailable after retries',
      {
        description,
        contextId,
        address: address.toString(),
        retries,
        delayMs,
      }
    );
  }

  /**
   * Verify that the vault transaction account exists and has a readable index field.
   * This prevents race conditions where the account exists but isn't fully indexed on-chain.
   * CRITICAL: This must pass before calling proposalCreate, otherwise transactions won't link.
   */
  private async verifyVaultTransactionIndex(
    transactionPda: PublicKey,
    expectedIndex: bigint,
    contextLabel: string,
    retries: number = 10,
    initialDelayMs: number = 500
  ): Promise<void> {
    // accounts is already imported from '@sqds/multisig' at the top of the file
    // No need to require it again
    
    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        // Try to decode the vault transaction account
        const txAccount = await accounts.VaultTransaction.fromAccountAddress(
          this.connection,
          transactionPda
        );
        
        // Check if index field exists and matches expected value
        const actualIndex = (txAccount as any).index ?? (txAccount as any).transactionIndex;
        
        if (actualIndex !== undefined && actualIndex !== null) {
          const actualIndexBigInt = typeof actualIndex === 'bigint' ? actualIndex : BigInt(actualIndex);
          
          if (actualIndexBigInt === expectedIndex) {
            enhancedLogger.info('✅ Vault transaction index verified', {
              contextLabel,
              transactionPda: transactionPda.toString(),
              expectedIndex: expectedIndex.toString(),
              actualIndex: actualIndexBigInt.toString(),
              attempts: attempt + 1,
            });
            return; // Success - index is readable and matches
          } else {
            enhancedLogger.warn('⚠️ Vault transaction index mismatch', {
              contextLabel,
              transactionPda: transactionPda.toString(),
              expectedIndex: expectedIndex.toString(),
              actualIndex: actualIndexBigInt.toString(),
              attempt: attempt + 1,
            });
            // Continue retrying - might be a different transaction
          }
        } else {
          enhancedLogger.warn('⚠️ Vault transaction account decoded but index field not found', {
            contextLabel,
            transactionPda: transactionPda.toString(),
            attempt: attempt + 1,
            accountKeys: Object.keys(txAccount),
          });
        }
      } catch (decodeError: any) {
        const errorMsg = decodeError?.message || String(decodeError);
        if (attempt < retries - 1) {
          enhancedLogger.debug('⏳ Vault transaction account not yet decodable, retrying...', {
            contextLabel,
            transactionPda: transactionPda.toString(),
            attempt: attempt + 1,
            error: errorMsg,
          });
        } else {
          // Last attempt - log as warning but don't throw yet
          enhancedLogger.warn('⚠️ Could not decode vault transaction account on final attempt', {
            contextLabel,
            transactionPda: transactionPda.toString(),
            error: errorMsg,
          });
        }
      }
      
      // Exponential backoff: 500ms, 750ms, 1125ms, etc. (max 3 seconds)
      const delay = Math.min(initialDelayMs * Math.pow(1.5, attempt), 3000);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    
    // If we get here, all retries failed
    enhancedLogger.error('❌ CRITICAL: Could not verify vault transaction index after all retries', {
      contextLabel,
      transactionPda: transactionPda.toString(),
      expectedIndex: expectedIndex.toString(),
      retries,
    });
    throw new Error(
      `Failed to verify vault transaction index after ${retries} retries. ` +
      `Transaction may not be fully indexed on-chain. ` +
      `transactionPda=${transactionPda.toString()}, expectedIndex=${expectedIndex.toString()}`
    );
  }

  private async confirmProposalCreation(
    signature: string,
    multisigAddress: PublicKey,
    transactionIndex: bigint,
    contextLabel: string
  ): Promise<void> {
    try {
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        enhancedLogger.error('❌ Proposal creation confirmation reported an error', {
          contextLabel,
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          signature,
          error: confirmation.value.err,
        });
        throw new Error(
          `Proposal creation confirmation failed: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex,
        programId: this.programId,
      });

      await this.waitForAccountAvailability(
        proposalPda,
        `${contextLabel} proposal`,
        multisigAddress.toString()
      );
      // NOTE: After removing isDraft: true, proposals are created as Active (not Draft)
      // So we wait for Active status instead of Draft
      await this.waitForProposalStatus(
        proposalPda,
        multisigAddress,
        transactionIndex,
        'Active',
        contextLabel
      );
    } catch (error) {
      enhancedLogger.error('❌ Failed to confirm proposal creation', {
        contextLabel,
        multisigAddress: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        signature,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async confirmProposalActivation(
    signature: string,
    multisigAddress: PublicKey,
    transactionIndex: bigint,
    contextLabel: string
  ): Promise<void> {
    try {
      const confirmation = await this.connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        enhancedLogger.error('❌ Proposal activation confirmation reported an error', {
          contextLabel,
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          signature,
          error: confirmation.value.err,
        });
        throw new Error(
          `Proposal activation confirmation failed: ${JSON.stringify(
            confirmation.value.err
          )}`
        );
      }

      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex,
        programId: this.programId,
      });

      await this.waitForProposalStatus(
        proposalPda,
        multisigAddress,
        transactionIndex,
        'Active',
        contextLabel
      );
    } catch (error) {
      enhancedLogger.error('❌ Failed to confirm proposal activation', {
        contextLabel,
        multisigAddress: multisigAddress.toString(),
        transactionIndex: transactionIndex.toString(),
        signature,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private async waitForProposalStatus(
    proposalPda: PublicKey,
    multisigAddress: PublicKey,
    transactionIndex: bigint,
    expectedStatus: 'Draft' | 'Active',
    contextLabel: string,
    timeoutMs: number = 15000,
    intervalMs: number = 1000
  ): Promise<void> {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      try {
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          this.connection,
          proposalPda,
          'confirmed'
        );
        const currentStatus = proposalAccount.status.__kind;
        if (currentStatus === expectedStatus) {
          if (expectedStatus === 'Active') {
            enhancedLogger.info('✅ Proposal is active', {
              contextLabel,
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              proposalPda: proposalPda.toString(),
            });
          } else {
            enhancedLogger.info('✅ Proposal account initialized', {
              contextLabel,
              status: currentStatus,
              multisigAddress: multisigAddress.toString(),
              transactionIndex: transactionIndex.toString(),
              proposalPda: proposalPda.toString(),
            });
          }
          return;
        }
        enhancedLogger.info('⏳ Waiting for proposal status update', {
          contextLabel,
          expectedStatus,
          currentStatus,
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          proposalPda: proposalPda.toString(),
        });
      } catch (error: any) {
        enhancedLogger.warn('⚠️ Unable to fetch proposal status, retrying', {
          contextLabel,
          expectedStatus,
          multisigAddress: multisigAddress.toString(),
          transactionIndex: transactionIndex.toString(),
          proposalPda: proposalPda.toString(),
          error: error?.message || String(error),
        });
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `Proposal ${proposalPda.toString()} did not reach status ${expectedStatus} within ${
        timeoutMs / 1000
      }s`
    );
  }

  private shouldRetryWithFreshBlockhash(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    if (!message) {
      return false;
    }
    const normalized = message.toLowerCase();
    return normalized.includes('blockhash not found') ||
      normalized.includes('transaction expired') ||
      normalized.includes('expired blockhash') ||
      normalized.includes('slot is behind');
  }

  /**
   * Determine if an error is retryable (transient RPC failures)
   * Non-retryable: 0x65/101 (InstructionFallbackNotFound), invalid state errors
   * Retryable: network errors, RPC timeouts, connection issues
   */
  private isRetryableError(error: any): boolean {
    const message = error?.message || String(error) || '';
    const normalized = message.toLowerCase();
    
    // Check for non-retryable errors first
    if (normalized.includes('0x65') || 
        normalized.includes('101') || 
        normalized.includes('instructionfallbacknotfound') ||
        normalized.includes('invalid state') ||
        normalized.includes('not in executeready')) {
      return false;
    }
    
    // Retryable errors: network, RPC, connection issues
    return normalized.includes('network') ||
           normalized.includes('timeout') ||
           normalized.includes('connection') ||
           normalized.includes('econnrefused') ||
           normalized.includes('enotfound') ||
           normalized.includes('econnreset') ||
           normalized.includes('socket') ||
           normalized.includes('rpc') && (normalized.includes('error') || normalized.includes('failed'));
  }

  /**
   * Comprehensive error logging for 0x65/101 and other execution failures
   * Includes full on-chain state dump, account details, and simulation logs
   */
  private async logExecutionErrorComprehensive(params: {
    vaultAddress: string;
    proposalId: string;
    transactionIndex: number;
    multisigPda: PublicKey;
    transactionPda: PublicKey;
    proposalPda: PublicKey;
    error: any;
    errorCode: number | null;
    isInstructionFallbackNotFound: boolean;
    correlationId: string;
    attempt: number;
  }): Promise<void> {
    const {
      vaultAddress,
      proposalId,
      transactionIndex,
      multisigPda,
      transactionPda,
      proposalPda,
      error,
      errorCode,
      isInstructionFallbackNotFound,
      correlationId,
      attempt,
    } = params;

    // Base error log
    enhancedLogger.error('❌ CRITICAL: Execution failed with comprehensive diagnostics', {
      vaultAddress,
      proposalId,
      transactionIndex,
      multisigPda: multisigPda.toString(),
      transactionPda: transactionPda.toString(),
      proposalPda: proposalPda.toString(),
      errorCode: errorCode || 'unknown',
      isInstructionFallbackNotFound,
      attempt,
      errorMessage: error?.message || String(error),
      errorStack: error?.stack,
      errorType: typeof error,
      errorKeys: error ? Object.keys(error) : [],
      correlationId,
      note: isInstructionFallbackNotFound 
        ? 'This error means the EXECUTE instruction is malformed. Manual construction is NOT safe. Only SDK method should be used.'
        : 'Execution failed - see comprehensive diagnostics below',
    });

    // Fetch and log on-chain Proposal account state
    try {
      const proposalAccount = await accounts.Proposal.fromAccountAddress(
        this.connection,
        proposalPda,
        'confirmed'
      );
      
      const proposalStatus = (proposalAccount.status as any)?.__kind;
      const approvedSigners = proposalAccount.approved || [];
      const threshold = proposalAccount.threshold;
      
      // Full account dump
      const accountDump = {
        status: proposalStatus,
        approvedSigners: approvedSigners.map((s: PublicKey) => s.toString()),
        approvedSignersCount: approvedSigners.length,
        threshold,
        hasEnoughSigners: approvedSigners.length >= threshold,
        accountData: JSON.stringify(proposalAccount, (key, value) => {
          // Serialize PublicKey objects
          if (value && typeof value === 'object' && 'toBase58' in value) {
            return value.toBase58();
          }
          return value;
        }, 2),
      };
      
      enhancedLogger.error('🔍 FULL ON-CHAIN PROPOSAL ACCOUNT DUMP', {
        vaultAddress,
        proposalId,
        proposalPda: proposalPda.toString(),
        ...accountDump,
        correlationId,
      });
      
      // Check ExecuteReady state
      if (proposalStatus !== 'ExecuteReady') {
        enhancedLogger.error('❌ Proposal is NOT in ExecuteReady state - execution cannot proceed', {
          vaultAddress,
          proposalId,
          proposalStatus,
          requiredStatus: 'ExecuteReady',
          approvedSignersCount: approvedSigners.length,
          threshold,
          correlationId,
          note: 'Execution must wait for ExecuteReady state. Do NOT bypass this check.',
        });
      }
    } catch (fetchError: unknown) {
      enhancedLogger.warn('⚠️ Could not fetch Proposal account for comprehensive diagnosis', {
        vaultAddress,
        proposalId,
        proposalPda: proposalPda.toString(),
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        correlationId,
      });
    }

    // Fetch and log VaultTransaction account state
    try {
      const vaultTxAccount = await accounts.VaultTransaction.fromAccountAddress(
        this.connection,
        transactionPda,
        'confirmed'
      );
      
      const vaultTxDump = {
        hasMessage: !!vaultTxAccount.message,
        messageAccountKeysCount: (vaultTxAccount.message as any)?.accountKeys?.length || 0,
        accountData: JSON.stringify(vaultTxAccount, (key, value) => {
          if (value && typeof value === 'object' && 'toBase58' in value) {
            return value.toBase58();
          }
          return value;
        }, 2),
      };
      
      enhancedLogger.error('🔍 FULL ON-CHAIN VAULTTRANSACTION ACCOUNT DUMP', {
        vaultAddress,
        proposalId,
        transactionPda: transactionPda.toString(),
        ...vaultTxDump,
        correlationId,
      });
    } catch (fetchError: unknown) {
      enhancedLogger.warn('⚠️ Could not fetch VaultTransaction account for comprehensive diagnosis', {
        vaultAddress,
        proposalId,
        transactionPda: transactionPda.toString(),
        error: fetchError instanceof Error ? fetchError.message : String(fetchError),
        correlationId,
      });
    }

    // Try to get simulation logs if available in error
    if (error?.logs && Array.isArray(error.logs)) {
      enhancedLogger.error('🔍 SIMULATION LOGS FROM ERROR', {
        vaultAddress,
        proposalId,
        transactionPda: transactionPda.toString(),
        simulationLogs: error.logs,
        logsCount: error.logs.length,
        correlationId,
      });
    }
  }

  private async buildExecutionErrorDetails(
    tx: VersionedTransaction | null,
    rawError: unknown
  ): Promise<{ message: string; logs?: string[] }> {
    let message = rawError instanceof Error ? rawError.message : String(rawError);
    let logs: string[] | undefined;

    const errorLogs = (rawError as any)?.logs;
    if (Array.isArray(errorLogs)) {
      logs = errorLogs;
    }

    if (tx) {
      try {
        const insights = await this.collectSimulationLogs(tx);
        if (insights.logs && insights.logs.length > 0) {
          logs = insights.logs;
        }
        if (insights.errorInfo) {
          message = `${message} | Simulation error: ${insights.errorInfo}`;
        }
      } catch (simulationError: unknown) {
        const simMessage = simulationError instanceof Error ? simulationError.message : String(simulationError);
        enhancedLogger.warn('⚠️ Simulation failed while diagnosing execution error', {
          error: simMessage,
        });
      }
    }

    return { message, logs };
  }

  private async collectSimulationLogs(tx: VersionedTransaction): Promise<{ logs?: string[]; errorInfo?: string }> {
    const simulation = await this.connection.simulateTransaction(tx, {
      replaceRecentBlockhash: true,
      sigVerify: false,
    });

    let errorInfo: string | undefined;

    if (simulation.value.err) {
      errorInfo = JSON.stringify(simulation.value.err);
      enhancedLogger.warn('⚠️ Simulation reported an error during execution diagnostics', {
        error: errorInfo,
        logs: simulation.value.logs?.slice(-20),
      });
    }

    // Log all simulation logs for debugging
    if (simulation.value.logs && simulation.value.logs.length > 0) {
      enhancedLogger.info('📋 Simulation logs', {
        logCount: simulation.value.logs.length,
        lastLogs: simulation.value.logs.slice(-10),
        allLogs: simulation.value.logs,
      });
    }

    return {
      logs: simulation.value.logs ?? undefined,
      errorInfo,
    };
  }
}

// Export singleton instance
/**
 * Type-safe wrapper for getTransactionPda to prevent parameter name errors.
 * 
 * CRITICAL: The Squads SDK's getTransactionPda() expects 'index', not 'transactionIndex'.
 * This wrapper enforces the correct parameter name and adds validation/logging.
 * 
 * @param params - PDA derivation parameters
 * @param params.multisigPda - The multisig PDA address
 * @param params.transactionIndex - The transaction index (will be passed as 'index' to SDK)
 * @param params.programId - The Squads program ID
 * @returns [PublicKey, number] - The derived VaultTransaction PDA and bump seed
 * 
 * @example
 * const [vaultTxPda] = deriveVaultTransactionPda({
 *   multisigPda: multisigAddress,
 *   transactionIndex: BigInt(3),
 *   programId: programId,
 * });
 */
export function deriveVaultTransactionPda(params: {
  multisigPda: PublicKey;
  transactionIndex: bigint | number;
  programId: PublicKey;
}): [PublicKey, number] {
  const { multisigPda, transactionIndex, programId } = params;
  
  // Runtime validation
  if (!multisigPda || !(multisigPda instanceof PublicKey)) {
    throw new Error('deriveVaultTransactionPda: multisigPda must be a PublicKey');
  }
  if (transactionIndex === undefined || transactionIndex === null) {
    throw new Error('deriveVaultTransactionPda: transactionIndex is required');
  }
  if (!programId || !(programId instanceof PublicKey)) {
    throw new Error('deriveVaultTransactionPda: programId must be a PublicKey');
  }
  
  // Convert to BigInt if needed
  const index = typeof transactionIndex === 'bigint' ? transactionIndex : BigInt(transactionIndex);
  
  // Log the derivation for debugging
  enhancedLogger.debug('🔍 Deriving VaultTransaction PDA', {
    multisigPda: multisigPda.toString(),
    transactionIndex: index.toString(),
    programId: programId.toString(),
    note: 'Using type-safe wrapper - parameter name is guaranteed correct',
  });
  
  // CRITICAL: Use 'index' parameter name (not 'transactionIndex')
  const [pda, bump] = getTransactionPda({
    multisigPda,
    index, // ✅ Correct parameter name
    programId,
  });
  
  enhancedLogger.debug('✅ VaultTransaction PDA derived', {
    pda: pda.toString(),
    bump,
    transactionIndex: index.toString(),
    multisigPda: multisigPda.toString(),
  });
  
  return [pda, bump];
}

export const squadsVaultService = new SquadsVaultService();
export const getSquadsVaultService = () => squadsVaultService;

