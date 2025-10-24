const { PublicKey } = require('@solana/web3.js');

class MockSmartContractService {
  constructor() {
    console.log('🔧 Initializing MockSmartContractService (no blockchain interaction)');
  }

  async testConnection() {
    console.log('✅ Mock smart contract service connection test passed');
    return true;
  }

  async createMatch(player1, player2, stakeAmount, feeBps, deadlineSlot, payer) {
    console.log('🎮 Mock createMatch called:', {
      player1: player1.toString(),
      player2: player2.toString(),
      stakeAmount,
      feeBps,
      deadlineSlot,
      payer: payer.publicKey.toString()
    });

    // Generate mock match account PDA (same logic as real client)
    const stakeAmountBuffer = Buffer.alloc(8);
    stakeAmountBuffer.writeBigUInt64LE(BigInt(stakeAmount), 0);
    
    const [matchAccount] = PublicKey.findProgramAddressSync(
      [
        Buffer.from('match'),
        player1.toBuffer(),
        player2.toBuffer(),
        stakeAmountBuffer,
      ],
      new PublicKey(process.env.SMART_CONTRACT_PROGRAM_ID || "ASLA3yCccjSoMAxoYBciM5vqdCZKcedd2QkbVWtjQEL4")
    );

    console.log('✅ Mock match created successfully:', {
      matchAccount: matchAccount.toString(),
      stakeAmount,
      feeBps,
      deadlineSlot
    });

    // Return a mock transaction signature
    return 'mock_transaction_signature_' + Date.now();
  }

  async deposit(matchAccount, player, amount) {
    console.log('💰 Mock deposit called:', {
      matchAccount: matchAccount.toString(),
      player: player.publicKey.toString(),
      amount
    });

    return 'mock_deposit_signature_' + Date.now();
  }

  async settleMatch(matchAccount, winner, result) {
    console.log('🏆 Mock settleMatch called:', {
      matchAccount: matchAccount.toString(),
      winner: winner.toString(),
      result
    });

    return 'mock_settle_signature_' + Date.now();
  }

  async refundTimeout(matchAccount) {
    console.log('⏰ Mock refundTimeout called:', {
      matchAccount: matchAccount.toString()
    });

    return 'mock_refund_signature_' + Date.now();
  }
}

module.exports = { MockSmartContractService };
