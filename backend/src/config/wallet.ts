import * as fs from 'fs';
import * as path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';

// Fee wallet for collecting platform fees
export const FEE_WALLET_ADDRESS = process.env.FEE_WALLET_ADDRESS || "AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A";

// Get fee wallet private key from environment
export const getFeeWalletPrivateKey = (): string => {
  const privateKey = process.env.FEE_WALLET_PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('FEE_WALLET_PRIVATE_KEY environment variable is required for automated payouts');
  }
  return privateKey;
};

// Get fee wallet keypair for signing transactions
export const getFeeWalletKeypair = (): Keypair => {
  const privateKeyString = getFeeWalletPrivateKey();
  try {
    // Try to decode as base58 string (most common format)
    const privateKeyBytes = bs58.decode(privateKeyString);
    return Keypair.fromSecretKey(privateKeyBytes);
  } catch (error: unknown) {
    throw new Error('Invalid FEE_WALLET_PRIVATE_KEY format. Should be base58-encoded string.');
  }
};

// Get fee wallet address
export const getFeeWalletAddress = (): string => {
  return FEE_WALLET_ADDRESS;
};

// Validate Solana configuration
export const validateSolanaConfig = () => {
  if (!process.env.SOLANA_NETWORK) {
    console.warn('⚠️ SOLANA_NETWORK not set, using default devnet');
  }
  
  if (!process.env.FEE_WALLET_ADDRESS) {
    console.warn('⚠️ FEE_WALLET_ADDRESS not set, using default fee wallet');
  }
  
  if (!process.env.FEE_WALLET_PRIVATE_KEY) {
    console.warn('⚠️ FEE_WALLET_PRIVATE_KEY not set - automated payouts will be disabled');
  } else {
    console.log('✅ Fee wallet private key configured - automated payouts enabled');
  }
  
  console.log('✅ Solana configuration validated');
  console.log(`🔗 Network: ${process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com'}`);
  console.log(`💰 Fee Wallet: ${getFeeWalletAddress()}`);
};

// Generate a new keypair for testing
export const generateTestKeypair = (): Keypair => {
  return Keypair.generate();
};

// Validate wallet address format
export const isValidWalletAddress = (address: string): boolean => {
  try {
    new PublicKey(address);
    return true;
  } catch {
    return false;
  }
}; 