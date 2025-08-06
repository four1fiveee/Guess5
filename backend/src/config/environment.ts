// Environment configuration for Guess5 backend
export const config = {
  // Database configuration
  database: {
    url: process.env.DATABASE_URL!,
    ssl: process.env.NODE_ENV === 'production',
    logging: process.env.NODE_ENV === 'development',
  },
  
  // Solana configuration
  solana: {
    network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    programId: process.env.PROGRAM_ID || 'GMvV52s55SziXuMd6uPZSswfvhu2hSXRyqk7KkQh5u3L',
    feeWallet: process.env.FEE_WALLET_ADDRESS || 'AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A',
  },
  
  // Application configuration
  app: {
    port: parseInt(process.env.PORT || '4000'),
    environment: process.env.NODE_ENV || 'development',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    logLevel: process.env.LOG_LEVEL || 'info',
  },
  
  // Game configuration
  game: {
    maxGuesses: 7,
    timeLimit: 120000, // 2 minutes in milliseconds
    inactivityTimeout: 300000, // 5 minutes in milliseconds
    wordLength: 5,
  },
  
  // Matchmaking configuration
  matchmaking: {
    tolerance: 0.001, // Allow 0.001 SOL difference for matching
    cleanupInterval: 60000, // 1 minute cleanup interval
    maxWaitingTime: 300000, // 5 minutes max waiting time
  }
};

// Validate all required environment variables
export const validateEnvironment = () => {
  const required = ['DATABASE_URL'];
  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
  
  // Validate optional environment variables
  const warnings = [];
  
  if (!process.env.SOLANA_NETWORK) {
    warnings.push('SOLANA_NETWORK not set, using default devnet');
  }
  
  if (!process.env.PROGRAM_ID) {
    warnings.push('PROGRAM_ID not set, using default program ID');
  }
  
  if (!process.env.FEE_WALLET_ADDRESS) {
    warnings.push('FEE_WALLET_ADDRESS not set, using default fee wallet');
  }
  
  if (!process.env.FRONTEND_URL) {
    warnings.push('FRONTEND_URL not set, using default localhost');
  }
  
  if (warnings.length > 0) {
    console.warn('⚠️ Environment warnings:', warnings);
  }
  
  console.log('✅ Environment validation completed');
  console.log(`🌍 Environment: ${config.app.environment}`);
  console.log(`🔗 Solana Network: ${config.solana.network}`);
  console.log(`📦 Program ID: ${config.solana.programId}`);
  console.log(`💰 Fee Wallet: ${config.solana.feeWallet}`);
  console.log(`🌐 Frontend URL: ${config.app.frontendUrl}`);
  console.log(`🎮 Game Port: ${config.app.port}`);
};

// Export configuration for use in other modules
export default config; 