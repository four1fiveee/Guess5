#!/usr/bin/env node
/**
 * Clear all match data from the database (keeps table structure).
 * 
 * WARNING: This will delete ALL match records. Use with caution.
 * 
 * Usage: node clear-all-matches.js [--confirm]
 */

const { AppDataSource } = require('../src/db');
const { Match } = require('../src/models/Match');

async function clearAllMatches(confirm = false) {
  if (!confirm) {
    console.error('❌ This will delete ALL match records!');
    console.error('   Run with --confirm to proceed');
    process.exit(1);
  }

  try {
    await AppDataSource.initialize();
    const matchRepository = AppDataSource.getRepository(Match);

    // Count matches first
    const countResult = await matchRepository.query(`
      SELECT COUNT(*) as count FROM "match"
    `);
    const totalMatches = parseInt(countResult[0].count, 10);

    console.log(`\n📊 Found ${totalMatches} matches in database`);

    if (totalMatches === 0) {
      console.log('✅ No matches to delete');
      return;
    }

    // Delete all matches
    console.log('\n🗑️  Deleting all matches...');
    const deleteResult = await matchRepository.query(`
      DELETE FROM "match"
    `);

    // Verify deletion
    const verifyResult = await matchRepository.query(`
      SELECT COUNT(*) as count FROM "match"
    `);
    const remainingMatches = parseInt(verifyResult[0].count, 10);

    if (remainingMatches === 0) {
      console.log(`✅ Successfully deleted ${totalMatches} matches`);
      console.log('   Database is now empty (table structure preserved)');
    } else {
      console.error(`⚠️  Warning: Expected 0 matches, but found ${remainingMatches}`);
    }

  } catch (error) {
    console.error('❌ Error clearing matches:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

const args = process.argv.slice(2);
const confirm = args.includes('--confirm');

clearAllMatches(confirm).then(() => {
  console.log('\n✅ Cleanup complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

