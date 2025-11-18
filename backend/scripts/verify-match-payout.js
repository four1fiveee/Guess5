/**
 * Comprehensive verification script to check if vault funds were released to winner and fee wallet
 * Usage: node backend/scripts/verify-match-payout.js <matchId>
 */

const { Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { getTransactionPda, getProposalPda, accounts } = require('@sqds/multisig');

const MATCH_ID = process.argv[2];
const FEE_WALLET = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';

if (!MATCH_ID) {
  console.error('Usage: node backend/scripts/verify-match-payout.js <matchId>');
  process.exit(1);
}

async function verifyMatchPayout() {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    console.log('\n' + '═'.repeat(80));
    console.log(`🔍 VERIFYING MATCH PAYOUT: ${MATCH_ID}`);
    console.log('═'.repeat(80) + '\n');

    // Initialize database
    const { AppDataSource } = require('../src/db/index');
    await AppDataSource.initialize();
    const { Match } = require('../src/models/Match');
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: MATCH_ID } });

    if (!match) {
      console.error('❌ Match not found:', MATCH_ID);
      await AppDataSource.destroy();
      process.exit(1);
    }

    // Display match details
    console.log('📋 Match Details:');
    console.log(JSON.stringify({
      matchId: match.id,
      player1: match.player1,
      player2: match.player2,
      winner: match.winner,
      entryFee: match.entryFee,
      status: match.status,
      vaultAddress: match.squadsVaultAddress,
      vaultPda: match.squadsVaultPda,
      proposalId: match.payoutProposalId || match.tieRefundProposalId,
      proposalStatus: match.proposalStatus,
      proposalExecutedAt: match.proposalExecutedAt,
      proposalTransactionId: match.proposalTransactionId,
    }, null, 2));

    if (!match.squadsVaultAddress || !match.squadsVaultPda) {
      console.error('❌ Missing vault information');
      await AppDataSource.destroy();
      process.exit(1);
    }

    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    if (!proposalId) {
      console.error('❌ No proposal ID found');
      await AppDataSource.destroy();
      process.exit(1);
    }

    const winner = match.winner;
    if (!winner) {
      console.error('❌ No winner found in match');
      await AppDataSource.destroy();
      process.exit(1);
    }

    console.log('\n' + '─'.repeat(80));
    console.log('💰 CHECKING VAULT BALANCE');
    console.log('─'.repeat(80));

    // Check vault balance
    const vaultPda = new PublicKey(match.squadsVaultPda);
    const vaultBalance = await connection.getBalance(vaultPda, 'confirmed');
    const vaultBalanceSOL = vaultBalance / LAMPORTS_PER_SOL;

    console.log(`Vault PDA: ${match.squadsVaultPda}`);
    console.log(`Current Balance: ${vaultBalanceSOL.toFixed(6)} SOL (${vaultBalance} lamports)`);

    // Check account info for rent exemption
    const vaultAccountInfo = await connection.getAccountInfo(vaultPda, 'confirmed');
    if (vaultAccountInfo) {
      const rentExemptReserve = await connection.getMinimumBalanceForRentExemption(
        vaultAccountInfo.data.length
      );
      const rentExemptSOL = rentExemptReserve / LAMPORTS_PER_SOL;
      const transferableBalance = (vaultBalance - rentExemptReserve) / LAMPORTS_PER_SOL;

      console.log(`Rent-Exempt Reserve: ${rentExemptSOL.toFixed(6)} SOL`);
      console.log(`Transferable Balance: ${transferableBalance.toFixed(6)} SOL`);

      if (vaultBalanceSOL > 0.01) {
        console.log('⚠️  WARNING: Vault still has significant balance - funds may not have been released');
      } else {
        console.log('✅ Vault balance is at rent reserve - funds likely released');
      }
    }

    console.log('\n' + '─'.repeat(80));
    console.log('📊 CHECKING PROPOSAL EXECUTION STATUS');
    console.log('─'.repeat(80));

    // Check proposal execution status
    const multisigPda = new PublicKey(match.squadsVaultAddress);
    const transactionIndex = BigInt(proposalId);
    const programId = new PublicKey(
      process.env.SQUADS_PROGRAM_ID || 'SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'
    );

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

    // Check if transaction account exists (should be closed if executed)
    const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
    if (!transactionAccount) {
      console.log('✅ Transaction account CLOSED - Proposal was EXECUTED!');
    } else {
      console.log('⚠️  Transaction account EXISTS - Proposal may NOT be executed');
      try {
        const transaction = await accounts.VaultTransaction.fromAccountAddress(
          connection,
          transactionPda
        );
        const status = transaction.status;
        const executed = transaction.executed;
        console.log(`Transaction Status: ${status} (0=Active, 1=ExecuteReady, 2=Executed)`);
        console.log(`Executed: ${executed}`);
      } catch (error) {
        console.log(`Error decoding transaction: ${error.message}`);
      }
    }

    // Check proposal account
    try {
      const proposal = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
      const proposalStatus = proposal.status;
      const proposalStatusKind = proposalStatus?.__kind;
      console.log(`Proposal Status: ${proposalStatusKind}`);
    } catch (error) {
      console.log(`Error decoding proposal: ${error.message}`);
    }

    console.log('\n' + '─'.repeat(80));
    console.log('👤 CHECKING WINNER WALLET BALANCE');
    console.log('─'.repeat(80));

    // Check winner wallet balance
    const winnerPubkey = new PublicKey(winner);
    const winnerBalance = await connection.getBalance(winnerPubkey, 'confirmed');
    const winnerBalanceSOL = winnerBalance / LAMPORTS_PER_SOL;

    console.log(`Winner Wallet: ${winner}`);
    console.log(`Current Balance: ${winnerBalanceSOL.toFixed(6)} SOL`);

    // Check winner's transaction history for recent transfers
    console.log('\n📜 Checking winner transaction history...');
    const winnerSignatures = await connection.getSignaturesForAddress(winnerPubkey, { limit: 10 });
    console.log(`Found ${winnerSignatures.length} recent transactions`);

    let winnerReceivedFunds = false;
    for (const sig of winnerSignatures.slice(0, 5)) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && !tx.meta.err) {
          const preBalances = tx.meta.preBalances || [];
          const postBalances = tx.meta.postBalances || [];
          
          // Handle both legacy and versioned transactions
          const message = tx.transaction.message;
          let accountKeys = [];
          if (message.accountKeys) {
            // Legacy transaction
            accountKeys = message.accountKeys;
          } else if (message.getAccountKeys && typeof message.getAccountKeys === 'function') {
            // Versioned transaction (MessageV0)
            accountKeys = message.getAccountKeys().staticAccountKeys;
          } else {
            // Fallback
            accountKeys = message.staticAccountKeys || [];
          }

          const winnerIndex = accountKeys.findIndex((key) => {
            const keyStr = key?.toString?.() || key?.toBase58?.() || String(key);
            return keyStr === winner;
          });

          if (winnerIndex >= 0) {
            const preBalance = preBalances[winnerIndex] || 0;
            const postBalance = postBalances[winnerIndex] || 0;
            const balanceChange = (postBalance - preBalance) / LAMPORTS_PER_SOL;

            if (balanceChange > 0.1) {
              // Significant increase
              console.log(`\n  ✅ Found transfer to winner:`);
              console.log(`     Signature: ${sig.signature}`);
              console.log(`     Amount Received: ${balanceChange.toFixed(6)} SOL`);
              console.log(`     Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
              winnerReceivedFunds = true;
            }
          }
        }
      } catch (error) {
        // Skip errors
      }
    }

    if (!winnerReceivedFunds) {
      console.log('⚠️  No significant transfers to winner wallet found in recent transactions');
    }

    console.log('\n' + '─'.repeat(80));
    console.log('💼 CHECKING FEE WALLET BALANCE');
    console.log('─'.repeat(80));

    // Check fee wallet balance
    const feeWalletPubkey = new PublicKey(FEE_WALLET);
    const feeWalletBalance = await connection.getBalance(feeWalletPubkey, 'confirmed');
    const feeWalletBalanceSOL = feeWalletBalance / LAMPORTS_PER_SOL;

    console.log(`Fee Wallet: ${FEE_WALLET}`);
    console.log(`Current Balance: ${feeWalletBalanceSOL.toFixed(6)} SOL`);

    // Check fee wallet transaction history
    console.log('\n📜 Checking fee wallet transaction history...');
    const feeSignatures = await connection.getSignaturesForAddress(feeWalletPubkey, { limit: 10 });
    console.log(`Found ${feeSignatures.length} recent transactions`);

    let feeWalletReceivedFunds = false;
    for (const sig of feeSignatures.slice(0, 5)) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && !tx.meta.err) {
          const preBalances = tx.meta.preBalances || [];
          const postBalances = tx.meta.postBalances || [];
          
          // Handle both legacy and versioned transactions
          const message = tx.transaction.message;
          let accountKeys = [];
          if (message.accountKeys) {
            // Legacy transaction
            accountKeys = message.accountKeys;
          } else if (message.getAccountKeys && typeof message.getAccountKeys === 'function') {
            // Versioned transaction (MessageV0)
            accountKeys = message.getAccountKeys().staticAccountKeys;
          } else {
            // Fallback
            accountKeys = message.staticAccountKeys || [];
          }

          const feeIndex = accountKeys.findIndex((key) => {
            const keyStr = key?.toString?.() || key?.toBase58?.() || String(key);
            return keyStr === FEE_WALLET;
          });

          if (feeIndex >= 0) {
            const preBalance = preBalances[feeIndex] || 0;
            const postBalance = postBalances[feeIndex] || 0;
            const balanceChange = (postBalance - preBalance) / LAMPORTS_PER_SOL;

            if (balanceChange > 0.01) {
              // Significant increase
              console.log(`\n  ✅ Found transfer to fee wallet:`);
              console.log(`     Signature: ${sig.signature}`);
              console.log(`     Amount Received: ${balanceChange.toFixed(6)} SOL`);
              console.log(`     Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
              feeWalletReceivedFunds = true;
            }
          }
        }
      } catch (error) {
        // Skip errors
      }
    }

    if (!feeWalletReceivedFunds) {
      console.log('⚠️  No significant transfers to fee wallet found in recent transactions');
    }

    // Check vault transaction history for outbound transfers
    console.log('\n' + '─'.repeat(80));
    console.log('📜 CHECKING VAULT TRANSACTION HISTORY');
    console.log('─'.repeat(80));

    const vaultSignatures = await connection.getSignaturesForAddress(vaultPda, { limit: 10 });
    console.log(`Found ${vaultSignatures.length} recent transactions`);

    let vaultSentFunds = false;
    for (const sig of vaultSignatures.slice(0, 10)) {
      try {
        const tx = await connection.getTransaction(sig.signature, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });

        if (tx && tx.meta && !tx.meta.err) {
          const preBalances = tx.meta.preBalances || [];
          const postBalances = tx.meta.postBalances || [];
          
          // Handle both legacy and versioned transactions
          const message = tx.transaction.message;
          let accountKeys = [];
          if (message.accountKeys) {
            // Legacy transaction
            accountKeys = message.accountKeys;
          } else if (message.getAccountKeys && typeof message.getAccountKeys === 'function') {
            // Versioned transaction (MessageV0)
            accountKeys = message.getAccountKeys().staticAccountKeys;
          } else {
            // Fallback
            accountKeys = message.staticAccountKeys || [];
          }

          const vaultIndex = accountKeys.findIndex((key) => {
            const keyStr = key?.toString?.() || key?.toBase58?.() || String(key);
            return keyStr === match.squadsVaultPda;
          });

          if (vaultIndex >= 0) {
            const preBalance = preBalances[vaultIndex] || 0;
            const postBalance = postBalances[vaultIndex] || 0;
            const balanceChange = (preBalance - postBalance) / LAMPORTS_PER_SOL;

            if (balanceChange > 0.01) {
              // Significant decrease
              console.log(`\n  ✅ Found outbound transfer from vault:`);
              console.log(`     Signature: ${sig.signature}`);
              console.log(`     Amount Sent: ${balanceChange.toFixed(6)} SOL`);
              console.log(`     Block Time: ${sig.blockTime ? new Date(sig.blockTime * 1000).toISOString() : 'N/A'}`);
              console.log(`     Status: ${tx.meta.err ? 'FAILED' : 'SUCCESS'}`);

              // Check which accounts received funds
              for (let i = 0; i < accountKeys.length; i++) {
                const accountKey = accountKeys[i];
                const accountStr = accountKey?.toString?.() || accountKey?.toBase58?.() || String(accountKey);
                const preBal = preBalances[i] || 0;
                const postBal = postBalances[i] || 0;
                const change = (postBal - preBal) / LAMPORTS_PER_SOL;

                if (change > 0.01 && accountStr !== match.squadsVaultPda) {
                  const isWinner = accountStr === winner;
                  const isFeeWallet = accountStr === FEE_WALLET;
                  const label = isWinner ? ' (WINNER)' : isFeeWallet ? ' (FEE WALLET)' : '';
                  console.log(`     → ${accountStr}${label}: +${change.toFixed(6)} SOL`);
                }
              }

              vaultSentFunds = true;
            }
          }
        }
      } catch (error) {
        // Skip errors
      }
    }

    if (!vaultSentFunds) {
      console.log('⚠️  No significant outbound transfers from vault found in recent transactions');
    }

    // Summary
    console.log('\n' + '═'.repeat(80));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('═'.repeat(80));

    const entryFee = parseFloat(match.entryFee.toString());
    const totalDeposited = entryFee * 2;
    const expectedWinnerPayout = entryFee * 1.95; // 95% of both entry fees
    const expectedFee = entryFee * 0.05 * 2; // 5% fee from both players

    console.log(`\nExpected Values:`);
    console.log(`  Total Deposited: ${totalDeposited.toFixed(6)} SOL (${entryFee.toFixed(6)} SOL per player)`);
    console.log(`  Expected Winner Payout: ${expectedWinnerPayout.toFixed(6)} SOL`);
    console.log(`  Expected Fee: ${expectedFee.toFixed(6)} SOL`);

    console.log(`\nActual State:`);
    console.log(`  Vault Balance: ${vaultBalanceSOL.toFixed(6)} SOL`);
    console.log(`  Transaction Account: ${transactionAccount ? 'EXISTS (not executed)' : 'CLOSED (executed)'}`);
    console.log(`  Winner Received Funds: ${winnerReceivedFunds ? '✅ YES' : '❌ NO'}`);
    console.log(`  Fee Wallet Received Funds: ${feeWalletReceivedFunds ? '✅ YES' : '❌ NO'}`);
    console.log(`  Vault Sent Funds: ${vaultSentFunds ? '✅ YES' : '❌ NO'}`);

    // Final verdict
    console.log(`\n${'═'.repeat(80)}`);
    if (!transactionAccount && vaultBalanceSOL < 0.01) {
      console.log('✅ VERIFICATION PASSED: Funds appear to have been released');
      console.log('   - Transaction account is closed (executed)');
      console.log('   - Vault balance is at rent reserve');
    } else if (vaultSentFunds && (winnerReceivedFunds || feeWalletReceivedFunds)) {
      console.log('✅ VERIFICATION PASSED: Funds were transferred');
      console.log('   - Vault sent funds in transaction history');
      console.log('   - Winner or fee wallet received funds');
    } else {
      console.log('⚠️  VERIFICATION INCONCLUSIVE: Unable to confirm funds were released');
      console.log('   - Check Solana Explorer for detailed transaction history');
      console.log(`   - Vault: https://explorer.solana.com/address/${match.squadsVaultPda}?cluster=devnet`);
      console.log(`   - Winner: https://explorer.solana.com/address/${winner}?cluster=devnet`);
      console.log(`   - Fee Wallet: https://explorer.solana.com/address/${FEE_WALLET}?cluster=devnet`);
    }
    console.log('═'.repeat(80) + '\n');

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Error during verification:', error.message);
    console.error(error.stack);
    try {
      const { AppDataSource } = require('../src/db/index');
      if (AppDataSource && AppDataSource.isInitialized) {
        await AppDataSource.destroy();
      }
    } catch (e) {
      // Ignore
    }
    process.exit(1);
  }
}

verifyMatchPayout().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

