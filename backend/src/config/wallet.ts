import * as fs from 'fs';
import * as path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';

// Fee wallet for collecting platform fees
export const FEE_WALLET_ADDRESS = process.env.FEE_WALLET_ADDRESS || "AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A";

// Get program ID from environment or use default
export const getProgramId = (): string => {
  return process.env.PROGRAM_ID || "GMvV52s55SziXuMd6uPZSswfvhu2hSXRyqk7KkQh5u3L";
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
  
  if (!process.env.PROGRAM_ID) {
    console.warn('⚠️ PROGRAM_ID not set, using default program ID');
  }
  
  if (!process.env.FEE_WALLET_ADDRESS) {
    console.warn('⚠️ FEE_WALLET_ADDRESS not set, using default fee wallet');
  }
  
  console.log('✅ Solana configuration validated');
  console.log(`🔗 Network: ${process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com'}`);
  console.log(`📦 Program ID: ${getProgramId()}`);
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