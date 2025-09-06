const { AppDataSource } = require('../db/index');

/**
 * Add Smart Contract Fields to Match Table
 * This script adds the missing smart contract fields that are causing the 500 errors
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

// Safely add a column if it doesn't exist
const safeAddColumn = async (tableName, columnName, columnDefinition) => {
  try {
    const exists = await columnExists(tableName, columnName);
    if (exists) {
      console.log(`✅ Column ${columnName} already exists`);
      return true;
    }
    
    await AppDataSource.query(`ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${columnDefinition}`);
    console.log(`✅ Added column ${columnName}`);
    return true;
  } catch (error) {
    console.error(`❌ Error adding column ${columnName}:`, error);
    return false;
  }
};

// Add smart contract fields
const addSmartContractFields = async () => {
  console.log('🚀 Adding smart contract fields to Match table...');
  
  try {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
    }
    
    // Add smart contract fields
    await safeAddColumn('match', 'matchPda', 'VARCHAR');
    await safeAddColumn('match', 'vaultPda', 'VARCHAR');
    await safeAddColumn('match', 'resultsAttestor', 'VARCHAR');
    await safeAddColumn('match', 'deadlineSlot', 'BIGINT');
    await safeAddColumn('match', 'feeBps', 'INTEGER');
    await safeAddColumn('match', 'smartContractStatus', 'VARCHAR');
    
    console.log('🎉 Smart contract fields added successfully!');
    
  } catch (error) {
    console.error('❌ Error adding smart contract fields:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
};

// Run the script
if (require.main === module) {
  addSmartContractFields();
}

module.exports = { addSmartContractFields };
