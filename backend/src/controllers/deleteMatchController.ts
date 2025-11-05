import { Request, Response } from 'express';
import { AppDataSource } from '../db';
import { Match } from '../models/Match';

/**
 * Delete a match by ID
 * DELETE /api/match/delete/:matchId
 */
export const deleteMatchById = async (req: Request, res: Response) => {
  try {
    const { matchId } = req.params;
    
    console.log('🗑️ Deleting match:', matchId);
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    
    await matchRepository.remove(match);
    
    console.log('✅ Match deleted:', matchId);
    
    return res.json({
      success: true,
      message: 'Match deleted successfully',
      matchId,
    });
    
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Failed to delete match:', errorMessage);
    
    return res.status(500).json({ 
      error: 'Internal server error',
      details: errorMessage 
    });
  }
};


