// Environment configuration
export const config = {
  // Database
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/guess5',
  },
  
  // Solana
  solana: {
    network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    feeWalletAddress: process.env.FEE_WALLET_ADDRESS || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
    feeWalletPrivateKey: process.env.FEE_WALLET_PRIVATE_KEY,
  },
  
  // Smart Contract
  smartContract: {
    programId: process.env.SMART_CONTRACT_PROGRAM_ID || 'ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4',
    resultsAttestorPubkey: process.env.RESULTS_ATTESTOR_PUBKEY || '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt',
    defaultFeeBps: parseInt(process.env.DEFAULT_FEE_BPS || '500'),
    defaultDeadlineBufferSlots: parseInt(process.env.DEFAULT_DEADLINE_BUFFER_SLOTS || '1000'),
  },
  
  // Security
  security: {
    recaptchaSecret: process.env.RECAPTCHA_SECRET,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  
  // Server
  server: {
    port: process.env.PORT || 4000,
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  },
  
  // Memory limits
  limits: {
    maxActiveGames: 1000,
    maxMatchmakingLocks: 500,
    maxInMemoryMatches: 100,
  }
};

// Validation
export const validateConfig = () => {
  const required = [
    'DATABASE_URL',
    'FEE_WALLET_ADDRESS'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // FEE_WALLET_PRIVATE_KEY is optional - we use AWS KMS for signing in multisig architecture
  if (!process.env.FEE_WALLET_PRIVATE_KEY) {
    console.warn('⚠️ FEE_WALLET_PRIVATE_KEY not set - using AWS KMS for automated signing');
  }
  
  // Only require ReCaptcha secret in production
  if (process.env.NODE_ENV === 'production' && !process.env.RECAPTCHA_SECRET) {
    console.warn('⚠️ RECAPTCHA_SECRET not set - ReCaptcha validation will be disabled');
  }
  
  console.log('✅ Environment configuration validated');
  console.log(`🔗 Solana Network: ${process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com'}`);
};

export default config; 