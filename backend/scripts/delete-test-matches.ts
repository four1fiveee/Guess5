// @ts-nocheck
/**
 * Delete Test Matches Script
 * 
 * Deletes specific test matches from the database.
 * 
 * Usage:
 *   ts-node scripts/delete-test-matches.ts
 */

import 'reflect-metadata';
import { AppDataSource } from '../src/db';

const MATCH_IDS_TO_DELETE = [
  '51336c2c-1d72-42f6-bb66-808de91a03b4',
  '402b4cba-5c2f-4e91-bae6-75a11028c86d',
  'bd49fc83-0ebd-451d-8cb7-2d9215fdcffc',
  '5b99892a-6b2d-4523-a1f6-a13caa548c61',
  'a3fd6e93-fad9-47e9-8f3a-df676b4c422f',
  '7df4872a-908b-4d4d-9369-c70181385307'
];

async function main() {
  try {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connection initialized');
    }

    const matchRepository = AppDataSource.getRepository('Match');
    
    console.log('🗑️ Deleting test matches...', {
      count: MATCH_IDS_TO_DELETE.length,
      matchIds: MATCH_IDS_TO_DELETE,
    });

    let deletedCount = 0;
    for (const matchId of MATCH_IDS_TO_DELETE) {
      try {
        const result = await matchRepository.delete({ id: matchId });
        if (result.affected && result.affected > 0) {
          deletedCount++;
          console.log(`✅ Deleted match: ${matchId}`);
        } else {
          console.log(`⚠️ Match not found: ${matchId}`);
        }
      } catch (error: any) {
        console.error(`❌ Error deleting match ${matchId}:`, error?.message);
      }
    }

    console.log('✅ Deletion complete!', {
      total: MATCH_IDS_TO_DELETE.length,
      deleted: deletedCount,
      failed: MATCH_IDS_TO_DELETE.length - deletedCount,
    });

    // Close database connection
    await AppDataSource.destroy();
    console.log('✅ Database connection closed');
    
  } catch (error: any) {
    console.error('❌ Error deleting matches:', {
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  }
}

main();

