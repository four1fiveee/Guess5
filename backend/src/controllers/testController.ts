import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { autoCreateProposalsForMatch } from '../services/proposalAutoCreateService';
import { enhancedLogger } from '../utils/enhancedLogger';

/**
 * Test endpoint to manually trigger proposal creation
 * POST /api/test/create-proposal/:matchId
 */
export const testCreateProposal = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    enhancedLogger.info('🧪 Test: Manual proposal creation requested', { matchId });
    
    await autoCreateProposalsForMatch(matchId);
    
    // Get updated match state
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    return res.json({
      success: true,
      matchId,
      isCompleted: match.isCompleted,
      winner: match.winner,
      payoutProposalId: (match as any).payoutProposalId,
      tieRefundProposalId: (match as any).tieRefundProposalId,
      vaultAddress: match.squadsVaultAddress,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Test: Failed to create proposal', {
      matchId: req.params.matchId,
      error: errorMessage,
    });
    
    return res.status(500).json({
      error: 'Internal server error',
      details: errorMessage,
    });
  }
};

/**
 * Test endpoint to check match state
 * GET /api/test/match-state/:matchId
 */
export const testMatchState = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    return res.json({
      success: true,
      match: {
        id: match.id,
        isCompleted: match.isCompleted,
        winner: match.winner,
        player1: match.player1,
        player2: match.player2,
        entryFee: match.entryFee,
        vaultAddress: match.squadsVaultAddress,
        payoutProposalId: (match as any).payoutProposalId,
        tieRefundProposalId: (match as any).tieRefundProposalId,
        proposalStatus: (match as any).proposalStatus,
        needsSignatures: (match as any).needsSignatures,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return res.status(500).json({
      error: 'Internal server error',
      details: errorMessage,
    });
  }
};


