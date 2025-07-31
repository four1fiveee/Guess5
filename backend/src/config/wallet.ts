import * as fs from 'fs';
import * as path from 'path';
import { Keypair, PublicKey } from '@solana/web3.js';

// Fee wallet for collecting platform fees
export const FEE_WALLET_ADDRESS = "AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A";

// Get program ID from environment or use default
export const getProgramId = (): string => {
  return process.env.PROGRAM_ID || "8v2ZyLNP5Apk17MbQxryjXuL6HHN65dxuDwRJDGARShz";
};

// Get fee wallet address
export const getFeeWalletAddress = (): string => {
  return FEE_WALLET_ADDRESS;
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