import { Connection, PublicKey, Transaction, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { IDL } from '../types/guess5';
import { FEE_WALLET_ADDRESS, getFeeWalletKeypair } from '../config/wallet';
import { ManualSolanaClient } from './manualSolanaClient';

// Program ID for the Guess5 escrow program - must match the deployed contract
const PROGRAM_ID = new PublicKey(process.env.SMART_CONTRACT_PROGRAM_ID || "ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4");
const RESULTS_ATTESTOR_ADDRESS = new PublicKey(process.env.RESULTS_ATTESTOR_PUBKEY || "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt");

// Create connection to Solana network
const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

// Helper function to generate match PDA
export const getMatchPda = (player1: PublicKey, player2: PublicKey, stakeLamports: number): PublicKey => {
  const stakeLamportsBuffer = Buffer.alloc(8);
  stakeLamportsBuffer.writeBigUInt64LE(BigInt(stakeLamports));
  
  const [matchPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('match'),
      player1.toBuffer(),
      player2.toBuffer(),
      stakeLamportsBuffer
    ],
    PROGRAM_ID
  );
  return matchPda;
};

// Helper function to generate vault PDA
export const getVaultPda = (matchPda: PublicKey): PublicKey => {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), matchPda.toBuffer()],
    PROGRAM_ID
  );
  return vaultPda;
};

// Smart contract service class
export class SmartContractService {
  private program: Program | null = null;
  private provider!: AnchorProvider;
  private manualClient: ManualSolanaClient;

  constructor() {
    // Initialize manual client as fallback
    this.manualClient = new ManualSolanaClient(connection);
    
    // Initialize provider in constructor, program will be initialized in initializeProgram()
    try {
      // Create a dummy wallet for the provider (we'll use the fee wallet)
      const feeWalletKeypair = getFeeWalletKeypair();
      
      console.log('🔧 Initializing SmartContractService:', {
        programId: PROGRAM_ID.toString(),
        network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
        feeWallet: feeWalletKeypair.publicKey.toString()
      });
    
      this.provider = new AnchorProvider(connection, {
        publicKey: feeWalletKeypair.publicKey,
        signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
          if (tx instanceof Transaction) {
            // Legacy Transaction
            tx.sign(feeWalletKeypair);
          } else {
            // VersionedTransaction - sign with keypair
            tx.sign([feeWalletKeypair]);
          }
          return tx;
        },
        signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
          txs.forEach(tx => {
            if (tx instanceof Transaction) {
              // Legacy Transaction
              tx.sign(feeWalletKeypair);
            } else {
              // VersionedTransaction
              tx.sign([feeWalletKeypair]);
            }
          });
          return txs;
        }
      }, {
        commitment: 'confirmed'
      });

      console.log('✅ SmartContractService provider initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize SmartContractService provider:', error);
      this.program = null;
      console.warn('⚠️ SmartContractService initialized with null program - smart contract features will be disabled');
    }
  }

  async initializeProgram(): Promise<void> {
    if (!this.provider) {
      throw new Error('Provider not initialized');
    }

    try {
      // Use embedded IDL directly since on-chain IDL is missing types section
      console.log('🔍 Using embedded IDL directly (on-chain IDL missing types)...');
      this.program = new Program(IDL as any, this.provider);
      console.log('✅ Program initialized with embedded IDL successfully');
    } catch (embeddedIdlError) {
      console.error('❌ Embedded IDL parsing failed:', embeddedIdlError);
      console.log('🔄 Falling back to raw Solana client...');
      
            // Test manual client connection
            const manualClientWorks = await this.manualClient.testConnection();
            if (manualClientWorks) {
              console.log('✅ Manual Solana client fallback initialized successfully');
              // Keep program as null, we'll use manual client methods
            } else {
              throw new Error(`Both IDL parsing and manual client failed: ${embeddedIdlError instanceof Error ? embeddedIdlError.message : String(embeddedIdlError)}`);
            }
    }
    
    console.log('✅ SmartContractService initialized successfully:', {
      program: !!this.program,
      provider: !!this.provider,
      programAccount: !!this.program?.account,
      rawClientFallback: !this.program
    });
  }

  isProgramInitialized(): boolean {
    return this.program !== null || this.manualClient !== null;
  }


  // Create a match on the smart contract
  async createMatch(
    player1: PublicKey,
    player2: PublicKey,
    stakeLamports: number,
    feeBps: number = 500, // 5% default fee
    deadlineSlot?: number
  ): Promise<{ success: boolean; matchPda?: PublicKey; vaultPda?: PublicKey; error?: string }> {
    if (!this.program) {
      return { success: false, error: 'Smart contract program not initialized' };
    }
    
    try {
      // Calculate deadline if not provided (24 hours from now)
      if (!deadlineSlot) {
        const currentSlot = await connection.getSlot();
        const slotsPerSecond = 2; // Approximate slots per second
        const slotsPerDay = slotsPerSecond * 60 * 60 * 24; // 24 hours
        deadlineSlot = currentSlot + slotsPerDay;
      }

      // Generate PDAs
      const matchPda = getMatchPda(player1, player2, stakeLamports);
      const vaultPda = getVaultPda(matchPda);

      console.log('🔧 Creating smart contract match:', {
        matchPda: matchPda.toString(),
        vaultPda: vaultPda.toString(),
        player1: player1.toString(),
        player2: player2.toString(),
        stakeLamports,
        feeBps,
        deadlineSlot
      });

      // Create the match
      const tx = await this.program.methods
        .createMatch(
          new BN(stakeLamports),
          feeBps,
          new BN(deadlineSlot)
        )
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          player1: player1,
          player2: player2,
          resultsAttestor: RESULTS_ATTESTOR_ADDRESS,
          feeWallet: new PublicKey(FEE_WALLET_ADDRESS),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Smart contract match created:', tx);

      return {
        success: true,
        matchPda,
        vaultPda
      };
    } catch (error) {
      console.error('❌ Error creating smart contract match:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Settle a match
  async settleMatch(
    matchPda: PublicKey,
    result: 'Player1' | 'Player2' | 'WinnerTie' | 'LosingTie' | 'Timeout' | 'Error'
  ): Promise<{ success: boolean; signature?: string; error?: string }> {
    if (!this.program) {
      return { success: false, error: 'Smart contract program not initialized' };
    }
    
    try {
      const vaultPda = getVaultPda(matchPda);

      console.log('🔧 Settling smart contract match:', {
        matchPda: matchPda.toString(),
        vaultPda: vaultPda.toString(),
        result,
        programExists: !!this.program,
        programAccountExists: !!this.program?.account
      });

      // Get match data to get player addresses
      console.log('🔍 Fetching match account data...');
      const matchAccount = await (this.program.account as any).Match.fetch(matchPda);
      console.log('✅ Match account fetched successfully:', {
        player1: matchAccount.player1.toString(),
        player2: matchAccount.player2.toString()
      });
      const player1 = matchAccount.player1;
      const player2 = matchAccount.player2;

      // Create the settlement transaction
      const tx = await this.program.methods
        .settleMatch({ [result]: {} })
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          resultsAttestor: RESULTS_ATTESTOR_ADDRESS,
          player1: player1,
          player2: player2,
          feeWallet: new PublicKey(FEE_WALLET_ADDRESS),
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Smart contract match settled:', tx);

      return {
        success: true,
        signature: tx
      };
    } catch (error) {
      console.error('❌ Error settling smart contract match:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  // Get match data from smart contract
  async getMatchData(matchPda: PublicKey): Promise<any> {
    if (this.program) {
      try {
        const matchAccount = await (this.program.account as any).Match.fetch(matchPda);
        return matchAccount;
      } catch (error) {
        console.error('❌ Error fetching match data with Anchor:', error);
        // Fall through to raw client
      }
    }
    
    // Use manual client as fallback
    if (this.manualClient) {
      try {
        console.log('🔄 Using manual client to fetch match data...');
        const matchData = await this.manualClient.getMatchData(matchPda);
        return matchData;
      } catch (error) {
        console.error('❌ Error fetching match data with manual client:', error);
        return null;
      }
    }
    
    console.error('❌ No smart contract client available');
    return null;
  }

  // Get vault data from smart contract
  async getVaultData(matchPda: PublicKey): Promise<any> {
    if (this.program) {
      try {
        const vaultPda = getVaultPda(matchPda);
        const vaultAccount = await (this.program.account as any).Vault.fetch(vaultPda);
        return vaultAccount;
      } catch (error) {
        console.error('❌ Error fetching vault data with Anchor:', error);
        // Fall through to raw client
      }
    }
    
    // Use manual client as fallback
    if (this.manualClient) {
      try {
        console.log('🔄 Using manual client to fetch vault data...');
        const vaultPda = getVaultPda(matchPda);
        const vaultData = await this.manualClient.getVaultData(vaultPda);
        return vaultData;
      } catch (error) {
        console.error('❌ Error fetching vault data with manual client:', error);
        return null;
      }
    }
    
    console.error('❌ No smart contract client available');
    return null;
  }
}

// Export singleton instance with lazy initialization
let smartContractServiceInstance: SmartContractService | null = null;

export const getSmartContractService = async (): Promise<SmartContractService> => {
  if (!smartContractServiceInstance) {
    try {
      smartContractServiceInstance = new SmartContractService();
    } catch (error) {
      console.error('❌ Failed to initialize SmartContractService:', error);
      throw new Error(`Failed to initialize SmartContractService: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  // Initialize the program if not already done
  if (!smartContractServiceInstance.isProgramInitialized()) {
    try {
      await smartContractServiceInstance.initializeProgram();
    } catch (error) {
      console.error('❌ Failed to initialize program:', error);
      throw new Error(`Failed to initialize program with IDL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  return smartContractServiceInstance;
};

// Remove the immediate instantiation that causes IDL errors on import
// export const smartContractService = new SmartContractService();

/*
export class Guess5AnchorClient {
  private program: Program;
  private connection: Connection;
  private provider: AnchorProvider;

  constructor(connection: Connection, wallet: any) {
    this.connection = connection;
    this.provider = new AnchorProvider(connection, wallet, {});
    this.program = new Program(IDL, this.provider);
  }

  async createMatchEscrow(
    matchId: string,
    player1: PublicKey,
    player2: PublicKey,
    entryFee: number
  ) {
    try {
      const matchEscrow = Keypair.generate();
      const entryFeeBN = new BN(entryFee * 1e9); // Convert to lamports

      const tx = await this.program.methods
        .initializeMatch(matchId, entryFeeBN)
        .accounts({
          matchEscrow: matchEscrow.publicKey,
          player1: player1,
          player2: player2,
          feeWallet: new PublicKey(FEE_WALLET_ADDRESS),
          systemProgram: SystemProgram.programId,
        })
        .signers([matchEscrow])
        .rpc();

      return {
        success: true,
        transaction: tx,
        escrowAddress: matchEscrow.publicKey.toString()
      };
    } catch (error) {
      console.error('❌ Error creating match escrow:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async lockEntryFee(
    escrowAddress: PublicKey,
    player: PublicKey,
    entryFee: number
  ) {
    try {
      const entryFeeBN = new BN(entryFee * 1e9);

      const tx = await this.program.methods
        .lockEntryFee(entryFeeBN)
        .accounts({
          matchEscrow: escrowAddress,
          player: player,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return {
        success: true,
        transaction: tx
      };
    } catch (error) {
      console.error('❌ Error locking entry fee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  async submitResult(
    escrowAddress: PublicKey,
    player: PublicKey,
    won: boolean,
    numGuesses: number,
    totalTime: number
  ) {
    try {
      const result = {
        won: won,
        numGuesses: new BN(numGuesses),
        totalTime: new BN(totalTime)
      };

      const tx = await this.program.methods
        .submitResult(result)
        .accounts({
          matchEscrow: escrowAddress,
          player: player,
        })
        .rpc();

      return {
        success: true,
        transaction: tx
      };
    } catch (error) {
      console.error('❌ Error submitting result:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}
*/ 