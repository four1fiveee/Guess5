export interface ProposalExecutionUpdateContext {
  executedAt: Date;
  signature?: string | null;
  isTieRefund: boolean;
  isWinnerPayout: boolean;
}

/**
 * Compute the set of database fields that should be updated when a Squads
 * proposal successfully executes. The same helper is used by both the primary
 * execution flow and the fallback executor so we always persist identical data.
 */
export function buildProposalExecutionUpdates(
  context: ProposalExecutionUpdateContext,
): Record<string, any> {
  const { executedAt, signature, isTieRefund, isWinnerPayout } = context;

  const normalizedSignature = signature ?? null;

  const updates: Record<string, any> = {
    proposalStatus: 'EXECUTED',
    proposalExecutedAt: executedAt,
    proposalTransactionId: normalizedSignature,
  };

  if (isTieRefund) {
    updates.refundTxHash = normalizedSignature;
  }

  if (isWinnerPayout) {
    updates.payoutTxHash = normalizedSignature;
    updates.winnerPayoutSignature = normalizedSignature;
  }

  return updates;
}

