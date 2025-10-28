import { Squads } from '@sqds/multisig';
import { Connection, PublicKey } from '@solana/web3.js';
import { useWallet } from '@solana/wallet-adapter-react';

export interface ProposalStatus {
  executed: boolean;
  signers: PublicKey[];
  needsSignatures: number;
}

export interface SignProposalResult {
  success: boolean;
  error?: string;
  transactionId?: string;
}

export class SquadsClient {
  private squads: Squads;
  private connection: Connection;

  constructor() {
    this.connection = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    this.squads = new Squads(this.connection);
  }

  /**
   * Sign a Squads proposal
   */
  async signProposal(
    vaultAddress: string,
    proposalId: string,
    signer: PublicKey
  ): Promise<SignProposalResult> {
    try {
      console.log('🔐 Signing Squads proposal', {
        vaultAddress,
        proposalId,
        signer: signer.toString(),
      });

      const multisigAddress = new PublicKey(vaultAddress);
      const transactionIndex = parseInt(proposalId);

      // Sign the transaction
      await this.squads.approveTransaction({
        multisig: multisigAddress,
        transactionIndex,
        signer,
      });

      console.log('✅ Proposal signed successfully');

      return {
        success: true,
        transactionId: `signed_${proposalId}_${Date.now()}`,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to sign proposal', errorMessage);

      return {
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Check proposal status
   */
  async checkProposalStatus(
    vaultAddress: string,
    proposalId: string
  ): Promise<ProposalStatus> {
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const transactionIndex = parseInt(proposalId);

      // Get transaction details from Squads
      const transaction = await this.squads.getTransaction({
        multisig: multisigAddress,
        transactionIndex,
      });

      const signers = transaction.signers || [];
      const needsSignatures = Math.max(0, 2 - signers.length); // 2-of-3 multisig

      return {
        executed: transaction.executed || false,
        signers,
        needsSignatures,
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to check proposal status', errorMessage);

      return {
        executed: false,
        signers: [],
        needsSignatures: 2,
      };
    }
  }

  /**
   * Get multisig details
   */
  async getMultisigDetails(vaultAddress: string) {
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const multisig = await this.squads.getMultisig(multisigAddress);

      return {
        address: multisig.multisigAddress.toString(),
        members: multisig.members.map(m => m.toString()),
        threshold: multisig.threshold,
        configAuthority: multisig.configAuthority.toString(),
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('❌ Failed to get multisig details', errorMessage);

      return null;
    }
  }

  /**
   * Check if a wallet is a member of the multisig
   */
  async isMultisigMember(vaultAddress: string, walletAddress: string): Promise<boolean> {
    try {
      const details = await this.getMultisigDetails(vaultAddress);
      if (!details) return false;

      return details.members.includes(walletAddress);

    } catch (error: unknown) {
      console.error('❌ Failed to check multisig membership', error);
      return false;
    }
  }

  /**
   * Check if a wallet has already signed a proposal
   */
  async hasSignedProposal(
    vaultAddress: string,
    proposalId: string,
    walletAddress: string
  ): Promise<boolean> {
    try {
      const status = await this.checkProposalStatus(vaultAddress, proposalId);
      return status.signers.some(signer => signer.toString() === walletAddress);

    } catch (error: unknown) {
      console.error('❌ Failed to check if wallet has signed', error);
      return false;
    }
  }
}

// Export singleton instance
export const squadsClient = new SquadsClient();

// React hook for Squads operations
export const useSquadsClient = () => {
  const { publicKey, signTransaction } = useWallet();

  const signProposal = async (
    vaultAddress: string,
    proposalId: string
  ): Promise<SignProposalResult> => {
    if (!publicKey) {
      return {
        success: false,
        error: 'Wallet not connected',
      };
    }

    return await squadsClient.signProposal(vaultAddress, proposalId, publicKey);
  };

  const checkProposalStatus = async (
    vaultAddress: string,
    proposalId: string
  ): Promise<ProposalStatus> => {
    return await squadsClient.checkProposalStatus(vaultAddress, proposalId);
  };

  const isMultisigMember = async (vaultAddress: string): Promise<boolean> => {
    if (!publicKey) return false;
    return await squadsClient.isMultisigMember(vaultAddress, publicKey.toString());
  };

  const hasSignedProposal = async (
    vaultAddress: string,
    proposalId: string
  ): Promise<boolean> => {
    if (!publicKey) return false;
    return await squadsClient.hasSignedProposal(vaultAddress, proposalId, publicKey.toString());
  };

  const getMultisigDetails = async (vaultAddress: string) => {
    return await squadsClient.getMultisigDetails(vaultAddress);
  };

  return {
    signProposal,
    checkProposalStatus,
    isMultisigMember,
    hasSignedProposal,
    getMultisigDetails,
    isConnected: !!publicKey,
    publicKey,
  };
};
