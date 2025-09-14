import { Connection, PublicKey, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { ManualSolanaClient } from './manualSolanaClient';
import { FEE_WALLET_ADDRESS, getFeeWalletKeypair } from '../config/wallet';

// Program ID for our deployed smart contract
const PROGRAM_ID = new PublicKey("rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X");

// Create connection to Solana network
const connection = new Connection(
  process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
  'confirmed'
);

// Smart contract service class using manual client
export class SmartContractService {
  private manualClient: ManualSolanaClient;
  private feeWallet: Keypair;

  constructor() {
    this.manualClient = new ManualSolanaClient(connection);
    this.feeWallet = getFeeWalletKeypair();
    
    console.log('🔧 Initializing SmartContractService:', {
      programId: PROGRAM_ID.toString(),
      network: process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      feeWallet: this.feeWallet.publicKey.toString()
    });
  }

  async initialize(): Promise<void> {
    try {
      const isConnected = await this.manualClient.testConnection();
      if (!isConnected) {
        throw new Error('Failed to connect to smart contract');
      }
      console.log('✅ SmartContractService initialized successfully');
    } catch (error) {
      console.error('❌ SmartContractService initialization failed:', error);
      throw error;
    }
  }

  isInitialized(): boolean {
    return this.manualClient !== null;
  }

  // Create a match on the smart contract
  async createMatch(
    player1: PublicKey,
    player2: PublicKey,
    stakeAmount: number,
    feeBps: number = 500, // 5% default
    deadlineSlot?: number
  ): Promise<{ signature: string; matchAccount: PublicKey; vaultAccount: PublicKey }> {
    try {
      // Calculate deadline slot if not provided (24 hours from now)
      if (!deadlineSlot) {
        const currentSlot = await connection.getSlot();
        deadlineSlot = currentSlot + (24 * 60 * 60 * 2); // 24 hours in slots (assuming 0.5s per slot)
      }

      // Generate match and vault account PDAs
      const matchAccount = this.manualClient.getMatchAccountPDA(player1, player2, stakeAmount);
      const [vaultAccount] = this.manualClient.getVaultAccountPDA(matchAccount);

      // Create the match
      const signature = await this.manualClient.createMatch(
        player1,
        player2,
        stakeAmount,
        feeBps,
        deadlineSlot,
        this.feeWallet
      );

      console.log('✅ Match created successfully:', {
        signature,
        matchAccount: matchAccount.toString(),
        vaultAccount: vaultAccount.toString(),
        stakeAmount,
        feeBps,
        deadlineSlot
      });

      return {
        signature,
        matchAccount,
        vaultAccount
      };
    } catch (error) {
      console.error('❌ Create match failed:', error);
      throw error;
    }
  }

  // Player deposits their stake
  async deposit(
    matchAccount: PublicKey,
    player: Keypair,
    amount: number
  ): Promise<string> {
    try {
      const signature = await this.manualClient.deposit(
        matchAccount,
        player,
        amount
      );

      console.log('✅ Deposit successful:', {
        signature,
        matchAccount: matchAccount.toString(),
        player: player.publicKey.toString(),
        amount
      });

      return signature;
    } catch (error) {
      console.error('❌ Deposit failed:', error);
      throw error;
    }
  }

  // Settle a match
  async settleMatch(
    matchAccount: PublicKey,
    result: number, // MatchResult enum value
    player1: PublicKey,
    player2: PublicKey
  ): Promise<string> {
    try {
      const [vaultAccount] = this.manualClient.getVaultAccountPDA(matchAccount);
      
      const signature = await this.manualClient.settleMatch(
        matchAccount,
        vaultAccount,
        result,
        this.feeWallet
      );

      console.log('✅ Match settled successfully:', {
        signature,
        matchAccount: matchAccount.toString(),
        result
      });

      return signature;
    } catch (error) {
      console.error('❌ Settle match failed:', error);
      throw error;
    }
  }

  // Get match data
  async getMatchData(matchAccount: PublicKey): Promise<any> {
    try {
      const matchData = await this.manualClient.getMatchData(matchAccount);
      return matchData;
    } catch (error) {
      console.error('❌ Get match data failed:', error);
      throw error;
    }
  }

  // Get vault data
  async getVaultData(vaultAccount: PublicKey): Promise<any> {
    try {
      const vaultData = await this.manualClient.getVaultData(vaultAccount);
      return vaultData;
    } catch (error) {
      console.error('❌ Get vault data failed:', error);
      throw error;
    }
  }

  // Generate match account PDA
  getMatchAccountPDA(player1: PublicKey, player2: PublicKey, stakeAmount: number): PublicKey {
    return this.manualClient.getMatchAccountPDA(player1, player2, stakeAmount);
  }

  // Generate vault account PDA
  getVaultAccountPDA(matchAccount: PublicKey): [PublicKey, number] {
    return this.manualClient.getVaultAccountPDA(matchAccount);
  }

  // Utility function to convert SOL to lamports
  solToLamports(sol: number): number {
    return Math.floor(sol * LAMPORTS_PER_SOL);
  }

  // Utility function to convert lamports to SOL
  lamportsToSol(lamports: number): number {
    return lamports / LAMPORTS_PER_SOL;
  }

  // Get connection for external use
  getConnection(): Connection {
    return connection;
  }

  // Get program ID
  getProgramId(): PublicKey {
    return PROGRAM_ID;
  }

  // Calculate deadline slot (current slot + buffer)
  async calculateDeadlineSlot(bufferSlots: number = 1000): Promise<number> {
    try {
      const currentSlot = await connection.getSlot();
      const deadlineSlot = currentSlot + bufferSlots;
      
      console.log('📅 Calculated deadline slot:', {
        currentSlot,
        bufferSlots,
        deadlineSlot
      });
      
      return deadlineSlot;
    } catch (error) {
      console.error('❌ Calculate deadline slot failed:', error);
      throw error;
    }
  }

  // Get match status (alias for getMatchData for backward compatibility)
  async getMatchStatus(matchAccount: PublicKey): Promise<any> {
    try {
      const matchData = await this.getMatchData(matchAccount);
      return {
        success: true,
        data: matchData
      };
    } catch (error) {
      console.error('❌ Get match status failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

// Export a singleton instance
export const smartContractService = new SmartContractService();

// Export a function to get the service (for backward compatibility)
export const getSmartContractService = async () => {
  await smartContractService.initialize();
  return smartContractService;
};