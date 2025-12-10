// @ts-nocheck
/**
 * Proposal Sync Service
 * 
 * Provides self-healing proposal synchronization across all backend paths.
 * Ensures database proposal state matches on-chain reality before critical operations.
 */

import { AppDataSource } from '../db';
import { getSquadsVaultService } from './squadsVaultService';
import { PublicKey, Connection } from '@solana/web3.js';

export interface ProposalSyncResult {
  success: boolean;
  synced: boolean;
  matchId: string;
  dbProposalId?: string;
  onChainProposalId?: string;
  dbStatus?: string;
  onChainStatus?: string;
  error?: string;
  changes?: {
    proposalId?: { from: string; to: string };
    proposalStatus?: { from: string; to: string };
    transactionIndex?: { from: string; to: string };
    signers?: { from: string[]; to: string[] };
  };
}

/**
 * Sync proposal status from on-chain to database
 * This is the core self-healing function that should be called before any
 * operation that depends on proposal state.
 */
export async function syncProposalIfNeeded(
  matchId: string,
  vaultAddress: string,
  dbProposalId: string | null | undefined
): Promise<ProposalSyncResult> {
  const matchRepository = AppDataSource.getRepository('Match');
  
  try {
    // Fetch match from database
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return {
        success: false,
        synced: false,
        matchId,
        error: 'Match not found in database',
      };
    }

    const currentDbProposalId = dbProposalId || (match as any).payoutProposalId;
    if (!currentDbProposalId) {
      // No proposal ID yet - nothing to sync
      return {
        success: true,
        synced: true,
        matchId,
        dbProposalId: null,
        dbStatus: (match as any).proposalStatus || 'PENDING',
      };
    }

    const dbStatus = (match as any).proposalStatus || 'PENDING';
    
    // If status is already APPROVED or EXECUTED, skip sync (optimization)
    if (dbStatus === 'APPROVED' || dbStatus === 'EXECUTED') {
      return {
        success: true,
        synced: true,
        matchId,
        dbProposalId: currentDbProposalId,
        dbStatus,
      };
    }

    // Fetch on-chain proposal status
    const squadsService = getSquadsVaultService();
    let proposalStatus;
    let onChainProposalId = currentDbProposalId;
    let transactionIndex: string | undefined;

    try {
      proposalStatus = await squadsService.checkProposalStatus(vaultAddress, currentDbProposalId);
      
      // Get the actual proposal account from on-chain
      const proposalPda = new PublicKey(currentDbProposalId);
      const connection = new Connection(
        process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
        'confirmed'
      );
      const proposalAccount = await require('@sqds/multisig').accounts.Proposal.fromAccountAddress(
        connection,
        proposalPda
      );
      
      onChainProposalId = proposalPda.toString();
      transactionIndex = (proposalAccount as any).transactionIndex?.toString();
      
      // Determine proposal status string
      const proposalStatusKind = (proposalAccount as any).status?.__kind || 'Unknown';
      const isExecuted = proposalStatus.executed;
      const hasEnoughSigners = proposalStatus.needsSignatures === 0;
      
      let statusString = 'ACTIVE';
      if (isExecuted) {
        statusString = 'EXECUTED';
      } else if (proposalStatusKind === 'Approved' && hasEnoughSigners) {
        statusString = 'APPROVED';
      } else if (proposalStatusKind === 'Rejected') {
        statusString = 'REJECTED';
      } else if (proposalStatusKind === 'Cancelled') {
        statusString = 'CANCELLED';
      }

      // Check if database needs updating
      const dbSigners = JSON.parse((match as any).proposalSigners || '[]');
      const onChainSigners = proposalStatus.signers.map((s: any) => s.toString());

      const needsUpdate = 
        dbStatus !== statusString ||
        JSON.stringify(dbSigners.sort()) !== JSON.stringify(onChainSigners.sort());

      if (!needsUpdate) {
        return {
          success: true,
          synced: true,
          matchId,
          dbProposalId: currentDbProposalId,
          onChainProposalId,
          dbStatus,
          onChainStatus: statusString,
        };
      }

      // Update database
      const changes: ProposalSyncResult['changes'] = {};
      if (dbStatus !== statusString) {
        changes.proposalStatus = { from: dbStatus, to: statusString };
      }
      if (JSON.stringify(dbSigners.sort()) !== JSON.stringify(onChainSigners.sort())) {
        changes.signers = { from: dbSigners, to: onChainSigners };
      }

      await matchRepository.query(`
        UPDATE "match"
        SET "proposalStatus" = $1,
            "proposalSigners" = $2,
            "needsSignatures" = $3,
            "updatedAt" = $4
        WHERE id = $5
      `, [
        statusString,
        JSON.stringify(onChainSigners),
        proposalStatus.needsSignatures,
        new Date(),
        matchId,
      ]);

      console.log('✅ SYNC: Updated proposal status from on-chain', {
        matchId,
        changes,
        transactionIndex,
        from: dbStatus,
        to: statusString,
        note: 'Database now matches on-chain state',
      });

      return {
        success: true,
        synced: true,
        matchId,
        dbProposalId: currentDbProposalId,
        onChainProposalId,
        dbStatus,
        onChainStatus: statusString,
        changes,
      };

    } catch (onChainError: any) {
      console.error('❌ SYNC: Failed to fetch on-chain proposal status', {
        matchId,
        dbProposalId: currentDbProposalId,
        vaultAddress,
        error: onChainError?.message,
      });

      return {
        success: false,
        synced: false,
        matchId,
        dbProposalId: currentDbProposalId,
        dbStatus,
        error: `Failed to fetch on-chain proposal: ${onChainError?.message}`,
      };
    }

  } catch (error: any) {
    console.error('❌ SYNC: Error syncing proposal', {
      matchId,
      error: error?.message,
      stack: error?.stack,
    });

    return {
      success: false,
      synced: false,
      matchId,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Auto-fix: Search for Approved proposal with both signatures if current proposal is stale
 * This handles cases where the database references an old proposal but a new one exists on-chain
 */
export async function findAndSyncApprovedProposal(
  matchId: string,
  vaultAddress: string
): Promise<ProposalSyncResult | null> {
  try {
    const { getMultisigPda, getProposalPda, accounts } = require('@sqds/multisig');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    const vaultPubkey = new PublicKey(vaultAddress);
    const multisigPda = getMultisigPda({
      createKey: vaultPubkey,
    })[0];
    
    // Search transaction indices 0-10 for Approved proposal with both signatures
    for (let i = 0; i <= 10; i++) {
      try {
        const [proposalPda] = getProposalPda({
          multisig: multisigPda,
          transactionIndex: BigInt(i),
        });
        
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          connection,
          proposalPda
        );
        
        const status = (proposalAccount as any).status?.__kind;
        const approved = (proposalAccount as any).approved || [];
        const approvedPubkeys = approved.map((p: PublicKey) => p.toString());
        
        // Found Approved proposal with both signatures
        if (status === 'Approved' && approvedPubkeys.length >= 2) {
          const matchRepository = AppDataSource.getRepository('Match');
          await matchRepository.update(matchId, {
            payoutProposalId: proposalPda.toString(),
            proposalStatus: 'APPROVED',
            proposalSigners: JSON.stringify(approvedPubkeys),
            needsSignatures: 0,
            transactionIndex: i.toString(),
            updatedAt: new Date(),
          });
          
          console.log('✅ AUTO-FIX: Found and synced Approved proposal', {
            matchId,
            proposalId: proposalPda.toString(),
            transactionIndex: i,
            signers: approvedPubkeys,
          });
          
          return {
            success: true,
            synced: true,
            matchId,
            dbProposalId: proposalPda.toString(),
            onChainProposalId: proposalPda.toString(),
            onChainStatus: 'APPROVED',
            changes: {
              proposalId: { from: 'unknown', to: proposalPda.toString() },
              proposalStatus: { from: 'unknown', to: 'APPROVED' },
            },
          };
        }
      } catch (e) {
        // Proposal doesn't exist at this index, continue
        continue;
      }
    }
    
    return null;
  } catch (error: any) {
    console.warn('⚠️ AUTO-FIX: Failed to search for Approved proposal', {
      matchId,
      error: error?.message,
    });
    return null;
  }
}

