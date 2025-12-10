// @ts-nocheck
/**
 * Fix Wrong Proposal Script
 * 
 * Finds the Approved proposal for a match and updates the database to point to it.
 * 
 * Usage:
 *   ts-node scripts/fix-wrong-proposal.ts <matchId>
 */

import 'reflect-metadata';
import { AppDataSource } from '../src/db';
import { getSquadsVaultService } from '../src/services/squadsVaultService';
import { PublicKey } from '@solana/web3.js';

async function main() {
  const matchId = process.argv[2];
  
  if (!matchId) {
    console.error('❌ Usage: ts-node scripts/fix-wrong-proposal.ts <matchId>');
    process.exit(1);
  }

  try {
    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('✅ Database connection initialized');
    }

    const matchRepository = AppDataSource.getRepository('Match');
    const match = await matchRepository.findOne({ where: { id: matchId } });
    
    if (!match) {
      console.error(`❌ Match not found: ${matchId}`);
      process.exit(1);
    }

    const vaultAddress = (match as any).squadsVaultAddress;
    if (!vaultAddress) {
      console.error(`❌ Match has no vault address: ${matchId}`);
      process.exit(1);
    }

    console.log('🔍 Current database state:', {
      matchId,
      vaultAddress,
      currentProposalId: (match as any).payoutProposalId,
      currentStatus: (match as any).proposalStatus,
      currentSigners: (match as any).proposalSigners,
    });

    // Get all proposals for this vault
    const squadsVaultService = getSquadsVaultService();
    
    // Use the Squads SDK to get all proposals
    const { Connection } = require('@solana/web3.js');
    const { getMultisigPda, accounts } = require('@sqds/multisig');
    
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const multisigPda = getMultisigPda({
      createKey: new PublicKey(vaultAddress),
    })[0];
    
    console.log('🔍 Fetching all proposals for vault...', {
      vaultAddress,
      multisigPda: multisigPda.toString(),
    });

    // Get all proposals using getProgramAccounts or similar
    // For now, let's use the service method if available
    let approvedProposal = null;
    let approvedTransactionIndex = null;

    // Try to get proposals by checking transaction indices 0-10
    for (let i = 0; i <= 10; i++) {
      try {
        const { getProposalPda } = require('@sqds/multisig');
        const [proposalPda] = getProposalPda({
          multisig: multisigPda,
          transactionIndex: BigInt(i),
        });
        
        try {
          const proposalAccount = await accounts.Proposal.fromAccountAddress(
            connection,
            proposalPda
          );
          
          const status = (proposalAccount as any).status?.__kind;
          const approved = (proposalAccount as any).approved || [];
          const transactionIndex = (proposalAccount as any).transactionIndex?.toString();
          
          console.log(`📋 Transaction index ${i}:`, {
            proposalPda: proposalPda.toString(),
            status,
            approvedCount: approved.length,
            approved: approved.map((p: PublicKey) => p.toString()),
          });
          
          // Check if this is Approved with both signatures
          if (status === 'Approved' && approved.length >= 2) {
            approvedProposal = proposalPda.toString();
            approvedTransactionIndex = transactionIndex;
            console.log('✅ Found Approved proposal with both signatures!', {
              proposalPda: approvedProposal,
              transactionIndex: approvedTransactionIndex,
              signers: approved.map((p: PublicKey) => p.toString()),
            });
            break;
          }
        } catch (e) {
          // Proposal doesn't exist at this index, continue
          continue;
        }
      } catch (e) {
        console.warn(`⚠️ Could not check transaction index ${i}:`, e?.message);
        continue;
      }
    }

    if (!approvedProposal) {
      console.error('❌ Could not find Approved proposal with both signatures');
      console.log('💡 This might mean:');
      console.log('   1. The proposal hasn\'t been approved yet');
      console.log('   2. The player hasn\'t signed yet');
      console.log('   3. The transaction indices are higher than 10');
      process.exit(1);
    }

    // Update database
    const player1 = (match as any).player1;
    const player2 = (match as any).player2;
    const winner = (match as any).winner;
    
    // Get the approved signers for this proposal
    const { getProposalPda } = require('@sqds/multisig');
    const [proposalPda] = getProposalPda({
      multisig: multisigPda,
      transactionIndex: BigInt(approvedTransactionIndex),
    });
    
    const proposalAccount = await accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );
    
    const approvedSigners = ((proposalAccount as any).approved || []).map((p: PublicKey) => p.toString());
    
    console.log('🔄 Updating database...', {
      oldProposalId: (match as any).payoutProposalId,
      newProposalId: approvedProposal,
      oldStatus: (match as any).proposalStatus,
      newStatus: 'APPROVED',
      oldSigners: JSON.parse((match as any).proposalSigners || '[]'),
      newSigners: approvedSigners,
    });

    await matchRepository.update(match.id, {
      payoutProposalId: approvedProposal,
      proposalStatus: 'APPROVED',
      proposalSigners: JSON.stringify(approvedSigners),
      needsSignatures: 0,
      updatedAt: new Date(),
    });

    console.log('✅ Database updated successfully!', {
      matchId,
      newProposalId: approvedProposal,
      newStatus: 'APPROVED',
      newSigners: approvedSigners,
    });

    // Close database connection
    await AppDataSource.destroy();
    console.log('✅ Database connection closed');
    
  } catch (error: any) {
    console.error('❌ Error fixing proposal:', {
      matchId,
      error: error?.message,
      stack: error?.stack,
    });
    process.exit(1);
  }
}

main();

