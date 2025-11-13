import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, Transaction, TransactionMessage, TransactionInstruction, SystemProgram, VersionedTransaction, SendTransactionError, ComputeBudgetProgram } from '@solana/web3.js';
import {
  rpc,
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
    // Get network URL from environment or default to Devnet
    const networkUrl = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
    this.connection = new Connection(networkUrl, 'confirmed');

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
      enhancedLogger.info('✅ System keypair loaded successfully', {
        publicKey: systemKeypair.publicKey.toString(),
      });
    } catch (keypairError: unknown) {
      const errorMsg = keypairError instanceof Error ? keypairError.message : String(keypairError);
      enhancedLogger.error('❌ Failed to load system keypair', {
        error: errorMsg,
      });
      throw new Error(`Failed to load system keypair: ${errorMsg}. Ensure FEE_WALLET_PRIVATE_KEY is set.`);
    }

    // Validate keypair has signing capability
    if (!systemKeypair.secretKey || systemKeypair.secretKey.length === 0) {
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
        existingMultisig = await accounts.Multisig.fromAccountAddress(
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

        const multisigAccountInfo = await this.connection.getAccountInfo(multisigPda, 'confirmed');
        
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
        const multisigInfo = await accounts.Multisig.fromAccountAddress(
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
      const vaultAccountInfo = await this.connection.getAccountInfo(vaultPdaKey, 'confirmed');
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

      const vaultLamportsBig = BigInt(vaultAccountInfo.lamports);
      const rentReserveBig = BigInt(rentExemptReserve);

      // Allow proposal creation even if vault balance is low - top-up from fee wallet will handle it
      // Only fail if vault account doesn't exist or has zero balance (which would indicate a problem)
      if (vaultLamportsBig === BigInt(0)) {
        const errorMsg = `Vault account has zero balance - this indicates funds were never deposited or already withdrawn`;
        enhancedLogger.error('❌ Vault balance is zero during proposal creation', {
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
      
      if (vaultLamportsBig <= rentReserveBig) {
        enhancedLogger.warn('⚠️ Vault balance is at or below rent reserve, but allowing proposal creation (fee wallet top-up will handle payout)', {
          vaultAddress,
          vaultPda: vaultPdaKey.toString(),
          vaultLamports: vaultLamportsBig.toString(),
          rentReserve: rentReserveBig.toString(),
          note: 'Proposal will use fee wallet top-up to cover winner payout if vault balance is insufficient',
        });
        // Continue with proposal creation - top-up logic will handle it
      }

      // Calculate transferable balance (vault balance minus rent reserve)
      // If vault balance is below rent reserve, transferable is 0 (all funds will come from fee wallet top-up)
      const transferableLamportsBig = vaultLamportsBig > rentReserveBig ? vaultLamportsBig - rentReserveBig : BigInt(0);
      
      // Calculate desired amounts based on total pot (entryFee * 2)
      // These are the target amounts, actual amounts from vault may be less if balance is low
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
        rentExemptReserve,
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

        await this.waitForAccountAvailability(
          transactionPda,
          'vault transaction',
          vaultAddress
        );
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

      // Ensure a proposal account exists and is active for this transaction
      let createdProposal = false;
      let proposalCreateSignature: string | null = null;
      try {
        proposalCreateSignature = await rpc.proposalCreate({
          connection: this.connection,
          feePayer: this.config.systemKeypair,
          creator: this.config.systemKeypair,
          multisigPda: multisigAddress,
          transactionIndex,
          programId: this.programId,
          isDraft: true,
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
          enhancedLogger.info('ℹ️ Proposal already exists, continuing', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
          });
        } else {
          enhancedLogger.error('❌ Failed to create proposal account', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            error: msg,
          });
          throw proposalError;
        }
      }

      if (createdProposal && proposalCreateSignature) {
        await this.confirmProposalCreation(
          proposalCreateSignature,
          multisigAddress,
          transactionIndex,
          'winner payout'
        );
      }

      try {
        const activateSignature = await rpc.proposalActivate({
          connection: this.connection,
          feePayer: this.config.systemKeypair,
          member: this.config.systemKeypair,
          multisigPda: multisigAddress,
          transactionIndex,
          programId: this.programId,
        });
        enhancedLogger.info('✅ Proposal activated', {
          vaultAddress,
          proposalId,
          activateSignature,
        });
        await this.confirmProposalActivation(
          activateSignature,
          multisigAddress,
          transactionIndex,
          'winner payout'
        );
      } catch (activateError: any) {
        const msg =
          activateError?.message ||
          (activateError?.logs ? activateError.logs.join('\n') : String(activateError));
        if (msg.includes('AlreadyActive') || msg.includes('already active')) {
          enhancedLogger.info('ℹ️ Proposal already active', {
            vaultAddress,
            proposalId,
          });
        } else {
          enhancedLogger.error('❌ Failed to activate proposal', {
            vaultAddress,
            proposalId,
            error: msg,
            rawError: activateError,
          });
          throw activateError;
        }
      }

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
        needsSignatures: 1, // 1 more signature needed (system already signed)
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
        const vaultAccountInfo = await this.connection.getAccountInfo(vaultPda, 'confirmed');
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
        const multisigInfo = await accounts.Multisig.fromAccountAddress(
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

      const vaultAccountInfo = await this.connection.getAccountInfo(vaultPdaKey, 'confirmed');
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
        rentExemptReserve,
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

      // CRITICAL FIX: Do NOT include top-up instructions in the proposal
      // Top-up transfers from fee wallet require fee wallet signature at execution time
      // which causes simulation failures. Instead, we'll top-up the vault BEFORE execution.
      // Store top-up amounts for later use in executeProposal
      const topUpAmounts = {
        player1TopUp: Number(player1TopUpBig),
        player2TopUp: Number(player2TopUpBig),
        totalTopUp: Number(player1TopUpBig + player2TopUpBig),
      };
      
      if (topUpAmounts.totalTopUp > 0) {
        enhancedLogger.info('⚠️ Vault balance insufficient - top-up will be done separately before execution', {
          vaultAddress,
          vaultPda: vaultPdaKey.toString(),
          player1TopUp: topUpAmounts.player1TopUp,
          player2TopUp: topUpAmounts.player2TopUp,
          totalTopUp: topUpAmounts.totalTopUp,
          note: 'Top-up instructions NOT included in proposal. Will transfer from fee wallet to vault before execution.',
        });
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
        const multisigAccountInfo = await this.connection.getAccountInfo(multisigAddress, 'confirmed');
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

        await this.waitForAccountAvailability(
          transactionPda,
          'tie refund vault transaction',
          vaultAddress
        );
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

      // Ensure proposal account exists and is active for this transaction
      let createdTieProposal = false;
      let tieProposalSignature: string | null = null;
      try {
        tieProposalSignature = await rpc.proposalCreate({
          connection: this.connection,
          feePayer: this.config.systemKeypair,
          creator: this.config.systemKeypair,
          multisigPda: multisigAddress,
          transactionIndex,
          programId: this.programId,
          isDraft: true,
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
          enhancedLogger.info('ℹ️ Proposal already exists, continuing', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
          });
        } else {
          enhancedLogger.error('❌ Failed to create proposal account', {
            multisigAddress: multisigAddress.toString(),
            transactionIndex: transactionIndex.toString(),
            error: msg,
          });
          throw proposalError;
        }
      }

      if (createdTieProposal && tieProposalSignature) {
        await this.confirmProposalCreation(
          tieProposalSignature,
          multisigAddress,
          transactionIndex,
          'tie refund'
        );
      }

      try {
        const activateSignature = await rpc.proposalActivate({
          connection: this.connection,
          feePayer: this.config.systemKeypair,
          member: this.config.systemKeypair,
          multisigPda: multisigAddress,
          transactionIndex,
          programId: this.programId,
        });
        enhancedLogger.info('✅ Proposal activated', {
          vaultAddress,
          proposalId,
          activateSignature,
        });
        await this.confirmProposalActivation(
          activateSignature,
          multisigAddress,
          transactionIndex,
          'tie refund'
        );
      } catch (activateError: any) {
        const msg =
          activateError?.message ||
          (activateError?.logs ? activateError.logs.join('\n') : String(activateError));
        if (msg.includes('AlreadyActive') || msg.includes('already active')) {
          enhancedLogger.info('ℹ️ Proposal already active', {
            vaultAddress,
            proposalId,
          });
        } else {
          enhancedLogger.error('❌ Failed to activate proposal', {
            vaultAddress,
            proposalId,
            error: msg,
            rawError: activateError,
          });
          throw activateError;
        }
      }

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
        needsSignatures: 1, // 1 more signature needed (system already signed)
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      
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
      const transactionIndex = BigInt(proposalId);

      // Get the transaction PDA
      const [transactionPda] = getTransactionPda({
        multisigPda: multisigAddress,
        index: transactionIndex,
        programId: this.programId,
      });

      // Get the proposal PDA
      const [proposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex,
        programId: this.programId,
      });

      // Fetch the transaction account
      const transactionAccount = await this.connection.getAccountInfo(transactionPda, 'confirmed');
      
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
        const transaction = await accounts.VaultTransaction.fromAccountAddress(
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

      // Use rpc.proposalApprove to approve the transaction
      const signature = await rpc.proposalApprove({
        connection: this.connection,
        feePayer: signer,
        multisigPda: multisigAddress,
        transactionIndex,
        member: signer,
        programId: this.programId, // Use network-specific program ID (Devnet/Mainnet)
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
   * Execute a Squads proposal after it has enough signatures
   * This actually moves the funds from the vault to recipients
   */
  async executeProposal(
    vaultAddress: string,
    proposalId: string,
    executor: Keypair,
    overrideVaultPda?: string
  ): Promise<{ success: boolean; signature?: string; slot?: number; executedAt?: string; logs?: string[]; error?: string }> {
    const multisigAddress = new PublicKey(vaultAddress);
    const transactionIndex = BigInt(proposalId);
    enhancedLogger.info('🚀 Executing Squads proposal', {
      vaultAddress,
      proposalId,
      transactionIndex: transactionIndex.toString(),
      executor: executor.publicKey.toString(),
    });

    // Verify proposal status before executing and wait for ExecuteReady transition if needed
    let proposalIsExecuteReady = false;
    let vaultTransactionIsExecuteReady = false;
    
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const transactionIndex = BigInt(proposalId);
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

      // Check both Proposal and VaultTransaction accounts
      // The execution instruction may check VaultTransaction status, not Proposal status
      try {
        // Check VaultTransaction account status
        try {
          const transaction = await accounts.VaultTransaction.fromAccountAddress(
            this.connection,
            transactionPda,
            'confirmed'
          );
          
          const vaultTxStatus = (transaction as any).status;
          // Status values: 0 = Active, 1 = ExecuteReady, 2 = Executed
          vaultTransactionIsExecuteReady = vaultTxStatus === 1; // ExecuteReady
          
          enhancedLogger.info('🔍 VaultTransaction account status check before execution', {
            vaultAddress,
            proposalId,
            transactionPda: transactionPda.toString(),
            status: vaultTxStatus,
            isExecuteReady: vaultTransactionIsExecuteReady,
            note: 'VaultTransaction status: 0=Active, 1=ExecuteReady, 2=Executed',
          });
        } catch (vaultTxError: unknown) {
          enhancedLogger.warn('⚠️ Failed to check VaultTransaction account status', {
            vaultAddress,
            proposalId,
            error: vaultTxError instanceof Error ? vaultTxError.message : String(vaultTxError),
          });
        }

        // Check Proposal account status
        const proposal = await accounts.Proposal.fromAccountAddress(
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
          vaultTransactionIsExecuteReady,
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

        // According to Squads Protocol and SDK behavior:
        // 1. vaultTransactionExecute CAN execute from "Approved" state directly (simulation confirms this)
        // 2. The ExecuteReady transition may happen DURING execution, not before
        // 3. If threshold is met, we can proceed with execution immediately
        if (proposalStatusKind === 'Approved' && !proposalIsExecuteReady && !vaultTransactionIsExecuteReady) {
          if (approvedCount >= this.config.threshold) {
            enhancedLogger.info('✅ Proposal is Approved with threshold met - executing directly', {
              vaultAddress,
              proposalId,
              statusKind: proposalStatusKind,
              approvedCount,
              threshold: this.config.threshold,
              approvedSigners: (proposal as any).approved,
              vaultTransactionStatus: vaultTransactionIsExecuteReady ? 'ExecuteReady' : 'Active',
              note: 'vaultTransactionExecute can execute from Approved state. ExecuteReady transition may occur during execution.',
            });
            // Proceed with execution - no need to wait for ExecuteReady transition
            // The execution instruction will handle the state transition
          } else {
            enhancedLogger.warn('⚠️ Proposal is Approved but does not have enough signatures yet', {
              vaultAddress,
              proposalId,
              statusKind: proposalStatusKind,
              approvedCount,
              threshold: this.config.threshold,
              note: 'Waiting for more signatures before attempting execution',
            });
            return {
              success: false,
              error: 'INSUFFICIENT_SIGNATURES',
              logs: [`Proposal needs ${this.config.threshold - approvedCount} more signature(s)`],
            };
          }
        }
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
        vaultTransactionIsExecuteReady,
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
      if (proposalStatus.needsSignatures > 0 && !proposalIsExecuteReady && !vaultTransactionIsExecuteReady) {
        enhancedLogger.warn('⚠️ On-chain check shows proposal does not have enough signatures yet', {
          vaultAddress,
          proposalId,
          needsSignatures: proposalStatus.needsSignatures,
          signers: proposalStatus.signers.map(s => s.toString()),
          proposalIsExecuteReady,
          vaultTransactionIsExecuteReady,
          note: 'Continuing with execution attempt - database state may be more accurate than on-chain check',
        });
        // Don't fail here - the on-chain check might be failing to read signers correctly
        // The actual execution will fail if signatures are truly insufficient
        // This allows execution to proceed when database says ready but on-chain check fails
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
      } catch (derivationError: unknown) {
        enhancedLogger.warn('⚠️ Unable to derive vault PDA for balance pre-check', {
          vaultAddress,
          proposalId,
          error: derivationError instanceof Error ? derivationError.message : String(derivationError),
        });
      }
    }

    // CRITICAL FIX: Top-up vault BEFORE execution if needed
    // Expert recommendation: Do NOT embed fee wallet transfers in proposal
    // Instead, top-up vault separately before executing proposal
    if (derivedVaultPda) {
      try {
        const vaultBalance = await this.connection.getBalance(derivedVaultPda, 'confirmed');
        const vaultAccountInfo = await this.connection.getAccountInfo(derivedVaultPda, 'confirmed');
        const rentExemptReserve = vaultAccountInfo 
          ? await this.connection.getMinimumBalanceForRentExemption(vaultAccountInfo.data.length)
          : 0;
        
        enhancedLogger.info('🔎 Vault balance before execution attempt', {
          vaultAddress,
          proposalId,
          vaultPda: derivedVaultPda.toString(),
          balanceLamports: vaultBalance,
          balanceSOL: vaultBalance / LAMPORTS_PER_SOL,
          rentExemptReserve,
          transferableBalance: Math.max(0, vaultBalance - rentExemptReserve),
        });

        // Calculate required lamports from the vault transaction proposal
        // We need to check what transfers the proposal requires
        let requiredLamports = 0;
        try {
          const [transactionPda] = getTransactionPda({
            multisigPda: new PublicKey(vaultAddress),
            index: BigInt(proposalId),
            programId: this.programId,
          });
          
          const vaultTx = await accounts.VaultTransaction.fromAccountAddress(
            this.connection,
            transactionPda,
            'confirmed'
          );
          
          // Extract transfer amounts from the transaction message
          const message = (vaultTx as any).message;
          if (message) {
            // The message contains instructions - we need to sum transfers FROM the vault
            // For versioned messages, we need to parse the instructions differently
            try {
              const accountKeys = message.getAccountKeys ? message.getAccountKeys() : null;
              if (accountKeys && message.compiledInstructions) {
                for (const ix of message.compiledInstructions) {
                  const programId = accountKeys.get(ix.programIdIndex);
                  // Check if this is a SystemProgram transfer
                  if (programId && programId.equals(SystemProgram.programId)) {
                    // Parse transfer instruction: 4 bytes instruction discriminator + 8 bytes lamports
                    if (ix.data && ix.data.length >= 12) {
                      const lamports = Number(ix.data.readBigUInt64LE(4));
                      // Check if first account is the vault PDA (transfer FROM vault)
                      if (ix.accountKeyIndexes && ix.accountKeyIndexes.length > 0) {
                        const fromAccount = accountKeys.get(ix.accountKeyIndexes[0]);
                        if (fromAccount && fromAccount.equals(derivedVaultPda)) {
                          requiredLamports += lamports;
                        }
                      }
                    }
                  }
                }
              }
            } catch (parseError: unknown) {
              enhancedLogger.warn('⚠️ Could not parse vault transaction instructions', {
                vaultAddress,
                proposalId,
                error: parseError instanceof Error ? parseError.message : String(parseError),
              });
            }
          }
        } catch (txParseError: unknown) {
          enhancedLogger.warn('⚠️ Could not fetch vault transaction to determine required amount', {
            vaultAddress,
            proposalId,
            error: txParseError instanceof Error ? txParseError.message : String(txParseError),
            note: 'Will proceed with execution - simulation will show clear error if balance insufficient',
          });
        }

        const transferableBalance = Math.max(0, vaultBalance - rentExemptReserve);
        const topUpNeeded = Math.max(0, requiredLamports - transferableBalance);

        if (topUpNeeded > 0) {
          enhancedLogger.info('💰 Top-up needed - transferring from fee wallet to vault BEFORE execution', {
            vaultAddress,
            proposalId,
            vaultPda: derivedVaultPda.toString(),
            currentBalance: vaultBalance,
            requiredLamports,
            transferableBalance,
            topUpNeeded,
            feeWallet: executor.publicKey.toString(),
            note: 'Expert recommendation: Top-up separately before execution to avoid signature issues',
          });

          // Perform top-up transfer from fee wallet to vault
          const topUpTx = new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: executor.publicKey,
              toPubkey: derivedVaultPda,
              lamports: topUpNeeded,
            })
          );
          
          const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
          topUpTx.feePayer = executor.publicKey;
          topUpTx.recentBlockhash = latestBlockhash.blockhash;
          topUpTx.sign(executor);

          // Send and confirm top-up transaction
          const topUpSignature = await this.connection.sendRawTransaction(topUpTx.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });

          enhancedLogger.info('📤 Top-up transaction sent, waiting for confirmation', {
            vaultAddress,
            proposalId,
            topUpSignature,
            topUpAmount: topUpNeeded,
            topUpAmountSOL: topUpNeeded / LAMPORTS_PER_SOL,
          });

          // Wait for confirmation with timeout
          try {
            const confirmation = await Promise.race([
              this.connection.confirmTransaction(topUpSignature, 'confirmed'),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Top-up confirmation timeout')), 30000)
              ),
            ]) as any;

            if (confirmation.value?.err) {
              const errorMsg = `Top-up transaction failed: ${JSON.stringify(confirmation.value.err)}`;
              enhancedLogger.error('❌ Top-up transaction failed', {
                vaultAddress,
                proposalId,
                topUpSignature,
                error: confirmation.value.err,
                logs: confirmation.value.logs,
              });
              return {
                success: false,
                error: errorMsg,
                logs: [`Top-up failed: ${JSON.stringify(confirmation.value.err)}`],
              };
            }

            enhancedLogger.info('✅ Top-up transaction confirmed, vault balance should now be sufficient', {
              vaultAddress,
              proposalId,
              topUpSignature,
              topUpAmount: topUpNeeded,
              slot: confirmation.value?.context?.slot,
            });

            // Verify vault balance increased
            const newVaultBalance = await this.connection.getBalance(derivedVaultPda, 'confirmed');
            enhancedLogger.info('🔍 Vault balance after top-up', {
              vaultAddress,
              proposalId,
              vaultPda: derivedVaultPda.toString(),
              previousBalance: vaultBalance,
              newBalance: newVaultBalance,
              topUpAmount: topUpNeeded,
              balanceIncrease: newVaultBalance - vaultBalance,
              note: 'If balance did not increase, top-up may have failed or been delayed',
            });
          } catch (confirmError: unknown) {
            enhancedLogger.error('❌ Top-up confirmation failed or timed out', {
              vaultAddress,
              proposalId,
              topUpSignature,
              error: confirmError instanceof Error ? confirmError.message : String(confirmError),
              note: 'Will proceed with execution - if balance is still insufficient, simulation will show error',
            });
            // Don't block execution - simulation will catch if balance is still insufficient
          }
        } else {
          enhancedLogger.info('✅ Vault balance sufficient, no top-up needed', {
            vaultAddress,
            proposalId,
            vaultBalance,
            requiredLamports,
            transferableBalance,
          });
        }
      } catch (balanceError: unknown) {
        enhancedLogger.warn('⚠️ Failed to check/fix vault balance before execution', {
          vaultAddress,
          proposalId,
          vaultPda: derivedVaultPda?.toString(),
          error: balanceError instanceof Error ? balanceError.message : String(balanceError),
          note: 'Proceeding with execution - simulation will show clear error if balance insufficient',
        });
        // Don't block execution on balance check failure - simulation will catch it
      }
    }

    // CRITICAL: Increased maxAttempts for 100% payment consistency
    // According to Solana docs, blockhashes expire after ~150 blocks (~60 seconds)
    // We'll retry up to 10 times with fresh blockhashes to handle network congestion
    // Each retry will check block height before attempting to ensure blockhash hasn't expired
    // The background ExecutionRetryService will continue retrying if all attempts fail here
    const maxAttempts = 10;
    let lastErrorMessage = '';
    let lastLogs: string[] | undefined;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let tx: VersionedTransaction | null = null;
      try {
        // CRITICAL FIX: Calculate priority fee and build transaction ONCE with fee included
        // Multiple rebuilds were corrupting the transaction structure
        // Increased base fee for devnet reliability
        const basePriorityFee = 50000; // 0.00005 SOL base fee (increased for devnet)
        const priorityFeeMultiplier = Math.min(1 + (attempt * 0.3), 2.0); // Up to 2x for later attempts
        const priorityFeeMicroLamports = Math.round(basePriorityFee * priorityFeeMultiplier);
        
        // Get fresh blockhash immediately before building
        const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
        
        enhancedLogger.info('🔨 Building execution transaction with priority fee', {
          vaultAddress,
          proposalId,
          attempt: attempt + 1,
          blockhash: latestBlockhash.blockhash.substring(0, 8) + '...',
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          priorityFeeMicroLamports,
          priorityFeeSOL: priorityFeeMicroLamports / 1_000_000,
          note: 'Building transaction ONCE with priority fee included to prevent structure corruption',
        });
        
        // Build base execution transaction
        const baseTx = await transactions.vaultTransactionExecute({
          connection: this.connection,
          blockhash: latestBlockhash.blockhash,
          feePayer: executor.publicKey,
          multisigPda: multisigAddress,
          transactionIndex,
          member: executor.publicKey,
          programId: this.programId,
        });

        // Add priority fee BEFORE signing to ensure it's part of the transaction structure
        const message = baseTx.message;
        const accountKeys = message.getAccountKeys();
        const totalAccounts = accountKeys.length;
        const { numRequiredSignatures, numReadonlySignedAccounts, numReadonlyUnsignedAccounts } = message.header;
        
        // Extract existing instructions
        const existingInstructions = message.compiledInstructions.map((ix: any) => {
          const programId = accountKeys.get(ix.programIdIndex);
          const keys = ix.accountKeyIndexes.map((keyIndex: number) => {
            const pubkey = accountKeys.get(keyIndex);
            const isSigner = keyIndex < numRequiredSignatures;
            const isWritable = keyIndex < numRequiredSignatures || 
                              (keyIndex >= numRequiredSignatures + numReadonlySignedAccounts && 
                               keyIndex < totalAccounts - numReadonlyUnsignedAccounts);
            return { pubkey, isSigner, isWritable };
          });
          return new TransactionInstruction({
            programId,
            keys,
            data: Buffer.from(ix.data),
          });
        });
        
        // Add priority fee instruction at the beginning
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
          microLamports: priorityFeeMicroLamports,
        });
        const instructionsWithPriorityFee = [priorityFeeIx, ...existingInstructions];
        
        // Build final transaction message with priority fee
        const transactionMessage = new TransactionMessage({
          payerKey: executor.publicKey,
          recentBlockhash: latestBlockhash.blockhash,
          instructions: instructionsWithPriorityFee,
        });
        
        const compiledMessage = transactionMessage.compileToV0Message();
        tx = new VersionedTransaction(compiledMessage);
        tx.sign([executor]);
        
        // CRITICAL: Always simulate and capture detailed logs before sending
        // Expert recommendation: This shows exact failure reasons
        try {
          const simulation = await this.connection.simulateTransaction(tx, {
            replaceRecentBlockhash: true,
            sigVerify: false,
          });
          
          // Log ALL simulation details for debugging
          enhancedLogger.info('🔬 Transaction simulation result', {
            vaultAddress,
            proposalId,
            attempt: attempt + 1,
            maxAttempts,
            err: simulation.value.err ? JSON.stringify(simulation.value.err, null, 2) : null,
            unitsConsumed: simulation.value.unitsConsumed,
            logs: simulation.value.logs || [],
            logCount: simulation.value.logs?.length || 0,
            note: 'Full simulation logs captured - check logs array for exact failure reason',
          });
          
          if (simulation.value.err) {
            const simError = JSON.stringify(simulation.value.err, null, 2);
            const errorLogs = simulation.value.logs || [];
            
            enhancedLogger.error('❌ Transaction simulation failed - DETAILED ERROR ANALYSIS', {
              vaultAddress,
              proposalId,
              attempt: attempt + 1,
              maxAttempts,
              error: simError,
              errorType: typeof simulation.value.err === 'object' && simulation.value.err !== null 
                ? Object.keys(simulation.value.err)[0] 
                : 'unknown',
              logs: errorLogs,
              logCount: errorLogs.length,
              unitsConsumed: simulation.value.unitsConsumed,
              note: 'Simulation failure indicates execution will fail. Check logs array for program errors, missing signers, or account issues.',
            });
            
            // Extract specific error messages from logs
            const programErrors = errorLogs.filter((log: string) => 
              log.includes('Program failed') || 
              log.includes('custom program error') ||
              log.includes('insufficient funds') ||
              log.includes('signature') ||
              log.includes('Account') ||
              log.includes('Instruction') ||
              log.includes('Error')
            );
            
            if (programErrors.length > 0) {
              enhancedLogger.error('🔍 Program errors extracted from simulation logs', {
                vaultAddress,
                proposalId,
                programErrors,
                programErrorCount: programErrors.length,
                note: 'These are the specific on-chain errors that caused simulation to fail',
              });
            }
            
            lastErrorMessage = `Simulation error: ${simError}`;
            if (programErrors.length > 0) {
              lastErrorMessage += ` | Program errors: ${programErrors.slice(0, 5).join('; ')}`;
            }
            lastLogs = errorLogs;
            
            // If simulation fails, retry with fresh blockhash
            if (attempt < maxAttempts - 1) {
              enhancedLogger.info('🔄 Retrying with fresh blockhash after simulation failure', {
                vaultAddress,
                proposalId,
                attempt: attempt + 1,
                errorSummary: programErrors.slice(0, 3), // First 3 errors
              });
              continue;
            }
          } else {
            enhancedLogger.info('✅ Transaction simulation succeeded', {
              vaultAddress,
              proposalId,
              attempt: attempt + 1,
              computeUnitsUsed: simulation.value.unitsConsumed,
              logCount: simulation.value.logs?.length || 0,
              note: 'Simulation passed - transaction should execute successfully',
            });
          }
        } catch (simError: unknown) {
          enhancedLogger.error('❌ Simulation threw exception (not just failed)', {
            vaultAddress,
            proposalId,
            attempt: attempt + 1,
            error: simError instanceof Error ? simError.message : String(simError),
            stack: simError instanceof Error ? simError.stack : undefined,
            note: 'Simulation exception indicates transaction structure issue - will attempt execution anyway but likely to fail',
          });
          // Don't continue - let execution attempt proceed to see actual error
        }

        // Serialize and send transaction
        // CRITICAL FIX: Use preflight validation instead of skipPreflight
        // Preflight catches errors before submission and provides better error messages
        const rawTx = tx.serialize();
        let signature: string;
        
        try {
          // Use preflight to validate transaction before sending
          // This catches errors early and provides better diagnostics
          signature = await this.connection.sendRawTransaction(rawTx, {
            skipPreflight: false, // Enable preflight for better error detection
            preflightCommitment: 'confirmed',
            maxRetries: 3, // Standard retries since we're using preflight
          });
        } catch (sendError: unknown) {
          // Handle SendTransactionError specifically to extract logs
          if (sendError instanceof SendTransactionError) {
            // Try to get logs from the error - SendTransactionError has logs property
            let errorLogs: string[] = [];
            let fullErrorDetails: any = null;
            let simulationResponse: any = null;
            try {
              // SendTransactionError may have logs directly or via getLogs() method
              if (sendError.logs && Array.isArray(sendError.logs)) {
                errorLogs = sendError.logs;
              } else if (typeof (sendError as any).getLogs === 'function') {
                try {
                  errorLogs = (sendError as any).getLogs() || [];
                } catch (getLogsError) {
                  enhancedLogger.warn('⚠️ getLogs() method failed', {
                    vaultAddress,
                    proposalId,
                    error: getLogsError instanceof Error ? getLogsError.message : String(getLogsError),
                  });
                }
              }
              
              // Try to get simulation response - it might be in different places
              simulationResponse = (sendError as any).simulationResponse 
                || (sendError as any).simulation 
                || (sendError as any).response;
              
              // Try to get full error details including simulation response
              fullErrorDetails = {
                message: sendError.message,
                name: sendError.name,
                stack: sendError.stack,
                simulationResponse,
                // Check for any other error properties
                ...Object.keys(sendError).reduce((acc, key) => {
                  try {
                    const value = (sendError as any)[key];
                    // Only include serializable values
                    if (value !== undefined && value !== null) {
                      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                        acc[key] = value;
                      } else if (Array.isArray(value)) {
                        acc[key] = value;
                      } else if (typeof value === 'object') {
                        try {
                          JSON.stringify(value);
                          acc[key] = value;
                        } catch {
                          acc[key] = '[Object - not serializable]';
                        }
                      }
                    }
                  } catch {
                    // Ignore unreadable properties
                  }
                  return acc;
                }, {} as any),
              };
            } catch (logError: unknown) {
              enhancedLogger.warn('⚠️ Failed to extract logs from SendTransactionError', {
                vaultAddress,
                proposalId,
                error: logError instanceof Error ? logError.message : String(logError),
              });
            }
            
            const errorMessage = sendError.message || String(sendError);
            
            // Extract simulation error details
            const simulationError = simulationResponse?.value?.err 
              ? JSON.stringify(simulationResponse.value.err, null, 2)
              : null;
            const simulationLogs = simulationResponse?.value?.logs || errorLogs || [];
            const simulationUnitsConsumed = simulationResponse?.value?.unitsConsumed;
            
            // Log full error details for debugging
            enhancedLogger.error('❌ sendRawTransaction failed with SendTransactionError', {
              vaultAddress,
              proposalId,
              error: errorMessage,
              errorName: sendError.name,
              logs: simulationLogs.length > 0 ? simulationLogs.slice(-30) : undefined, // Last 30 log lines
              simulationError,
              simulationUnitsConsumed,
              hasSimulationResponse: !!simulationResponse,
              fullErrorDetails: JSON.stringify(fullErrorDetails, null, 2),
              proposalIsExecuteReady,
              vaultTransactionIsExecuteReady,
              attempt: attempt + 1,
              maxAttempts,
              note: 'This error occurs during preflight check or transaction submission. Check simulationError and logs for on-chain error details.',
            });
            
            lastErrorMessage = `SendTransactionError: ${errorMessage}`;
            if (simulationError) {
              lastErrorMessage += ` | Simulation error: ${simulationError}`;
            }
            lastLogs = errorLogs.length > 0 ? errorLogs : simulationLogs;
            
            // Check if error is related to proposal status
            const errorStr = (errorMessage + (simulationError || '')).toLowerCase();
            if (errorStr.includes('insufficient') || errorStr.includes('signature')) {
              enhancedLogger.error('❌ SendTransactionError indicates signature-related issue', {
                vaultAddress,
                proposalId,
                error: errorMessage,
                simulationError,
                logs: lastLogs?.slice(-20),
                proposalIsExecuteReady,
                vaultTransactionIsExecuteReady,
                note: 'The proposal may need to be in ExecuteReady state, or there may be a mismatch between approved signers and what execution requires',
              });
            }
            
            break;
          } else {
            // Handle non-SendTransactionError from sendRawTransaction
            const errorMessage = sendError instanceof Error ? sendError.message : String(sendError);
            enhancedLogger.error('❌ sendRawTransaction failed with non-SendTransactionError', {
              vaultAddress,
              proposalId,
              error: errorMessage,
              errorType: sendError?.constructor?.name || typeof sendError,
              errorDetails: sendError,
              proposalIsExecuteReady,
              vaultTransactionIsExecuteReady,
            });
            
            lastErrorMessage = `sendRawTransaction error: ${errorMessage}`;
            // Try to extract logs from the error if available
            if ((sendError as any)?.logs && Array.isArray((sendError as any).logs)) {
              lastLogs = (sendError as any).logs;
            }
            
            if (attempt === 0) {
              enhancedLogger.warn('🔄 Will retry execution with fresh blockhash after sendRawTransaction error', {
                vaultAddress,
                proposalId,
                error: errorMessage,
              });
              continue;
            }
            break;
          }
        }

        // Use a more reliable confirmation strategy with longer timeout
        // According to Solana docs, blockhashes expire after ~150 blocks (~60 seconds)
        // We'll use a custom confirmation strategy that polls getSignatureStatus
        // This is more reliable than confirmTransaction which can timeout prematurely
        let confirmation;
        let transactionConfirmed = false;
        let confirmationError: any = null;
        
        try {
          // First, try the standard confirmTransaction with a longer timeout
          // But we'll also implement a fallback polling strategy
          const confirmationPromise = this.connection.confirmTransaction(
            {
              signature,
              blockhash: latestBlockhash.blockhash,
              lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            'confirmed'
          );
          
          // Set a timeout of 90 seconds (longer than default ~30 seconds)
          // This gives more time for network congestion scenarios
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Confirmation timeout after 90 seconds')), 90000);
          });
          
          try {
            confirmation = await Promise.race([confirmationPromise, timeoutPromise]);
            transactionConfirmed = true;
          } catch (raceError: any) {
            // Timeout or other error - we'll fall back to polling strategy
            confirmationError = raceError;
            enhancedLogger.warn('⚠️ confirmTransaction timed out or failed, falling back to polling strategy', {
              vaultAddress,
              proposalId,
              signature,
              error: raceError instanceof Error ? raceError.message : String(raceError),
            });
          }
        } catch (confirmError: unknown) {
          confirmationError = confirmError;
        }
        
        // If standard confirmation failed, use polling strategy
        if (!transactionConfirmed) {
          enhancedLogger.info('🔄 Using polling strategy for transaction confirmation', {
            vaultAddress,
            proposalId,
            signature,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          });
          
          // Poll getSignatureStatus until transaction is confirmed or blockhash expires
          // According to Solana docs, blockhashes expire after ~150 blocks (~60 seconds)
          // We'll poll every 1 second for up to 90 seconds (with blockheight checking)
          const maxPollingDuration = 90000; // 90 seconds
          const pollInterval = 1000; // 1 second
          const startTime = Date.now();
          let currentBlockHeight = await this.connection.getBlockHeight('confirmed');
          
          while (Date.now() - startTime < maxPollingDuration && currentBlockHeight < latestBlockhash.lastValidBlockHeight) {
            try {
              const txStatus = await this.connection.getSignatureStatus(signature, {
                searchTransactionHistory: true,
              });
              
              if (txStatus?.value) {
                if (txStatus.value.err) {
                  // Transaction failed on-chain
                  confirmationError = new Error(`Transaction failed: ${JSON.stringify(txStatus.value.err)}`);
                  enhancedLogger.error('❌ Transaction failed on-chain (polling strategy)', {
                    vaultAddress,
                    proposalId,
                    signature,
                    error: JSON.stringify(txStatus.value.err),
                    slot: txStatus.value.slot,
                  });
                  break;
                } else if (txStatus.value.confirmationStatus === 'confirmed' || txStatus.value.confirmationStatus === 'finalized') {
                  // Transaction succeeded!
                  transactionConfirmed = true;
                  confirmation = { value: { err: null } }; // Create mock confirmation object
                  enhancedLogger.info('✅ Transaction confirmed via polling strategy', {
                    vaultAddress,
                    proposalId,
                    signature,
                    slot: txStatus.value.slot,
                    confirmationStatus: txStatus.value.confirmationStatus,
                    elapsedMs: Date.now() - startTime,
                  });
                  break;
                }
              }
              
              // Check current block height to ensure we haven't exceeded lastValidBlockHeight
              currentBlockHeight = await this.connection.getBlockHeight('confirmed');
              
              if (currentBlockHeight >= latestBlockhash.lastValidBlockHeight) {
                enhancedLogger.warn('⚠️ Blockhash expired during polling', {
                  vaultAddress,
                  proposalId,
                  signature,
                  currentBlockHeight,
                  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
                });
                break;
              }
              
              // Wait before next poll (respect rate limits)
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            } catch (pollError: unknown) {
              enhancedLogger.warn('⚠️ Error during polling (will continue)', {
                vaultAddress,
                proposalId,
                signature,
                error: pollError instanceof Error ? pollError.message : String(pollError),
              });
              // Continue polling despite error
              await new Promise(resolve => setTimeout(resolve, pollInterval));
            }
          }
          
          if (!transactionConfirmed && !confirmationError) {
            confirmationError = new Error('Transaction confirmation timeout - transaction may still be processing');
          }
        }
        
        // If we got a successful confirmation, proceed
        if (transactionConfirmed && confirmation && !confirmation.value?.err) {
          // Success - transaction confirmed
          enhancedLogger.info('✅ Transaction confirmed successfully', {
            vaultAddress,
            proposalId,
            signature,
            slot: (confirmation as any).value?.slot,
          });
          
          // Get transaction slot for return value
          let confirmedSlot: number | undefined;
          try {
            const txStatus = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
            confirmedSlot = txStatus?.value?.slot;
          } catch (slotError: unknown) {
            enhancedLogger.warn('⚠️ Could not get transaction slot (non-critical)', {
              vaultAddress,
              proposalId,
              signature,
              error: slotError instanceof Error ? slotError.message : String(slotError),
            });
          }
          
          // Transaction confirmed successfully - verify execution and return
          // Verify the transaction actually executed the transfers by checking transaction details
          try {
            const txDetails = await this.connection.getTransaction(signature, {
              commitment: 'confirmed',
              maxSupportedTransactionVersion: 0,
            });
            
            if (txDetails?.meta?.err) {
              enhancedLogger.error('❌ Transaction execution failed despite confirmation', {
                vaultAddress,
                proposalId,
                signature,
                error: JSON.stringify(txDetails.meta.err),
                logs: txDetails.meta.logMessages?.slice(-10),
              });
            } else {
              // Check if transfers were included in the transaction
              // Handle both legacy and versioned transactions
              let hasTransfers = false;
              const message = txDetails?.transaction?.message;
              if (message) {
                // For legacy transactions, instructions are directly accessible
                if ('instructions' in message && Array.isArray(message.instructions)) {
                  hasTransfers = message.instructions.some((ix: any) => {
                    const programId = typeof ix.programId === 'string' ? ix.programId : ix.programId?.toString();
                    return programId === '11111111111111111111111111111111'; // System Program
                  });
                } else if ('staticAccountKeys' in message) {
                  // For versioned transactions, we rely on balance changes
                  hasTransfers = true; // Assume transfers if balance changes exist
                }
              }
              
              enhancedLogger.info('✅ Transaction verification complete', {
                vaultAddress,
                proposalId,
                signature,
                hasTransfers,
                preBalances: txDetails?.meta?.preBalances?.slice(0, 5),
                postBalances: txDetails?.meta?.postBalances?.slice(0, 5),
                balanceChanges: txDetails?.meta?.preBalances && txDetails?.meta?.postBalances
                  ? txDetails.meta.postBalances.slice(0, 5).map((post: number, i: number) => 
                      post - (txDetails.meta.preBalances[i] || 0)
                    )
                  : undefined,
                note: 'Positive balance changes indicate funds were received. Negative changes indicate funds were sent.',
              });
            }
          } catch (txCheckError: unknown) {
            enhancedLogger.warn('⚠️ Could not verify transaction details (non-critical)', {
              vaultAddress,
              proposalId,
              signature,
              error: txCheckError instanceof Error ? txCheckError.message : String(txCheckError),
            });
          }

          const executedAt = new Date();
          enhancedLogger.info('✅ Proposal executed successfully - funds should be released', {
            vaultAddress,
            proposalId,
            executor: executor.publicKey.toString(),
            signature,
            slot: confirmedSlot,
            note: 'The vaultTransactionExecute instruction executed all transfer instructions in the proposal. Check transaction logs to verify funds were transferred to players/fee wallet.',
          });

          // Return success immediately - transaction confirmed
          return {
            success: true,
            signature,
            slot: confirmedSlot,
            executedAt: executedAt.toISOString(),
          };
        } else {
          // Confirmation failed or timed out - check if it's a retryable error
          const confirmErrorMessage = confirmationError instanceof Error ? confirmationError.message : String(confirmationError);
          const isTimeoutError = confirmErrorMessage.includes('expired') || 
                                 confirmErrorMessage.includes('block height exceeded') ||
                                 confirmErrorMessage.includes('timeout') ||
                                 confirmErrorMessage.includes('Confirmation timeout');
          
          enhancedLogger.error('❌ Transaction confirmation failed', {
            vaultAddress,
            proposalId,
            signature,
            error: confirmErrorMessage,
            isTimeoutError,
            note: 'Transaction was sent but confirmation failed. Will retry with fresh blockhash if timeout error.',
          });
          
          lastErrorMessage = `confirmTransaction error: ${confirmErrorMessage}`;
          
          // If timeout error, we'll retry with fresh blockhash below
          // Otherwise, check transaction status directly as fallback
          if (isTimeoutError) {
            // Try to check transaction status directly - it may have succeeded despite timeout
            // Retry checking status multiple times with delays, as transaction may still be processing
            let transactionSucceeded = false;
            let onChainError: any = null;
            let txDetails: any = null;
            
            // Retry checking transaction status up to 5 times with increasing delays
            // This handles cases where the transaction is still being processed on-chain
            const maxStatusCheckRetries = 5;
            const statusCheckDelays = [500, 1000, 2000, 3000, 5000]; // ms
            
            for (let statusRetry = 0; statusRetry < maxStatusCheckRetries && !transactionSucceeded && !onChainError; statusRetry++) {
              if (statusRetry > 0) {
                // Wait before retrying (except first attempt)
                await new Promise(resolve => setTimeout(resolve, statusCheckDelays[statusRetry - 1]));
              }
              
              try {
                enhancedLogger.info('🔍 Checking transaction status after timeout (retry attempt)', {
                  vaultAddress,
                  proposalId,
                  signature,
                  attempt: statusRetry + 1,
                  maxAttempts: maxStatusCheckRetries,
                });
                
                // First try getSignatureStatus with searchTransactionHistory
                const txStatus = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
                if (txStatus?.value) {
                  if (txStatus.value.err) {
                    // Transaction failed on-chain - capture the error
                    onChainError = txStatus.value.err;
                    lastErrorMessage += ` | On-chain error: ${JSON.stringify(txStatus.value.err)}`;
                    enhancedLogger.error('❌ Transaction failed on-chain (found via getSignatureStatus)', {
                      vaultAddress,
                      proposalId,
                      signature,
                      error: JSON.stringify(txStatus.value.err),
                      slot: txStatus.value.slot,
                      attempt: statusRetry + 1,
                    });
                    break; // Stop retrying if we found an error
                  } else {
                    // Transaction succeeded!
                    transactionSucceeded = true;
                    enhancedLogger.info('✅ Transaction confirmed via direct status check (despite confirmTransaction timeout)', {
                      vaultAddress,
                      proposalId,
                      signature,
                      slot: txStatus.value.slot,
                      attempt: statusRetry + 1,
                      note: 'Transaction succeeded on-chain even though confirmTransaction timed out',
                    });
                    break; // Stop retrying if we found success
                  }
                } else {
                  // Transaction not found yet - might still be processing
                  enhancedLogger.info('⏳ Transaction not found in signature status yet (may still be processing)', {
                    vaultAddress,
                    proposalId,
                    signature,
                    attempt: statusRetry + 1,
                    maxAttempts: maxStatusCheckRetries,
                    note: 'Will retry checking status',
                  });
                }
                
                // If getSignatureStatus didn't find it, try getTransaction to verify
                if (!transactionSucceeded && !onChainError) {
                  try {
                    txDetails = await this.connection.getTransaction(signature, {
                      commitment: 'confirmed',
                      maxSupportedTransactionVersion: 0,
                    });
                    
                    if (txDetails) {
                      if (txDetails.meta?.err) {
                        // Transaction failed on-chain
                        onChainError = txDetails.meta.err;
                        lastErrorMessage += ` | Transaction error from getTransaction: ${JSON.stringify(txDetails.meta.err)}`;
                        enhancedLogger.error('❌ Transaction failed on-chain (found via getTransaction)', {
                          vaultAddress,
                          proposalId,
                          signature,
                          error: JSON.stringify(txDetails.meta.err),
                          logs: txDetails.meta.logMessages?.slice(-10),
                          slot: txDetails.slot,
                          attempt: statusRetry + 1,
                        });
                        break; // Stop retrying if we found an error
                      } else {
                        // Transaction succeeded!
                        transactionSucceeded = true;
                        enhancedLogger.info('✅ Transaction confirmed via getTransaction (despite confirmTransaction timeout)', {
                          vaultAddress,
                          proposalId,
                          signature,
                          slot: txDetails.slot,
                          attempt: statusRetry + 1,
                          note: 'Transaction succeeded on-chain even though confirmTransaction timed out',
                        });
                        break; // Stop retrying if we found success
                      }
                    }
                  } catch (txError: unknown) {
                    enhancedLogger.warn('⚠️ Failed to check transaction via getTransaction', {
                      vaultAddress,
                      proposalId,
                      signature,
                      attempt: statusRetry + 1,
                      error: txError instanceof Error ? txError.message : String(txError),
                      note: 'Will retry if more attempts remain',
                    });
                  }
                }
              } catch (statusError: unknown) {
                enhancedLogger.warn('⚠️ Failed to check transaction status (will retry)', {
                  vaultAddress,
                  proposalId,
                  signature,
                  attempt: statusRetry + 1,
                  maxAttempts: maxStatusCheckRetries,
                  error: statusError instanceof Error ? statusError.message : String(statusError),
                });
                // Continue to next retry attempt
              }
            }
            
            if (!transactionSucceeded && !onChainError) {
              enhancedLogger.warn('⚠️ Transaction status still not found after all retry attempts', {
                vaultAddress,
                proposalId,
                signature,
                totalRetries: maxStatusCheckRetries,
                note: 'Transaction may still be processing, or may have failed before being included in a block',
              });
            }
            
            if (transactionSucceeded) {
              // Double-check proposal was actually executed by checking on-chain state
              try {
                const proposalStatusAfter = await this.checkProposalStatus(vaultAddress, proposalId);
                if (proposalStatusAfter.executed) {
                  enhancedLogger.info('✅ Verified proposal execution on-chain after timeout recovery', {
                    vaultAddress,
                    proposalId,
                    signature,
                  });
                } else {
                  enhancedLogger.warn('⚠️ Transaction succeeded but proposal not marked as executed on-chain', {
                    vaultAddress,
                    proposalId,
                    signature,
                    proposalStatus: proposalStatusAfter,
                  });
                }
              } catch (verifyError: unknown) {
                enhancedLogger.warn('⚠️ Could not verify proposal execution state (non-critical)', {
                  vaultAddress,
                  proposalId,
                  signature,
                  error: verifyError instanceof Error ? verifyError.message : String(verifyError),
                });
              }
              
              // Return success - transaction was found on-chain
              const txStatus = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
              return {
                success: true,
                signature,
                slot: txStatus?.value?.slot || undefined,
                executedAt: new Date().toISOString(),
              };
            }
          }
          
          // If we get here, confirmation failed and we couldn't verify success
          // Throw error to trigger retry with fresh blockhash
          throw confirmationError || new Error('Transaction confirmation failed');
        }
      } catch (rawError: unknown) {
        // This catch block handles errors from the entire try block (transaction building, sending, confirmation)
        const { message, logs } = await this.buildExecutionErrorDetails(tx, rawError);
        lastErrorMessage = message;
        lastLogs = logs;

        // Check if we should retry with fresh blockhash
        if (attempt < maxAttempts - 1 && this.shouldRetryWithFreshBlockhash(rawError)) {
          enhancedLogger.warn('🔄 Retrying Squads proposal execution with a fresh blockhash', {
            vaultAddress,
            proposalId,
            reason: lastErrorMessage,
            attempt: attempt + 1,
            maxAttempts,
          });
          continue;
        }

        break;
      }
    }

    // Ensure we have a meaningful error message
    const finalErrorMessage = lastErrorMessage || 'Unknown execution error - no error details captured';
    
    enhancedLogger.error('❌ Failed to execute proposal', {
      vaultAddress,
      proposalId,
      executor: executor.publicKey.toString(),
      error: finalErrorMessage,
      errorString: String(finalErrorMessage),
      logs: lastLogs?.slice(-5),
      hasLogs: !!lastLogs && lastLogs.length > 0,
      note: 'If error is empty, check simulation logs and transaction confirmation status above',
    });

    return {
      success: false,
      error: finalErrorMessage,
      logs: lastLogs,
    };
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
          const { getRandomWord } = require('../wordList');
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
      await this.waitForProposalStatus(
        proposalPda,
        multisigAddress,
        transactionIndex,
        'Draft',
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
export const squadsVaultService = new SquadsVaultService();
export const getSquadsVaultService = () => squadsVaultService;
