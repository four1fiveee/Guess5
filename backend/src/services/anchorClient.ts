// @ts-ignore: If 'socket.io' types are missing, install with npm i --save-dev @types/socket.io
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, web3, BN, Idl } from '@project-serum/anchor';
import { IDL } from '../types/guess5';
import { FEE_WALLET_ADDRESS } from '../config/wallet';

// Configuration
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "https://api.devnet.solana.com";
const connection = new Connection(SOLANA_NETWORK);

// Program ID for the Guess5 escrow program
const PROGRAM_ID = new PublicKey("8v2ZyLNP5Apk17MbQxryjXuL6HHN65dxuDwRJDGARShz");

export class Guess5AnchorClient {
  private program: Program;
  private provider: AnchorProvider;

  constructor(wallet: any) {
    this.provider = new AnchorProvider(connection, wallet, {
      commitment: 'confirmed',
      preflightCommitment: 'confirmed',
    });
    this.program = new Program(IDL as any, PROGRAM_ID, this.provider);
  }

  /**
   * Initialize a new match escrow
   */
  async initializeMatch(matchId: string, entryFee: number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🔒 Initializing match escrow:', { matchId, entryFee });
      
      const entryFeeLamports = entryFee * 1000000000; // Convert to lamports
      const feeWallet = new PublicKey(FEE_WALLET_ADDRESS);
      
      // Generate PDA for match escrow account
      const [matchEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_escrow'), Buffer.from(matchId)],
        this.program.programId
      );

      const tx = await this.program.methods
        .initializeMatch(matchId, new BN(entryFeeLamports))
        .accounts({
          matchEscrow: matchEscrowPda,
          player1: this.provider.wallet.publicKey,
          feeWallet: feeWallet,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Match escrow initialized:', tx);
      return { success: true };
    } catch (error) {
      console.error('❌ Error initializing match escrow:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Join an existing match (second player)
   */
  async joinMatch(matchId: string, player2EntryFee: number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🎮 Joining match:', { matchId, player2EntryFee });
      
      const player2EntryFeeLamports = player2EntryFee * 1000000000;
      
      // Get match escrow PDA
      const [matchEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_escrow'), Buffer.from(matchId)],
        this.program.programId
      );

      const tx = await this.program.methods
        .joinMatch(new BN(player2EntryFeeLamports))
        .accounts({
          matchEscrow: matchEscrowPda,
          player2: this.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Joined match:', tx);
      return { success: true };
    } catch (error) {
      console.error('❌ Error joining match:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Lock entry fee in escrow
   */
  async lockEntryFee(matchId: string, amount: number): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('💰 Locking entry fee:', { matchId, amount });
      
      const amountLamports = amount * 1000000000;
      
      // Get match escrow PDA
      const [matchEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_escrow'), Buffer.from(matchId)],
        this.program.programId
      );

      const tx = await this.program.methods
        .lockEntryFee(new BN(amountLamports))
        .accounts({
          matchEscrow: matchEscrowPda,
          player: this.provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Entry fee locked:', tx);
      return { success: true };
    } catch (error) {
      console.error('❌ Error locking entry fee:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Submit game result
   */
  async submitResult(
    matchId: string, 
    result: 'Win' | 'Lose' | 'Tie', 
    attempts: number, 
    solved: boolean
  ): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('📊 Submitting game result:', { matchId, result, attempts, solved });
      
      // Get match escrow PDA
      const [matchEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_escrow'), Buffer.from(matchId)],
        this.program.programId
      );

      // Get player accounts for payout
      const matchData = await this.program.account.matchEscrow.fetch(matchEscrowPda);
      const player1 = matchData.player1;
      const player2 = matchData.player2;
      const feeWallet = new PublicKey(FEE_WALLET_ADDRESS);

      const tx = await this.program.methods
        .submitResult(result, attempts, solved)
        .accounts({
          matchEscrow: matchEscrowPda,
          player: this.provider.wallet.publicKey,
          player1: player1,
          player2: player2,
          feeWallet: feeWallet,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Game result submitted:', tx);
      return { success: true };
    } catch (error) {
      console.error('❌ Error submitting game result:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Refund players (for ties or timeouts)
   */
  async refundPlayers(matchId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('🔄 Refunding players:', { matchId });
      
      // Get match escrow PDA
      const [matchEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_escrow'), Buffer.from(matchId)],
        this.program.programId
      );

      // Get player accounts
      const matchData = await this.program.account.matchEscrow.fetch(matchEscrowPda);
      const player1 = matchData.player1;
      const player2 = matchData.player2;

      const tx = await this.program.methods
        .refundPlayers()
        .accounts({
          matchEscrow: matchEscrowPda,
          player1: player1,
          player2: player2,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('✅ Players refunded:', tx);
      return { success: true };
    } catch (error) {
      console.error('❌ Error refunding players:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get match escrow data
   */
  async getMatchEscrow(matchId: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const [matchEscrowPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('match_escrow'), Buffer.from(matchId)],
        this.program.programId
      );

      const matchData = await this.program.account.matchEscrow.fetch(matchEscrowPda);
      return { success: true, data: matchData };
    } catch (error) {
      console.error('❌ Error fetching match escrow:', error);
      return { success: false, error: error.message };
    }
  }
}

export default Guess5AnchorClient; 