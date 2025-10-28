import { rpc, PROGRAM_ID } from '@sqds/multisig';
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
  private connection: Connection;

  constructor() {
    this.connection = new Connection(
      process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
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
      const transactionIndex = BigInt(proposalId);

      // For now, we'll return success since we need wallet integration
      // The actual signing will be handled by the wallet adapter
      return { success: true };
    } catch (error) {
      console.error('❌ Error signing proposal:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
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
      const transactionIndex = BigInt(proposalId);

      // For now, return a default status
      // In a real implementation, we would query the blockchain
      return {
        executed: false,
        signers: [],
        needsSignatures: 2, // 2-of-3 multisig
      };
    } catch (error) {
      console.error('❌ Failed to check proposal status', error);
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
      
      // For now, return default details
      // In a real implementation, we would query the blockchain
      return {
        address: vaultAddress,
        members: [] as string[],
        threshold: 2,
        configAuthority: '',
      };
    } catch (error) {
      console.error('❌ Failed to get multisig details', error);
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
    } catch (error) {
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
    } catch (error) {
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