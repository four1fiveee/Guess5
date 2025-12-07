/**
 * Signature Verification Utility
 * 
 * Implements dual-RPC verification pattern for proposal signatures:
 * - Check transaction confirmation on both RPCs
 * - Check proposal signer list on both RPCs
 * - Use exponential backoff after N attempts
 * - Add jitter to initial delay to reduce hot-node contention
 * 
 * Reduces false negatives from single RPC cache issues
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { accounts, getProposalPda, PROGRAM_ID } from '@sqds/multisig';
import { createRPCConnections } from './rpcFailover';

export interface VerificationResult {
  ok: boolean;
  reason?: string;
  attempt?: number;
  primaryRpcSeen?: boolean;
  secondaryRpcSeen?: boolean;
  vaultTxSignersPrimary?: string[];
  vaultTxSignersSecondary?: string[];
  txConfirmed?: boolean;
}

export interface VerificationOptions {
  attempts?: number;
  initialDelayMs?: number;
  delayMs?: number;
  exponentialBackoffAfter?: number;
  correlationId?: string;
}

/**
 * Verify signature on-chain using dual-RPC strategy
 * Returns ok: true if signature is found on either RPC
 */
export async function verifySignatureOnChain({
  txSig,
  vaultAddress,
  proposalId,
  signerPubkey,
  transactionIndex,
  options = {},
}: {
  txSig: string;
  vaultAddress: string;
  proposalId: string;
  transactionIndex: number;
  signerPubkey: string;
  options?: VerificationOptions;
}): Promise<VerificationResult> {
  const {
    attempts = 10,
    initialDelayMs = 3000,
    delayMs = 3000,
    exponentialBackoffAfter = 6,
    correlationId,
  } = options;

  const { primary, fallback } = createRPCConnections();
  const vaultPda = new PublicKey(vaultAddress);
  const signerPubkeyObj = new PublicKey(signerPubkey);
  
  // Get proposal PDA
  const [proposalPda] = getProposalPda({
    multisigPda: vaultPda,
    transactionIndex: BigInt(transactionIndex),
    programId: PROGRAM_ID,
  });

  // Add jitter to initial delay (1-3s randomized) to reduce hot-node contention
  const jitter = Math.floor(Math.random() * 2000); // 0-2000ms random
  const initialDelay = initialDelayMs + jitter;
  
  console.log('⏳ VERIFICATION_ATTEMPT: Starting verification with jitter', {
    event: 'VERIFICATION_ATTEMPT',
    matchId: correlationId,
    attempt: 0,
    txSig,
    initialDelayMs: initialDelay,
    jitter,
    note: 'Waiting before first verification attempt to allow Solana eventual consistency',
  });
  
  await new Promise(resolve => setTimeout(resolve, initialDelay));

  let txConfirmed = false;
  let primaryRpcSeen = false;
  let secondaryRpcSeen = false;
  let vaultTxSignersPrimary: string[] = [];
  let vaultTxSignersSecondary: string[] = [];

  for (let attempt = 0; attempt < attempts; attempt++) {
    const currentDelay = attempt >= exponentialBackoffAfter
      ? delayMs * Math.pow(1.5, attempt - exponentialBackoffAfter) // Exponential backoff after N attempts
      : delayMs;

    // 1) Check transaction confirmation on both RPCs
    if (!txConfirmed) {
      try {
        const txPrimary = await primary.getTransaction(txSig, { commitment: 'confirmed' });
        if (txPrimary) {
          txConfirmed = true;
          primaryRpcSeen = true;
        }
      } catch (e) {
        // Ignore - will try secondary
      }

      if (!txConfirmed) {
        try {
          const txSecondary = await fallback.getTransaction(txSig, { commitment: 'confirmed' });
          if (txSecondary) {
            txConfirmed = true;
            secondaryRpcSeen = true;
          }
        } catch (e) {
          // Ignore - will retry
        }
      }
    }

    // 2) Check on-chain proposal signer list on both RPCs
    try {
      const proposalPrimary = await accounts.Proposal.fromAccountAddress(
        primary,
        proposalPda,
        'confirmed'
      );
      
      // Proposal uses 'approved' property, not 'signers'
      const approvedSigners = (proposalPrimary as any).approved || [];
      if (approvedSigners.length > 0) {
        vaultTxSignersPrimary = approvedSigners.map((s: any) => {
          // Handle both PublicKey objects and objects with .key property
          if (s instanceof PublicKey) {
            return s.toString();
          } else if (s?.key instanceof PublicKey) {
            return s.key.toString();
          } else if (typeof s === 'string') {
            return s;
          }
          return s?.toString() || '';
        });
        const signerFound = approvedSigners.some(
          (s: any) => {
            const signerKey = s instanceof PublicKey ? s : (s?.key instanceof PublicKey ? s.key : (typeof s === 'string' ? new PublicKey(s) : null));
            return signerKey && signerKey.toString().toLowerCase() === signerPubkey.toLowerCase();
          }
        );
        
        if (signerFound) {
          console.log('✅ VERIFICATION_CONFIRMED: Signature found on primary RPC', {
            event: 'VERIFICATION_CONFIRMED',
            matchId: correlationId,
            attempt: attempt + 1,
            txSig,
            primaryRpcSeen: true,
            secondaryRpcSeen,
            vaultTxSignersPrimary,
            vaultTxSignersSecondary,
            txConfirmed,
          });
          
          return {
            ok: true,
            attempt: attempt + 1,
            primaryRpcSeen: true,
            secondaryRpcSeen,
            vaultTxSignersPrimary,
            vaultTxSignersSecondary,
            txConfirmed,
          };
        }
      }
    } catch (e) {
      // Ignore - will try secondary
    }

    try {
      const proposalSecondary = await accounts.Proposal.fromAccountAddress(
        fallback,
        proposalPda,
        'confirmed'
      );
      
      // Proposal uses 'approved' property, not 'signers'
      const approvedSignersSecondary = (proposalSecondary as any).approved || [];
      if (approvedSignersSecondary.length > 0) {
        vaultTxSignersSecondary = approvedSignersSecondary.map((s: any) => {
          // Handle both PublicKey objects and objects with .key property
          if (s instanceof PublicKey) {
            return s.toString();
          } else if (s?.key instanceof PublicKey) {
            return s.key.toString();
          } else if (typeof s === 'string') {
            return s;
          }
          return s?.toString() || '';
        });
        const signerFound = approvedSignersSecondary.some(
          (s: any) => {
            const signerKey = s instanceof PublicKey ? s : (s?.key instanceof PublicKey ? s.key : (typeof s === 'string' ? new PublicKey(s) : null));
            return signerKey && signerKey.toString().toLowerCase() === signerPubkey.toLowerCase();
          }
        );
        
        if (signerFound) {
          console.log('✅ VERIFICATION_CONFIRMED: Signature found on secondary RPC', {
            event: 'VERIFICATION_CONFIRMED',
            matchId: correlationId,
            attempt: attempt + 1,
            txSig,
            primaryRpcSeen,
            secondaryRpcSeen: true,
            vaultTxSignersPrimary,
            vaultTxSignersSecondary,
            txConfirmed,
          });
          
          return {
            ok: true,
            attempt: attempt + 1,
            primaryRpcSeen,
            secondaryRpcSeen: true,
            vaultTxSignersPrimary,
            vaultTxSignersSecondary,
            txConfirmed,
          };
        }
      }
    } catch (e) {
      // Ignore - will retry
    }

    // Log attempt for observability
    console.log('🔄 VERIFICATION_ATTEMPT: Signature not found yet', {
      event: 'VERIFICATION_ATTEMPT',
      matchId: correlationId,
      attempt: attempt + 1,
      txSig,
      primaryRpcSeen,
      secondaryRpcSeen,
      vaultTxSignersPrimary,
      vaultTxSignersSecondary,
      txConfirmed,
      nextDelayMs: currentDelay,
    });

    // Wait before next attempt (with exponential backoff after N attempts)
    if (attempt < attempts - 1) {
      await new Promise(resolve => setTimeout(resolve, currentDelay));
    }
  }

  // Verification failed after all attempts
  console.error('❌ VERIFICATION_FAILED: Signature not found after all attempts', {
    event: 'VERIFICATION_FAILED',
    matchId: correlationId,
    attempt: attempts,
    txSig,
    primaryRpcSeen,
    secondaryRpcSeen,
    vaultTxSignersPrimary,
    vaultTxSignersSecondary,
    txConfirmed,
    reason: 'timeout',
  });

  return {
    ok: false,
    reason: 'timeout',
    attempt: attempts,
    primaryRpcSeen,
    secondaryRpcSeen,
    vaultTxSignersPrimary,
    vaultTxSignersSecondary,
    txConfirmed,
  };
}

