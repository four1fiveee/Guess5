import { PublicKey } from '@solana/web3.js';

// Smart contract configuration
export const SMART_CONTRACT_CONFIG = {
  // Program ID for the deployed smart contract
  PROGRAM_ID: process.env.SMART_CONTRACT_PROGRAM_ID || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4',
  
  // Results attestor public key (who can settle matches)
  RESULTS_ATTESTOR_PUBKEY: process.env.RESULTS_ATTESTOR_PUBKEY || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
  
  // Default fee in basis points (500 = 5%)
  DEFAULT_FEE_BPS: parseInt(process.env.DEFAULT_FEE_BPS || '500'),
  
  // Default deadline buffer in slots (1000 slots ≈ 5-10 minutes)
  DEFAULT_DEADLINE_BUFFER_SLOTS: parseInt(process.env.DEFAULT_DEADLINE_BUFFER_SLOTS || '1000'),
  
  // Minimum stake amount in lamports (0.001 SOL)
  MIN_STAKE_LAMPORTS: parseInt(process.env.MIN_STAKE_LAMPORTS || '1000000'),
  
  // Maximum fee in basis points (1000 = 10%)
  MAX_FEE_BPS: parseInt(process.env.MAX_FEE_BPS || '1000'),
};

// Validate smart contract configuration
export const validateSmartContractConfig = () => {
  if (!process.env.SMART_CONTRACT_PROGRAM_ID) {
    console.warn('⚠️ SMART_CONTRACT_PROGRAM_ID not set, using default program ID');
  }
  
  if (!process.env.RESULTS_ATTESTOR_PUBKEY) {
    console.warn('⚠️ RESULTS_ATTESTOR_PUBKEY not set - match settlement will be disabled');
  } else {
    console.log('✅ Results attestor configured - match settlement enabled');
  }
  
  if (SMART_CONTRACT_CONFIG.DEFAULT_FEE_BPS > SMART_CONTRACT_CONFIG.MAX_FEE_BPS) {
    throw new Error('Default fee BPS cannot exceed maximum fee BPS');
  }
  
  console.log('✅ Smart contract configuration validated');
  console.log(`🔗 Program ID: ${SMART_CONTRACT_CONFIG.PROGRAM_ID}`);
  console.log(`💰 Default Fee: ${SMART_CONTRACT_CONFIG.DEFAULT_FEE_BPS} basis points (${SMART_CONTRACT_CONFIG.DEFAULT_FEE_BPS / 100}%)`);
  console.log(`⏰ Deadline Buffer: ${SMART_CONTRACT_CONFIG.DEFAULT_DEADLINE_BUFFER_SLOTS} slots`);
};

// Get program ID as PublicKey
export const getProgramId = (): PublicKey => {
  return new PublicKey(SMART_CONTRACT_CONFIG.PROGRAM_ID);
};

// Get results attestor as PublicKey
export const getResultsAttestorPubkey = (): PublicKey | null => {
  if (!SMART_CONTRACT_CONFIG.RESULTS_ATTESTOR_PUBKEY) {
    return null;
  }
  return new PublicKey(SMART_CONTRACT_CONFIG.RESULTS_ATTESTOR_PUBKEY);
};

// Validate fee basis points
export const validateFeeBps = (feeBps: number): boolean => {
  return feeBps >= 0 && feeBps <= SMART_CONTRACT_CONFIG.MAX_FEE_BPS;
};

// Convert SOL to lamports
export const solToLamports = (sol: number): number => {
  return Math.floor(sol * 1_000_000_000);
};

// Convert lamports to SOL
export const lamportsToSol = (lamports: number): number => {
  return lamports / 1_000_000_000;
};

// Calculate fee amount in lamports
export const calculateFeeAmount = (totalPotLamports: number, feeBps: number): number => {
  return Math.floor((totalPotLamports * feeBps) / 10000);
};

// Calculate winner amount in lamports
export const calculateWinnerAmount = (totalPotLamports: number, feeBps: number): number => {
  const feeAmount = calculateFeeAmount(totalPotLamports, feeBps);
  return totalPotLamports - feeAmount;
};


















