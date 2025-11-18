/**
 * Verify match payout on-chain using match data from API
 * Usage: node backend/scripts/verify-payout-onchain.js <matchId>
 */

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getTransactionPda, getProposalPda, accounts } = require('@sqds/multisig');

const MATCH_ID = process.argv[2];
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
const API_URL = 'https://guess5.onrender.com';

if (!MATCH_ID) {
  console.error('Usage: node backend/scripts/verify-payout-onchain.js <matchId>');
  process.exit(1);
}

async function verifyPayout() {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    console.log('\n' + '═'.repeat(80));
    console.log(`🔍 VERIFYING MATCH PAYOUT ON-CHAIN: ${MATCH_ID}`);
    console.log('═'.repeat(80) + '\n');

    // Get match data from API
    console.log('📡 Fetching match data from API...');
    const fetch = require('node-fetch');
    const apiResponse = await fetch(`${API_URL}/api/match/status/${MATCH_ID}`);
    const match = await apiResponse.json();

    if (!match || !match.squadsVaultPda) {
      console.error('❌ Match not found or missing vault information');
      process.exit(1);
    }

    console.log('✅ Match data retrieved');
    console.log({
      winner: match.winner,
      vaultPda: match.squadsVaultPda,
      vaultAddress: match.squadsVaultAddress,
      proposalId: match.payoutProposalId || match.tieRefundProposalId,
      proposalStatus: match.proposalStatus,
      expectedWinnerPayout: match.payout?.winnerAmount,
      expectedFee: match.payout?.feeAmount,
    });

    const vaultPda = match.squadsVaultPda;
    const winner = match.winner;
    const proposalId = match.payoutProposalId || match.tieRefundProposalId;

    if (!vaultPda || !winner || !proposalId) {
      console.error('❌ Missing required match information');
      process.exit(1);
    }

    console.log('\n' + '─'.repeat(80));
    console.log('💰 CHECKING VAULT BALANCE');
    console.log('─'.repeat(80));

    // Check vault balance
    const vaultPubkey = new PublicKey(vaultPda);
    const vaultBalance = await connection.getBalance(vaultPubkey, 'confirmed');
    const vaultBalanceSOL = vaultBalance / LAMPORTS_PER_SOL;

    console.log(`Vault PDA: ${vaultPda}`);
    console.log(`Current Balance: ${vaultBalanceSOL.toFixed(6)} SOL`);

    if (vaultBalanceSOL > 0.01) {
      console.log('⚠️  WARNING: Vault still has significant balance');
    } else {
      console.log('✅ Vault balance is at rent reserve - funds likely released');
    }

    console.log('\n' + '─'.repeat(80));
    console.log('📊 CHECKING PROPOSAL EXECUTION STATUS');
    console.log('─'.repeat(80));

    // Check proposal execution
    const multisigPda = new PublicKey(match.squadsVaultAddress);
    const transactionIndex = BigInt(proposalId);
    const programId = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

    const [transactionPda] = getTransactionPda({
      multisigPda,
      index: transactionIndex,
      programId,
    });

    const [proposalPda] = getProposalPda({
      multisigPda,
      transactionIndex,
      programId,
    });

    console.log(`Transaction PDA: ${transactionPda.toString()}`);
    console.log(`Proposal PDA: ${proposalPda.toString()}`);

    const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
    if (!transactionAccount) {
      console.log('✅ Transaction account CLOSED - Proposal was EXECUTED!');
    } else {
      console.log('⚠️  Transaction account EXISTS - Proposal may NOT be executed');
      try {
        const tx = await accounts.VaultTransaction.fromAccountAddress(connection, transactionPda);
        console.log(`Transaction Status: ${tx.status} (0=Active, 1=ExecuteReady, 2=Executed)`);
        console.log(`Executed: ${tx.executed}`);
      } catch (error) {
        console.log(`Error: ${error.message}`);
      }
    }

    console.log('\n' + '─'.repeat(80));
    console.log('👤 CHECKING WINNER WALLET');
    console.log('─'.repeat(80));

    const winnerPubkey = new PublicKey(winner);
    const winnerBalance = await connection.getBalance(winnerPubkey, 'confirmed');
    console.log(`Winner: ${winner}`);
    console.log(`Current Balance: ${(winnerBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    console.log('\n' + '─'.repeat(80));
    console.log('💼 CHECKING FEE WALLET');
    console.log('─'.repeat(80));

    const feeWalletPubkey = new PublicKey(FEE_WALLET);
    const feeBalance = await connection.getBalance(feeWalletPubkey, 'confirmed');
    console.log(`Fee Wallet: ${FEE_WALLET}`);
    console.log(`Current Balance: ${(feeBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

    console.log('\n' + '─'.repeat(80));
    console.log('📜 CHECKING VAULT TRANSACTION HISTORY');
    console.log('─'.repeat(80));

    const vaultSignatures = await connection.getSignaturesForAddress(vaultPubkey, { limit: 10 });
    console.log(`Found ${vaultSignatures.length} recent transactions`);

    let foundPayout = false;
    for (const sig of vaultSignatures.slice(0, 10)) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && !tx.meta.err) {
          const preBalances = tx.meta.preBalances || [];
          const postBalances = tx.meta.postBalances || [];
          
          const message = tx.transaction.message;
          let accountKeys = [];
          if (message.accountKeys) {
            accountKeys = message.accountKeys;
          } else if (message.getAccountKeys) {
            accountKeys = message.getAccountKeys().staticAccountKeys;
          } else {
            accountKeys = message.staticAccountKeys || [];
          }

          const vaultIndex = accountKeys.findIndex((key) => {
            const keyStr = key?.toString?.() || key?.toBase58?.() || String(key);
            return keyStr === vaultPda;
          });

          if (vaultIndex >= 0) {
            const preBalance = preBalances[vaultIndex] || 0;
            const postBalance = postBalances[vaultIndex] || 0;
            const sent = (preBalance - postBalance) / LAMPORTS_PER_SOL;

            if (sent > 0.01) {
              console.log(`\n✅ Found payout transaction:`);
              console.log(`   Signature: ${sig.signature}`);
              console.log(`   Vault sent: ${sent.toFixed(6)} SOL`);
              console.log(`   Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);

              // Check recipients
              for (let i = 0; i < accountKeys.length; i++) {
                const key = accountKeys[i];
                const keyStr = key?.toString?.() || key?.toBase58?.() || String(key);
                const preBal = preBalances[i] || 0;
                const postBal = postBalances[i] || 0;
                const received = (postBal - preBal) / LAMPORTS_PER_SOL;

                if (received > 0.01 && keyStr !== vaultPda) {
                  const isWinner = keyStr === winner;
                  const isFee = keyStr === FEE_WALLET;
                  const label = isWinner ? ' (WINNER)' : isFee ? ' (FEE WALLET)' : '';
                  console.log(`   → ${keyStr}${label}: +${received.toFixed(6)} SOL`);
                  if (isWinner || isFee) foundPayout = true;
                }
              }
            }
          }
        }
      } catch (error) {
        // Skip
      }
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('═'.repeat(80));

    const expectedWinner = match.payout?.winnerAmount || 0;
    const expectedFee = match.payout?.feeAmount || 0;

    console.log(`\nExpected:`);
    console.log(`  Winner Payout: ${expectedWinner.toFixed(6)} SOL`);
    console.log(`  Fee: ${expectedFee.toFixed(6)} SOL`);

    console.log(`\nOn-Chain State:`);
    console.log(`  Vault Balance: ${vaultBalanceSOL.toFixed(6)} SOL`);
    console.log(`  Transaction Account: ${transactionAccount ? 'EXISTS' : 'CLOSED (executed)'}`);
    console.log(`  Found Payout Transaction: ${foundPayout ? '✅ YES' : '❌ NO'}`);

    console.log(`\n${'═'.repeat(80)}`);
    if (!transactionAccount && vaultBalanceSOL < 0.01) {
      console.log('✅ VERIFICATION PASSED: Funds were released');
      console.log('   - Transaction account is closed (executed)');
      console.log('   - Vault balance is at rent reserve');
    } else if (foundPayout) {
      console.log('✅ VERIFICATION PASSED: Payout transaction found');
      console.log('   - Funds were transferred to winner and/or fee wallet');
    } else {
      console.log('⚠️  VERIFICATION INCONCLUSIVE');
      console.log('   - Check Solana Explorer for detailed transaction history');
      console.log(`   - Vault: https://explorer.solana.com/address/${vaultPda}?cluster=devnet`);
      console.log(`   - Winner: https://explorer.solana.com/address/${winner}?cluster=devnet`);
    }
    console.log('═'.repeat(80) + '\n');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

verifyPayout().catch(console.error);

