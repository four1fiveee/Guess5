/**
 * Manual script to sync proposal status and execute for a specific match
 * Usage: node scripts/manual-sync-and-execute.js <matchId>
 */

require('dotenv').config({ path: '.env.local' });
const { AppDataSource } = require('../dist/db');
const { proposalSyncService } = require('../dist/services/proposalSyncService');
const { SquadsVaultService } = require('../dist/services/squadsVaultService');

async function main() {
  const matchId = process.argv[2];
  
  if (!matchId) {
    console.error('❌ Usage: node scripts/manual-sync-and-execute.js <matchId>');
    process.exit(1);
  }
  
  console.log('🔄 Manual Sync and Execute Script');
  console.log('Match ID:', matchId);
  console.log('');
  
  try {
    // Initialize database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database initialized');
    }
    
    // Get match from database
    const matchRepository = AppDataSource.getRepository('Match');
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    console.log('📊 Current Database State:');
    console.log('  Proposal Status:', match.proposalStatus);
    console.log('  Proposal Signers:', match.proposalSigners);
    console.log('  Proposal ID:', match.payoutProposalId);
    console.log('  Vault Address:', match.squadsVaultAddress);
    console.log('');
    
    // Step 1: Sync proposal status
    console.log('🔄 Step 1: Syncing proposal status from on-chain...');
    const { syncProposalIfNeeded, findAndSyncApprovedProposal } = require('../dist/services/proposalSyncService');
    
    // Try to sync existing proposal
    const syncResult = await syncProposalIfNeeded(
      matchId,
      match.squadsVaultAddress,
      match.payoutProposalId
    );
    
    console.log('  Sync Result:', syncResult);
    
    // If sync didn't find approved proposal, search for it
    if (!syncResult || syncResult.status !== 'APPROVED') {
      console.log('  Searching for approved proposal...');
      const autoFixResult = await findAndSyncApprovedProposal(
        matchId,
        match.squadsVaultAddress
      );
      console.log('  Auto-fix Result:', autoFixResult);
    }
    
    // Refresh match from database
    await matchRepository.manager.query('SELECT 1'); // Force refresh
    const updatedMatch = await matchRepository.findOne({ where: { id: matchId } });
    
    console.log('');
    console.log('📊 Updated Database State:');
    console.log('  Proposal Status:', updatedMatch.proposalStatus);
    console.log('  Proposal Signers:', updatedMatch.proposalSigners);
    console.log('');
    
    // Step 2: Execute if approved
    if (updatedMatch.proposalStatus === 'APPROVED' || updatedMatch.proposalStatus === 'READY_TO_EXECUTE') {
      console.log('⚡ Step 2: Executing proposal...');
      
      const squadsService = new SquadsVaultService();
      const executionResult = await squadsService.executeProposal(
        updatedMatch.squadsVaultAddress,
        updatedMatch.payoutProposalId,
        require('../dist/config/wallet').getFeeWalletKeypair(),
        updatedMatch.squadsVaultPda
      );
      
      console.log('  Execution Result:', executionResult);
      
      if (executionResult.success) {
        console.log('✅ Proposal executed successfully!');
        console.log('  Transaction Signature:', executionResult.signature);
      } else {
        console.error('❌ Execution failed:', executionResult.error);
      }
    } else {
      console.log('⏸️  Proposal not ready for execution');
      console.log('  Status:', updatedMatch.proposalStatus);
      console.log('  Signers:', updatedMatch.proposalSigners);
    }
    
    console.log('');
    console.log('✅ Script completed');
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

main();

