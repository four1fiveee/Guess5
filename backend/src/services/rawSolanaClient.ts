import { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction, Keypair } from '@solana/web3.js';
import { Program, AnchorProvider, Wallet } from '@coral-xyz/anchor';

export interface MatchResult {
  Player1?: {};
  Player2?: {};
  WinnerTie?: {};
  LosingTie?: {};
  Timeout?: {};
  Error?: {};
}

export interface MatchAccount {
  player1: PublicKey;
  player2: PublicKey;
  stakeLamports: bigint;
  feeBps: number;
  deadlineSlot: bigint;
  feeWallet: PublicKey;
  resultsAttestor: PublicKey;
  vault: PublicKey;
  status: { Active?: {}; Settled?: {} };
  result: MatchResult | null;
  createdAt: bigint;
  settledAt: bigint | null;
}

export interface VaultAccount {
  matchAccount: PublicKey;
  balance: bigint;
  player1Deposited: boolean;
  player2Deposited: boolean;
}

export class RawSolanaClient {
  private connection: Connection;
  private programId: PublicKey;
  private provider: AnchorProvider;

  constructor(rpcUrl: string, programId: string) {
    this.connection = new Connection(rpcUrl, 'confirmed');
    this.programId = new PublicKey(programId);
    
    // Create a dummy wallet for the provider (we'll use keypairs directly for signing)
    const dummyKeypair = Keypair.generate();
    const wallet = new Wallet(dummyKeypair);
    this.provider = new AnchorProvider(this.connection, wallet, {});
  }

  /**
   * Get match account data
   */
  async getMatchAccount(matchAccountAddress: string): Promise<MatchAccount | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(matchAccountAddress));
      if (!accountInfo) {
        return null;
      }

      // Parse the account data manually
      // The account data starts with an 8-byte discriminator, then the struct data
      const data = accountInfo.data.slice(8); // Skip discriminator
      
      // Parse according to the Match struct layout
      let offset = 0;
      
      // player1 (32 bytes)
      const player1 = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      // player2 (32 bytes)
      const player2 = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      // stake_lamports (8 bytes, little-endian)
      const stakeLamports = data.readBigUInt64LE(offset);
      offset += 8;
      
      // fee_bps (2 bytes, little-endian)
      const feeBps = data.readUInt16LE(offset);
      offset += 2;
      
      // deadline_slot (8 bytes, little-endian)
      const deadlineSlot = data.readBigUInt64LE(offset);
      offset += 8;
      
      // fee_wallet (32 bytes)
      const feeWallet = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      // results_attestor (32 bytes)
      const resultsAttestor = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      // vault (32 bytes)
      const vault = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      // status (1 byte enum)
      const statusByte = data[offset];
      const status = statusByte === 0 ? { Active: {} } : { Settled: {} };
      offset += 1;
      
      // result (Option<MatchResult> - 1 byte for Some/None + 1 byte for enum if Some)
      let result: MatchResult | null = null;
      const resultOptionByte = data[offset];
      offset += 1;
      if (resultOptionByte === 1) { // Some
        const resultEnumByte = data[offset];
        offset += 1;
        switch (resultEnumByte) {
          case 0: result = { Player1: {} }; break;
          case 1: result = { Player2: {} }; break;
          case 2: result = { WinnerTie: {} }; break;
          case 3: result = { LosingTie: {} }; break;
          case 4: result = { Timeout: {} }; break;
          case 5: result = { Error: {} }; break;
        }
      }
      
      // created_at (8 bytes, little-endian)
      const createdAt = data.readBigInt64LE(offset);
      offset += 8;
      
      // settled_at (Option<i64> - 1 byte for Some/None + 8 bytes if Some)
      let settledAt: bigint | null = null;
      const settledAtOptionByte = data[offset];
      offset += 1;
      if (settledAtOptionByte === 1) { // Some
        settledAt = data.readBigInt64LE(offset);
      }

      return {
        player1,
        player2,
        stakeLamports,
        feeBps,
        deadlineSlot,
        feeWallet,
        resultsAttestor,
        vault,
        status,
        result,
        createdAt,
        settledAt
      };
    } catch (error) {
      console.error('Error fetching match account:', error);
      return null;
    }
  }

  /**
   * Get vault account data
   */
  async getVaultAccount(vaultAddress: string): Promise<VaultAccount | null> {
    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(vaultAddress));
      if (!accountInfo) {
        return null;
      }

      // Parse the account data manually
      const data = accountInfo.data.slice(8); // Skip discriminator
      
      let offset = 0;
      
      // match_account (32 bytes)
      const matchAccount = new PublicKey(data.slice(offset, offset + 32));
      offset += 32;
      
      // balance (8 bytes, little-endian)
      const balance = data.readBigUInt64LE(offset);
      offset += 8;
      
      // player1_deposited (1 byte bool)
      const player1Deposited = data[offset] === 1;
      offset += 1;
      
      // player2_deposited (1 byte bool)
      const player2Deposited = data[offset] === 1;

      return {
        matchAccount,
        balance,
        player1Deposited,
        player2Deposited
      };
    } catch (error) {
      console.error('Error fetching vault account:', error);
      return null;
    }
  }

  /**
   * Create a match (using raw instruction)
   */
  async createMatch(
    payer: Keypair,
    player1: PublicKey,
    player2: PublicKey,
    stakeLamports: number,
    feeBps: number,
    deadlineSlot: number,
    resultsAttestor: PublicKey
  ): Promise<string> {
    try {
      // Generate match account PDA
      const [matchAccountPda] = PublicKey.findProgramAddressSync(
        [
          Buffer.from('match'),
          player1.toBuffer(),
          player2.toBuffer(),
          Buffer.from(stakeLamports.toString().padStart(8, '0'), 'hex')
        ],
        this.programId
      );

      // Generate vault account PDA
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchAccountPda.toBuffer()],
        this.programId
      );

      // Create the instruction data manually
      // This would need to be implemented based on the actual instruction layout
      // For now, we'll use a placeholder
      const instructionData = Buffer.alloc(8 + 8 + 2 + 8); // discriminator + stake + fee + deadline
      
      // Add discriminator (first 8 bytes of hash of "global:create_match")
      const discriminator = this.getDiscriminator('create_match');
      instructionData.set(discriminator, 0);
      
      // Add parameters
      instructionData.writeBigUInt64LE(BigInt(stakeLamports), 8);
      instructionData.writeUInt16LE(feeBps, 16);
      instructionData.writeBigUInt64LE(BigInt(deadlineSlot), 18);

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: matchAccountPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: player1, isSigner: false, isWritable: false },
          { pubkey: player2, isSigner: false, isWritable: false },
          { pubkey: resultsAttestor, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: true, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: this.programId,
        data: instructionData
      });

      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [payer]
      );

      return signature;
    } catch (error) {
      console.error('Error creating match:', error);
      throw error;
    }
  }

  /**
   * Settle a match (using raw instruction)
   */
  async settleMatch(
    payer: Keypair,
    matchAccount: PublicKey,
    result: MatchResult
  ): Promise<string> {
    try {
      // Get match account data to find vault and other accounts
      const matchData = await this.getMatchAccount(matchAccount.toString());
      if (!matchData) {
        throw new Error('Match account not found');
      }

      // Generate vault account PDA
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), matchAccount.toBuffer()],
        this.programId
      );

      // Create the instruction data manually
      const instructionData = Buffer.alloc(8 + 1); // discriminator + result enum
      
      // Add discriminator
      const discriminator = this.getDiscriminator('settle_match');
      instructionData.set(discriminator, 0);
      
      // Add result enum
      let resultByte = 0;
      if (result.Player1) resultByte = 0;
      else if (result.Player2) resultByte = 1;
      else if (result.WinnerTie) resultByte = 2;
      else if (result.LosingTie) resultByte = 3;
      else if (result.Timeout) resultByte = 4;
      else if (result.Error) resultByte = 5;
      
      instructionData[8] = resultByte;

      const instruction = new TransactionInstruction({
        keys: [
          { pubkey: matchAccount, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: matchData.resultsAttestor, isSigner: true, isWritable: false },
          { pubkey: matchData.player1, isSigner: false, isWritable: true },
          { pubkey: matchData.player2, isSigner: false, isWritable: true },
          { pubkey: matchData.feeWallet, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }
        ],
        programId: this.programId,
        data: instructionData
      });

      const transaction = new Transaction().add(instruction);
      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [payer]
      );

      return signature;
    } catch (error) {
      console.error('Error settling match:', error);
      throw error;
    }
  }

  /**
   * Get instruction discriminator
   */
  private getDiscriminator(instructionName: string): Buffer {
    // This is a simplified version - in reality, you'd need to compute the actual discriminator
    // which is the first 8 bytes of the SHA256 hash of "global:<instruction_name>"
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(`global:${instructionName}`);
    return hash.digest().slice(0, 8);
  }
}










