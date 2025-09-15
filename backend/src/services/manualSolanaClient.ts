import { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} from '@solana/web3.js';
import * as borsh from 'borsh';

// Program ID for our deployed smart contract
const PROGRAM_ID = new PublicKey("rnJUt7xoxQvZpPqvY5LeQ3qUYSBnYfLKa5B8K5SWh6X");

// Instruction discriminators (8-byte hashes for each instruction)
const INSTRUCTION_DISCRIMINATORS = {
  createMatch: Buffer.from([107, 2, 184, 145, 70, 142, 17, 165]), // create_match
  deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]), // deposit
  settleMatch: Buffer.from([71, 124, 117, 96, 191, 217, 116, 24]), // settle_match
  refundTimeout: Buffer.from([142, 147, 135, 70, 231, 198, 23, 207]), // refund_timeout
};

// Note: We use manual serialization instead of Borsh schemas for better control

export class ManualSolanaClient {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Test connection to the smart contract
   */
  async testConnection(): Promise<boolean> {
    try {
      // Test basic connection first
      const version = await this.connection.getVersion();
      console.log('🔗 Solana connection test successful:', version);
      
      // Test program account
      const programInfo = await this.connection.getAccountInfo(PROGRAM_ID);
      if (programInfo === null) {
        console.error('❌ Program not found at address:', PROGRAM_ID.toString());
        return false;
      }
      
      console.log('✅ Program found at address:', PROGRAM_ID.toString());
      return true;
    } catch (error) {
      console.error('❌ Connection test failed:', error);
      return false;
    }
  }

  /**
   * Create a new match
   */
  async createMatch(
    player1: PublicKey,
    player2: PublicKey,
    stakeAmount: number,
    feeBps: number,
    deadlineSlot: number,
    payer: Keypair
  ): Promise<string> {
    try {
      // Generate match account PDA
      const [matchAccount] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('match'),
          player1.toBuffer(),
          player2.toBuffer(),
          Buffer.from(stakeAmount.toString()),
        ],
        PROGRAM_ID
      );

      // Generate vault account PDA
      const [vaultAccount, vaultBump] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchAccount.toBuffer()],
        PROGRAM_ID
      );

      // Serialize instruction data manually
      const stakeAmountBuffer = Buffer.alloc(8);
      stakeAmountBuffer.writeBigUInt64LE(BigInt(stakeAmount), 0);
      
      const feeBpsBuffer = Buffer.alloc(2);
      feeBpsBuffer.writeUInt16LE(feeBps, 0);
      
      const deadlineSlotBuffer = Buffer.alloc(8);
      deadlineSlotBuffer.writeBigUInt64LE(BigInt(deadlineSlot), 0);
      
      const instructionData = Buffer.concat([
        INSTRUCTION_DISCRIMINATORS.createMatch,
        stakeAmountBuffer,
        feeBpsBuffer,
        deadlineSlotBuffer
      ]);

      // Create instruction
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: matchAccount, isSigner: false, isWritable: true },
          { pubkey: vaultAccount, isSigner: false, isWritable: true },
          { pubkey: player1, isSigner: false, isWritable: true },
          { pubkey: player2, isSigner: false, isWritable: true },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: instructionData,
      });

      // Create and send transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [payer],
        { commitment: 'confirmed' }
      );

      return signature;
    } catch (error) {
      console.error('Create match failed:', error);
      throw error;
    }
  }

  /**
   * Deposit stake for a player
   */
  async deposit(
    matchAccount: PublicKey,
    player: Keypair,
    amount: number
  ): Promise<string> {
    try {
      // Generate vault account PDA
      const [vaultAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchAccount.toBuffer()],
        PROGRAM_ID
      );

      // Serialize instruction data manually
      const amountBuffer = Buffer.alloc(8);
      amountBuffer.writeBigUInt64LE(BigInt(amount), 0);
      
      const instructionData = Buffer.concat([
        INSTRUCTION_DISCRIMINATORS.deposit,
        amountBuffer
      ]);

      // Create instruction
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: matchAccount, isSigner: false, isWritable: true },
          { pubkey: vaultAccount, isSigner: false, isWritable: true },
          { pubkey: player.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: instructionData,
      });

      // Create and send transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [player],
        { commitment: 'confirmed' }
      );

      return signature;
    } catch (error) {
      console.error('Deposit failed:', error);
      throw error;
    }
  }

  /**
   * Settle a match
   */
  async settleMatch(
    matchAccount: PublicKey,
    vaultAccount: PublicKey,
    result: number, // MatchResult enum value
    authority: Keypair
  ): Promise<string> {
    try {
      // Serialize instruction data manually
      const resultBuffer = Buffer.alloc(1);
      resultBuffer.writeUInt8(result, 0);
      
      const instructionData = Buffer.concat([
        INSTRUCTION_DISCRIMINATORS.settleMatch,
        resultBuffer
      ]);

      // Create instruction
      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: matchAccount, isSigner: false, isWritable: true },
          { pubkey: vaultAccount, isSigner: false, isWritable: true },
          { pubkey: authority.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        programId: PROGRAM_ID,
        data: instructionData,
      });

      // Create and send transaction
      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [authority],
        { commitment: 'confirmed' }
      );

      return signature;
    } catch (error) {
      console.error('Settle match failed:', error);
      throw error;
    }
  }

  /**
   * Get match account data
   */
  async getMatchData(matchAccount: PublicKey): Promise<any> {
    try {
      const accountInfo = await this.connection.getAccountInfo(matchAccount);
      if (!accountInfo) {
        throw new Error('Match account not found');
      }

      // Manual deserialization (skip the 8-byte discriminator)
      const data = accountInfo.data.slice(8);
      let offset = 0;
      
      return {
        player1: new PublicKey(data.slice(offset, offset + 32)),
        player2: new PublicKey(data.slice(offset + 32, offset + 64)),
        stakeAmount: data.readBigUInt64LE(offset + 64),
        feeBps: data.readUInt16LE(offset + 72),
        deadlineSlot: data.readBigUInt64LE(offset + 74),
        status: data.readUInt8(offset + 82),
        result: data.readUInt8(offset + 83),
        player1Deposited: data.readBigUInt64LE(offset + 84),
        player2Deposited: data.readBigUInt64LE(offset + 92),
        vaultBump: data.readUInt8(offset + 100),
      };
    } catch (error) {
      console.error('Get match data failed:', error);
      throw error;
    }
  }

  /**
   * Get vault account data
   */
  async getVaultData(vaultAccount: PublicKey): Promise<any> {
    try {
      const accountInfo = await this.connection.getAccountInfo(vaultAccount);
      if (!accountInfo) {
        throw new Error('Vault account not found');
      }

      // Manual deserialization (skip the 8-byte discriminator)
      const data = accountInfo.data.slice(8);
      let offset = 0;
      
      return {
        matchAccount: new PublicKey(data.slice(offset, offset + 32)),
        totalDeposited: data.readBigUInt64LE(offset + 32),
        bump: data.readUInt8(offset + 40),
      };
    } catch (error) {
      console.error('Get vault data failed:', error);
      throw error;
    }
  }

  /**
   * Generate match account PDA
   */
  getMatchAccountPDA(player1: PublicKey, player2: PublicKey, stakeAmount: number): PublicKey {
    const [matchAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('match'),
        player1.toBuffer(),
        player2.toBuffer(),
        Buffer.from(stakeAmount.toString()),
      ],
      PROGRAM_ID
    );
    return matchAccount;
  }

  /**
   * Generate vault account PDA
   */
  getVaultAccountPDA(matchAccount: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), matchAccount.toBuffer()],
      PROGRAM_ID
    );
  }
}
