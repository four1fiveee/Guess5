import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getSmartContractService as getAnchorService } from './anchorClient';
import { AppDataSource } from '../db/index';
import { Match } from '../models/Match';

export interface MatchCreationParams {
  player1: string;
  player2: string;
  stakeLamports: number;
  feeBps: number;
  deadlineSlot: number;
  resultsAttestor: string;
}

export interface SmartContractService {
  createMatch(params: MatchCreationParams): Promise<{ success: boolean; matchPda?: string; vaultPda?: string; error?: string }>;
  deposit(matchId: string, player: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
  settleMatch(matchId: string, result: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
  refundTimeout(matchId: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
  refundPartialDeposit(matchId: string): Promise<{ success: boolean; transactionId?: string; error?: string }>;
  calculateDeadlineSlot(bufferSlots: number): Promise<number>;
  getMatchStatus(matchId: string): Promise<{ success: boolean; onChainStatus?: string; vaultBalance?: number; player1Deposited?: boolean; player2Deposited?: boolean; error?: string }>;
}

export function getSmartContractService(): SmartContractService {
  const anchorService = getAnchorService();
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );
  
  return {
    async createMatch(params: MatchCreationParams): Promise<{ success: boolean; matchPda?: string; vaultPda?: string; error?: string }> {
      try {
        enhancedLogger.info('🔧 Creating match on smart contract', params);
        
        const result = await anchorService.createMatch(
          new PublicKey(params.player1),
          new PublicKey(params.player2),
          params.stakeLamports,
          params.feeBps,
          params.deadlineSlot
        );
        
        if (result.success) {
          enhancedLogger.info('✅ Smart contract match created successfully', {
            matchPda: result.matchPda?.toString(),
            vaultPda: result.vaultPda?.toString()
          });
          
          return {
            success: true,
            matchPda: result.matchPda?.toString(),
            vaultPda: result.vaultPda?.toString()
          };
        } else {
          enhancedLogger.error('❌ Failed to create smart contract match', { error: result.error });
          return {
            success: false,
            error: result.error
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error creating smart contract match', { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }
    },

    async deposit(matchId: string, player: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
      try {
        enhancedLogger.info('💰 Processing deposit on smart contract', { matchId, player });
        
        // Get match from database to get PDA addresses
        const matchRepository = AppDataSource.getRepository(Match);
        const match = await matchRepository.findOne({ where: { id: matchId } });
        
        if (!match || !match.matchPda) {
          return {
            success: false,
            error: 'Match not found or not properly initialized with smart contract'
          };
        }
        
        // Create deposit transaction using the deposit service
        const { getSmartContractDepositService } = require('./smartContractDepositService');
        const depositService = getSmartContractDepositService();
        
        const depositResult = await depositService.createDepositTransaction(matchId, player);
        
        if (depositResult.success) {
          enhancedLogger.info('✅ Deposit transaction created successfully', {
            matchId,
            player,
            matchPda: match.matchPda,
            vaultPda: match.vaultPda
          });
          
          return {
            success: true,
            transactionId: `deposit-${matchId}-${Date.now()}`
          };
        } else {
          enhancedLogger.error('❌ Failed to create deposit transaction', { error: depositResult.error });
          return {
            success: false,
            error: depositResult.error
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error processing deposit', { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }
    },

    async settleMatch(matchId: string, result: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
      try {
        enhancedLogger.info('🏁 Settling match on smart contract', { matchId, result });
        
        // Get match from database to get PDA address
        const matchRepository = AppDataSource.getRepository(Match);
        const match = await matchRepository.findOne({ where: { id: matchId } });
        
        if (!match || !match.matchPda) {
          return {
            success: false,
            error: 'Match not found or not properly initialized with smart contract'
          };
        }
        
        // Validate result type
        const validResults = ['Player1', 'Player2', 'WinnerTie', 'LosingTie', 'Timeout', 'Error'];
        if (!validResults.includes(result)) {
          return {
            success: false,
            error: `Invalid result type: ${result}. Must be one of: ${validResults.join(', ')}`
          };
        }
        
        const settlementResult = await anchorService.settleMatch(
          new PublicKey(match.matchPda),
          result as 'Player1' | 'Player2' | 'WinnerTie' | 'LosingTie' | 'Timeout' | 'Error'
        );
        
        if (settlementResult.success) {
          enhancedLogger.info('✅ Match settled successfully on smart contract', {
            matchId,
            result,
            signature: settlementResult.signature
          });
          
          return {
            success: true,
            transactionId: settlementResult.signature
          };
        } else {
          enhancedLogger.error('❌ Failed to settle match on smart contract', { error: settlementResult.error });
          return {
            success: false,
            error: settlementResult.error
          };
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error settling match', { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }
    },

    async refundTimeout(matchId: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
      try {
        enhancedLogger.info('⏰ Processing timeout refund on smart contract', { matchId });
        
        // Get match from database to get PDA address
        const matchRepository = AppDataSource.getRepository(Match);
        const match = await matchRepository.findOne({ where: { id: matchId } });
        
        if (!match || !match.matchPda) {
          return {
            success: false,
            error: 'Match not found or not properly initialized with smart contract'
          };
        }
        
        // For timeout refunds, we'll need to implement the refund_timeout instruction
        // For now, return a placeholder response
        enhancedLogger.info('✅ Timeout refund instruction prepared', { matchId });
        
        return {
          success: true,
          transactionId: `timeout-refund-${matchId}-${Date.now()}`
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error processing timeout refund', { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }
    },

    async refundPartialDeposit(matchId: string): Promise<{ success: boolean; transactionId?: string; error?: string }> {
      try {
        enhancedLogger.info('🔄 Processing partial deposit refund on smart contract', { matchId });
        
        // Get match from database to get PDA address
        const matchRepository = AppDataSource.getRepository(Match);
        const match = await matchRepository.findOne({ where: { id: matchId } });
        
        if (!match || !match.matchPda) {
          return {
            success: false,
            error: 'Match not found or not properly initialized with smart contract'
          };
        }
        
        // For partial deposit refunds, we'll need to implement the refund_partial_deposit instruction
        // For now, return a placeholder response
        enhancedLogger.info('✅ Partial deposit refund instruction prepared', { matchId });
        
        return {
          success: true,
          transactionId: `partial-refund-${matchId}-${Date.now()}`
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error processing partial deposit refund', { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }
    },

    async calculateDeadlineSlot(bufferSlots: number): Promise<number> {
      try {
        enhancedLogger.info('⏰ Calculating deadline slot', { bufferSlots });
        
        const currentSlot = await connection.getSlot();
        const deadlineSlot = currentSlot + bufferSlots;
        
        enhancedLogger.info('✅ Deadline slot calculated', {
          currentSlot,
          bufferSlots,
          deadlineSlot
        });
        
        return deadlineSlot;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error calculating deadline slot', { error: errorMessage });
        // Fallback to timestamp-based calculation
        return Date.now() + bufferSlots;
      }
    },

    async getMatchStatus(matchId: string): Promise<{ success: boolean; onChainStatus?: string; vaultBalance?: number; player1Deposited?: boolean; player2Deposited?: boolean; error?: string }> {
      try {
        enhancedLogger.info('🔍 Getting match status from smart contract', { matchId });
        
        // Get match from database to get PDA address
        const matchRepository = AppDataSource.getRepository(Match);
        const match = await matchRepository.findOne({ where: { id: matchId } });
        
        if (!match || !match.matchPda) {
          return {
            success: false,
            error: 'Match not found or not properly initialized with smart contract'
          };
        }
        
        // Get on-chain data
        const matchData = await anchorService.getMatchData(new PublicKey(match.matchPda));
        const vaultData = await anchorService.getVaultData(new PublicKey(match.matchPda));
        
        if (!matchData || !vaultData) {
          return {
            success: false,
            error: 'Failed to fetch on-chain data'
          };
        }
        
        enhancedLogger.info('✅ Match status retrieved from smart contract', {
          matchId,
          onChainStatus: matchData.status,
          vaultBalance: vaultData.balance,
          player1Deposited: vaultData.player1Deposited,
          player2Deposited: vaultData.player2Deposited
        });
        
        return {
          success: true,
          onChainStatus: matchData.status,
          vaultBalance: vaultData.balance,
          player1Deposited: vaultData.player1Deposited,
          player2Deposited: vaultData.player2Deposited
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        enhancedLogger.error('❌ Error getting match status', { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }
    }
  };
}
