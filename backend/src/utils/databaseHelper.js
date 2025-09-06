const { AppDataSource } = require('../db/index');

/**
 * Database Helper Utility
 * Provides safe database operations that work with both old and new field names
 * during the transition from escrow to no-escrow flow
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

// Get the appropriate field name based on what exists in the database
const getFieldName = async (tableName, newFieldName, oldFieldName) => {
  const newExists = await columnExists(tableName, newFieldName);
  const oldExists = await columnExists(tableName, oldFieldName);
  
  if (newExists) {
    return newFieldName;
  } else if (oldExists) {
    return oldFieldName;
  } else {
    return null; // Neither field exists
  }
};

// Safely update a match with payment data using appropriate field names
const updateMatchPayment = async (match, isPlayer1, paymentData) => {
  const {
    paymentSignature,
    slot,
    blockTime,
    finalized = true,
    // Smart contract fields
    matchPda,
    vaultPda,
    matchId,
    smartContractVerified,
    verificationDetails
  } = paymentData;
  
  try {
    // Check which field names exist in the database
    const player1PaidField = await getFieldName('match', 'player1Paid', 'player1Paid');
    const player2PaidField = await getFieldName('match', 'player2Paid', 'player2Paid');
    const player1PaymentSigField = await getFieldName('match', 'player1PaymentSignature', 'player1PaymentSignature');
    const player2PaymentSigField = await getFieldName('match', 'player2PaymentSignature', 'player2PaymentSignature');
    const player1EntrySigField = await getFieldName('match', 'player1EntrySignature', 'player1EscrowSignature');
    const player2EntrySigField = await getFieldName('match', 'player2EntrySignature', 'player2EscrowSignature');
    const player1EntryConfirmedField = await getFieldName('match', 'player1EntryConfirmed', 'player1EscrowConfirmed');
    const player2EntryConfirmedField = await getFieldName('match', 'player2EntryConfirmed', 'player2EscrowConfirmed');
    const player1EntrySlotField = await getFieldName('match', 'player1EntrySlot', null);
    const player2EntrySlotField = await getFieldName('match', 'player2EntrySlot', null);
    const player1EntryBlockTimeField = await getFieldName('match', 'player1EntryBlockTime', null);
    const player2EntryBlockTimeField = await getFieldName('match', 'player2EntryBlockTime', null);
    const player1EntryFinalizedField = await getFieldName('match', 'player1EntryFinalized', null);
    const player2EntryFinalizedField = await getFieldName('match', 'player2EntryFinalized', null);
    
    if (isPlayer1) {
      if (player1PaidField) match[player1PaidField] = true;
      if (player1PaymentSigField) match[player1PaymentSigField] = paymentSignature;
      if (player1EntrySigField) match[player1EntrySigField] = paymentSignature;
      if (player1EntryConfirmedField) match[player1EntryConfirmedField] = true;
      if (player1EntrySlotField && slot) match[player1EntrySlotField] = slot;
      if (player1EntryBlockTimeField && blockTime) match[player1EntryBlockTimeField] = new Date(blockTime * 1000);
      if (player1EntryFinalizedField) match[player1EntryFinalizedField] = finalized;
    } else {
      if (player2PaidField) match[player2PaidField] = true;
      if (player2PaymentSigField) match[player2PaymentSigField] = paymentSignature;
      if (player2EntrySigField) match[player2EntrySigField] = paymentSignature;
      if (player2EntryConfirmedField) match[player2EntryConfirmedField] = true;
      if (player2EntrySlotField && slot) match[player2EntrySlotField] = slot;
      if (player2EntryBlockTimeField && blockTime) match[player2EntryBlockTimeField] = new Date(blockTime * 1000);
      if (player2EntryFinalizedField) match[player2EntryFinalizedField] = finalized;
    }
    
    // Update smart contract fields if present
    if (matchPda) {
      const matchPdaField = await getFieldName('match', 'matchPda', null);
      if (matchPdaField) match[matchPdaField] = matchPda;
    }
    
    if (vaultPda) {
      const vaultPdaField = await getFieldName('match', 'vaultPda', null);
      if (vaultPdaField) match[vaultPdaField] = vaultPda;
    }
    
    if (matchId) {
      const matchIdField = await getFieldName('match', 'matchId', null);
      if (matchIdField) match[matchIdField] = matchId;
    }
    
    if (smartContractVerified !== undefined) {
      const smartContractStatusField = await getFieldName('match', 'smartContractStatus', null);
      if (smartContractStatusField) {
        match[smartContractStatusField] = smartContractVerified ? 'verified' : 'unverified';
      }
    }
    
    return true;
  } catch (error) {
    console.error('Error updating match payment:', error);
    return false;
  }
};

// Safely update match with game start data
const updateMatchGameStart = async (match, gameData) => {
  try {
    const {
      word,
      gameStartTime = new Date(),
      feeWalletAddress = process.env.FEE_WALLET_ADDRESS,
      entryFee
    } = gameData;
    
    // Check which field names exist
    const wordField = await getFieldName('match', 'word', 'word');
    const gameStartTimeField = await getFieldName('match', 'gameStartTime', 'gameStartTime');
    const gameStartTimeUtcField = await getFieldName('match', 'gameStartTimeUtc', null);
    const feeWalletField = await getFieldName('match', 'feeWalletAddress', 'escrowAddress');
    const totalFeesField = await getFieldName('match', 'totalFeesCollected', null);
    const platformFeeField = await getFieldName('match', 'platformFee', null);
    
    if (wordField) match[wordField] = word;
    if (gameStartTimeField) match[gameStartTimeField] = gameStartTime;
    if (gameStartTimeUtcField) match[gameStartTimeUtcField] = gameStartTime;
    if (feeWalletField) match[feeWalletField] = feeWalletAddress;
    if (totalFeesField && entryFee) match[totalFeesField] = entryFee * 2;
    if (platformFeeField && entryFee) match[platformFeeField] = entryFee * 0.1;
    
    return true;
  } catch (error) {
    console.error('Error updating match game start:', error);
    return false;
  }
};

// Get match data with appropriate field names
const getMatchData = async (match) => {
  try {
    const feeWalletField = await getFieldName('match', 'feeWalletAddress', 'escrowAddress');
    const player1EntrySigField = await getFieldName('match', 'player1EntrySignature', 'player1EscrowSignature');
    const player2EntrySigField = await getFieldName('match', 'player2EntrySignature', 'player2EscrowSignature');
    const player1EntryConfirmedField = await getFieldName('match', 'player1EntryConfirmed', 'player1EscrowConfirmed');
    const player2EntryConfirmedField = await getFieldName('match', 'player2EntryConfirmed', 'player2EscrowConfirmed');
    
    return {
      ...match,
      feeWalletAddress: match[feeWalletField] || match.escrowAddress,
      player1EntrySignature: match[player1EntrySigField] || match.player1EscrowSignature,
      player2EntrySignature: match[player2EntrySigField] || match.player2EscrowSignature,
      player1EntryConfirmed: match[player1EntryConfirmedField] || match.player1EscrowConfirmed,
      player2EntryConfirmed: match[player2EntryConfirmedField] || match.player2EscrowConfirmed,
    };
  } catch (error) {
    console.error('Error getting match data:', error);
    return match;
  }
};

module.exports = {
  columnExists,
  getFieldName,
  updateMatchPayment,
  updateMatchGameStart,
  getMatchData
};
