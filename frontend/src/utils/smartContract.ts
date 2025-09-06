import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL 
} from '@solana/web3.js';
import { Program, AnchorProvider, Wallet, BN } from '@project-serum/anchor';
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
  deadlineSlot: number
): Promise<{ instruction: TransactionInstruction; matchPda: PublicKey; vaultPda: PublicKey }> => {
  // Generate PDAs for this match
  const [matchPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('match'), payer.toBuffer(), Buffer.from(deadlineSlot.toString())],
    program.programId
  );

  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), matchPda.toBuffer()],
    program.programId
  );

  // Create the instruction
  const instruction = await program.methods
    .createMatch(
      new BN(entryFee * LAMPORTS_PER_SOL),
      new BN(deadlineSlot)
    )
    .accounts({
      match: matchPda,
      vault: vaultPda,
      payer: payer,
      resultsAttestor: RESULTS_ATTESTOR_ADDRESS,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction, matchPda, vaultPda };
};

// Join a match on the smart contract
export const joinMatchInstruction = async (
  program: Program,
  payer: PublicKey,
  matchPda: PublicKey,
  vaultPda: PublicKey,
  entryFee: number
): Promise<TransactionInstruction> => {
  return await program.methods
    .joinMatch()
    .accounts({
      match: matchPda,
      vault: vaultPda,
      payer: payer,
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
  result: string,
  signature: string
): Promise<TransactionInstruction> => {
  return await program.methods
    .submitResult(result, signature)
    .accounts({
      match: matchPda,
      vault: vaultPda,
      payer: payer,
      resultsAttestor: RESULTS_ATTESTOR_ADDRESS,
    })
    .instruction();
};

// Claim prize from smart contract
export const claimPrizeInstruction = async (
  program: Program,
  winner: PublicKey,
  matchPda: PublicKey,
  vaultPda: PublicKey
): Promise<TransactionInstruction> => {
  return await program.methods
    .claimPrize()
    .accounts({
      match: matchPda,
      vault: vaultPda,
      winner: winner,
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
  wallet: Wallet
): Promise<Program> => {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: 'confirmed',
  });

  return new Program(IDL, SOLANA_PROGRAM_ID, provider);
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
