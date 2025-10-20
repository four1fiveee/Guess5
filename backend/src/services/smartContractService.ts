import { getSmartContractService } from './anchorClient';

export interface SmartContractConfig {
  programId: string;
  resultsAttestorPubkey: string;
  feeWalletPubkey: string;
  defaultFeeBps: number;
  defaultDeadlineBufferSlots: number;
}

export interface MatchCreationParams {
  player1: string;
  player2: string;
  stakeAmount: number; // in SOL
  feeBps?: number;
  deadlineBufferSlots?: number;
}

export interface DepositParams {
  matchId: string;
  player: string;
  stakeAmount: number; // in SOL
}

export interface SettlementParams {
  matchId: string;
  result: 'Player1' | 'Player2' | 'WinnerTie' | 'LosingTie' | 'Error';
}

export class SmartContractService {
  private config: SmartContractConfig;

  constructor() {
    this.config = {
      programId: process.env.SMART_CONTRACT_PROGRAM_ID || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4',
      resultsAttestorPubkey: process.env.RESULTS_ATTESTOR_PUBKEY || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
      feeWalletPubkey: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
      defaultFeeBps: parseInt(process.env.DEFAULT_FEE_BPS || '500'),
      defaultDeadlineBufferSlots: parseInt(process.env.DEFAULT_DEADLINE_BUFFER_SLOTS || '1000'),
    };
  }

  /**
   * Create a new match with smart contract escrow
   */
  async createMatch(params: MatchCreationParams): Promise<{
    matchPda: string;
    vaultPda: string;
    transaction: string;
    success: boolean;
    error?: string;
  }> {
    try {
      const anchorService = await getSmartContractService();
      const { PublicKey } = await import('@solana/web3.js');
      const result = await anchorService.createMatch(
        new PublicKey(params.player1),
        new PublicKey(params.player2),
        params.stakeAmount * 1e9, // Convert SOL to lamports
        params.feeBps || this.config.defaultFeeBps,
        undefined // deadlineSlot
      );
      
      return {
        matchPda: result.matchPda?.toString() || '',
        vaultPda: result.vaultPda?.toString() || '',
        transaction: 'match_created',
        success: result.success,
        error: result.error
      };
    } catch (error) {
      console.error('Error creating match:', error);
      return {
        matchPda: '',
        vaultPda: '',
        transaction: '',
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Deposit stake for a match
   */
  async deposit(params: DepositParams): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      // For now, return success as the frontend handles the actual deposit
      return {
        success: true,
        transactionId: 'pending_frontend_transaction'
      };
    } catch (error) {
      console.error('Error depositing:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Settle a match and distribute winnings
   */
  async settleMatch(params: SettlementParams): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      const anchorService = await getSmartContractService();
      const { PublicKey } = await import('@solana/web3.js');
      const result = await anchorService.settleMatch(
        new PublicKey(params.matchId),
        params.result
      );
      
      return {
        success: result.success,
        transactionId: result.signature,
        error: result.error
      };
    } catch (error) {
      console.error('Error settling match:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Refund timeout matches
   */
  async refundTimeout(matchId: string): Promise<{
    success: boolean;
    transactionId?: string;
    error?: string;
  }> {
    try {
      // For now, return success as this would be handled by the smart contract
      return {
        success: true,
        transactionId: 'timeout_refund_pending'
      };
    } catch (error) {
      console.error('Error refunding timeout:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get match data from smart contract
   */
  async getMatchData(matchId: string): Promise<any> {
    try {
      const anchorService = await getSmartContractService();
      const { PublicKey } = await import('@solana/web3.js');
      return await anchorService.getMatchData(new PublicKey(matchId));
    } catch (error) {
      console.error('Error getting match data:', error);
      return null;
    }
  }

  /**
   * Get vault data from smart contract
   */
  async getVaultData(vaultId: string): Promise<any> {
    try {
      const anchorService = await getSmartContractService();
      const { PublicKey } = await import('@solana/web3.js');
      return await anchorService.getVaultData(new PublicKey(vaultId));
    } catch (error) {
      console.error('Error getting vault data:', error);
      return null;
    }
  }
}