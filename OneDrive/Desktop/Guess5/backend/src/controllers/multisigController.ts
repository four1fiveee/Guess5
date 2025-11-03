import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import { SquadsVaultService } from '../services/squadsVaultService';
import { PublicKey } from '@solana/web3.js';
import { enhancedLogger } from '../utils/enhancedLogger';

/**
 * Approve a Squads proposal with a player's signature
 * POST /api/multisig/proposals/:matchId/approve
 * Body: { wallet: string, proposalId: string, signedTransaction?: string }
 * 
 * For frontend: Frontend gets transaction from Squads, user signs with Phantom,
 * then sends signed transaction here, or we can provide transaction for them to sign
 */
export const approveProposal = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    const { wallet, proposalId, signedTransaction } = req.body;
    
    if (!wallet || !proposalId) {
      return res.status(400).json({ error: 'Missing wallet or proposalId' });
    }
    
    enhancedLogger.info('📝 Player approval request', {
      matchId,
      wallet,
      proposalId,
    });
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    // Verify wallet is part of this match
    if (wallet !== match.player1 && wallet !== match.player2) {
      return res.status(403).json({ error: 'Wallet not part of this match' });
    }
    
    if (!match.squadsVaultAddress) {
      return res.status(400).json({ error: 'Match has no Squads vault' });
    }
    
    // For now, return instructions for frontend to sign
    // Frontend will use @sqds/multisig SDK to create and sign the approval
    // We can also provide a transaction builder endpoint
    
    return res.json({
      success: true,
      message: 'Use Phantom wallet to sign the Squads proposal',
      instructions: {
        vaultAddress: match.squadsVaultAddress,
        proposalId,
        playerWallet: wallet,
        action: 'approve',
        // Frontend should use Squads SDK: rpc.vaultTransactionApprove()
      },
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Failed to process approval request', {
      matchId: req.params.matchId,
      error: errorMessage,
    });
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

/**
 * Get proposal details for frontend
 * GET /api/multisig/proposals/:matchId
 */
export const getProposal = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    if (!match.squadsVaultAddress) {
      return res.status(400).json({ error: 'Match has no Squads vault' });
    }
    
    const payoutResult = match.getPayoutResult();
    const proposalId = (match as any).payoutProposalId || (match as any).tieRefundProposalId;
    
    if (!proposalId) {
      return res.status(404).json({ error: 'No proposal found for this match' });
    }
    
    // Get proposal status
    const squadsService = new SquadsVaultService();
    const status = await squadsService.checkProposalStatus(
      match.squadsVaultAddress,
      proposalId
    );
    
    return res.json({
      success: true,
      proposal: {
        matchId: match.id,
        vaultAddress: match.squadsVaultAddress,
        proposalId,
        executed: status.executed,
        signers: status.signers.map(s => s.toString()),
        needsSignatures: status.needsSignatures,
        winner: match.winner,
        player1: match.player1,
        player2: match.player2,
      },
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Failed to get proposal', {
      matchId: req.params.matchId,
      error: errorMessage,
    });
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};

/**
 * Clean up old stuck matches (older than 12 hours, completed but no proposal)
 * POST /api/multisig/cleanup-stuck-matches
 */
export const cleanupStuckMatches = async (req: Request, res: Response) => {
  try {
    enhancedLogger.info('🧹 Starting stuck matches cleanup');
    
    const matchRepository = AppDataSource.getRepository(Match);
    const twelveHoursAgo = new Date(Date.now() - 12 * 60 * 60 * 1000);
    
    // Find matches that are:
    // - Completed
    // - Older than 12 hours
    // - Missing proposal IDs
    const stuckMatches = await matchRepository
      .createQueryBuilder('match')
      .where('match.isCompleted = :completed', { completed: true })
      .andWhere('match.createdAt < :twelveHoursAgo', { twelveHoursAgo })
      .andWhere('(match.payoutProposalId IS NULL OR match.payoutProposalId = \'\')')
      .andWhere('(match.tieRefundProposalId IS NULL OR match.tieRefundProposalId = \'\')')
      .getMany();
    
    enhancedLogger.info('🔍 Found stuck matches', { count: stuckMatches.length });
    
    const deleted = [];
    for (const match of stuckMatches) {
      try {
        await matchRepository.remove(match);
        deleted.push(match.id);
        enhancedLogger.info('🗑️ Deleted stuck match', { matchId: match.id });
      } catch (error) {
        enhancedLogger.error('❌ Failed to delete match', {
          matchId: match.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    
    return res.json({
      success: true,
      deletedCount: deleted.length,
      deletedMatches: deleted,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    enhancedLogger.error('❌ Failed to cleanup stuck matches', {
      error: errorMessage,
    });
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};
