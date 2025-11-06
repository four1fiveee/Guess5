import { Match } from '../models/Match';
import { enhancedLogger } from '../utils/enhancedLogger';

const PROPOSAL_EXPIRATION_MINUTES = 30; // 30 minutes expiration

/**
 * Set proposal expiration timestamp when proposal is created
 */
export function setProposalExpiration(match: Match): void {
  if (match.proposalCreatedAt) {
    match.proposalExpiresAt = new Date(
      new Date(match.proposalCreatedAt).getTime() + PROPOSAL_EXPIRATION_MINUTES * 60 * 1000
    );
    enhancedLogger.info(`⏰ Set proposal expiration for match ${match.id}`, {
      matchId: match.id,
      expiresAt: match.proposalExpiresAt.toISOString()
    });
  }
}

/**
 * Check if proposal is expired
 */
export function isProposalExpired(match: Match): boolean {
  if (!match.proposalExpiresAt) {
    return false;
  }
  return new Date() > new Date(match.proposalExpiresAt);
}

// Export a stub object for backward compatibility with existing require() calls
export const proposalExpirationService = {
  setProposalExpiration,
  isProposalExpired,
  scanForExpiredProposals: async (): Promise<void> => {
    // Stub - will be implemented later if needed
    enhancedLogger.info('⏭️ scanForExpiredProposals not yet implemented');
  }
};
