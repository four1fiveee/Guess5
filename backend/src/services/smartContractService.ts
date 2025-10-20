import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';
import { Guess5Escrow } from '../../smart-contract/target/types/guess5_escrow';
import IDL from '../../smart-contract/target/idl/guess5_escrow.json';

export interface SmartContractConfig {
  programId: string;
  resultsAttestorPubkey: string;
  feeWalletPubkey: string;
  defaultFeeBps: number;
  defaultDeadlineBufferSlots: number;
}

export interface MatchCreationParams {
  player1: string;
  player2: string;
  stakeAmount: number; // in SOL
  feeBps?: number;
  deadlineBufferSlots?: number;
}

export interface DepositParams {
  matchId: string;
  player: string;
  stakeAmount: number; // in SOL
}

export interface SettlementParams {
  matchId: string;
  result: 'Player1' | 'Player2' | 'WinnerTie' | 'LosingTie' | 'Error';
}

export class SmartContractService {
  private connection: Connection;
  private program: Program<Guess5Escrow>;
  private config: SmartContractConfig;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      'confirmed'
    );

    this.config = {
      programId: process.env.SMART_CONTRACT_PROGRAM_ID || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4',
      resultsAttestorPubkey: process.env.RESULTS_ATTESTOR_PUBKEY || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
      feeWalletPubkey: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
      defaultFeeBps: parseInt(process.env.DEFAULT_FEE_BPS || '500'),
      defaultDeadlineBufferSlots: parseInt(process.env.DEFAULT_DEADLINE_BUFFER_SLOTS || '1000'),
    };

    // Initialize Anchor program
    const provider = new AnchorProvider(
      this.connection,
      new Wallet(Keypair.generate()), // Dummy wallet for read operations
      { commitment: 'confirmed' }
    );

    this.program = new Program(
      IDL as any,
      new PublicKey(this.config.programId),
      provider
    );
  }

  /**
   * Create a new match with smart contract escrow
   */
  async createMatch(params: MatchCreationParams): Promise<{
    matchPda: string;
    vaultPda: string;
    transaction: string;
  }> {
    try {
      const stakeAmountLamports = Math.floor(params.stakeAmount * LAMPORTS_PER_SOL);
      const feeBps = params.feeBps || this.config.defaultFeeBps;
      const deadlineBufferSlots = params.deadlineBufferSlots || this.config.defaultDeadlineBufferSlots;
      
      // Get current slot and add buffer
      const currentSlot = await this.connection.getSlot();
      const deadlineSlot = currentSlot + deadlineBufferSlots;

      // Derive PDAs
      const [matchPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('match'),
          new PublicKey(params.player1).toBuffer(),
          new PublicKey(params.player2).toBuffer(),
          Buffer.from(stakeAmountLamports.toString().padStart(8, '0'), 'hex')
        ],
        new PublicKey(this.config.programId)
      );

      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchPda.toBuffer()],
        new PublicKey(this.config.programId)
      );

      // Create transaction
      const transaction = new Transaction();

      const createMatchIx = await this.program.methods
        .createMatch(
          new anchor.BN(stakeAmountLamports),
          feeBps,
          new anchor.BN(deadlineSlot)
        )
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          player1: new PublicKey(params.player1),
          player2: new PublicKey(params.player2),
          feeWallet: new PublicKey(this.config.feeWalletPubkey),
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      transaction.add(createMatchIx);

      return {
        matchPda: matchPda.toString(),
        vaultPda: vaultPda.toString(),
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      };
    } catch (error) {
      console.error('Error creating match:', error);
      throw new Error(`Failed to create match: ${error.message}`);
    }
  }

  /**
   * Player deposits stake into match vault
   */
  async deposit(params: DepositParams): Promise<{
    transaction: string;
  }> {
    try {
      const stakeAmountLamports = Math.floor(params.stakeAmount * LAMPORTS_PER_SOL);
      
      // Derive PDAs (same logic as createMatch)
      const matchPda = new PublicKey(params.matchId);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchPda.toBuffer()],
        new PublicKey(this.config.programId)
      );

      // Create transaction
      const transaction = new Transaction();

      const depositIx = await this.program.methods
        .deposit(new anchor.BN(stakeAmountLamports))
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          player: new PublicKey(params.player),
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      transaction.add(depositIx);

      return {
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      };
    } catch (error) {
      console.error('Error creating deposit transaction:', error);
      throw new Error(`Failed to create deposit transaction: ${error.message}`);
    }
  }

  /**
   * Settle match with result (only results attestor can call)
   */
  async settleMatch(params: SettlementParams): Promise<{
    transaction: string;
  }> {
    try {
      const matchPda = new PublicKey(params.matchId);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchPda.toBuffer()],
        new PublicKey(this.config.programId)
      );

      // Get match data to find players
      const matchData = await this.program.account.matchAccount.fetch(matchPda);

      // Create transaction
      const transaction = new Transaction();

      const settleIx = await this.program.methods
        .settleMatch({ [params.result.toLowerCase()]: {} })
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          player1: matchData.player1,
          player2: matchData.player2,
          feeWallet: new PublicKey(this.config.feeWalletPubkey),
          resultsAttestor: new PublicKey(this.config.resultsAttestorPubkey),
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      transaction.add(settleIx);

      return {
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      };
    } catch (error) {
      console.error('Error creating settlement transaction:', error);
      throw new Error(`Failed to create settlement transaction: ${error.message}`);
    }
  }

  /**
   * Refund timeout (anyone can call after deadline)
   */
  async refundTimeout(matchId: string): Promise<{
    transaction: string;
  }> {
    try {
      const matchPda = new PublicKey(matchId);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchPda.toBuffer()],
        new PublicKey(this.config.programId)
      );

      // Get match data to find players
      const matchData = await this.program.account.matchAccount.fetch(matchPda);

      // Create transaction
      const transaction = new Transaction();

      const refundIx = await this.program.methods
        .refundTimeout()
        .accounts({
          matchAccount: matchPda,
          vault: vaultPda,
          player1: matchData.player1,
          player2: matchData.player2,
          systemProgram: SystemProgram.programId,
        })
        .instruction();

      transaction.add(refundIx);

      return {
        transaction: transaction.serialize({ requireAllSignatures: false }).toString('base64'),
      };
    } catch (error) {
      console.error('Error creating refund transaction:', error);
      throw new Error(`Failed to create refund transaction: ${error.message}`);
    }
  }

  /**
   * Get match account data
   */
  async getMatchData(matchId: string): Promise<any> {
    try {
      const matchPda = new PublicKey(matchId);
      const matchData = await this.program.account.matchAccount.fetch(matchPda);
      
      return {
        player1: matchData.player1.toString(),
        player2: matchData.player2.toString(),
        stakeAmount: matchData.stakeAmount.toString(),
        feeBps: matchData.feeBps,
        deadlineSlot: matchData.deadlineSlot.toString(),
        status: matchData.status,
        result: matchData.result,
        player1Deposited: matchData.player1Deposited.toString(),
        player2Deposited: matchData.player2Deposited.toString(),
      };
    } catch (error) {
      console.error('Error fetching match data:', error);
      throw new Error(`Failed to fetch match data: ${error.message}`);
    }
  }

  /**
   * Get vault account data
   */
  async getVaultData(matchId: string): Promise<any> {
    try {
      const matchPda = new PublicKey(matchId);
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchPda.toBuffer()],
        new PublicKey(this.config.programId)
      );

      const vaultData = await this.program.account.vaultAccount.fetch(vaultPda);
      
      return {
        matchAccount: vaultData.matchAccount.toString(),
        totalDeposited: vaultData.totalDeposited.toString(),
      };
    } catch (error) {
      console.error('Error fetching vault data:', error);
      throw new Error(`Failed to fetch vault data: ${error.message}`);
    }
  }

  /**
   * Check if match is ready for settlement
   */
  async isMatchReadyForSettlement(matchId: string): Promise<boolean> {
    try {
      const matchData = await this.getMatchData(matchId);
      return matchData.status === 'Active' && 
             matchData.player1Deposited > 0 && 
             matchData.player2Deposited > 0;
    } catch (error) {
      console.error('Error checking match settlement readiness:', error);
      return false;
    }
  }

  /**
   * Check if match has timed out
   */
  async isMatchTimedOut(matchId: string): Promise<boolean> {
    try {
      const matchData = await this.getMatchData(matchId);
      const currentSlot = await this.connection.getSlot();
      return currentSlot > parseInt(matchData.deadlineSlot);
    } catch (error) {
      console.error('Error checking match timeout:', error);
      return false;
    }
  }
}

// Export singleton instance
export const smartContractService = new SmartContractService();