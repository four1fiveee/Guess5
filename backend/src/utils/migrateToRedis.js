const fs = require('fs');
const path = require('path');

// Migration script to replace in-memory storage with Redis
const migrateToRedis = () => {
  // Use path.resolve with __dirname to ensure we get a relative path from the script location
  // Never use absolute paths - always use relative paths from __dirname
  const matchControllerPath = path.resolve(__dirname, '../controllers/matchController.ts');
  
  // Safety check: ensure the path is within the project (relative to backend root)
  const backendRoot = path.resolve(__dirname, '../..');
  const normalizedPath = path.normalize(matchControllerPath);
  if (!normalizedPath.startsWith(backendRoot)) {
    throw new Error(`Invalid path: ${matchControllerPath} is outside project root`);
  }
  let content = fs.readFileSync(matchControllerPath, 'utf8');

  console.log('🔄 Starting migration to Redis...');

  // Replace activeGames.get() calls
  content = content.replace(
    /const serverGameState = activeGames\.get\(([^)]+)\);/g,
    'const serverGameState = await getGameState($1);'
  );

  // Replace activeGames.set() calls
  content = content.replace(
    /activeGames\.set\(([^,]+),\s*(\{[^}]+\})\);/g,
    'await setGameState($1, $2);'
  );

  // Replace activeGames.delete() calls
  content = content.replace(
    /activeGames\.delete\(([^)]+)\);/g,
    'await deleteGameState($1);'
  );

  // Replace matchmakingLocks.get() calls
  content = content.replace(
    /matchmakingLocks\.get\(([^)]+)\)/g,
    'await getMatchmakingLock($1)'
  );

  // Replace matchmakingLocks.set() calls
  content = content.replace(
    /matchmakingLocks\.set\(([^,]+),\s*(\{[^}]+\})\);/g,
    'await setMatchmakingLock($1, $2);'
  );

  // Replace matchmakingLocks.delete() calls
  content = content.replace(
    /matchmakingLocks\.delete\(([^)]+)\);/g,
    'await deleteMatchmakingLock($1);'
  );

  // Replace matchmakingLocks.has() calls
  content = content.replace(
    /matchmakingLocks\.has\(([^)]+)\)/g,
    '(await getMatchmakingLock($1)) !== null'
  );

  // Add async to functions that use await
  content = content.replace(
    /const cleanupInactiveGames = \(\) => {/g,
    'const cleanupInactiveGames = async () => {'
  );

  content = content.replace(
    /const markGameCompleted = \(matchId: string\) => {/g,
    'const markGameCompleted = async (matchId: string) => {'
  );

  // Update console.log messages
  content = content.replace(
    /from memory/g,
    'from Redis'
  );

  content = content.replace(
    /in memory/g,
    'in Redis'
  );

  // Write the migrated content back
  fs.writeFileSync(matchControllerPath, content);
  console.log('✅ Migration to Redis completed!');
};

// Run the migration
migrateToRedis();
