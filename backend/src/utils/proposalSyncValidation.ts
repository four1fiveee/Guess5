// @ts-nocheck
/**
 * Proposal Sync Validation Utility
 * 
 * Validates whether database proposal state matches on-chain proposal state.
 * Used for testing, debugging, and pre-flight checks.
 */

export interface ProposalValidationResult {
  isValid: boolean;
  matchId: string;
  dbProposalId?: string;
  onChainProposalId?: string;
  dbStatus?: string;
  onChainStatus?: string;
  mismatches: string[];
  details?: {
    proposalIdMatch?: boolean;
    statusMatch?: boolean;
    signersMatch?: boolean;
  };
}

/**
 * Validate that database proposal state matches on-chain proposal state
 */
export function validateProposalSync(
  dbProposal: {
    id?: string | null;
    status?: string | null;
    signers?: string[] | null;
  },
  onChainProposal: {
    id?: string | null;
    status?: string | null;
    signers?: string[] | null;
  }
): ProposalValidationResult {
  const mismatches: string[] = [];
  const details: ProposalValidationResult['details'] = {};

  // Check proposal ID match
  const proposalIdMatch = dbProposal.id === onChainProposal.id;
  details.proposalIdMatch = proposalIdMatch;
  if (!proposalIdMatch) {
    mismatches.push(`Proposal ID mismatch: DB=${dbProposal.id}, On-chain=${onChainProposal.id}`);
  }

  // Check status match
  const statusMatch = dbProposal.status === onChainProposal.status;
  details.statusMatch = statusMatch;
  if (!statusMatch) {
    mismatches.push(`Status mismatch: DB=${dbProposal.status}, On-chain=${onChainProposal.status}`);
  }

  // Check signers match (normalize arrays for comparison)
  const dbSigners = (dbProposal.signers || []).map(s => s.toLowerCase()).sort();
  const onChainSigners = (onChainProposal.signers || []).map(s => s.toLowerCase()).sort();
  const signersMatch = JSON.stringify(dbSigners) === JSON.stringify(onChainSigners);
  details.signersMatch = signersMatch;
  if (!signersMatch) {
    mismatches.push(`Signers mismatch: DB=[${dbSigners.join(', ')}], On-chain=[${onChainSigners.join(', ')}]`);
  }

  return {
    isValid: mismatches.length === 0,
    matchId: '', // Will be set by caller
    dbProposalId: dbProposal.id || undefined,
    onChainProposalId: onChainProposal.id || undefined,
    dbStatus: dbProposal.status || undefined,
    onChainStatus: onChainProposal.status || undefined,
    mismatches,
    details,
  };
}

/**
 * Log validation result with appropriate log level
 */
export function logValidationResult(result: ProposalValidationResult, context: string = 'proposal-sync'): void {
  if (result.isValid) {
    console.log(`✅ [${context}] Proposal sync validation passed`, {
      matchId: result.matchId,
      proposalId: result.dbProposalId,
      status: result.dbStatus,
    });
  } else {
    console.warn(`⚠️ [${context}] Proposal sync validation failed`, {
      matchId: result.matchId,
      mismatches: result.mismatches,
      details: result.details,
    });
  }
}




