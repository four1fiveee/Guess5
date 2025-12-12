// @ts-nocheck
/**
 * Proposal Validation Service
 * 
 * Ensures proposal IDs in the database always match the transaction index's proposal PDA.
 * This prevents desync issues where the database has a stale proposal ID.
 */

import { PublicKey } from '@solana/web3.js';
import { getProposalPda } from '@sqds/multisig';

/**
 * Validates that a proposal ID matches the expected PDA for a given transaction index
 * @param vaultAddress - The multisig vault address
 * @param proposalId - The proposal ID stored in the database
 * @param transactionIndex - The transaction index (if available)
 * @returns Object with validation result and corrected proposal ID if mismatch found
 */
export function validateProposalIdMatchesTransactionIndex(
  vaultAddress: string,
  proposalId: string,
  transactionIndex?: string | number | bigint
): { valid: boolean; correctedProposalId?: string; error?: string } {
  try {
    const multisigAddress = new PublicKey(vaultAddress);
    const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMDKyuUq6aD6EgTu8psMDFvC9onYSQ');
    
    // If we have transactionIndex, derive the expected proposal PDA
    if (transactionIndex !== undefined && transactionIndex !== null) {
      const txIndex = typeof transactionIndex === 'bigint' 
        ? transactionIndex 
        : BigInt(transactionIndex.toString());
      
      const [expectedProposalPda] = getProposalPda({
        multisigPda: multisigAddress,
        transactionIndex: txIndex,
        programId: programId,
      });
      
      const expectedProposalId = expectedProposalPda.toString();
      
      if (proposalId !== expectedProposalId) {
        return {
          valid: false,
          correctedProposalId: expectedProposalId,
          error: `Proposal ID mismatch: DB has ${proposalId}, but transaction index ${transactionIndex} expects ${expectedProposalId}`,
        };
      }
      
      return { valid: true };
    }
    
    // If no transactionIndex, we can't validate - return valid but log warning
    return {
      valid: true,
      error: 'Cannot validate proposal ID without transaction index',
    };
  } catch (error: any) {
    return {
      valid: false,
      error: `Validation error: ${error?.message || String(error)}`,
    };
  }
}

/**
 * Derives the proposal PDA for a given transaction index
 * This is the source of truth for what the proposal ID should be
 */
export function deriveProposalPda(
  vaultAddress: string,
  transactionIndex: string | number | bigint
): string {
  const multisigAddress = new PublicKey(vaultAddress);
  const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMDKyuUq6aD6EgTu8psMDFvC9onYSQ');
  
  const txIndex = typeof transactionIndex === 'bigint' 
    ? transactionIndex 
    : BigInt(transactionIndex.toString());
  
  const [proposalPda] = getProposalPda({
    multisigPda: multisigAddress,
    transactionIndex: txIndex,
    programId: programId,
  });
  
  return proposalPda.toString();
}

