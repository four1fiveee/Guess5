import { Connection, PublicKey, Keypair, Transaction, VersionedTransaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { IDL } from '../types/guess5';
import { enhancedLogger } from '../utils/enhancedLogger';
import { AppDataSource } from '../db/index';
import { Match } from '../models/Match';

// Program ID for the Guess5 escrow program
const PROGRAM_ID = new PublicKey("HyejroGJD3TDPHzmCmtUSnsViENuPn6vHDPZZHw35fGC");

// Create connection to Solana network
const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

export interface DepositTransactionResult {
  success: boolean;
  transaction?: Transaction;
  transactionId?: string;
  error?: string;
  instructions?: any[];
}

export interface DepositVerificationResult {
  success: boolean;
  deposited: boolean;
  transactionSignature?: string;
  error?: string;
}

export class SmartContractDepositService {
  private program: Program;
  private provider: AnchorProvider;

  constructor() {
    // Create a dummy wallet for the provider (we'll use the fee wallet)
    const feeWalletKeypair = this.getFeeWalletKeypair();
    
    this.provider = new AnchorProvider(connection, {
      publicKey: feeWalletKeypair.publicKey,
      signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
        // Don't sign here - let the frontend handle signing
        return tx;
      },
      signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
        // Don't sign here - let the frontend handle signing
        return txs;
      }
    }, {
      commitment: 'confirmed'
    });

    this.program = new Program(IDL as any, this.provider);
  }

  /**
   * Create a deposit transaction for a player to deposit into the smart contract vault
   */
  async createDepositTransaction(
    matchId: string,
    playerWallet: string,
    playerKeypair?: Keypair
  ): Promise<DepositTransactionResult> {
    try {
      enhancedLogger.info('💰 Creating deposit transaction', { matchId, playerWallet });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match) {
        return {
          success: false,
          error: 'Match not found'
        };
      }

      if (!match.matchPda || !match.vaultPda) {
        return {
          success: false,
          error: 'Match not properly initialized with smart contract'
        };
      }

      // Validate player is part of this match
      if (playerWallet !== match.player1 && playerWallet !== match.player2) {
        return {
          success: false,
          error: 'Player not part of this match'
        };
      }

      // Check if player has already deposited
      const isPlayer1 = playerWallet === match.player1;
      if (isPlayer1 && match.player1Paid) {
        return {
          success: false,
          error: 'Player 1 has already deposited'
        };
      }
      if (!isPlayer1 && match.player2Paid) {
        return {
          success: false,
          error: 'Player 2 has already deposited'
        };
      }

      // Convert entry fee to lamports
      const stakeLamports = Math.floor(match.entryFee * LAMPORTS_PER_SOL);

      // Create the deposit transaction
      const matchPda = new PublicKey(match.matchPda);
      const vaultPda = new PublicKey(match.vaultPda);
      const playerPubkey = new PublicKey(playerWallet);

      const transaction = await this.program.methods
        .deposit()
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          player: playerPubkey,
          systemProgram: SystemProgram.programId,
        })
        .transaction();

      // Get the latest blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = playerPubkey;

      enhancedLogger.info('✅ Deposit transaction created successfully', {
        matchId,
        playerWallet,
        stakeLamports,
        matchPda: matchPda.toString(),
        vaultPda: vaultPda.toString()
      });

      return {
        success: true,
        transaction,
        instructions: [
          {
            programId: PROGRAM_ID.toString(),
            accounts: [
              { pubkey: matchPda.toString(), isSigner: false, isWritable: true },
              { pubkey: vaultPda.toString(), isSigner: false, isWritable: true },
              { pubkey: playerPubkey.toString(), isSigner: true, isWritable: true },
              { pubkey: SystemProgram.programId.toString(), isSigner: false, isWritable: false }
            ],
            data: 'deposit'
          }
        ]
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Error creating deposit transaction', { error: errorMessage });
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Verify that a deposit transaction was successful
   */
  async verifyDeposit(
    matchId: string,
    playerWallet: string,
    transactionSignature: string
  ): Promise<DepositVerificationResult> {
    try {
      enhancedLogger.info('🔍 Verifying deposit transaction', { 
        matchId, 
        playerWallet, 
        transactionSignature 
      });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match || !match.matchPda) {
        return {
          success: false,
          deposited: false,
          error: 'Match not found or not properly initialized'
        };
      }

      // Verify the transaction on-chain
      const transaction = await connection.getTransaction(transactionSignature, {
        commitment: 'confirmed'
      });

      if (!transaction) {
        return {
          success: false,
          deposited: false,
          error: 'Transaction not found on blockchain'
        };
      }

      // Check if transaction was successful
      if (transaction.meta?.err) {
        return {
          success: false,
          deposited: false,
          error: `Transaction failed: ${JSON.stringify(transaction.meta.err)}`
        };
      }

      // Get the vault account to check if deposit was recorded
      const vaultPda = new PublicKey(match.vaultPda!);
      const vaultAccount = await (this.program.account as any).vault.fetch(vaultPda);

      if (!vaultAccount) {
        return {
          success: false,
          deposited: false,
          error: 'Failed to fetch vault account'
        };
      }

      // Check if the player's deposit was recorded
      const isPlayer1 = playerWallet === match.player1;
      const playerDeposited = isPlayer1 ? vaultAccount.player1Deposited : vaultAccount.player2Deposited;

      if (playerDeposited) {
        // Update database to reflect the deposit
        if (isPlayer1) {
          match.player1Paid = true;
          match.player1EntrySignature = transactionSignature;
        } else {
          match.player2Paid = true;
          match.player2EntrySignature = transactionSignature;
        }

        // Check if both players have deposited
        if (match.player1Paid && match.player2Paid) {
          match.status = 'active';
          match.smartContractStatus = 'Deposited';
          match.gameStartTime = new Date();
        }

        await matchRepository.save(match);

        enhancedLogger.info('✅ Deposit verified and database updated', {
          matchId,
          playerWallet,
          transactionSignature,
          bothPlayersDeposited: match.player1Paid && match.player2Paid
        });

        return {
          success: true,
          deposited: true,
          transactionSignature
        };
      } else {
        return {
          success: true,
          deposited: false,
          error: 'Deposit not recorded in vault account'
        };
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Error verifying deposit', { error: errorMessage });
      return {
        success: false,
        deposited: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get deposit status for a match
   */
  async getDepositStatus(matchId: string): Promise<{
    success: boolean;
    player1Deposited?: boolean;
    player2Deposited?: boolean;
    vaultBalance?: number;
    error?: string;
  }> {
    try {
      enhancedLogger.info('🔍 Getting deposit status', { matchId });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match || !match.matchPda || !match.vaultPda) {
        return {
          success: false,
          error: 'Match not found or not properly initialized'
        };
      }

      // Get vault account from smart contract
      const vaultPda = new PublicKey(match.vaultPda);
      const vaultAccount = await (this.program.account as any).vault.fetch(vaultPda);

      if (!vaultAccount) {
        return {
          success: false,
          error: 'Failed to fetch vault account'
        };
      }

      enhancedLogger.info('✅ Deposit status retrieved', {
        matchId,
        player1Deposited: vaultAccount.player1Deposited,
        player2Deposited: vaultAccount.player2Deposited,
        vaultBalance: vaultAccount.balance
      });

      return {
        success: true,
        player1Deposited: vaultAccount.player1Deposited,
        player2Deposited: vaultAccount.player2Deposited,
        vaultBalance: vaultAccount.balance
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Error getting deposit status', { error: errorMessage });
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Helper function to get fee wallet keypair
   */
  private getFeeWalletKeypair(): Keypair {
    // You'll need to implement this based on your key management strategy
    // For now, generate a dummy keypair
    return Keypair.generate();
  }
}

// Export singleton instance
let smartContractDepositService: SmartContractDepositService | null = null;

export const getSmartContractDepositService = (): SmartContractDepositService => {
  if (!smartContractDepositService) {
    smartContractDepositService = new SmartContractDepositService();
  }
  return smartContractDepositService;
};
