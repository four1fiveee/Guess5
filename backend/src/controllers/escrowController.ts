import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';
import {
  initializeMatchEscrow,
  createDepositTransaction,
  submitResult,
  settleMatch,
  refundSinglePlayer,
  getEscrowState,
  deriveEscrowPDA,
} from '../services/escrowService';
import { createSignedResult } from '../utils/escrowSigning';

/**
 * Escrow controller for handling escrow-based match operations
 * Replaces Squads multisig vault system
 */

/**
 * Initialize escrow for a new match
 * POST /api/escrow/initialize
 */
export const initializeEscrow = async (req: Request, res: Response) => {
  try {
    const { matchId, playerA, playerB, entryFee } = req.body;

    if (!matchId || !playerA || !playerB || !entryFee) {
      return res.status(400).json({
        error: 'Missing required fields: matchId, playerA, playerB, entryFee',
      });
    }

    const result = await initializeMatchEscrow(matchId, playerA, playerB, entryFee);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      escrowAddress: result.escrowAddress,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error initializing escrow:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Get deposit transaction for a player
 * POST /api/escrow/deposit-transaction
 */
export const getDepositTransaction = async (req: Request, res: Response) => {
  try {
    const { matchId, playerPubkey, entryFee } = req.body;

    if (!matchId || !playerPubkey || !entryFee) {
      return res.status(400).json({
        error: 'Missing required fields: matchId, playerPubkey, entryFee',
      });
    }

    const result = await createDepositTransaction(matchId, playerPubkey, entryFee);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Serialize transaction for frontend
    const serialized = result.transaction!.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    res.json({
      success: true,
      transaction: Buffer.from(serialized).toString('base64'),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error creating deposit transaction:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Submit game result (called by player to approve result)
 * POST /api/escrow/submit-result
 */
export const submitGameResult = async (req: Request, res: Response) => {
  try {
    const { matchId, playerPubkey, winner, resultType } = req.body;

    if (!matchId || !playerPubkey || !resultType) {
      return res.status(400).json({
        error: 'Missing required fields: matchId, playerPubkey, resultType',
      });
    }

    const result = await submitResult(matchId, playerPubkey, winner, resultType);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    // Serialize transaction for frontend
    const serialized = result.transaction!.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    // Update match in database
    const matchRepository = AppDataSource.getRepository(Match);
    await matchRepository.update(
      { id: matchId },
      {
        escrowResultSubmittedAt: new Date(),
        escrowResultSubmittedBy: playerPubkey,
      }
    );

    res.json({
      success: true,
      transaction: Buffer.from(serialized).toString('base64'),
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error submitting result:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Settle a match (can be called by backend or player)
 * POST /api/escrow/settle
 */
export const settleEscrow = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.body;

    if (!matchId) {
      return res.status(400).json({ error: 'Missing required field: matchId' });
    }

    const result = await settleMatch(matchId);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      signature: result.signature,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error settling escrow:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Get escrow state
 * GET /api/escrow/state/:matchId
 */
export const getEscrowStateHandler = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ error: 'Missing required field: matchId' });
    }

    const result = await getEscrowState(matchId);

    if (!result.success) {
      return res.status(500).json({ error: result.error });
    }

    res.json({
      success: true,
      state: result.state,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting escrow state:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
};

/**
 * Get signed result for a match (for frontend to display)
 * GET /api/escrow/signed-result/:matchId
 */
export const getSignedResult = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;

    if (!matchId) {
      return res.status(400).json({ error: 'Missing required field: matchId' });
    }

    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }

    // Determine winner and result type from match data
    let winner: string | null = null;
    let resultType: 'Win' | 'DrawFullRefund' | 'DrawPartialRefund' = 'DrawFullRefund';

    if (match.winner) {
      winner = match.winner;
      resultType = 'Win';
    } else {
      // Check if it's a tie (both lost) or draw (same time/moves)
      const player1Result = match.getPlayer1Result();
      const player2Result = match.getPlayer2Result();

      if (player1Result && player2Result) {
        if (!player1Result.won && !player2Result.won) {
          // Both lost - partial refund
          resultType = 'DrawPartialRefund';
        } else if (
          player1Result.won &&
          player2Result.won &&
          player1Result.numGuesses === player2Result.numGuesses &&
          Math.abs(player1Result.totalTime - player2Result.totalTime) < 1000
        ) {
          // Same time/moves - full refund
          resultType = 'DrawFullRefund';
        }
      }
    }

    const signedResult = await createSignedResult(matchId, winner, resultType);

    res.json({
      success: true,
      payload: signedResult.payload,
      signature: signedResult.signatureBase58,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Error getting signed result:', errorMessage);
    res.status(500).json({ error: errorMessage });
  }
};

