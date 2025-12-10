// @ts-nocheck
/**
 * Proposal Sync Utility
 * 
 * Syncs database proposal status with on-chain Squads proposal state.
 * Used to fix desync issues where database has stale proposal IDs or statuses.
 */

const { AppDataSource } = require('../db');
const { squadsVaultService } = require('../services/squadsVaultService');
const { PublicKey } = require('@solana/web3.js');

export interface ProposalSyncResult {
  success: boolean;
  matchId: string;
  dbProposalId?: string;
  onChainProposalId?: string;
  synced: boolean;
  error?: string;
  changes?: {
    proposalId?: { from: string; to: string };
    proposalStatus?: { from: string; to: string };
    transactionIndex?: { from: string; to: string };
    signers?: { from: string[]; to: string[] };
  };
}

/**
 * Sync a single match's proposal status from on-chain to database
 */
export async function syncMatchProposal(
  matchId: string,
  vaultAddress: string
): Promise<ProposalSyncResult> {
  const matchRepository = AppDataSource.getRepository('Match');
  
  try {
    // Fetch match from database
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return {
        success: false,
        matchId,
        synced: false,
        error: 'Match not found in database',
      };
    }

    const dbProposalId = (match as any).payoutProposalId;
    if (!dbProposalId) {
      return {
        success: false,
        matchId,
        synced: false,
        error: 'No proposal ID in database',
      };
    }

    // Fetch on-chain proposal status
    const { getSquadsVaultService } = require('../services/squadsVaultService');
    const squadsService = getSquadsVaultService();
    let proposalStatus;
    let onChainProposalId = dbProposalId;
    let transactionIndex: string | undefined;

    try {
      proposalStatus = await squadsService.checkProposalStatus(vaultAddress, dbProposalId);
      
      // Try to get the actual proposal PDA from on-chain
      // The proposalStatus should contain the proposal PDA
      const proposalPda = new PublicKey(dbProposalId);
      const { Connection } = require('@solana/web3.js');
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
      const dbStatus = (match as any).proposalStatus || 'PENDING';
      const dbSigners = JSON.parse((match as any).proposalSigners || '[]');
      const onChainSigners = proposalStatus.signers.map((s: any) => s.toString());

      const needsUpdate = 
        dbProposalId !== onChainProposalId ||
        dbStatus !== statusString ||
        JSON.stringify(dbSigners.sort()) !== JSON.stringify(onChainSigners.sort());

      if (!needsUpdate) {
        return {
          success: true,
          matchId,
          dbProposalId,
          onChainProposalId,
          synced: true,
        };
      }

      // Update database
      const changes: ProposalSyncResult['changes'] = {};
      if (dbProposalId !== onChainProposalId) {
        changes.proposalId = { from: dbProposalId, to: onChainProposalId };
      }
      if (dbStatus !== statusString) {
        changes.proposalStatus = { from: dbStatus, to: statusString };
      }
      if (JSON.stringify(dbSigners.sort()) !== JSON.stringify(onChainSigners.sort())) {
        changes.signers = { from: dbSigners, to: onChainSigners };
      }

      await matchRepository.query(`
        UPDATE "match"
        SET "payoutProposalId" = $1,
            "proposalStatus" = $2,
            "proposalSigners" = $3,
            "needsSignatures" = $4,
            "updatedAt" = $5
        WHERE id = $6
      `, [
        onChainProposalId,
        statusString,
        JSON.stringify(onChainSigners),
        proposalStatus.needsSignatures,
        new Date(),
        matchId,
      ]);

      console.log('✅ Synced proposal status from on-chain to database', {
        matchId,
        changes,
        transactionIndex,
      });

      return {
        success: true,
        matchId,
        dbProposalId,
        onChainProposalId,
        synced: true,
        changes,
      };

    } catch (onChainError: any) {
      console.error('❌ Failed to fetch on-chain proposal status', {
        matchId,
        dbProposalId,
        vaultAddress,
        error: onChainError?.message,
      });

      return {
        success: false,
        matchId,
        dbProposalId,
        synced: false,
        error: `Failed to fetch on-chain proposal: ${onChainError?.message}`,
      };
    }

  } catch (error: any) {
    console.error('❌ Error syncing proposal', {
      matchId,
      error: error?.message,
      stack: error?.stack,
    });

    return {
      success: false,
      matchId,
      synced: false,
      error: error?.message || 'Unknown error',
    };
  }
}

/**
 * Detect proposal desync by comparing database vs on-chain proposal IDs
 */
export async function detectProposalDesync(
  matchId: string,
  dbProposalId: string,
  vaultAddress: string
): Promise<{ desynced: boolean; onChainProposalId?: string; error?: string }> {
  try {
    const { Connection } = require('@solana/web3.js');
    const connection = new Connection(
      process.env.SOLANA_NETWORK || 'https://api.devnet.solana.com',
      'confirmed'
    );
    
    // Try to fetch the proposal from on-chain
    const proposalPda = new PublicKey(dbProposalId);
    const proposalAccount = await require('@sqds/multisig').accounts.Proposal.fromAccountAddress(
      connection,
      proposalPda
    );
    
    const onChainProposalId = proposalPda.toString();
    const onChainStatus = (proposalAccount as any).status?.__kind || 'Unknown';
    
    // Check if this proposal exists and is valid
    const isValid = onChainStatus !== 'Unknown';
    
    return {
      desynced: !isValid,
      onChainProposalId: isValid ? onChainProposalId : undefined,
    };
  } catch (error: any) {
    // If we can't fetch the proposal, it might be desynced
    console.warn('⚠️ Could not verify proposal on-chain (may indicate desync)', {
      matchId,
      dbProposalId,
      error: error?.message,
    });
    
    return {
      desynced: true,
      error: error?.message,
    };
  }
}

