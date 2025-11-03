const { AppDataSource } = require('../db/index');

/**
 * Migration Helper Utility
 * Provides safe database migration functions for the high-impact security updates
 */

// Check if a column exists in the table
const columnExists = async (tableName, columnName) => {
  try {
    const result = await AppDataSource.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = $1 AND column_name = $2
    `, [tableName, columnName]);
    return result.length > 0;
  } catch (error) {
    console.error(`Error checking if column ${columnName} exists:`, error);
    return false;
  }
};

// Safely rename a column if it exists
const safeRenameColumn = async (tableName, oldColumnName, newColumnName) => {
  try {
    const exists = await columnExists(tableName, oldColumnName);
    if (exists) {
      await AppDataSource.query(`
        ALTER TABLE "${tableName}" RENAME COLUMN "${oldColumnName}" TO "${newColumnName}"
      `);
      console.log(`✅ Renamed column ${oldColumnName} to ${newColumnName}`);
      return true;
    } else {
      console.log(`⚠️ Column ${oldColumnName} does not exist, skipping rename`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error renaming column ${oldColumnName}:`, error);
    return false;
  }
};

// Safely add a column if it doesn't exist
const safeAddColumn = async (tableName, columnName, columnDefinition) => {
  try {
    const exists = await columnExists(tableName, columnName);
    if (!exists) {
      await AppDataSource.query(`
        ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}
      `);
      console.log(`✅ Added column ${columnName}`);
      return true;
    } else {
      console.log(`⚠️ Column ${columnName} already exists, skipping`);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error adding column ${columnName}:`, error);
    return false;
  }
};

// Run the high-impact security migration
const runHighImpactSecurityMigration = async () => {
  console.log('🚀 Starting High-Impact Security Migration...');
  
  try {
    // 1. Rename escrow fields to entry fields
    console.log('\n📝 Step 1: Renaming escrow fields to entry fields...');
    await safeRenameColumn('match', 'escrowAddress', 'feeWalletAddress');
    await safeRenameColumn('match', 'player1EscrowConfirmed', 'player1EntryConfirmed');
    await safeRenameColumn('match', 'player2EscrowConfirmed', 'player2EntryConfirmed');
    await safeRenameColumn('match', 'player1EscrowSignature', 'player1EntrySignature');
    await safeRenameColumn('match', 'player2EscrowSignature', 'player2EntrySignature');
    
    // 2. Add blockchain verification fields for entry payments
    console.log('\n🔗 Step 2: Adding blockchain verification fields...');
    await safeAddColumn('match', 'player1EntrySlot', 'INTEGER');
    await safeAddColumn('match', 'player1EntryBlockTime', 'TIMESTAMP');
    await safeAddColumn('match', 'player1EntryFinalized', 'BOOLEAN DEFAULT FALSE');
    await safeAddColumn('match', 'player2EntrySlot', 'INTEGER');
    await safeAddColumn('match', 'player2EntryBlockTime', 'TIMESTAMP');
    await safeAddColumn('match', 'player2EntryFinalized', 'BOOLEAN DEFAULT FALSE');
    
    // 3. Add UTC timestamp fields
    console.log('\n⏰ Step 3: Adding UTC timestamp fields...');
    await safeAddColumn('match', 'gameStartTimeUtc', 'TIMESTAMP');
    await safeAddColumn('match', 'gameEndTime', 'TIMESTAMP');
    await safeAddColumn('match', 'gameEndTimeUtc', 'TIMESTAMP');
    await safeAddColumn('match', 'refundedAtUtc', 'TIMESTAMP');
    
    // 4. Add payout signature fields with blockchain verification
    console.log('\n💰 Step 4: Adding payout verification fields...');
    await safeAddColumn('match', 'winnerPayoutSignature', 'VARCHAR');
    await safeAddColumn('match', 'winnerPayoutSlot', 'INTEGER');
    await safeAddColumn('match', 'winnerPayoutBlockTime', 'TIMESTAMP');
    await safeAddColumn('match', 'winnerPayoutFinalized', 'BOOLEAN DEFAULT FALSE');
    
    // 5. Add refund signature fields with blockchain verification
    console.log('\n🔄 Step 5: Adding refund verification fields...');
    await safeAddColumn('match', 'player1RefundSignature', 'VARCHAR');
    await safeAddColumn('match', 'player1RefundSlot', 'INTEGER');
    await safeAddColumn('match', 'player1RefundBlockTime', 'TIMESTAMP');
    await safeAddColumn('match', 'player1RefundFinalized', 'BOOLEAN DEFAULT FALSE');
    await safeAddColumn('match', 'player2RefundSignature', 'VARCHAR');
    await safeAddColumn('match', 'player2RefundSlot', 'INTEGER');
    await safeAddColumn('match', 'player2RefundBlockTime', 'TIMESTAMP');
    await safeAddColumn('match', 'player2RefundFinalized', 'BOOLEAN DEFAULT FALSE');
    
    // 6. Add financial tracking fields
    console.log('\n💵 Step 6: Adding financial tracking fields...');
    await safeAddColumn('match', 'totalFeesCollected', 'DECIMAL(10,6)');
    await safeAddColumn('match', 'platformFee', 'DECIMAL(10,6)');
    await safeAddColumn('match', 'matchDuration', 'DECIMAL(10,6)');
    
    // 7. Add completion tracking
    console.log('\n✅ Step 7: Adding completion tracking...');
    await safeAddColumn('match', 'isCompleted', 'BOOLEAN DEFAULT FALSE');
    
    // 8. Add integrity hash field
    console.log('\n🔐 Step 8: Adding integrity hash field...');
    await safeAddColumn('match', 'rowHash', 'VARCHAR');
    
    // 9. Update existing data
    console.log('\n📊 Step 9: Updating existing data...');
    await AppDataSource.query(`
      UPDATE "match" SET 
        "player1EntryConfirmed" = COALESCE("player1Paid", FALSE),
        "player2EntryConfirmed" = COALESCE("player2Paid", FALSE),
        "player1EntryFinalized" = TRUE,
        "player2EntryFinalized" = TRUE,
        "gameStartTimeUtc" = "gameStartTime",
        "gameEndTimeUtc" = "updatedAt",
        "refundedAtUtc" = "refundedAt",
        "totalFeesCollected" = COALESCE("entryFee" * 2, 0),
        "platformFee" = COALESCE("entryFee" * 0.1, 0),
        "isCompleted" = CASE WHEN status = 'completed' THEN TRUE ELSE FALSE END
      WHERE "player1EntryConfirmed" IS NULL
    `);
    
    // 10. Create indexes for performance
    console.log('\n⚡ Step 10: Creating performance indexes...');
    await AppDataSource.query('CREATE INDEX IF NOT EXISTS "idx_match_status" ON "match" (status)');
    await AppDataSource.query('CREATE INDEX IF NOT EXISTS "idx_match_created_at" ON "match" ("createdAt")');
    await AppDataSource.query('CREATE INDEX IF NOT EXISTS "idx_match_is_completed" ON "match" ("isCompleted")');
    await AppDataSource.query('CREATE INDEX IF NOT EXISTS "idx_match_player1" ON "match" ("player1")');
    await AppDataSource.query('CREATE INDEX IF NOT EXISTS "idx_match_player2" ON "match" ("player2")');
    
    console.log('\n🎉 High-Impact Security Migration completed successfully!');
    return true;
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return false;
  }
};

// Check migration status
const checkMigrationStatus = async () => {
  console.log('🔍 Checking migration status...');
  
  const requiredColumns = [
    'feeWalletAddress',
    'player1EntrySignature',
    'player2EntrySignature',
    'player1EntrySlot',
    'player1EntryFinalized',
    'gameStartTimeUtc',
    'gameEndTimeUtc',
    'winnerPayoutSignature',
    'winnerPayoutSlot',
    'winnerPayoutFinalized',
    'totalFeesCollected',
    'platformFee',
    'isCompleted',
    'rowHash'
  ];
  
  const results = {};
  
  for (const column of requiredColumns) {
    const exists = await columnExists('match', column);
    results[column] = exists;
    console.log(`${exists ? '✅' : '❌'} ${column}: ${exists ? 'EXISTS' : 'MISSING'}`);
  }
  
  const allExist = Object.values(results).every(exists => exists);
  console.log(`\n${allExist ? '🎉' : '⚠️'} Migration Status: ${allExist ? 'COMPLETE' : 'INCOMPLETE'}`);
  
  return results;
};

module.exports = {
  columnExists,
  safeRenameColumn,
  safeAddColumn,
  runHighImpactSecurityMigration,
  checkMigrationStatus
};
