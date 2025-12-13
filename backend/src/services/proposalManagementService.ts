// @ts-nocheck
/**
 * Proposal Management Service
 * 
 * Prevents proposal proliferation by reusing existing Active proposals
 * Tracks proposal versioning and provides enhanced logging
 */

import { AppDataSource } from '../db';
import { PublicKey } from '@solana/web3.js';
import { getProposalPda, accounts, PROGRAM_ID } from '@sqds/multisig';
import { createStandardSolanaConnection } from '../config/solanaConnection';

export interface ProposalCheckResult {
  exists: boolean;
  isValid: boolean;
  proposalId?: string;
  transactionIndex?: string;
  status?: string;
  signers?: string[];
  needsSignatures?: number;
  reason?: string;
}

export interface CreateOrReuseResult {
  success: boolean;
  reused: boolean;
  proposalId?: string;
  transactionIndex?: string;
  attemptCount: number;
  error?: string;
  details?: {
    existingProposalId?: string;
    newProposalId?: string;
    status?: string;
  };
}

/**
 * Check if a proposal exists at a specific transaction index
 */
export async function checkProposalAtIndex(
  vaultAddress: string,
  transactionIndex: number | bigint,
  programId?: PublicKey
): Promise<ProposalCheckResult> {
  try {
    const multisigAddress = new PublicKey(vaultAddress);
    const proposalProgramId = programId || new PublicKey(process.env.SQUADS_PROGRAM_ID || PROGRAM_ID);
    const connection = createStandardSolanaConnection('confirmed');
    
    const [proposalPda] = getProposalPda({
      multisigPda: multisigAddress,
      transactionIndex: typeof transactionIndex === 'number' ? BigInt(transactionIndex) : transactionIndex,
      programId: proposalProgramId,
    });
    
    const proposalAccount = await accounts.Proposal.fromAccountAddress(connection, proposalPda);
    const status = (proposalAccount as any).status?.__kind || 'Unknown';
    const approved = (proposalAccount as any).approved || [];
    const approvedPubkeys = approved.map((p: PublicKey) => p.toString());
    
    // Get multisig threshold
    let threshold = 2;
    try {
      const multisigAccount = await accounts.Multisig.fromAccountAddress(connection, multisigAddress);
      threshold = (multisigAccount as any).threshold || 2;
    } catch (e) {
      // Default to 2 if we can't fetch
    }
    
    const needsSignatures = Math.max(0, threshold - approvedPubkeys.length);
    
    // Check if proposal is valid (not Executed/Cancelled/Rejected)
    const isFinalized = status === 'Executed' || status === 'Cancelled' || status === 'Rejected';
    const isValid = !isFinalized && (status === 'Active' || status === 'Approved' || status === 'ExecuteReady');
    
    return {
      exists: true,
      isValid,
      proposalId: proposalPda.toString(),
      transactionIndex: transactionIndex.toString(),
      status,
      signers: approvedPubkeys,
      needsSignatures,
      reason: !isValid ? `Proposal is ${status.toLowerCase()}` : undefined,
    };
  } catch (e: any) {
    if (e?.message?.includes('AccountNotFound') || e?.message?.includes('Invalid account') || e?.message?.includes('Unable to find')) {
      return { exists: false, isValid: false };
    }
    throw e;
  }
}

/**
 * Find the latest valid Active proposal for a vault
 * Searches transaction indices 0-20 to find the most recent Active proposal
 */
export async function findLatestActiveProposal(
  vaultAddress: string,
  programId?: PublicKey
): Promise<ProposalCheckResult | null> {
  const proposalProgramId = programId || new PublicKey(process.env.SQUADS_PROGRAM_ID || PROGRAM_ID);
  
  // Search backwards from index 20 to 0 to find the latest
  for (let i = 20; i >= 0; i--) {
    try {
      const result = await checkProposalAtIndex(vaultAddress, i, proposalProgramId);
      if (result.exists && result.isValid) {
        return result;
      }
    } catch (e) {
      // Continue searching
      continue;
    }
  }
  
  return null;
}

/**
 * Create or reuse a proposal for a match
 * 
 * This function:
 * 1. Checks if match already has a valid proposal
 * 2. If not, searches for existing Active proposals in the vault
 * 3. Reuses existing proposal if found and valid
 * 4. Only creates new proposal if none exists
 * 
 * This prevents proposal proliferation.
 */
export async function createOrReuseProposal(
  matchId: string,
  vaultAddress: string,
  createProposalFn: (transactionIndex: bigint) => Promise<{ success: boolean; proposalId?: string; transactionIndex?: string; error?: string }>,
  programId?: PublicKey
): Promise<CreateOrReuseResult> {
  const matchRepository = AppDataSource.getRepository('Match');
  
  try {
    // Get current match state
    const match = await matchRepository.findOne({ where: { id: matchId } });
    if (!match) {
      return {
        success: false,
        reused: false,
        attemptCount: 0,
        error: 'Match not found',
      };
    }
    
    const currentProposalId = (match as any).payoutProposalId || (match as any).tieRefundProposalId;
    const currentTransactionIndex = (match as any).payoutProposalTransactionIndex || (match as any).tieRefundProposalTransactionIndex;
    const currentAttemptCount = (match as any).proposalAttemptCount || 0;
    const newAttemptCount = currentAttemptCount + 1;
    
    // ✅ STEP 1: Check if match already has a valid proposal
    if (currentProposalId && currentTransactionIndex) {
      try {
        const existingCheck = await checkProposalAtIndex(
          vaultAddress,
          BigInt(currentTransactionIndex),
          programId
        );
        
        if (existingCheck.exists && existingCheck.isValid) {
          console.log('✅ [createOrReuseProposal] Match already has valid proposal, reusing', {
            matchId,
            proposalId: currentProposalId,
            transactionIndex: currentTransactionIndex,
            status: existingCheck.status,
            attemptCount: currentAttemptCount,
          });
          
          // Update attempt count for tracking
          await matchRepository.update(matchId, {
            proposalAttemptCount: newAttemptCount,
            updatedAt: new Date(),
          });
          
          return {
            success: true,
            reused: true,
            proposalId: currentProposalId,
            transactionIndex: currentTransactionIndex,
            attemptCount: newAttemptCount,
            details: {
              existingProposalId: currentProposalId,
              status: existingCheck.status,
            },
          };
        } else if (existingCheck.exists && !existingCheck.isValid) {
          console.warn('⚠️ [createOrReuseProposal] Existing proposal is finalized, will search for new one', {
            matchId,
            proposalId: currentProposalId,
            status: existingCheck.status,
            reason: existingCheck.reason,
          });
        }
      } catch (e: any) {
        console.warn('⚠️ [createOrReuseProposal] Error checking existing proposal, will search for new one', {
          matchId,
          proposalId: currentProposalId,
          error: e?.message,
        });
      }
    }
    
    // ✅ STEP 2: Search for latest Active proposal in vault
    console.log('🔍 [createOrReuseProposal] Searching for existing Active proposal in vault...', {
      matchId,
      vaultAddress,
      currentProposalId,
    });
    
    const latestActive = await findLatestActiveProposal(vaultAddress, programId);
    
    if (latestActive && latestActive.isValid) {
      console.log('✅ [createOrReuseProposal] Found existing Active proposal, reusing', {
        matchId,
        proposalId: latestActive.proposalId,
        transactionIndex: latestActive.transactionIndex,
        status: latestActive.status,
        signers: latestActive.signers?.length || 0,
        attemptCount: newAttemptCount,
      });
      
      // Update match with existing proposal
      const updateData: any = {
        payoutProposalId: latestActive.proposalId,
        payoutProposalTransactionIndex: latestActive.transactionIndex,
        proposalStatus: latestActive.status === 'Approved' ? 'APPROVED' : 'ACTIVE',
        proposalSigners: JSON.stringify(latestActive.signers || []),
        needsSignatures: latestActive.needsSignatures || 0,
        proposalAttemptCount: newAttemptCount,
        updatedAt: new Date(),
      };
      
      if (!(match as any).proposalCreatedAt) {
        updateData.proposalCreatedAt = new Date();
      }
      
      await matchRepository.update(matchId, updateData);
      
      // 📘 Enhanced logging
      console.log('📘 [createOrReuseProposal] PROPOSAL_REUSED', {
        event: 'PROPOSAL_REUSED',
        matchId,
        vaultAddress,
        proposalId: latestActive.proposalId,
        transactionIndex: latestActive.transactionIndex,
        status: latestActive.status,
        attemptCount: newAttemptCount,
        previousProposalId: currentProposalId,
        timestamp: new Date().toISOString(),
      });
      
      return {
        success: true,
        reused: true,
        proposalId: latestActive.proposalId,
        transactionIndex: latestActive.transactionIndex,
        attemptCount: newAttemptCount,
        details: {
          existingProposalId: latestActive.proposalId,
          status: latestActive.status,
        },
      };
    }
    
    // ✅ STEP 3: No valid proposal found, create new one
    console.log('🆕 [createOrReuseProposal] No valid proposal found, creating new one', {
      matchId,
      vaultAddress,
      attemptCount: newAttemptCount,
    });
    
    // Determine next transaction index
    // Start from 0 if no current index, otherwise increment
    let nextIndex = 0;
    if (currentTransactionIndex) {
      nextIndex = parseInt(currentTransactionIndex) + 1;
    }
    
    // Try creating at next index
    const createResult = await createProposalFn(BigInt(nextIndex));
    
    if (createResult.success && createResult.proposalId) {
      // Update attempt count
      await matchRepository.update(matchId, {
        proposalAttemptCount: newAttemptCount,
        updatedAt: new Date(),
      });
      
      // 📘 Enhanced logging
      console.log('📘 [createOrReuseProposal] PROPOSAL_CREATED', {
        event: 'PROPOSAL_CREATED',
        matchId,
        vaultAddress,
        proposalId: createResult.proposalId,
        transactionIndex: createResult.transactionIndex,
        attemptCount: newAttemptCount,
        previousProposalId: currentProposalId,
        timestamp: new Date().toISOString(),
      });
      
      return {
        success: true,
        reused: false,
        proposalId: createResult.proposalId,
        transactionIndex: createResult.transactionIndex,
        attemptCount: newAttemptCount,
        details: {
          newProposalId: createResult.proposalId,
        },
      };
    } else {
      return {
        success: false,
        reused: false,
        attemptCount: newAttemptCount,
        error: createResult.error || 'Failed to create proposal',
      };
    }
    
  } catch (error: any) {
    console.error('❌ [createOrReuseProposal] Error in createOrReuseProposal', {
      matchId,
      vaultAddress,
      error: error?.message,
      stack: error?.stack,
    });
    
    return {
      success: false,
      reused: false,
      attemptCount: 0,
      error: error?.message || 'Unknown error',
    };
  }
}

