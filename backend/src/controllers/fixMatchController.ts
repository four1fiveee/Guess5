import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { SquadsVaultService } from '../services/squadsVaultService';
import { PublicKey } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';

/**
 * Fix stuck tie matches by retroactively creating Squads proposals
 * POST /api/match/fix-tie-proposal/:matchId
 */
async function fixTieProposal(req: Request, res: Response) {
  try {
    const { matchId } = req.params;
    
    enhancedLogger.info('=ƒöº Fix tie proposal requested', { matchId });
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    // Check if match is a tie
    if (match.winner !== 'tie') {
      return res.status(400).json({ 
        error: 'Match is not a tie',
        winner: match.winner 
      });
    }
    
    // Check if match is completed
    if (!match.isCompleted) {
      return res.status(400).json({ 
        error: 'Match is not completed yet' 
      });
    }
    
    // Get payout result
    const payoutResult = match.getPayoutResult();
    if (!payoutResult || payoutResult.winner !== 'tie') {
      return res.status(400).json({ 
        error: 'Invalid payout result for tie match' 
      });
    }
    
    // Check if proposal already exists
    if ((match as any).tieRefundProposalId) {
      return res.status(400).json({ 
        error: 'Proposal already exists',
        proposalId: (match as any).tieRefundProposalId 
      });
    }
    
    // Check if vault exists
    if (!match.squadsVaultAddress) {
      return res.status(400).json({ 
        error: 'Squads vault not found for this match' 
      });
    }
    
    // Determine if this is a losing tie (both failed)
    const player1Result = match.getPlayer1Result();
    const player2Result = match.getPlayer2Result();
    const isLosingTie = !player1Result?.won && !player2Result?.won;
    
    if (!isLosingTie) {
      return res.status(400).json({ 
        error: 'This endpoint only fixes losing ties. Winning ties are handled differently.' 
      });
    }
    
    // Calculate refund amount (95% of entry fee)
    const entryFee = match.entryFee;
    const refundAmount = entryFee * 0.95;
    
    enhancedLogger.info('=ƒöä Creating tie refund proposal', {
      matchId,
      vaultAddress: match.squadsVaultAddress,
      player1: match.player1,
      player2: match.player2,
      refundAmount,
    });
    
    // Create Squads proposal
    const squadsService = new SquadsVaultService();
    const proposalResult = await squadsService.proposeTieRefund(
      match.squadsVaultAddress,
      new PublicKey(match.player1),
      new PublicKey(match.player2),
      refundAmount
    );
    
    if (!proposalResult.success || !proposalResult.proposalId) {
      return res.status(500).json({ 
        error: 'Failed to create proposal',
        details: proposalResult.error 
      });
    }
    
    // Save proposal ID to match
    (match as any).tieRefundProposalId = proposalResult.proposalId;
    await matchRepository.save(match);
    
    enhancedLogger.info('G£à Tie refund proposal created and saved', {
      matchId,
      proposalId: proposalResult.proposalId,
    });
    
    return res.json({
      success: true,
      message: 'Tie refund proposal created successfully',
      proposalId: proposalResult.proposalId,
      needsSignatures: proposalResult.needsSignatures || 2,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('G¥î Failed to fix tie proposal', {
      matchId: req.params.matchId,
      error: errorMessage,
    });
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

// Export for CommonJS compatibility
module.exports = {
  fixTieProposal,
};


