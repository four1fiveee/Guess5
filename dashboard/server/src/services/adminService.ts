import { query } from '../datasources/postgres';
import { MatchLookup, DeleteMatchResult } from '@guess5-dashboard/shared';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execAsync = promisify(exec);

export async function lookupMatch(matchId: string): Promise<MatchLookup | null> {
  const result = await query<MatchLookup>(
    `
    SELECT 
      id,
      "player1",
      "player2",
      status,
      "entryFee",
      "createdAt",
      "updatedAt"
    FROM "match"
    WHERE id = $1
  `,
    [matchId]
  );

  if (result.rows.length === 0) {
    return null;
  }

  const row = result.rows[0];
  return {
    ...row,
    createdAt: new Date(row.createdAt),
    updatedAt: new Date(row.updatedAt),
  };
}

export async function deleteMatch(matchId: string): Promise<DeleteMatchResult> {
  try {
    // First verify match exists
    const match = await lookupMatch(matchId);
    if (!match) {
      return {
        matchId,
        success: false,
        error: 'Match not found',
      };
    }

    // Use the existing deleteMatch script
    const scriptPath = path.join(__dirname, '../../../backend/scripts/deleteMatch.js');
    const { stdout, stderr } = await execAsync(`node "${scriptPath}" "${matchId}"`, {
      env: process.env,
      cwd: path.join(__dirname, '../../../backend'),
    });

    if (stderr && !stderr.includes('✅')) {
      return {
        matchId,
        success: false,
        error: stderr,
      };
    }

    return {
      matchId,
      success: true,
    };
  } catch (error: any) {
    return {
      matchId,
      success: false,
      error: error.message || String(error),
    };
  }
}

export async function deleteMatches(matchIds: string[]): Promise<DeleteMatchResult[]> {
  const results = await Promise.all(matchIds.map((id) => deleteMatch(id)));
  return results;
}







