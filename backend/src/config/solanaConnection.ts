import { Connection, Commitment } from '@solana/web3.js';

/**
 * Get standard Solana RPC endpoint URL (free tier)
 * Used for non-critical operations like status checks, monitoring, etc.
 */
export const getStandardSolanaRpcUrl = (): string => {
  const solanaNetwork = process.env.SOLANA_NETWORK || 'devnet';
  const standardEndpoints: Record<string, string> = {
    'devnet': 'https://api.devnet.solana.com',
    'mainnet': 'https://api.mainnet-beta.solana.com',
    'mainnet-beta': 'https://api.mainnet-beta.solana.com',
    'testnet': 'https://api.testnet.solana.com',
  };
  
  const endpoint = standardEndpoints[solanaNetwork] || standardEndpoints['devnet'];
  return endpoint;
};

/**
 * Get premium Solana RPC endpoint URL (Helius)
 * Used for critical vault transactions that need high reliability and speed
 */
export const getPremiumSolanaRpcUrl = (): string => {
  const heliusApiKey = process.env.HELIUS_API_KEY;
  const solanaNetwork = process.env.SOLANA_NETWORK || 'devnet';
  
  // If Helius API key is provided, use Helius RPC
  if (heliusApiKey) {
    const network = solanaNetwork.includes('mainnet') ? 'mainnet' : 'devnet';
    const heliusUrl = `https://${network}.helius-rpc.com/?api-key=${heliusApiKey}`;
    console.log(`✅ Using Helius RPC (${network}) - Premium endpoint for critical operations`);
    return heliusUrl;
  }
  
  // Fallback to standard if Helius not configured
  console.log(`⚠️ HELIUS_API_KEY not set - Using standard RPC for critical operations (may have rate limits)`);
  return getStandardSolanaRpcUrl();
};

/**
 * Get Solana RPC endpoint URL (legacy - defaults to premium for backward compatibility)
 * @deprecated Use createPremiumSolanaConnection or createStandardSolanaConnection instead
 */
export const getSolanaRpcUrl = (): string => {
  return getPremiumSolanaRpcUrl();
};

/**
 * Create a premium Solana Connection instance (Helius RPC)
 * Use for CRITICAL operations: vault transactions, proposal signing/broadcasting, execution
 */
export const createPremiumSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  const rpcUrl = getPremiumSolanaRpcUrl();
  return new Connection(rpcUrl, commitment);
};

/**
 * Create a standard Solana Connection instance (free RPC)
 * Use for NON-CRITICAL operations: status checks, monitoring, sync operations, price queries
 */
export const createStandardSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  const rpcUrl = getStandardSolanaRpcUrl();
  return new Connection(rpcUrl, commitment);
};

/**
 * Create a Solana Connection instance (legacy - defaults to premium)
 * @deprecated Use createPremiumSolanaConnection or createStandardSolanaConnection instead
 */
export const createSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  return createPremiumSolanaConnection(commitment);
};

/**
 * Get the default premium Solana connection (singleton pattern for reuse)
 */
let defaultPremiumConnection: Connection | null = null;
let defaultStandardConnection: Connection | null = null;

export const getPremiumSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  if (!defaultPremiumConnection) {
    defaultPremiumConnection = createPremiumSolanaConnection(commitment);
  }
  return defaultPremiumConnection;
};

export const getStandardSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  if (!defaultStandardConnection) {
    defaultStandardConnection = createStandardSolanaConnection(commitment);
  }
  return defaultStandardConnection;
};

/**
 * Get the default Solana connection (legacy - defaults to premium)
 * @deprecated Use getPremiumSolanaConnection or getStandardSolanaConnection instead
 */
export const getSolanaConnection = (commitment: Commitment = 'confirmed'): Connection => {
  return getPremiumSolanaConnection(commitment);
};

/**
 * Reset the default connections (useful for testing or reconfiguration)
 */
export const resetSolanaConnection = (): void => {
  defaultPremiumConnection = null;
  defaultStandardConnection = null;
};

export default {
  getSolanaRpcUrl,
  getStandardSolanaRpcUrl,
  getPremiumSolanaRpcUrl,
  createSolanaConnection,
  createPremiumSolanaConnection,
  createStandardSolanaConnection,
  getSolanaConnection,
  getPremiumSolanaConnection,
  getStandardSolanaConnection,
  resetSolanaConnection,
};

