import { Connection, PublicKey, LAMPORTS_PER_SOL, Keypair, TransactionMessage, TransactionInstruction, SystemProgram } from '@solana/web3.js';
import { rpc, PROGRAM_ID, getMultisigPda, getVaultPda, getProgramConfigPda, accounts, types } from '@sqds/multisig';
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
        if (checkErr?.message?.includes('Account does not exist') || 
            checkErr?.message?.includes('Invalid account data') ||
            checkErr?.code === 'InvalidAccountData') {
          enhancedLogger.info('✅ Multisig does not exist, proceeding with creation', {
            matchId,
            multisigAddress: multisigPda.toString(),
          });
        } else {
          // Re-throw if it's a different error (like configuration mismatch)
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
      });

      return {
        success: true,
        vaultAddress: multisigPda.toString(),
        multisigAddress: multisigPda.toString(),
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
    feeAmount: number
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
      let vaultPda: PublicKey;
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

      enhancedLogger.info('📍 Derived vault PDA', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
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
        const currentTransactionIndex = Number(multisigInfo.transactionIndex);
        transactionIndex = BigInt(currentTransactionIndex + 1);
        
        enhancedLogger.info('📊 Fetched multisig transaction index', {
          multisigAddress: multisigAddress.toString(),
          currentTransactionIndex,
          nextTransactionIndex: transactionIndex.toString(),
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
        transactionIndex = BigInt(1);
        
        enhancedLogger.warn('⚠️ Using fallback transaction index 1', {
          multisigAddress: multisigAddress.toString(),
          note: 'This assumes no previous transactions. If vault has existing transactions, proposal creation will fail.',
        });
      }
      
      // Create transfer instructions using SystemProgram
      const winnerLamports = Math.floor(winnerAmount * LAMPORTS_PER_SOL);
      const feeLamports = Math.floor(feeAmount * LAMPORTS_PER_SOL);
      
      // Ensure all PublicKeys are properly instantiated
      const vaultPdaKey = typeof vaultPda === 'string' ? new PublicKey(vaultPda) : vaultPda;
      const winnerKey = typeof winner === 'string' ? new PublicKey(winner) : winner;
      const feeWalletKey = typeof feeWallet === 'string' ? new PublicKey(feeWallet) : feeWallet;
      
      // Create System Program transfer instruction for winner using SystemProgram.transfer directly
      // Then correct the isSigner flag for vaultPda (PDAs cannot sign)
      const winnerTransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: winnerKey,
        lamports: winnerLamports,
      });
      // Correct the keys: vaultPda is a PDA and cannot be a signer
      winnerTransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: false, isWritable: true };
      
      // Create System Program transfer instruction for fee
      const feeTransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: feeWalletKey,
        lamports: feeLamports,
      });
      // Correct the keys: vaultPda is a PDA and cannot be a signer
      feeTransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: false, isWritable: true };
      
      // Log instruction keys for debugging
      enhancedLogger.info('🔍 Instruction keys check', {
        winnerIxKeys: winnerTransferIx.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        feeIxKeys: feeTransferIx.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        winnerIxProgramId: winnerTransferIx.programId.toString(),
        feeIxProgramId: feeTransferIx.programId.toString(),
      });
      
      // Create transaction message (uncompiled - Squads SDK compiles it internally)
      // Note: payerKey must be a signer account (systemPublicKey) that pays for transaction creation
      // The vault PDA holds funds but cannot pay fees (it's not a signer)
      const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
      const transactionMessage = new TransactionMessage({
        payerKey: this.config.systemPublicKey, // System pays for transaction creation fees
        recentBlockhash: blockhash,
        instructions: [winnerTransferIx, feeTransferIx],
      });
      
      // Create the Squads vault transaction
      // Pass uncompiled TransactionMessage - Squads SDK will compile it internally
      enhancedLogger.info('📝 Creating vault transaction...', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
        transactionIndex: transactionIndex.toString(),
        winner: winner.toString(),
        winnerAmount,
      });
      
      let signature: string;
      try {
        signature = await rpc.vaultTransactionCreate({
          connection: this.connection,
          feePayer: this.config.systemKeypair, // Keypair that signs and pays for transaction creation
          multisigPda: multisigAddress,
          transactionIndex,
          creator: this.config.systemKeypair.publicKey, // Creator public key
          vaultIndex: 0, // First vault
          ephemeralSigners: 0, // No ephemeral signers needed
          transactionMessage: transactionMessage, // Pass uncompiled TransactionMessage
          memo: `Winner payout: ${winner.toString()}`,
          programId: this.programId, // Use network-specific program ID
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
    refundAmount: number
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
      let vaultPda: PublicKey;
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

      enhancedLogger.info('📍 Derived vault PDA for tie refund', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
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
        const currentTransactionIndex = Number(multisigInfo.transactionIndex);
        transactionIndex = BigInt(currentTransactionIndex + 1);
        
        enhancedLogger.info('📊 Fetched multisig transaction index for tie refund', {
          multisigAddress: multisigAddress.toString(),
          currentTransactionIndex,
          nextTransactionIndex: transactionIndex.toString(),
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
        transactionIndex = BigInt(1);
        
        enhancedLogger.warn('⚠️ Using fallback transaction index 1', {
          multisigAddress: multisigAddress.toString(),
          note: 'This assumes no previous transactions. If vault has existing transactions, proposal creation will fail.',
        });
      }
      
      // Create transfer instructions using SystemProgram
      const refundLamports = Math.floor(refundAmount * LAMPORTS_PER_SOL);
      
      // Ensure all PublicKeys are properly instantiated
      const vaultPdaKey = typeof vaultPda === 'string' ? new PublicKey(vaultPda) : vaultPda;
      const player1Key = typeof player1 === 'string' ? new PublicKey(player1) : player1;
      const player2Key = typeof player2 === 'string' ? new PublicKey(player2) : player2;
      
      // Create System Program transfer instruction for player 1 using SystemProgram.transfer directly
      // Then correct the isSigner flag for vaultPda (PDAs cannot sign)
      const player1TransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: player1Key,
        lamports: refundLamports,
      });
      // Correct the keys: vaultPda is a PDA and cannot be a signer
      player1TransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: false, isWritable: true };
      
      // Create System Program transfer instruction for player 2
      const player2TransferIx = SystemProgram.transfer({
        fromPubkey: vaultPdaKey,
        toPubkey: player2Key,
        lamports: refundLamports,
      });
      // Correct the keys: vaultPda is a PDA and cannot be a signer
      player2TransferIx.keys[0] = { pubkey: vaultPdaKey, isSigner: false, isWritable: true };
      
      // Log instruction keys for debugging
      enhancedLogger.info('🔍 Instruction keys check for tie refund', {
        player1IxKeys: player1TransferIx.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        player2IxKeys: player2TransferIx.keys.map(k => ({
          pubkey: k.pubkey.toString(),
          isSigner: k.isSigner,
          isWritable: k.isWritable,
        })),
        player1IxProgramId: player1TransferIx.programId.toString(),
        player2IxProgramId: player2TransferIx.programId.toString(),
      });
      
      // Create transaction message (uncompiled - Squads SDK compiles it internally)
      // Note: payerKey must be a signer account (systemPublicKey) that pays for transaction creation
      // The vault PDA holds funds but cannot pay fees (it's not a signer)
      const { blockhash: blockhash2, lastValidBlockHeight } = await this.connection.getLatestBlockhash('finalized');
      const transactionMessage = new TransactionMessage({
        payerKey: this.config.systemPublicKey, // System pays for transaction creation fees
        recentBlockhash: blockhash2,
        instructions: [player1TransferIx, player2TransferIx],
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
      enhancedLogger.info('📝 Creating vault transaction for tie refund', {
        multisigAddress: multisigAddress.toString(),
        vaultPda: vaultPda.toString(),
        programId: this.programId.toString(),
        blockhash: blockhash2,
        lastValidBlockHeight,
        player1: player1.toString(),
        player2: player2.toString(),
        refundLamports,
      });
      
      let signature: string;
      try {
        signature = await rpc.vaultTransactionCreate({
          connection: this.connection,
          feePayer: this.config.systemKeypair, // Keypair that signs and pays for transaction creation
          multisigPda: multisigAddress,
          transactionIndex,
          creator: this.config.systemKeypair.publicKey, // Creator public key
          vaultIndex: 0, // First vault
          ephemeralSigners: 0, // No ephemeral signers needed
          transactionMessage: transactionMessage, // Pass uncompiled TransactionMessage
          memo: `Tie refund: ${player1.toString()}, ${player2.toString()}`,
          programId: this.programId, // Use network-specific program ID
        });
      } catch (createError: any) {
        // Log detailed error information to diagnose AccountOwnedByWrongProgram
        const errorDetails: any = {
          error: createError?.message || String(createError),
          stack: createError?.stack,
          vaultAddress,
          multisigAddress: multisigAddress.toString(),
          vaultPda: vaultPda.toString(),
          programId: this.programId.toString(),
          player1: player1.toString(),
          player2: player2.toString(),
          transactionIndex: transactionIndex.toString(),
        };
        
        // Check if vault PDA exists and what it's owned by
        try {
          const vaultAccountInfo = await this.connection.getAccountInfo(vaultPda, 'confirmed');
          if (vaultAccountInfo) {
            errorDetails.vaultPdaExists = true;
            errorDetails.vaultPdaOwner = vaultAccountInfo.owner.toString();
            errorDetails.vaultPdaDataLength = vaultAccountInfo.data.length;
            errorDetails.vaultPdaLamports = vaultAccountInfo.lamports;
          } else {
            errorDetails.vaultPdaExists = false;
            errorDetails.vaultPdaOwner = 'N/A (account does not exist)';
          }
        } catch (accountCheckError: any) {
          errorDetails.vaultPdaCheckError = accountCheckError?.message || String(accountCheckError);
        }
        
        enhancedLogger.error('❌ vaultTransactionCreate failed for tie refund', errorDetails);
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
        
        // Save match directly (helper file doesn't exist)
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
