#!/usr/bin/env node
/**
 * Verification script to check if a player's signature is actually on-chain
 * for a given proposal.
 * 
 * Usage: node verify-signer-onchain.js <matchId> [walletAddress]
 * Example: node verify-signer-onchain.js 5e5187ad-712e-4ef8-9ce9-93883d322427 F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { accounts, getProposalPda } = require('@sqds/multisig');
const { AppDataSource } = require('../src/db');
const { Match } = require('../src/models/Match');

const PROGRAM_ID = new PublicKey('SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf'); // Devnet

async function verifySignerOnChain(matchId, walletAddress = null) {
  const connection = new Connection(
    process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
    'confirmed'
  );

  try {
    await AppDataSource.initialize();
    const matchRepository = AppDataSource.getRepository(Match);

    const match = await matchRepository.findOne({ where: { id: matchId } });

    if (!match) {
      console.error(`❌ Match with ID ${matchId} not found in database.`);
      return;
    }

    const multisigAddress = new PublicKey(match.squadsVaultAddress);
    const proposalId = match.payoutProposalId || match.tieRefundProposalId;

    if (!proposalId) {
      console.log(`ℹ️ Match ${matchId} has no proposal ID yet.`);
      return;
    }

    const proposalPda = new PublicKey(proposalId);
    console.log(`\n📋 Verifying on-chain state for Match ID: ${matchId}`);
    console.log(`Proposal PDA: ${proposalPda.toString()}`);
    console.log(`Multisig Address: ${multisigAddress.toString()}`);

    // Fetch Proposal account
    let proposalAccount;
    try {
      proposalAccount = await accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );
    } catch (error) {
      console.error(`❌ Failed to fetch Proposal account ${proposalPda.toString()}: ${error.message}`);
      return;
    }

    const statusKind = proposalAccount.status?.__kind || 'Unknown';
    const approvedSigners = Array.isArray(proposalAccount.approved)
      ? proposalAccount.approved.map(s => s.toString().toLowerCase())
      : [];
    const threshold = proposalAccount.threshold ? Number(proposalAccount.threshold) : 'N/A';

    console.log('\n📊 ON-CHAIN PROPOSAL STATUS:');
    console.log('Status Kind:', statusKind);
    console.log('Executed:', proposalAccount.executed);
    console.log('Approved Signers (on-chain):', approvedSigners);
    console.log('Signer Count (on-chain):', approvedSigners.length);
    console.log('Threshold:', threshold);
    console.log('Ready to Execute:', statusKind === 'ExecuteReady' || (statusKind === 'Approved' && approvedSigners.length >= threshold));

    // Compare with database
    const dbSigners = match.proposalSigners 
      ? (typeof match.proposalSigners === 'string' 
          ? JSON.parse(match.proposalSigners) 
          : match.proposalSigners)
          .map(s => s.toString().toLowerCase())
      : [];
    
    console.log('\n📊 DATABASE STATE:');
    console.log('Proposal Status (DB):', match.proposalStatus);
    console.log('Needs Signatures (DB):', match.needsSignatures);
    console.log('Signers (DB):', dbSigners);
    console.log('Signer Count (DB):', dbSigners.length);

    // Compare
    console.log('\n🔍 COMPARISON:');
    const missingOnChain = dbSigners.filter(s => !approvedSigners.includes(s));
    const missingInDB = approvedSigners.filter(s => !dbSigners.includes(s));
    
    if (missingOnChain.length > 0) {
      console.log('❌ MISMATCH: Signers in DB but NOT on-chain:', missingOnChain);
    }
    if (missingInDB.length > 0) {
      console.log('⚠️ MISMATCH: Signers on-chain but NOT in DB:', missingInDB);
    }
    if (missingOnChain.length === 0 && missingInDB.length === 0) {
      console.log('✅ MATCH: DB and on-chain signers are in sync');
    }

    // Check specific wallet if provided
    if (walletAddress) {
      const walletLower = walletAddress.toLowerCase();
      const onChain = approvedSigners.includes(walletLower);
      const inDB = dbSigners.includes(walletLower);
      
      console.log(`\n🔍 WALLET VERIFICATION: ${walletAddress}`);
      console.log('On-chain:', onChain ? '✅ YES' : '❌ NO');
      console.log('In DB:', inDB ? '✅ YES' : '❌ NO');
      
      if (!onChain && inDB) {
        console.log('❌ CRITICAL: Wallet is in DB but NOT on-chain - signature was never confirmed!');
        console.log('   Action: User must re-sign the proposal');
      } else if (onChain && !inDB) {
        console.log('⚠️ WARNING: Wallet is on-chain but NOT in DB - database needs update');
      } else if (onChain && inDB) {
        console.log('✅ VERIFIED: Wallet signature is confirmed on-chain and in DB');
      } else {
        console.log('ℹ️ INFO: Wallet has not signed yet');
      }
    }

    // Summary
    console.log('\n📋 SUMMARY:');
    console.log('On-chain Status:', statusKind);
    console.log('On-chain Signers:', approvedSigners.length, '/', threshold);
    console.log('DB Signers:', dbSigners.length);
    console.log('DB Status:', match.proposalStatus);
    console.log('DB Needs Signatures:', match.needsSignatures);
    
    if (statusKind === 'ExecuteReady' || (statusKind === 'Approved' && approvedSigners.length >= threshold)) {
      console.log('✅ Proposal is ready to execute on-chain');
    } else {
      console.log('⏳ Proposal is NOT ready to execute on-chain');
    }

  } catch (error) {
    console.error('❌ Error verifying signer on-chain:', error.message);
    console.error(error.stack);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

const matchIdArg = process.argv[2];
const walletArg = process.argv[3];

if (!matchIdArg) {
  console.error('❌ Usage: node verify-signer-onchain.js <matchId> [walletAddress]');
  console.error('Example: node verify-signer-onchain.js 5e5187ad-712e-4ef8-9ce9-93883d322427 F4WKQYkUDBiFxCEMH49NpjjipCeHyG5a45isY8o7wpZ8');
  process.exit(1);
}

verifySignerOnChain(matchIdArg, walletArg).then(() => {
  console.log('\n✅ Verification complete');
  process.exit(0);
}).catch(error => {
  console.error('❌ Fatal error during verification:', error);
  process.exit(1);
});

