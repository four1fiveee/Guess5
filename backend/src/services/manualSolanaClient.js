const { 
  Connection, 
  PublicKey, 
  Transaction, 
  TransactionInstruction,
  SystemProgram,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} = require('@solana/web3.js');
const borsh = require('borsh');

// Program ID for our deployed smart contract
const PROGRAM_ID = new PublicKey("CYXJFpzXnJQj53zv2zHUyi5NEeCAnTowwZC5o1nTcBoh");

// Instruction discriminators (8-byte hashes for each instruction)
const INSTRUCTION_DISCRIMINATORS = {
  initialize: Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]),
  createMatch: Buffer.from([107, 2, 184, 145, 70, 142, 17, 165]),
  deposit: Buffer.from([242, 35, 198, 137, 82, 225, 242, 182]),
  settleMatch: Buffer.from([71, 124, 117, 96, 191, 217, 116, 24]),
  refundTimeout: Buffer.from([142, 147, 135, 70, 231, 198, 23, 207]),
};

// Account schemas for serialization/deserialization
const CreateMatchSchema = new Map([
  [
    'CreateMatchArgs',
    {
      kind: 'struct',
      fields: [
        ['stakeAmount', 'u64'],
        ['feeBps', 'u16'],
        ['deadlineSlot', 'u64'],
      ],
    },
  ],
]);

const DepositSchema = new Map([
  [
    'DepositArgs',
    {
      kind: 'struct',
      fields: [
        ['amount', 'u64'],
      ],
    },
  ],
]);

const SettleMatchSchema = new Map([
  [
    'SettleMatchArgs',
    {
      kind: 'struct',
      fields: [
        ['result', 'u8'], // MatchResult enum
      ],
    },
  ],
]);

// Account data schemas
const MatchAccountSchema = new Map([
  [
    'MatchAccount',
    {
      kind: 'struct',
      fields: [
        ['player1', [32]], // PublicKey
        ['player2', [32]], // PublicKey
        ['stakeAmount', 'u64'],
        ['feeBps', 'u16'],
        ['deadlineSlot', 'u64'],
        ['status', 'u8'], // MatchStatus enum
        ['result', 'u8'], // MatchResult enum
        ['player1Deposited', 'u64'],
        ['player2Deposited', 'u64'],
        ['vaultBump', 'u8'],
      ],
    },
  ],
]);

const VaultAccountSchema = new Map([
  [
    'VaultAccount',
    {
      kind: 'struct',
      fields: [
        ['matchAccount', [32]], // PublicKey
        ['totalDeposited', 'u64'],
        ['bump', 'u8'],
      ],
    },
  ],
]);

class ManualSolanaClient {
  constructor(connection) {
    this.connection = connection;
  }

  /**
   * Test connection to the smart contract
   */
  async testConnection() {
    try {
      const programInfo = await this.connection.getAccountInfo(PROGRAM_ID);
      return programInfo !== null;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  /**
   * Create a new match
   */
  async createMatch(
    player1,
    player2,
    stakeAmount,
    feeBps,
    deadlineSlot,
    payer
  ) {
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
          { pubkey: player1, isSigner: true, isWritable: true },
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
        [payer, player1],
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
    matchAccount,
    player,
    amount
  ) {
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
    matchAccount,
    vaultAccount,
    result, // MatchResult enum value
    authority
  ) {
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
  async getMatchData(matchAccount) {
    try {
      const accountInfo = await this.connection.getAccountInfo(matchAccount);
      if (!accountInfo) {
        throw new Error('Match account not found');
      }

      // Deserialize account data (skip the 8-byte discriminator)
      const data = accountInfo.data.slice(8);
      return borsh.deserialize(MatchAccountSchema, 'MatchAccount', data);
    } catch (error) {
      console.error('Get match data failed:', error);
      throw error;
    }
  }

  /**
   * Get vault account data
   */
  async getVaultData(vaultAccount) {
    try {
      const accountInfo = await this.connection.getAccountInfo(vaultAccount);
      if (!accountInfo) {
        throw new Error('Vault account not found');
      }

      // Deserialize account data (skip the 8-byte discriminator)
      const data = accountInfo.data.slice(8);
      return borsh.deserialize(VaultAccountSchema, 'VaultAccount', data);
    } catch (error) {
      console.error('Get vault data failed:', error);
      throw error;
    }
  }

  /**
   * Generate match account PDA
   */
  getMatchAccountPDA(player1, player2, stakeAmount) {
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
  getVaultAccountPDA(matchAccount) {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), matchAccount.toBuffer()],
      PROGRAM_ID
    );
  }
}

module.exports = { ManualSolanaClient };
