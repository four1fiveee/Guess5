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
    
    // CRITICAL: Always sync if status is SIGNATURE_VERIFICATION_FAILED - this indicates a desync
    // Even if status is APPROVED or EXECUTED, we should still verify on-chain state matches
    // (Optimization: Skip if already APPROVED/EXECUTED AND we have recent update, but always check FAILED)
    if (dbStatus === 'APPROVED' || dbStatus === 'EXECUTED') {
      // Still verify on-chain matches DB, but don't force update if already correct
      // This is an optimization - we'll still fetch on-chain status below
      console.log('ℹ️ [syncProposalIfNeeded] DB status is already APPROVED/EXECUTED, verifying on-chain matches', {
        matchId,
        dbStatus,
        dbProposalId: currentDbProposalId,
      });
    } else if (dbStatus === 'SIGNATURE_VERIFICATION_FAILED') {
      // CRITICAL: SIGNATURE_VERIFICATION_FAILED indicates a desync - always attempt to find Approved proposal
      console.log('🚨 [syncProposalIfNeeded] DB status is SIGNATURE_VERIFICATION_FAILED - attempting auto-fix', {
        matchId,
        dbProposalId: currentDbProposalId,
        note: 'This may indicate database points to wrong proposal - will search for Approved proposal',
      });
    }

    // Fetch on-chain proposal status
    const squadsService = getSquadsVaultService();
    let proposalStatus;
    let onChainProposalId = currentDbProposalId;
    let transactionIndex: string | undefined;

    try {
      proposalStatus = await squadsService.checkProposalStatus(vaultAddress, currentDbProposalId);
      
      // Get the actual proposal account from on-chain
      // NON-CRITICAL: Use standard RPC for monitoring/sync operations
      const proposalPda = new PublicKey(currentDbProposalId);
      const { createStandardSolanaConnection } = require('../config/solanaConnection');
      const connection = createStandardSolanaConnection('confirmed');
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

      // CRITICAL: Even if status matches, if DB status is SIGNATURE_VERIFICATION_FAILED,
      // we should still check if there's an Approved proposal elsewhere (desync scenario)
      if (!needsUpdate && dbStatus !== 'SIGNATURE_VERIFICATION_FAILED') {
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
      
      // If DB status is SIGNATURE_VERIFICATION_FAILED but on-chain proposal is also Active/not Approved,
      // this means the DB proposal ID might be wrong - try to find Approved proposal
      if (dbStatus === 'SIGNATURE_VERIFICATION_FAILED' && statusString !== 'APPROVED') {
        console.log('🔄 [syncProposalIfNeeded] DB proposal is FAILED and on-chain is not Approved - searching for Approved proposal', {
          matchId,
          dbProposalId: currentDbProposalId,
          onChainStatus: statusString,
          note: 'DB proposal may be wrong - attempting to find Approved proposal',
        });
        
        // Try to find Approved proposal as fallback
        try {
          const autoFixResult = await findAndSyncApprovedProposal(matchId, vaultAddress);
          if (autoFixResult && autoFixResult.synced) {
            console.log('✅ [syncProposalIfNeeded] Found Approved proposal after detecting FAILED status', {
              matchId,
              oldProposalId: currentDbProposalId,
              newProposalId: autoFixResult.onChainProposalId,
            });
            return autoFixResult;
          }
        } catch (autoFixError: any) {
          console.warn('⚠️ [syncProposalIfNeeded] Failed to find Approved proposal after FAILED status', {
            matchId,
            error: autoFixError?.message,
          });
        }
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
      console.error('❌ [syncProposalIfNeeded] Failed to fetch on-chain proposal status', {
        matchId,
        dbProposalId: currentDbProposalId,
        vaultAddress,
        dbStatus,
        error: onChainError?.message,
      });

      // CRITICAL: If DB status is SIGNATURE_VERIFICATION_FAILED and we can't fetch the proposal,
      // it likely means the DB proposal ID is stale/wrong - try to find Approved proposal
      if (dbStatus === 'SIGNATURE_VERIFICATION_FAILED') {
        console.log('🔄 [syncProposalIfNeeded] DB proposal not found on-chain, attempting to find Approved proposal', {
          matchId,
          dbProposalId: currentDbProposalId,
          note: 'DB proposal may be stale - searching for Approved proposal as fallback',
        });
        
        try {
          const autoFixResult = await findAndSyncApprovedProposal(matchId, vaultAddress);
          if (autoFixResult && autoFixResult.synced) {
            console.log('✅ [syncProposalIfNeeded] Auto-fix succeeded after proposal fetch failure', {
              matchId,
              newProposalId: autoFixResult.onChainProposalId,
              newStatus: autoFixResult.onChainStatus,
            });
            return autoFixResult;
          } else {
            console.warn('⚠️ [syncProposalIfNeeded] Desync detected but no Approved proposal found', {
              matchId,
              dbProposalId: currentDbProposalId,
              dbStatus,
              note: 'Proposal may remain in FAILED state - manual intervention may be required',
            });
          }
        } catch (autoFixError: any) {
          console.error('❌ [syncProposalIfNeeded] Auto-fix failed after proposal fetch error', {
            matchId,
            error: autoFixError?.message,
          });
        }
      }

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
 * Check if a proposal status is finalized (cannot be signed or modified)
 */
export function isFinalizedStatus(status: string): boolean {
  return status === 'Executed' || status === 'Cancelled' || status === 'Rejected';
}

/**
 * Check if a specific proposal exists on-chain and get its status
 * Returns null if proposal doesn't exist or is invalid
 * 
 * ✅ ENHANCED: Now checks for Executed/Cancelled status and marks as invalid
 */
export async function checkProposalExists(
  proposalId: string,
  vaultAddress: string
): Promise<{ 
  exists: boolean; 
  valid: boolean;
  status?: string; 
  signers?: string[]; 
  needsSignatures?: number;
  reason?: string;
} | null> {
  try {
    const { accounts } = require('@sqds/multisig');
    const { createStandardSolanaConnection } = require('../config/solanaConnection');
    const connection = createStandardSolanaConnection('confirmed');
    
    const proposalPda = new PublicKey(proposalId);
    const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
    
    const status = (proposalAccount as any).status?.__kind || 'Unknown';
    const approved = (proposalAccount as any).approved || [];
    const approvedPubkeys = approved.map((p: PublicKey) => p.toString());
    
    // ✅ Check if proposal is finalized (Executed/Cancelled/Rejected)
    const isFinalized = isFinalizedStatus(status);
    if (isFinalized) {
      return {
        exists: true,
        valid: false,
        status,
        signers: approvedPubkeys,
        needsSignatures: 0,
        reason: `Proposal is ${status.toLowerCase()} and cannot be signed`,
      };
    }
    
    // Get multisig to determine threshold (default to 2 if we can't fetch)
    let threshold = 2;
    try {
      const multisigAddress = new PublicKey(vaultAddress);
      const multisigAccount = await accounts.Multisig.fromAccountAddress(connection, multisigAddress);
      threshold = (multisigAccount as any).threshold || 2;
    } catch (multisigError: any) {
      console.warn('⚠️ [checkProposalExists] Could not fetch multisig threshold, defaulting to 2', {
        vaultAddress,
        error: multisigError?.message,
      });
    }
    
    const needsSignatures = Math.max(0, threshold - approvedPubkeys.length);
    
    return {
      exists: true,
      valid: true, // Valid for signing (not finalized)
      status,
      signers: approvedPubkeys,
      needsSignatures,
    };
  } catch (e: any) {
    if (e?.message?.includes('AccountNotFound') || e?.message?.includes('Invalid account')) {
      return { exists: false, valid: false };
    }
    console.warn('⚠️ [checkProposalExists] Error checking proposal', {
      proposalId,
      error: e?.message,
    });
    return null;
  }
}

/**
 * Auto-fix: Search for Approved proposal with both signatures if current proposal is stale
 * This handles cases where the database references an old proposal but a new one exists on-chain
 * 
 * NEW: Also accepts an optional signedProposalId to check if that specific proposal exists
 */
export async function findAndSyncApprovedProposal(
  matchId: string,
  vaultAddress: string,
  signedProposalId?: string
): Promise<ProposalSyncResult | null> {
  try {
    console.log('🔍 [findAndSyncApprovedProposal] Searching for Approved proposal...', {
      matchId,
      vaultAddress,
      searchRange: 'transaction indices 0-10',
    });
    
    const { getProposalPda, accounts, PROGRAM_ID } = require('@sqds/multisig');
    // NON-CRITICAL: Use standard RPC for monitoring/search operations
    const { createStandardSolanaConnection } = require('../config/solanaConnection');
    const connection = createStandardSolanaConnection('confirmed');
    
    // CRITICAL: vaultAddress IS the multisig address (PublicKey)
    // We don't need to derive it - just use it directly
    const multisigAddress = new PublicKey(vaultAddress);
    
    // Get program ID (should match what was used to create proposals)
    const programId = new PublicKey(process.env.SQUADS_PROGRAM_ID || PROGRAM_ID);
    
    // Get current DB state for comparison
    const matchRepository = AppDataSource.getRepository('Match');
    const match = await matchRepository.findOne({ where: { id: matchId } });
    const oldProposalId = (match as any)?.payoutProposalId;
    const oldStatus = (match as any)?.proposalStatus;
    const oldSigners = JSON.parse((match as any)?.proposalSigners || '[]');
    
    // ✅ NEW: First check if the signed proposal exists and is valid
    // If user signed a specific proposal, we should sync to that one if it exists and is valid
    if (signedProposalId) {
      console.log('🔍 [findAndSyncApprovedProposal] Checking if signed proposal exists...', {
        matchId,
        signedProposalId,
        vaultAddress,
      });
      
      const signedProposalCheck = await checkProposalExists(signedProposalId, vaultAddress);
      if (signedProposalCheck && signedProposalCheck.exists) {
        // ✅ Check if proposal is finalized (Executed/Cancelled/Rejected)
        if (!signedProposalCheck.valid) {
          console.warn('⚠️ [findAndSyncApprovedProposal] Signed proposal is finalized and cannot be signed', {
            matchId,
            signedProposalId,
            status: signedProposalCheck.status,
            reason: signedProposalCheck.reason,
          });
          
          // Return error result indicating proposal is finalized
          return {
            success: false,
            synced: false,
            matchId,
            dbProposalId: oldProposalId || undefined,
            onChainProposalId: signedProposalId,
            dbStatus: oldStatus,
            onChainStatus: signedProposalCheck.status?.toUpperCase() || 'FINALIZED',
            error: signedProposalCheck.reason || 'Proposal is finalized and cannot be signed',
          };
        }
        
        console.log('✅ [findAndSyncApprovedProposal] Signed proposal exists and is valid on-chain!', {
          matchId,
          signedProposalId,
          status: signedProposalCheck.status,
          signers: signedProposalCheck.signers,
          needsSignatures: signedProposalCheck.needsSignatures,
        });
        
        // Sync database to the proposal the user signed
        const statusString = signedProposalCheck.status === 'Approved' ? 'APPROVED' :
                            signedProposalCheck.status === 'Active' ? 'ACTIVE' :
                            signedProposalCheck.status === 'ExecuteReady' ? 'APPROVED' :
                            'ACTIVE';
        
        await matchRepository.update(matchId, {
          payoutProposalId: signedProposalId,
          proposalStatus: statusString,
          proposalSigners: JSON.stringify(signedProposalCheck.signers || []),
          needsSignatures: signedProposalCheck.needsSignatures || 0,
          updatedAt: new Date(),
        });
        
        const changes: ProposalSyncResult['changes'] = {};
        if (oldProposalId !== signedProposalId) {
          changes.proposalId = { from: oldProposalId || 'unknown', to: signedProposalId };
        }
        if (oldStatus !== statusString) {
          changes.proposalStatus = { from: oldStatus || 'unknown', to: statusString };
        }
        if (JSON.stringify(oldSigners.sort()) !== JSON.stringify((signedProposalCheck.signers || []).sort())) {
          changes.signers = { from: oldSigners, to: signedProposalCheck.signers || [] };
        }
        
        console.log('✅ [findAndSyncApprovedProposal] Synced to signed proposal', {
          matchId,
          signedProposalId,
          status: statusString,
          changes,
        });
        
        return {
          success: true,
          synced: true,
          matchId,
          dbProposalId: oldProposalId || undefined,
          onChainProposalId: signedProposalId,
          dbStatus: oldStatus,
          onChainStatus: statusString,
          changes,
        };
      } else {
        console.warn('⚠️ [findAndSyncApprovedProposal] Signed proposal does not exist on-chain', {
          matchId,
          signedProposalId,
          note: 'Will search for valid proposal',
        });
      }
    }
    
    // Search transaction indices 0-10 for Approved proposal with both signatures
    for (let i = 0; i <= 10; i++) {
      try {
        // CRITICAL: Use multisigPda parameter (not multisig) and include programId
        // This matches the pattern used in squadsVaultService.ts
        const [proposalPda] = getProposalPda({
          multisigPda: multisigAddress,  // Fixed: use multisigPda parameter, vaultAddress is the multisig
          transactionIndex: BigInt(i),
          programId: programId,  // Added: ensure we use the same program ID as proposal creation
        });
        
        const proposalAccount = await accounts.Proposal.fromAccountAddress(
          connection,
          proposalPda
        );
        
        const status = (proposalAccount as any).status?.__kind;
        const approved = (proposalAccount as any).approved || [];
        const approvedPubkeys = approved.map((p: PublicKey) => p.toString());
        
        // Log each proposal found for debugging
        if (status === 'Approved' || status === 'Active' || status === 'ExecuteReady') {
          console.log('🔍 [findAndSyncApprovedProposal] Found proposal', {
            matchId,
            transactionIndex: i,
            proposalId: proposalPda.toString(),
            status,
            approvedCount: approvedPubkeys.length,
            approvedSigners: approvedPubkeys,
          });
        }
        
        // Found Approved proposal with both signatures
        if (status === 'Approved' && approvedPubkeys.length >= 2) {
          console.log('✅ [findAndSyncApprovedProposal] Found Approved proposal with both signatures!', {
            matchId,
            transactionIndex: i,
            proposalId: proposalPda.toString(),
            signers: approvedPubkeys,
            oldProposalId,
            oldStatus,
            oldSigners,
          });
          
          await matchRepository.update(matchId, {
            payoutProposalId: proposalPda.toString(),
            proposalStatus: 'APPROVED',
            proposalSigners: JSON.stringify(approvedPubkeys),
            needsSignatures: 0,
            transactionIndex: i.toString(),
            updatedAt: new Date(),
          });
          
          const changes: ProposalSyncResult['changes'] = {};
          if (oldProposalId !== proposalPda.toString()) {
            changes.proposalId = { from: oldProposalId || 'unknown', to: proposalPda.toString() };
          }
          if (oldStatus !== 'APPROVED') {
            changes.proposalStatus = { from: oldStatus || 'unknown', to: 'APPROVED' };
          }
          if (JSON.stringify(oldSigners.sort()) !== JSON.stringify(approvedPubkeys.sort())) {
            changes.signers = { from: oldSigners, to: approvedPubkeys };
          }
          
          console.log('✅ [findAndSyncApprovedProposal] AUTO-FIX: Database updated', {
            matchId,
            proposalId: proposalPda.toString(),
            transactionIndex: i,
            signers: approvedPubkeys,
            changes,
          });
          
          return {
            success: true,
            synced: true,
            matchId,
            dbProposalId: oldProposalId || undefined,
            onChainProposalId: proposalPda.toString(),
            dbStatus: oldStatus,
            onChainStatus: 'APPROVED',
            changes,
          };
        }
      } catch (e: any) {
        // Proposal doesn't exist at this index, continue
        // Only log if it's not a "not found" error
        if (e?.message && !e.message.includes('AccountNotFound') && !e.message.includes('Invalid account')) {
          console.debug('🔍 [findAndSyncApprovedProposal] Error checking transaction index', {
            matchId,
            transactionIndex: i,
            error: e?.message,
          });
        }
        continue;
      }
    }
    
    console.warn('❌ [findAndSyncApprovedProposal] No Approved proposal found in range 0-10', {
      matchId,
      vaultAddress,
      note: 'Searched all transaction indices but no Approved proposal with both signatures found',
    });
    
    return null;
  } catch (error: any) {
    console.error('❌ [findAndSyncApprovedProposal] Failed to search for Approved proposal', {
      matchId,
      vaultAddress,
      error: error?.message,
      stack: error?.stack,
    });
    return null;
  }
}

