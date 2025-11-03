import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { MatchAuditLog } from '../models/MatchAuditLog';
import { squadsVaultService } from './squadsVaultService';
import { enhancedLogger } from '../utils/enhancedLogger';
import { getGameState } from '../utils/redisGameState';

export class TimeoutScannerService {
  private isRunning: boolean = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private readonly POLL_INTERVAL = 30000; // 30 seconds
  private readonly MATCH_TIMEOUT = 30 * 60 * 1000; // 30 minutes
  private readonly DEPOSIT_TIMEOUT = 10 * 60 * 1000; // 10 minutes
  private readonly ABANDONED_GAME_TIMEOUT = 90 * 1000; // 90 seconds - if one player finishes, other has 90 seconds

  /**
   * Start the timeout scanner service
   */
  start(): void {
    if (this.isRunning) {
      enhancedLogger.warn('Timeout scanner service is already running');
      return;
    }

    this.isRunning = true;
    enhancedLogger.info('⏰ Starting timeout scanner service');

    this.scanInterval = setInterval(async () => {
      try {
        await this.scanForTimeouts();
      } catch (error) {
        enhancedLogger.error('❌ Error in timeout scanner service', { error });
      }
    }, this.POLL_INTERVAL);
  }

  /**
   * Stop the timeout scanner service
   */
  stop(): void {
    if (!this.isRunning) {
      enhancedLogger.warn('Timeout scanner service is not running');
      return;
    }

    this.isRunning = false;
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    enhancedLogger.info('🛑 Stopped timeout scanner service');
  }

  /**
   * Scan for matches that have timed out
   */
  private async scanForTimeouts(): Promise<void> {
    try {
      const matchRepository = AppDataSource.getRepository(Match);
      const auditLogRepository = AppDataSource.getRepository(MatchAuditLog);

      const now = new Date();
      const matchTimeout = new Date(now.getTime() - this.MATCH_TIMEOUT);
      const depositTimeout = new Date(now.getTime() - this.DEPOSIT_TIMEOUT);

      // Find matches that need timeout processing
      const timeoutMatches = await matchRepository
        .createQueryBuilder('match')
        .where('match.matchStatus IN (:...statuses)', {
          statuses: ['PENDING', 'VAULT_CREATED', 'PAYMENT_REQUIRED'],
        })
        .andWhere('match.createdAt < :timeout', { timeout: matchTimeout })
        .getMany();

      enhancedLogger.debug(`⏰ Scanning ${timeoutMatches.length} matches for timeouts`);

      for (const match of timeoutMatches) {
        try {
          await this.processTimeoutMatch(match, auditLogRepository);
        } catch (error) {
          enhancedLogger.error('❌ Error processing timeout match', {
            matchId: match.id,
            error,
          });
        }
      }

      // Find matches with deposit timeouts
      const depositTimeoutMatches = await matchRepository
        .createQueryBuilder('match')
        .where('match.matchStatus = :status', { status: 'PAYMENT_REQUIRED' })
        .andWhere('match.createdAt < :timeout', { timeout: depositTimeout })
        .getMany();

      enhancedLogger.debug(`⏰ Scanning ${depositTimeoutMatches.length} matches for deposit timeouts`);

      for (const match of depositTimeoutMatches) {
        try {
          await this.processDepositTimeout(match, auditLogRepository);
        } catch (error) {
          enhancedLogger.error('❌ Error processing deposit timeout match', {
            matchId: match.id,
            error,
          });
        }
      }

      // Find active games where one player has finished but the other abandoned
      await this.scanForAbandonedGames(matchRepository, auditLogRepository);
    } catch (error) {
      enhancedLogger.error('❌ Error in scanForTimeouts', { error });
    }
  }

  /**
   * Scan for active games where one player finished but the other abandoned
   */
  private async scanForAbandonedGames(
    matchRepository: any,
    auditLogRepository: any
  ): Promise<void> {
    try {
      // Find active matches where game has started
      const activeMatches = await matchRepository.find({
        where: { status: 'active', isCompleted: false },
        order: { gameStartTime: 'DESC' }
      });

      const now = Date.now();
      
      for (const match of activeMatches) {
        try {
          const gameState = await getGameState(match.id);
          if (!gameState) {
            continue; // No game state, skip
          }

          const player1Result = match.getPlayer1Result();
          const player2Result = match.getPlayer2Result();
          
          // IMPORTANT: If match is already completed, skip (race condition)
          if (match.isCompleted) {
            continue;
          }
          
          // If both players have submitted results, skip (normal completion path)
          if (player1Result && player2Result) {
            continue;
          }
          
          // Check if one player has submitted but the other hasn't
          const player1Finished = gameState.player1Solved || gameState.player1Guesses.length >= 7 || !!player1Result;
          const player2Finished = gameState.player2Solved || gameState.player2Guesses.length >= 7 || !!player2Result;
          
          // If both finished in game state but results aren't saved yet, skip (wait for normal completion)
          // Only process if exactly one player finished AND we're past the timeout
          if ((player1Finished && player2Finished)) {
            // Both finished in game state - wait for results to be saved normally
            // Don't process as abandoned game
            continue;
          }
          
          // If neither finished, skip
          if (!player1Finished && !player2Finished) {
            continue;
          }

          // One player finished, check how long it's been
          const timeSinceLastActivity = now - gameState.lastActivity;
          
          if (timeSinceLastActivity > this.ABANDONED_GAME_TIMEOUT) {
            enhancedLogger.info('⏰ Detected abandoned game - one player finished, other player timeout', {
              matchId: match.id,
              player1Finished,
              player2Finished,
              player1HasResult: !!player1Result,
              player2HasResult: !!player2Result,
              timeSinceLastActivity: timeSinceLastActivity / 1000 + 's',
            });

            await this.processAbandonedGame(match, player1Finished, player1Result, player2Finished, player2Result, auditLogRepository);
          }
        } catch (error) {
          enhancedLogger.error('❌ Error processing abandoned game check', {
            matchId: match.id,
            error,
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error scanning for abandoned games', { error });
    }
  }

  /**
   * Process an abandoned game - create timeout result for missing player and determine winner
   */
  private async processAbandonedGame(
    match: Match,
    player1Finished: boolean,
    player1Result: any,
    player2Finished: boolean,
    player2Result: any,
    auditLogRepository: any
  ): Promise<void> {
    try {
      const { determineWinnerAndPayout } = require('../controllers/matchController');
      const matchRepository = AppDataSource.getRepository(Match);
      
      // Reload match to get latest state
      const freshMatch = await matchRepository.findOne({ where: { id: match.id } });
      if (!freshMatch || freshMatch.isCompleted) {
        return; // Match already completed or doesn't exist
      }

      const freshPlayer1Result = freshMatch.getPlayer1Result();
      const freshPlayer2Result = freshMatch.getPlayer2Result();

      // If both have results now, skip (race condition)
      if (freshPlayer1Result && freshPlayer2Result) {
        return;
      }

      // Create timeout result for the missing player
      const timeoutResult = {
        won: false,
        numGuesses: 7, // Max guesses = lost
        totalTime: this.ABANDONED_GAME_TIMEOUT,
        guesses: [],
        reason: 'abandoned',
        abandoned: true
      };

      let finalPlayer1Result = freshPlayer1Result;
      let finalPlayer2Result = freshPlayer2Result;

      // Set timeout result for missing player
      if (!freshPlayer1Result && player2Finished) {
        freshMatch.setPlayer1Result(timeoutResult);
        finalPlayer1Result = timeoutResult;
        enhancedLogger.info('⏰ Created timeout result for Player 1 (abandoned)', { matchId: match.id });
      } else if (!freshPlayer2Result && player1Finished) {
        freshMatch.setPlayer2Result(timeoutResult);
        finalPlayer2Result = timeoutResult;
        enhancedLogger.info('⏰ Created timeout result for Player 2 (abandoned)', { matchId: match.id });
      }

      // Save the timeout result
      await matchRepository.save(freshMatch);

      // Determine winner and create payout
      const payoutResult = await determineWinnerAndPayout(match.id, finalPlayer1Result, finalPlayer2Result);

      if (payoutResult) {
        // Reload match to get latest state after determineWinnerAndPayout
        const updatedMatch = await matchRepository.findOne({ where: { id: match.id } });
        if (!updatedMatch) {
          enhancedLogger.error('❌ Match not found after winner determination', { matchId: match.id });
          return;
        }

        // Create Squads proposal if there's a winner (not a tie)
        if (payoutResult.winner && payoutResult.winner !== 'tie' && updatedMatch.squadsVaultAddress) {
          try {
            const { PublicKey } = require('@solana/web3.js');
            const winner = payoutResult.winner;
            const entryFee = updatedMatch.entryFee;
            const totalPot = entryFee * 2;
            const winnerAmount = totalPot * 0.95;
            const feeAmount = totalPot * 0.05;

            const proposalResult = await squadsVaultService.proposeWinnerPayout(
              updatedMatch.squadsVaultAddress,
              new PublicKey(winner),
              winnerAmount,
              new PublicKey(process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'),
              feeAmount
            );

            if (proposalResult.success) {
              enhancedLogger.info('✅ Squads winner payout proposal created for abandoned game', {
                matchId: match.id,
                proposalId: proposalResult.proposalId,
              });

              updatedMatch.payoutProposalId = proposalResult.proposalId;
              updatedMatch.proposalCreatedAt = new Date();
              updatedMatch.proposalStatus = 'ACTIVE';
              updatedMatch.needsSignatures = 2; // 2-of-3 multisig

              // Update payout result with proposal info
              (payoutResult as any).paymentInstructions = {
                winner,
                winnerAmount,
                feeAmount,
                feeWallet: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
                squadsProposal: true,
                proposalId: proposalResult.proposalId,
                transactions: [{
                  from: 'Squads Vault',
                  to: winner,
                  amount: winnerAmount,
                  description: 'Winner payout via Squads proposal (requires winner signature)',
                  proposalId: proposalResult.proposalId
                }]
              };
              (payoutResult as any).paymentSuccess = true;
              (payoutResult as any).squadsProposal = true;
              (payoutResult as any).proposalId = proposalResult.proposalId;
            } else {
              enhancedLogger.error('❌ Failed to create Squads proposal for abandoned game', {
                matchId: match.id,
                error: proposalResult.error,
              });
            }
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            enhancedLogger.error('❌ Error creating Squads proposal for abandoned game', {
              matchId: match.id,
              error: errorMessage,
            });
          }
        }

        // Update match with payout result
        updatedMatch.setPayoutResult(payoutResult);
        updatedMatch.isCompleted = true;
        await matchRepository.save(updatedMatch);

        // Mark game as completed in Redis
        const { markGameCompleted } = require('../controllers/matchController');
        await markGameCompleted(match.id);

        await this.logAuditEvent(auditLogRepository, match.id, 'ABANDONED_GAME_COMPLETED', {
          winner: (payoutResult as any).winner,
          player1Result: finalPlayer1Result,
          player2Result: finalPlayer2Result,
          timeoutSeconds: this.ABANDONED_GAME_TIMEOUT / 1000,
          proposalId: updatedMatch.payoutProposalId,
        });

        enhancedLogger.info('✅ Abandoned game completed, winner determined', {
          matchId: match.id,
          winner: (payoutResult as any).winner,
          proposalId: updatedMatch.payoutProposalId,
        });
      }
    } catch (error) {
      enhancedLogger.error('❌ Error processing abandoned game', {
        matchId: match.id,
        error,
      });
    }
  }

  /**
   * Process a match that has timed out
   */
  private async processTimeoutMatch(
    match: Match,
    auditLogRepository: any
  ): Promise<void> {
    try {
      enhancedLogger.info('⏰ Processing timeout match', {
        matchId: match.id,
        status: match.matchStatus,
        createdAt: match.createdAt,
      });

      // Determine timeout reason
      let timeoutReason = 'TIMEOUT_REFUND';
      if (match.matchStatus === 'PENDING') {
        timeoutReason = 'MATCH_TIMEOUT';
      } else if (match.matchStatus === 'VAULT_CREATED') {
        timeoutReason = 'VAULT_TIMEOUT';
      }

      // Process refund
      const refundResult = await squadsVaultService.proposeTieRefund(
        match.squadsVaultAddress!,
        new (require('@solana/web3.js').PublicKey)(match.player1),
        new (require('@solana/web3.js').PublicKey)(match.player2),
        match.entryFee
      );

      if (refundResult.success) {
        // Update match status
        match.matchStatus = 'REFUNDED';
        match.payoutProposalId = refundResult.proposalId;
        match.proposalStatus = 'ACTIVE';
        match.proposalCreatedAt = new Date();
        match.needsSignatures = 2; // 2-of-3 multisig
        await AppDataSource.getRepository(Match).save(match);

        // Log timeout event
        await this.logAuditEvent(auditLogRepository, match.id, 'TIMEOUT_PROPOSAL_CREATED', {
          timeoutReason,
          proposalId: refundResult.proposalId,
          originalStatus: match.matchStatus,
        });

        enhancedLogger.info('✅ Timeout refund proposal created', {
          matchId: match.id,
          timeoutReason,
          proposalId: refundResult.proposalId,
        });
      } else {
        enhancedLogger.error('❌ Failed to create timeout refund proposal', {
          matchId: match.id,
          error: refundResult.error,
        });
      }
    } catch (error) {
      enhancedLogger.error('❌ Error processing timeout match', {
        matchId: match.id,
        error,
      });
    }
  }

  /**
   * Process a match with deposit timeout
   */
  private async processDepositTimeout(
    match: Match,
    auditLogRepository: any
  ): Promise<void> {
    try {
      enhancedLogger.info('⏰ Processing deposit timeout match', {
        matchId: match.id,
        player1Paid: match.player1Paid,
        player2Paid: match.player2Paid,
      });

      // Check if both players have paid
      if (match.player1Paid && match.player2Paid) {
        // Both players paid, but game didn't start - refund both
// @ts-ignore
        const refundResult = await squadsVaultService.proposeTieRefund(
          match.id,
          'GAME_START_TIMEOUT'
        );

        if (refundResult.success) {
          match.matchStatus = 'REFUNDED';
          match.payoutProposalId = refundResult.proposalId;
          match.proposalStatus = 'ACTIVE';
          match.proposalCreatedAt = new Date();
          match.needsSignatures = 2; // 2-of-3 multisig
          await AppDataSource.getRepository(Match).save(match);

          await this.logAuditEvent(auditLogRepository, match.id, 'DEPOSIT_TIMEOUT_PROPOSAL_CREATED', {
            proposalId: refundResult.proposalId,
            reason: 'GAME_START_TIMEOUT',
          });

          enhancedLogger.info('✅ Deposit timeout refund proposal created', {
            matchId: match.id,
            proposalId: refundResult.proposalId,
          });
        }
      } else {
// @ts-ignore
        // One or both players didn't pay - refund those who did
        const refundResult = await squadsVaultService.proposeTieRefund(
          match.id,
          'DEPOSIT_TIMEOUT'
        );

        if (refundResult.success) {
          match.matchStatus = 'REFUNDED';
          match.payoutProposalId = refundResult.proposalId;
          match.proposalStatus = 'ACTIVE';
          match.proposalCreatedAt = new Date();
          match.needsSignatures = 2; // 2-of-3 multisig
          await AppDataSource.getRepository(Match).save(match);

          await this.logAuditEvent(auditLogRepository, match.id, 'DEPOSIT_TIMEOUT_PROPOSAL_CREATED', {
            proposalId: refundResult.proposalId,
            reason: 'DEPOSIT_TIMEOUT',
          });

          enhancedLogger.info('✅ Deposit timeout refund proposal created', {
            matchId: match.id,
            proposalId: refundResult.proposalId,
          });
        }
      }
    } catch (error) {
      enhancedLogger.error('❌ Error processing deposit timeout match', {
        matchId: match.id,
        error,
      });
    }
  }

  /**
   * Log audit event
   */
  private async logAuditEvent(
    auditLogRepository: any,
    matchId: string,
    eventType: string,
    eventData: any
  ): Promise<void> {
    try {
      const auditLog = new MatchAuditLog();
      auditLog.matchId = matchId;
      auditLog.eventType = eventType;
      auditLog.eventData = eventData;
      await auditLogRepository.save(auditLog);
    } catch (error) {
      enhancedLogger.error('❌ Failed to log audit event', {
        matchId,
        eventType,
        error,
      });
    }
  }

  /**
   * Get service status
   */
  getStatus(): { isRunning: boolean; pollInterval: number } {
    return {
      isRunning: this.isRunning,
      pollInterval: this.POLL_INTERVAL,
    };
  }
}

// Export singleton instance
export const timeoutScannerService = new TimeoutScannerService();
