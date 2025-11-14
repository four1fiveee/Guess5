/**
 * JavaScript version of fixStuckMatch script
 * Usage: From backend root: node scripts/fixStuckMatch.js <matchId>
 * 
 * This avoids TypeScript compilation issues
 */

// Use require since we're in a script context
const path = require('path');

// Change to backend directory
const backendRoot = path.resolve(__dirname, '..');
process.chdir(backendRoot);

// Now require from the backend root
const { AppDataSource } = require('../dist/db');
const { Match } = require('../dist/models/Match');
const { SquadsVaultService } = require('../dist/services/squadsVaultService');
const { PublicKey } = require('@solana/web3.js');

const matchId = process.argv[2] || 'aebc06bb-30ef-465f-8fc1-eae608ecae39';

async function fixStuckMatch() {
  try {
    console.log('🔧 Fixing stuck match:', matchId);
    
    // Initialize database
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connected');
    }
    
    const matchRepository = AppDataSource.getRepository(Match);
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error('❌ Match not found:', matchId);
      process.exit(1);
    }
    
    console.log('📋 Match found:', {
      id: match.id,
      winner: match.winner,
      isCompleted: match.isCompleted,
      player1: match.player1,
      player2: match.player2,
      vaultAddress: match.squadsVaultAddress,
      entryFee: match.entryFee,
    });
    
    // Check if match is a tie
    if (match.winner !== 'tie') {
      console.error('❌ Match is not a tie. Winner:', match.winner);
      process.exit(1);
    }
    
    // Check if match is completed
    if (!match.isCompleted) {
      console.error('❌ Match is not completed yet');
      process.exit(1);
    }
    
    // Check if proposal already exists
    if (match.tieRefundProposalId) {
      console.log('✅ Proposal already exists:', match.tieRefundProposalId);
      console.log('   Match is already fixed!');
      process.exit(0);
    }
    
    // Check if vault exists
    if (!match.squadsVaultAddress) {
      console.error('❌ Squads vault not found for this match');
      process.exit(1);
    }
    
    // Determine if this is a losing tie
    const player1Result = match.getPlayer1Result();
    const player2Result = match.getPlayer2Result();
    const isLosingTie = !player1Result?.won && !player2Result?.won;
    
    if (!isLosingTie) {
      console.error('❌ This script only fixes losing ties (both players failed)');
      process.exit(1);
    }
    
    // Calculate refund amount (95% of entry fee)
    const entryFee = match.entryFee;
    const refundAmount = entryFee * 0.95;
    
    console.log('🔄 Creating tie refund proposal...');
    console.log({
      vaultAddress: match.squadsVaultAddress,
      player1: match.player1,
      player2: match.player2,
      refundAmount,
    });
    
    // Create Squads proposal
    const squadsService = new SquadsVaultService();
    const proposalResult = await squadsService.proposeTieRefund(
      match.squadsVaultAddress,
      new PublicKey(match.player1),
      new PublicKey(match.player2),
      refundAmount
    );
    
    if (!proposalResult.success || !proposalResult.proposalId) {
      console.error('❌ Failed to create proposal:', proposalResult.error);
      process.exit(1);
    }
    
    // Save proposal ID to match
    match.tieRefundProposalId = proposalResult.proposalId;
    await matchRepository.save(match);
    
    console.log('✅ Tie refund proposal created and saved!');
    console.log({
      proposalId: proposalResult.proposalId,
      needsSignatures: proposalResult.needsSignatures || 2,
    });
    
    console.log('\n🎉 Match fixed! Players can now sign the proposal.');
    
    process.exit(0);
    
  } catch (error) {
    console.error('❌ Error fixing match:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

fixStuckMatch();








