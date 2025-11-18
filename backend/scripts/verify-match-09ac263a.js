/**
 * Verify match 09ac263a-db41-4a43-bd0b-4f7c6cea8bc5
 * Checks database and on-chain state
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { getTransactionPda, getProposalPda, accounts } = require('@sqds/multisig');

const MATCH_ID = '09ac263a-db41-4a43-bd0b-4f7c6cea8bc5';

async function main() {
  console.log(`\n🔍 Verifying Match: ${MATCH_ID}\n`);

  const RPC = process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com';
  const connection = new Connection(RPC, 'confirmed');
  const programId = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf');

  // Get match data from database
  try {
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

    console.log('📋 Match Details from Database:');
    const matchDetails = {
      matchId: match.id,
      vaultAddress: match.squadsVaultAddress,
      vaultPda: match.squadsVaultPda,
      proposalId: match.payoutProposalId || match.tieRefundProposalId,
      proposalStatus: match.proposalStatus,
      needsSignatures: match.needsSignatures,
      proposalSigners: match.proposalSigners,
      proposalExecutedAt: match.proposalExecutedAt,
      proposalTransactionId: match.proposalTransactionId,
      player1: match.player1,
      player2: match.player2,
    };
    console.log(JSON.stringify(matchDetails, null, 2));

    if (!match.squadsVaultAddress) {
      console.error('❌ No vault address found');
      await AppDataSource.destroy();
      process.exit(1);
    }

    const proposalId = match.payoutProposalId || match.tieRefundProposalId;
    if (!proposalId) {
      console.error('❌ No proposal ID found');
      await AppDataSource.destroy();
      process.exit(1);
    }

    const multisigAddress = new PublicKey(match.squadsVaultAddress);
    const transactionIndex = BigInt(proposalId);

    // Get PDAs
    const [transactionPda] = getTransactionPda({
      multisigPda: multisigAddress,
      index: transactionIndex,
      programId,
    });

    const [proposalPda] = getProposalPda({
      multisigPda: multisigAddress,
      transactionIndex,
      programId,
    });

    console.log('\n📍 Derived PDAs:');
    console.log({
      transactionPda: transactionPda.toString(),
      proposalPda: proposalPda.toString(),
    });

    // Check if transaction account exists (should be closed if executed)
    const transactionAccount = await connection.getAccountInfo(transactionPda, 'confirmed');
    
    if (!transactionAccount) {
      console.log('\n✅ Transaction account CLOSED - Proposal was EXECUTED!');
      console.log('✅ Funds should have been released');
      
      // Check vault balance
      if (match.squadsVaultPda) {
        const vaultBalance = await connection.getBalance(new PublicKey(match.squadsVaultPda), 'confirmed');
        console.log('\n💰 Final Vault Balance:');
        console.log({
          balanceSOL: (vaultBalance / 1e9).toFixed(6),
          balanceLamports: vaultBalance,
          note: 'Should be ~0.0025 SOL (rent-exempt reserve only) if executed',
        });
      }
      
      await AppDataSource.destroy();
      return;
    }

    // Decode transaction account
    console.log('\n📊 VaultTransaction Account On-Chain:');
    try {
      const transaction = await accounts.VaultTransaction.fromAccountAddress(
        connection,
        transactionPda
      );

      const vaultTxStatus = transaction.status;
      const vaultTxApprovals = transaction.approvals || [];
      const vaultTxThreshold = transaction.threshold?.toNumber() || 2;

      const vaultTxInfo = {
        status: vaultTxStatus,
        statusType: typeof vaultTxStatus,
        statusMeaning: vaultTxStatus === 0 ? 'Active' : vaultTxStatus === 1 ? 'ExecuteReady' : vaultTxStatus === 2 ? 'Executed' : 'Unknown',
        approvals: vaultTxApprovals.map((a) => a?.toString?.() || String(a)),
        approvalCount: vaultTxApprovals.length,
        threshold: vaultTxThreshold,
        hasEnoughSignatures: vaultTxApprovals.length >= vaultTxThreshold,
        isExecuteReady: vaultTxStatus === 1,
      };
      console.log(JSON.stringify(vaultTxInfo, null, 2));
      
      if (vaultTxInfo.approvalCount < vaultTxInfo.threshold) {
        console.log(`\n⚠️  Vault transaction has only ${vaultTxInfo.approvalCount}/${vaultTxInfo.threshold} signatures`);
        console.log('   This means the vault transaction signing fix may not have worked, or player needs to also sign vault transaction');
      } else if (vaultTxInfo.isExecuteReady) {
        console.log('\n✅ Vault transaction is ExecuteReady!');
      } else {
        console.log(`\n⚠️  Vault transaction has enough signatures but status is ${vaultTxInfo.statusMeaning} (not ExecuteReady)`);
      }
    } catch (error) {
      console.error('❌ Failed to decode VaultTransaction:', error.message);
    }

    // Check proposal account
    console.log('\n📊 Proposal Account On-Chain:');
    try {
      const proposal = await accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );

      const proposalStatusKind = proposal.status?.__kind;
      const proposalApproved = proposal.approved || [];
      const approvedCount = Array.isArray(proposalApproved) ? proposalApproved.length : 0;

      const proposalInfo = {
        statusKind: proposalStatusKind,
        approved: proposalApproved.map((s) => s?.toString?.() || String(s)),
        approvedCount,
        isExecuteReady: proposalStatusKind === 'ExecuteReady',
      };
      console.log(JSON.stringify(proposalInfo, null, 2));

      // Check if ExecuteReady
      const isExecuteReady = proposalStatusKind === 'ExecuteReady';
      console.log(`\n${isExecuteReady ? '✅' : '❌'} Proposal is ${isExecuteReady ? 'ExecuteReady' : 'NOT ExecuteReady'}`);
      
      if (!isExecuteReady) {
        console.log(`   Current status: ${proposalStatusKind}`);
        if (proposalStatusKind === 'Approved' && approvedCount >= 2) {
          console.log('   ⚠️  Proposal is Approved with enough signatures but not ExecuteReady');
          console.log('   This suggests vault transaction may not have enough signatures');
        }
      }
    } catch (error) {
      console.error('❌ Failed to decode Proposal:', error.message);
    }

    // Check vault balance
    if (match.squadsVaultPda) {
      const vaultBalance = await connection.getBalance(new PublicKey(match.squadsVaultPda), 'confirmed');
      console.log('\n💰 Vault Balance:');
      console.log(JSON.stringify({
        balanceSOL: (vaultBalance / 1e9).toFixed(6),
        balanceLamports: vaultBalance,
        note: 'Should be ~0.0025 SOL (rent-exempt reserve only) if executed',
        expectedIfExecuted: '~0.0025 SOL',
      }, null, 2));
      
      if (vaultBalance > 0.01 * 1e9) {
        console.log('\n⚠️  Vault still has significant balance - execution likely did not occur');
      }
    }

    // Check player and fee wallet balances
    const playerWallet = match.player1 || match.player2;
    const feeWallet = '2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt';
    
    if (playerWallet) {
      const playerBalance = await connection.getBalance(new PublicKey(playerWallet), 'confirmed');
      console.log('\n👤 Player Wallet Balance:');
      console.log(JSON.stringify({
        wallet: playerWallet,
        balanceSOL: (playerBalance / 1e9).toFixed(6),
      }, null, 2));
    }
    
    const feeBalance = await connection.getBalance(new PublicKey(feeWallet), 'confirmed');
    console.log('\n💼 Fee Wallet Balance:');
    console.log(JSON.stringify({
      wallet: feeWallet,
      balanceSOL: (feeBalance / 1e9).toFixed(6),
    }, null, 2));

    await AppDataSource.destroy();
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

