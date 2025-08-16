const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');

// Test fee wallet balance and payout calculation
async function testFeeWallet() {
  const FEE_WALLET_ADDRESS = "AdujK4E4Rme8sza8ZTrbX2HHGnde31NTUjRk5MErxf3A";
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  try {
    // Check fee wallet balance
    const feeWalletPublicKey = new PublicKey(FEE_WALLET_ADDRESS);
    const balance = await connection.getBalance(feeWalletPublicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;
    
    console.log('💰 Fee Wallet Status:');
    console.log(`Address: ${FEE_WALLET_ADDRESS}`);
    console.log(`Balance: ${balanceInSol} SOL (${balance} lamports)`);
    
    // Test payout calculation
    const entryFee = 0.1; // 0.1 SOL entry fee
    const totalPot = entryFee * 2; // Both players paid
    const winnerAmount = totalPot * 0.95; // 95% to winner
    const feeAmount = totalPot * 0.05; // 5% fee
    
    console.log('\n🎮 Payout Calculation (0.1 SOL entry fee):');
    console.log(`Total pot: ${totalPot} SOL`);
    console.log(`Winner gets: ${winnerAmount} SOL`);
    console.log(`Fee wallet keeps: ${feeAmount} SOL`);
    
    const requiredPayout = Math.floor(winnerAmount * LAMPORTS_PER_SOL);
    const hasEnoughBalance = balance >= requiredPayout;
    
    console.log('\n✅ Balance Check:');
    console.log(`Required for payout: ${requiredPayout} lamports (${winnerAmount} SOL)`);
    console.log(`Fee wallet has: ${balance} lamports (${balanceInSol} SOL)`);
    console.log(`Can pay winner: ${hasEnoughBalance ? 'YES' : 'NO'}`);
    
    if (!hasEnoughBalance) {
      console.log('\n⚠️ WARNING: Fee wallet needs more SOL for payouts!');
      console.log(`Need at least: ${winnerAmount} SOL`);
      console.log(`Current balance: ${balanceInSol} SOL`);
      console.log(`Shortfall: ${winnerAmount - balanceInSol} SOL`);
    } else {
      console.log('\n✅ Fee wallet has sufficient balance for payouts!');
    }
    
  } catch (error) {
    console.error('❌ Error testing fee wallet:', error);
  }
}

// Run the test
testFeeWallet();
