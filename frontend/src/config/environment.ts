// Environment configuration with fallbacks
export const config = {
  API_URL: process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com',
  SOLANA_NETWORK: process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com',
  SMART_CONTRACT_PROGRAM_ID: process.env.NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4',
  RESULTS_ATTESTOR_PUBKEY: process.env.NEXT_PUBLIC_RESULTS_ATTESTOR_PUBKEY || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
  FEE_WALLET_ADDRESS: process.env.NEXT_PUBLIC_FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt'
};

// Debug logging
console.log('🔍 Environment Config:', {
  API_URL: config.API_URL,
  SOLANA_NETWORK: config.SOLANA_NETWORK,
  SMART_CONTRACT_PROGRAM_ID: config.SMART_CONTRACT_PROGRAM_ID,
  RESULTS_ATTESTOR_PUBKEY: config.RESULTS_ATTESTOR_PUBKEY,
  FEE_WALLET_ADDRESS: config.FEE_WALLET_ADDRESS
});

export default config;
