import { Connection, Commitment } from '@solana/web3.js';

/**
 * Get Solana RPC endpoint URL
 * Supports Helius RPC (preferred) or fallback to standard endpoints
 */
export const getSolanaRpcUrl = (): string => {
  const heliusApiKey = process.env.HELIUS_API_KEY;
  const solanaNetwork = process.env.SOLANA_NETWORK || 'devnet';
  
  // If Helius API key is provided, use Helius RPC
  if (heliusApiKey) {
    const network = solanaNetwork.includes('mainnet') ? 'mainnet' : 'devnet';
    const heliusUrl = `https://${network}.helius-rpc.com/?api-key=${heliusApiKey}`;
    console.log(`✅ Using Helius RPC (${network})`);
    return heliusUrl;
  }
  
  // Fallback to standard Solana RPC endpoints
  const standardEndpoints: Record<string, string> = {
    'devnet': 'https://api.devnet.solana.com',
    'mainnet': 'https://api.mainnet-beta.solana.com',
    'mainnet-beta': 'https://api.mainnet-beta.solana.com',
    'testnet': 'https://api.testnet.solana.com',
  };
  
  const endpoint = standardEndpoints[solanaNetwork] || standardEndpoints['devnet'];
  console.log(`⚠️ Using standard Solana RPC (${solanaNetwork}) - Consider setting HELIUS_API_KEY for better performance`);
  return endpoint;
};

/**
 * Create a Solana Connection instance
 * Uses Helius RPC if API key is configured, otherwise falls back to standard endpoints
 */
export const createSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  const rpcUrl = getSolanaRpcUrl();
  return new Connection(rpcUrl, commitment);
};

/**
 * Get the default Solana connection (singleton pattern for reuse)
 */
let defaultConnection: Connection | null = null;

export const getSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  if (!defaultConnection) {
    defaultConnection = createSolanaConnection(commitment);
  }
  return defaultConnection;
};

/**
 * Reset the default connection (useful for testing or reconfiguration)
 */
export const resetSolanaConnection = (): void => {
  defaultConnection = null;
};

export default {
  getSolanaRpcUrl,
  createSolanaConnection,
  getSolanaConnection,
  resetSolanaConnection,
};

