import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import 'dotenv/config';

async function checkMatchVault() {
  const matchId = process.argv[2];
  const vaultAddress = process.argv[3] || '3uRKQfvwtLdri7DJpiDz5ZtpfhUfKtjTqMQFh6qECBR2';
  const player1 = 'F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8';
  const feeWallet = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

  if (!vaultAddress) {
    console.error('Usage: ts-node check-match-vault.ts <matchId> [vaultAddress]');
    process.exit(1);
  }

  try {
    const connection = new Connection(process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com', 'confirmed');
    const vaultPublicKey = new PublicKey(vaultAddress);
    const player1PublicKey = new PublicKey(player1);
    const feeWalletPublicKey = new PublicKey(feeWallet);

    console.log(`\n🔍 Checking vault balance for match: ${matchId || 'N/A'}`);
    console.log(`📍 Vault Address: ${vaultAddress}\n`);

    const vaultBalance = await connection.getBalance(vaultPublicKey, 'confirmed');
    const vaultBalanceSOL = vaultBalance / LAMPORTS_PER_SOL;

    const player1Balance = await connection.getBalance(player1PublicKey, 'confirmed');
    const player1BalanceSOL = player1Balance / LAMPORTS_PER_SOL;

    const feeWalletBalance = await connection.getBalance(feeWalletPublicKey, 'confirmed');
    const feeWalletBalanceSOL = feeWalletBalance / LAMPORTS_PER_SOL;

    console.log(`💰 Vault Balance: ${vaultBalanceSOL} SOL (${vaultBalance} Lamports)`);
    console.log(`👤 Player 1 Balance: ${player1BalanceSOL} SOL`);
    console.log(`💼 Fee Wallet Balance: ${feeWalletBalanceSOL} SOL\n`);

    // Check account info for rent exemption
    const accountInfo = await connection.getAccountInfo(vaultPublicKey);
    if (accountInfo) {
      const rentExemptReserve = await connection.getMinimumBalanceForRentExemption(accountInfo.data.length);
      console.log(`🔒 Rent-Exempt Reserve: ${rentExemptReserve / LAMPORTS_PER_SOL} SOL`);
      console.log(`💸 Transferable Balance: ${(vaultBalance - rentExemptReserve) / LAMPORTS_PER_SOL} SOL\n`);
    } else {
      console.log('⚠️ Vault account not found on-chain.\n');
    }

    // Check recent transactions for the vault
    console.log('📋 Checking recent transactions...');
    try {
      const signatures = await connection.getSignaturesForAddress(vaultPublicKey, { limit: 5 });
      console.log(`Found ${signatures.length} recent transactions:\n`);
      signatures.forEach((sig, i) => {
        console.log(`${i + 1}. Signature: ${sig.signature}`);
        console.log(`   Slot: ${sig.slot}, Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
        console.log(`   Err: ${sig.err ? JSON.stringify(sig.err) : 'None'}\n`);
      });
    } catch (txError: any) {
      console.error(`❌ Error fetching transactions: ${txError.message}\n`);
    }

    // Expected amounts
    const entryFee = 0.1302; // From logs
    const totalDeposited = entryFee * 2; // Both players
    const expectedRefundPerPlayer = entryFee * 0.95; // 95% refund
    const expectedFee = entryFee * 0.05 * 2; // 5% fee from both players

    console.log(`📊 Expected Values:`);
    console.log(`   Total Deposited: ${totalDeposited} SOL (${entryFee} SOL per player)`);
    console.log(`   Expected Refund per Player: ${expectedRefundPerPlayer} SOL`);
    console.log(`   Expected Fee: ${expectedFee} SOL\n`);

    if (vaultBalanceSOL > 0.01) {
      console.log(`⚠️ WARNING: Vault still has ${vaultBalanceSOL} SOL - funds may not have been released!`);
    } else {
      console.log(`✅ Vault balance is low (${vaultBalanceSOL} SOL) - funds likely released (or only rent remains)`);
    }

  } catch (error: any) {
    console.error('❌ Error checking vault balance:', error.message);
    process.exit(1);
  }
}

checkMatchVault().catch(console.error);





