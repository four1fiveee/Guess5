const { Connection, PublicKey, Transaction, TransactionInstruction, SystemProgram, sendAndConfirmTransaction, Keypair } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@coral-xyz/anchor');

class RawSolanaClient {
  constructor(rpcUrl, programId) {
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
  async getMatchAccount(matchAccountAddress) {
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
      let result = null;
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
      let settledAt = null;
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
  async getVaultAccount(vaultAddress) {
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
   * Get instruction discriminator
   */
  getDiscriminator(instructionName) {
    // This is a simplified version - in reality, you'd need to compute the actual discriminator
    // which is the first 8 bytes of the SHA256 hash of "global:<instruction_name>"
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256');
    hash.update(`global:${instructionName}`);
    return hash.digest().slice(0, 8);
  }

  /**
   * Test method to verify the client works
   */
  async testConnection() {
    try {
      const version = await this.connection.getVersion();
      console.log('✅ Connection successful, Solana version:', version);
      return true;
    } catch (error) {
      console.error('❌ Connection failed:', error.message);
      return false;
    }
  }
}

module.exports = { RawSolanaClient };





