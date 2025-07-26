import { Keypair, PublicKey } from '@solana/web3.js';
import * as fs from 'fs';
import * as path from 'path';

// Configuration
const FEE_WALLET_ADDRESS = "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt";
const PROGRAM_ID = "bmUnEvC6W4JDLG6vdqbTJX73wECTeUZAWgptmNuabd1";

// Wallet file paths
const WALLET_DIR = path.join(__dirname, '../../wallets');
const PROGRAM_AUTHORITY_FILE = path.join(WALLET_DIR, 'program-authority.json');
const FEE_WALLET_FILE = path.join(WALLET_DIR, 'fee-wallet.json');

// Ensure wallet directory exists
if (!fs.existsSync(WALLET_DIR)) {
  fs.mkdirSync(WALLET_DIR, { recursive: true });
}

// Generate or load program authority keypair
export const getProgramAuthority = (): Keypair => {
  try {
    if (fs.existsSync(PROGRAM_AUTHORITY_FILE)) {
      const keyData = JSON.parse(fs.readFileSync(PROGRAM_AUTHORITY_FILE, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(keyData));
    } else {
      // Generate new program authority keypair
      const keypair = Keypair.generate();
      fs.writeFileSync(PROGRAM_AUTHORITY_FILE, JSON.stringify(Array.from(keypair.secretKey)));
      console.log('Generated new program authority keypair');
      console.log('Program Authority Public Key:', keypair.publicKey.toString());
      return keypair;
    }
  } catch (error) {
    console.error('Error loading program authority:', error);
    throw error;
  }
};

// Generate or load fee wallet keypair
export const getFeeWallet = (): Keypair => {
  try {
    if (fs.existsSync(FEE_WALLET_FILE)) {
      const keyData = JSON.parse(fs.readFileSync(FEE_WALLET_FILE, 'utf8'));
      return Keypair.fromSecretKey(new Uint8Array(keyData));
    } else {
      // Generate new fee wallet keypair
      const keypair = Keypair.generate();
      fs.writeFileSync(FEE_WALLET_FILE, JSON.stringify(Array.from(keypair.secretKey)));
      console.log('Generated new fee wallet keypair');
      console.log('Fee Wallet Public Key:', keypair.publicKey.toString());
      console.log('⚠️  IMPORTANT: Fund this wallet with SOL for fees!');
      return keypair;
    }
  } catch (error) {
    console.error('Error loading fee wallet:', error);
    throw error;
  }
};

// Validate fee wallet matches expected address
export const validateFeeWallet = (): boolean => {
  const feeWallet = getFeeWallet();
  const expectedAddress = new PublicKey(FEE_WALLET_ADDRESS);
  
  if (!feeWallet.publicKey.equals(expectedAddress)) {
    console.error('⚠️  WARNING: Fee wallet address mismatch!');
    console.error('Expected:', FEE_WALLET_ADDRESS);
    console.error('Actual:', feeWallet.publicKey.toString());
    console.error('Please update FEE_WALLET_ADDRESS in anchorClient.ts or replace the wallet file');
    return false;
  }
  
  return true;
};

// Get public keys
export const getProgramId = (): PublicKey => new PublicKey(PROGRAM_ID);
export const getFeeWalletAddress = (): PublicKey => new PublicKey(FEE_WALLET_ADDRESS);

// Export constants
export { FEE_WALLET_ADDRESS, PROGRAM_ID }; 