// @ts-ignore: If 'socket.io' types are missing, install with npm i --save-dev @types/socket.io
import { Connection, PublicKey, Keypair, Transaction, SystemProgram } from '@solana/web3.js';
// import { Program, AnchorProvider, web3, BN, Idl } from '@project-serum/anchor';
import { IDL } from '../types/guess5';
import { FEE_WALLET_ADDRESS } from '../config/wallet';

// Program ID for the Guess5 escrow program
const PROGRAM_ID = new PublicKey("8v2ZyLNP5Apk17MbQxryjXuL6HHN65dxuDwRJDGARShz");

// Placeholder for anchor client - not currently used
export const anchorClient = {
  // TODO: Implement anchor client when needed
};

/*
export class Guess5AnchorClient {
  private program: Program;
  private connection: Connection;
  private provider: AnchorProvider;

  constructor(connection: Connection, wallet: any) {
    this.connection = connection;
    this.provider = new AnchorProvider(connection, wallet, {});
    this.program = new Program(IDL, PROGRAM_ID, this.provider);
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