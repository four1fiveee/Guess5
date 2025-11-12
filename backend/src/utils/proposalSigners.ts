import walletConfig = require('../config/wallet');

const { FEE_WALLET_ADDRESS } = walletConfig;

export const MIN_REQUIRED_PROPOSAL_SIGNATURES = 2;

export const normalizeRequiredSignatures = (value: unknown): number => {
  const numeric = Number(value ?? Number.NaN);
  if (!Number.isFinite(numeric)) {
    return MIN_REQUIRED_PROPOSAL_SIGNATURES; // Default to threshold if invalid
  }
  if (numeric <= 0) {
    return 0;
  }
  // Return the actual value, don't force a minimum - the value should be 0-2 based on actual signatures
  return Math.ceil(numeric);
};

export const resolveFeeWalletAddress = (): string | null => {
  try {
    if (walletConfig && typeof walletConfig.getFeeWalletAddress === 'function') {
      const resolved = walletConfig.getFeeWalletAddress();
      if (resolved) {
        return resolved;
      }
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('⚠️ Failed to resolve fee wallet address via helper', { message });
  }

  if (walletConfig && typeof walletConfig.FEE_WALLET_ADDRESS === 'string' && walletConfig.FEE_WALLET_ADDRESS.length > 0) {
    return walletConfig.FEE_WALLET_ADDRESS;
  }

  if (typeof process !== 'undefined' && process.env && typeof process.env.FEE_WALLET_ADDRESS === 'string' && process.env.FEE_WALLET_ADDRESS.length > 0) {
    return process.env.FEE_WALLET_ADDRESS;
  }

  return FEE_WALLET_ADDRESS || null;
};

export interface ProposalState {
  normalizedNeeds: number;
  signers: string[];
  signersJson: string;
}

export const buildInitialProposalState = (rawNeedsSignatures: unknown): ProposalState => {
  const normalizedNeeds = normalizeRequiredSignatures(rawNeedsSignatures);
  const feeWalletAddress = resolveFeeWalletAddress();
  const signers = feeWalletAddress ? [feeWalletAddress] : [];

  return {
    normalizedNeeds,
    signers,
    signersJson: JSON.stringify(signers),
  };
};

type MatchProposalTarget = {
  needsSignatures?: number;
  setProposalSigners?: (signers: string[]) => void;
  proposalSigners?: string | null;
} | null | undefined;

export const applyProposalStateToMatch = (matchEntity: MatchProposalTarget, state: ProposalState): void => {
  if (!matchEntity || !state) {
    return;
  }

  matchEntity.needsSignatures = state.normalizedNeeds;

  if (typeof matchEntity.setProposalSigners === 'function') {
    matchEntity.setProposalSigners(state.signers);
  } else {
    matchEntity.proposalSigners = state.signersJson;
  }
};

