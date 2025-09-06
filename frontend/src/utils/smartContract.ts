import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@project-serum/anchor';
import { IDL } from '../types/guess5';

// Smart contract configuration
export const SOLANA_PROGRAM_ID = new PublicKey('HyejroGJD3TDPHzmCmtUSnsViENuPn6vHDPZZHw35fGC');
export const RESULTS_ATTESTOR_ADDRESS = new PublicKey('2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt');

// Smart contract instruction types
export enum InstructionType {
  CREATE_MATCH = 'createMatch',
  JOIN_MATCH = 'joinMatch',
  SUBMIT_RESULT = 'submitResult',
  CLAIM_PRIZE = 'claimPrize'
}

// Helper function to generate match PDA using the same seeds as the smart contract
export const getMatchPda = (player1: PublicKey, player2: PublicKey, stakeLamports: number, programId: PublicKey): PublicKey => {
  const stakeLamportsBuffer = Buffer.alloc(8);
  stakeLamportsBuffer.writeBigUInt64LE(BigInt(stakeLamports), 0);
  
  const [matchPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from('match'),
      player1.toBuffer(),
      player2.toBuffer(),
      stakeLamportsBuffer
    ],
    programId
  );
  return matchPda;
};

// Helper function to generate vault PDA from match PDA
export const getVaultPda = (matchPda: PublicKey, programId: PublicKey): PublicKey => {
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), matchPda.toBuffer()],
    programId
  );
  return vaultPda;
};

// Smart contract match data structure
export interface SmartContractMatch {
  matchPda: PublicKey;
  vaultPda: PublicKey;
  resultsAttestor: PublicKey;
  deadlineSlot: number;
  feeBps: number;
  status: string;
}

// Create a match on the smart contract
export const createMatchInstruction = async (
  program: Program,
  payer: PublicKey,
  entryFee: number,
  player2: PublicKey
): Promise<{ instruction: TransactionInstruction; matchPda: PublicKey; vaultPda: PublicKey }> => {
  const stakeLamports = Math.floor(entryFee * LAMPORTS_PER_SOL);
  
  // Generate PDAs for this match using helper functions
  const matchPda = getMatchPda(payer, player2, stakeLamports, program.programId);
  const vaultPda = getVaultPda(matchPda, program.programId);

  // Create the instruction using the correct smart contract method name
  const instruction = await program.methods
    .createMatch(
      new BN(entryFee * LAMPORTS_PER_SOL),
      500, // feeBps (5%)
      0    // deadlineSlot (0 for now)
    )
    .accounts({
      matchAccount: matchPda,
      player1: payer,
      player2: payer, // For now, use same player for both
      resultsAttestor: RESULTS_ATTESTOR_ADDRESS,
      feeWallet: RESULTS_ATTESTOR_ADDRESS,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction, matchPda, vaultPda };
};

// Join a match on the smart contract (deposit entry fee)
export const joinMatchInstruction = async (
  program: Program,
  payer: PublicKey,
  matchPda: PublicKey,
  vaultPda: PublicKey,
  entryFee: number
): Promise<TransactionInstruction> => {
  return await program.methods
    .deposit()
    .accounts({
      matchAccount: matchPda,
      vault: vaultPda,
      player: payer,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};

// Submit result to smart contract
export const submitResultInstruction = async (
  program: Program,
  payer: PublicKey,
  matchPda: PublicKey,
  vaultPda: PublicKey,
  player1: PublicKey,
  player2: PublicKey,
  result: any,
  attempts: number,
  solved: boolean
): Promise<TransactionInstruction> => {
  return await program.methods
    .settleMatch(result)
    .accounts({
      matchAccount: matchPda,
      vault: vaultPda,
      resultsAttestor: RESULTS_ATTESTOR_ADDRESS,
      player1: player1,
      player2: player2,
      feeWallet: RESULTS_ATTESTOR_ADDRESS,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};

// Refund players from smart contract
export const refundPlayersInstruction = async (
  program: Program,
  matchPda: PublicKey,
  vaultPda: PublicKey,
  player1: PublicKey,
  player2: PublicKey
): Promise<TransactionInstruction> => {
  return await program.methods
    .refundTimeout()
    .accounts({
      matchAccount: matchPda,
      vault: vaultPda,
      player1: player1,
      player2: player2,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
};

// Get match data from smart contract
export const getMatchData = async (
  program: Program,
  matchPda: PublicKey
): Promise<SmartContractMatch | null> => {
  try {
    const matchAccount = await program.account.match.fetch(matchPda);
    return {
      matchPda,
      vaultPda: matchAccount.vault,
      resultsAttestor: matchAccount.resultsAttestor,
      deadlineSlot: matchAccount.deadlineSlot.toNumber(),
      feeBps: matchAccount.feeBps,
      status: matchAccount.status
    };
  } catch (error) {
    console.error('Error fetching match data:', error);
    return null;
  }
};

// Initialize Anchor program
export const initializeProgram = async (
  connection: Connection,
  wallet: any
): Promise<Program> => {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  return new Program(IDL as any, SOLANA_PROGRAM_ID, provider);
};

// Calculate deadline slot (current slot + 24 hours)
export const calculateDeadlineSlot = async (connection: Connection): Promise<number> => {
  const currentSlot = await connection.getSlot();
  const slotsPerSecond = 2; // Approximate slots per second
  const slotsPerDay = slotsPerSecond * 60 * 60 * 24; // 24 hours
  return currentSlot + slotsPerDay;
};

// Verify smart contract transaction
export const verifySmartContractTransaction = async (
  connection: Connection,
  signature: string,
  expectedProgramId: PublicKey
): Promise<{
  verified: boolean;
  error?: string;
  details?: any;
}> => {
  try {
    const transaction = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0
    });

    if (!transaction) {
      return { verified: false, error: 'Transaction not found' };
    }

    // Check if transaction contains our program
    const programIds = transaction.transaction.message.staticAccountKeys
      .filter(key => key.equals(expectedProgramId));

    if (programIds.length === 0) {
      return { verified: false, error: 'Smart contract not involved in transaction' };
    }

    // Check transaction success
    if (transaction.meta?.err) {
      return { verified: false, error: 'Transaction failed', details: transaction.meta.err };
    }

    return { 
      verified: true, 
      details: {
        slot: transaction.slot,
        blockTime: transaction.blockTime,
        fee: transaction.meta?.fee,
        programIds: programIds.map(id => id.toString())
      }
    };
  } catch (error) {
    return { 
      verified: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
};
