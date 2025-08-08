// Environment configuration
export const config = {
  // Database
  database: {
    url: process.env.DATABASE_URL || 'postgresql://localhost:5432/guess5',
  },
  
  // Solana
  solana: {
    network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    feeWalletAddress: process.env.FEE_WALLET_ADDRESS || 'AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A',
    feeWalletPrivateKey: process.env.FEE_WALLET_PRIVATE_KEY,
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
    'FEE_WALLET_ADDRESS',
    'FEE_WALLET_PRIVATE_KEY'
  ];
  
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing);
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Only require ReCaptcha secret in production
  if (process.env.NODE_ENV === 'production' && !process.env.RECAPTCHA_SECRET) {
    console.warn('⚠️ RECAPTCHA_SECRET not set - ReCaptcha validation will be disabled');
  }
  
  console.log('✅ Environment configuration validated');
};

export default config; 