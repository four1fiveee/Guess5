import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { getSmartContractService, MatchCreationParams } from './smartContractService';
import { enhancedLogger } from '../utils/enhancedLogger';
import { Match } from '../models/Match';
import { AppDataSource } from '../db/index';

export interface NonCustodialMatchParams {
  player1: string;
  player2: string;
  entryFee: number; // in SOL
  feeBps?: number; // basis points, default 500 (5%)
  deadlineBufferSlots?: number; // default 1000 slots
}

export interface DepositResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export interface SettlementResult {
  success: boolean;
  transactionId?: string;
  error?: string;
}

export class NonCustodialMatchService {
  private smartContractService: any;
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
    this.smartContractService = getSmartContractService();
  }

  /**
   * Create a new non-custodial match
   */
  async createMatch(params: NonCustodialMatchParams): Promise<{
    success: boolean;
    matchId?: string;
    matchPda?: string;
    vaultPda?: string;
    error?: string;
  }> {
    try {
      enhancedLogger.info('🎮 Creating non-custodial match', {
        player1: params.player1,
        player2: params.player2,
        entryFee: params.entryFee
      });

      // Calculate parameters
      const stakeLamports = params.entryFee * 1_000_000_000; // Convert SOL to lamports
      const feeBps = params.feeBps || 500; // Default 5%
      const deadlineSlot = await this.smartContractService.calculateDeadlineSlot(
        params.deadlineBufferSlots || 1000
      );

      // Create match on-chain
      const matchCreationParams: MatchCreationParams = {
        player1: params.player1,
        player2: params.player2,
        stakeLamports,
        feeBps,
        deadlineSlot,
        resultsAttestor: process.env.RESULTS_ATTESTOR_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'
      };

      const onChainResult = await this.smartContractService.createMatch(matchCreationParams);

      if (!onChainResult.success) {
        return {
          success: false,
          error: `Failed to create match on-chain: ${onChainResult.error}`
        };
      }

      // Create database record
      const matchRepository = AppDataSource.getRepository(Match);
      const match = new Match();
      
      // Generate a unique match ID (you might want to use a different strategy)
      match.id = this.generateMatchId();
      match.player1 = params.player1;
      match.player2 = params.player2;
      match.entryFee = params.entryFee;
      match.status = 'payment_required';
      match.word = this.getRandomWord();
      
      // Store smart contract data
      match.matchPda = onChainResult.matchPda!;
      match.vaultPda = onChainResult.vaultPda!;
      match.deadlineSlot = deadlineSlot;
      match.feeBps = feeBps;
      match.smartContractStatus = 'Active';
      
      // Store results attestor (you'll need to configure this)
      match.resultsAttestor = process.env.RESULTS_ATTESTOR_PUBKEY || '';

      await matchRepository.save(match);

      enhancedLogger.info('✅ Non-custodial match created successfully', {
        matchId: match.id,
        matchPda: match.matchPda,
        vaultPda: match.vaultPda
      });

      return {
        success: true,
        matchId: match.id,
        matchPda: match.matchPda,
        vaultPda: match.vaultPda
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to create non-custodial match', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Process player deposit to smart contract vault
   */
  async processDeposit(matchId: string, playerWallet: string, playerKeypair: Keypair): Promise<DepositResult> {
    try {
      enhancedLogger.info('💰 Processing non-custodial deposit', {
        matchId,
        playerWallet
      });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match) {
        return {
          success: false,
          error: 'Match not found'
        };
      }

      if (!match.matchPda || !match.vaultPda) {
        return {
          success: false,
          error: 'Match not properly initialized with smart contract'
        };
      }

      // Verify player is part of this match
      if (playerWallet !== match.player1 && playerWallet !== match.player2) {
        return {
          success: false,
          error: 'Player not part of this match'
        };
      }

      // Check if player has already deposited
      const isPlayer1 = playerWallet === match.player1;
      if (isPlayer1 && match.player1Paid) {
        return {
          success: false,
          error: 'Player 1 has already deposited'
        };
      }
      if (!isPlayer1 && match.player2Paid) {
        return {
          success: false,
          error: 'Player 2 has already deposited'
        };
      }

      // Create deposit transaction
      const stakeLamports = match.entryFee * 1_000_000_000;
      
      // For now, we'll create a simple transfer instruction
      // In the full implementation, you'd call the smart contract's deposit method
      const depositResult = await this.smartContractService.deposit({
        matchId,
        player: playerWallet,
        playerKeypair
      });

      if (!depositResult.success) {
        return {
          success: false,
          error: `Deposit failed: ${depositResult.error}`
        };
      }

      // Update match status
      if (isPlayer1) {
        match.player1Paid = true;
        match.player1EntrySignature = depositResult.transactionId;
      } else {
        match.player2Paid = true;
        match.player2EntrySignature = depositResult.transactionId;
      }

      // Check if both players have deposited
      if (match.player1Paid && match.player2Paid) {
        match.status = 'active';
        match.smartContractStatus = 'Deposited';
        match.gameStartTime = new Date();
      }

      await matchRepository.save(match);

      enhancedLogger.info('✅ Deposit processed successfully', {
        matchId,
        playerWallet,
        transactionId: depositResult.transactionId
      });

      return {
        success: true,
        transactionId: depositResult.transactionId
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to process deposit', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Settle match and distribute funds
   */
  async settleMatch(matchId: string, result: 'Player1' | 'Player2' | 'WinnerTie' | 'LosingTie' | 'Timeout' | 'Error'): Promise<SettlementResult> {
    try {
      enhancedLogger.info('🏁 Settling non-custodial match', {
        matchId,
        result
      });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match) {
        return {
          success: false,
          error: 'Match not found'
        };
      }

      if (!match.matchPda) {
        return {
          success: false,
          error: 'Match not properly initialized with smart contract'
        };
      }

      // Get results attestor keypair
      const resultsAttestorKeypair = this.getResultsAttestorKeypair();

      // Call smart contract settlement
      const settlementResult = await this.smartContractService.settleMatch({
        matchId,
        result,
        resultsAttestor: resultsAttestorKeypair
      });

      if (!settlementResult.success) {
        return {
          success: false,
          error: `Settlement failed: ${settlementResult.error}`
        };
      }

      // Update match status
      match.status = 'completed';
      match.smartContractStatus = 'Settled';
      
      // Determine winner based on result type
      let winner: string;
      let isTieOrError = false;
      let isLosingTie = false;
      
      switch (result) {
        case 'Player1':
          winner = match.player1;
          break;
        case 'Player2':
          winner = match.player2;
          break;
        case 'WinnerTie':
        case 'Timeout':
        case 'Error':
          winner = 'tie';
          isTieOrError = true;
          break;
        case 'LosingTie':
          winner = 'tie';
          isLosingTie = true;
          break;
        default:
          winner = 'tie';
          isTieOrError = true;
      }
      
      match.winner = winner;
      match.isCompleted = true;

      // Create payout result for display
      let winnerAmount: number;
      let feeAmount: number;
      let description: string;
      
      if (isLosingTie) {
        // Losing tie: both players get 95% back, 5% fee to platform
        winnerAmount = match.entryFee * 0.95; // 95% of each player's stake
        feeAmount = match.entryFee * 0.1; // 5% from both players = 10% of total pot
        description = 'Losing tie refund (95% each)';
      } else if (isTieOrError) {
        // Winner tie, timeout, or error: refund minus gas fee (0.0001 SOL each)
        const gasFee = 0.0001; // 0.0001 SOL gas fee
        winnerAmount = match.entryFee - gasFee; // Refund minus gas fee
        feeAmount = gasFee * 2; // Gas fee from both players
        description = `${result} refund (minus gas fee)`;
      } else {
        // Player win: winner gets 95% of total pot, 5% fee
        winnerAmount = match.entryFee * 1.9; // 95% of total pot
        feeAmount = match.entryFee * 0.1; // 5% of total pot
        description = 'Winner payout';
      }
      
      const payoutResult = {
        winner: match.winner,
        winnerAmount,
        feeAmount,
        feeWallet: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
        transactions: [
          {
            from: match.vaultPda || 'unknown-vault',
            to: match.winner === 'tie' ? 'both_players' : match.winner,
            amount: winnerAmount,
            description,
            signature: settlementResult.transactionId
          }
        ],
        paymentSuccess: true,
        transaction: settlementResult.transactionId
      };

      match.setPayoutResult(payoutResult);
      await matchRepository.save(match);

      enhancedLogger.info('✅ Match settled successfully', {
        matchId,
        result,
        transactionId: settlementResult.transactionId
      });

      return {
        success: true,
        transactionId: settlementResult.transactionId
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to settle match', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Process timeout refund
   */
  async processTimeoutRefund(matchId: string): Promise<SettlementResult> {
    try {
      enhancedLogger.info('⏰ Processing timeout refund', { matchId });

      // Get match from database
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match) {
        return {
          success: false,
          error: 'Match not found'
        };
      }

      if (!match.matchPda) {
        return {
          success: false,
          error: 'Match not properly initialized with smart contract'
        };
      }

      // Check if deadline has passed
      const isDeadlinePassed = await this.smartContractService.isDeadlinePassed(match.deadlineSlot!);
      if (!isDeadlinePassed) {
        return {
          success: false,
          error: 'Deadline has not passed yet'
        };
      }

      // Call smart contract refund
      const refundResult = await this.smartContractService.refundTimeout(matchId);

      if (!refundResult.success) {
        return {
          success: false,
          error: `Refund failed: ${refundResult.error}`
        };
      }

      // Update match status
      match.status = 'completed';
      match.smartContractStatus = 'Refunded';
      match.winner = 'tie';
      match.isCompleted = true;
      match.refundReason = 'timeout';

      await matchRepository.save(match);

      enhancedLogger.info('✅ Timeout refund processed successfully', {
        matchId,
        transactionId: refundResult.transactionId
      });

      return {
        success: true,
        transactionId: refundResult.transactionId
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to process timeout refund', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  /**
   * Get match status from smart contract
   */
  async getMatchStatus(matchId: string): Promise<{
    success: boolean;
    onChainStatus?: string;
    vaultBalance?: number;
    player1Deposited?: boolean;
    player2Deposited?: boolean;
    error?: string;
  }> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const match = await matchRepository.findOne({ where: { id: matchId } });

      if (!match || !match.matchPda || !match.vaultPda) {
        return {
          success: false,
          error: 'Match not found or not properly initialized'
        };
      }

      // Get on-chain data
      const matchAccount = await this.smartContractService.getMatchAccount(match.matchPda);
      const vaultAccount = await this.smartContractService.getVaultAccount(match.vaultPda);

      if (!matchAccount || !vaultAccount) {
        return {
          success: false,
          error: 'Failed to fetch on-chain data'
        };
      }

      return {
        success: true,
        onChainStatus: matchAccount.status,
        vaultBalance: vaultAccount.balance,
        player1Deposited: vaultAccount.player1Deposited,
        player2Deposited: vaultAccount.player2Deposited
      };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      enhancedLogger.error('❌ Failed to get match status', { error: errorMessage });
      
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  // Helper methods
  private generateMatchId(): string {
    return `match_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private getRandomWord(): string {
    // Import your word list logic here
    const words = ['APPLE', 'BRAIN', 'CHAIR', 'DANCE', 'EARTH'];
    return words[Math.floor(Math.random() * words.length)];
  }

  private getResultsAttestorKeypair(): Keypair {
    // You'll need to implement this based on your key management strategy
    // For now, throw an error to indicate this needs to be implemented
    throw new Error('Results attestor keypair not configured - implement key management');
  }
}

// Export singleton instance
let nonCustodialMatchService: NonCustodialMatchService | null = null;

export const getNonCustodialMatchService = (connection?: Connection): NonCustodialMatchService => {
  if (!nonCustodialMatchService) {
    if (!connection) {
      throw new Error('Connection required for first initialization of NonCustodialMatchService');
    }
    nonCustodialMatchService = new NonCustodialMatchService(connection);
  }
  return nonCustodialMatchService;
};
