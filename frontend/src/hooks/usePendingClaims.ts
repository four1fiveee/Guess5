import { useState, useEffect } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/router';

export interface PendingClaim {
  matchId: string;
  entryFee: number;
  proposalId: string;
  proposalCreatedAt: string;
  needsSignatures: number;
  isWinner?: boolean;
  refundAmount?: number;
}

export interface PendingClaimsData {
  hasPendingClaims: boolean;
  hasPendingWinnings: boolean;
  hasPendingRefunds: boolean;
  refundCanBeExecuted: boolean;
  pendingWinnings: PendingClaim[];
  pendingRefunds: PendingClaim[];
}

export const usePendingClaims = () => {
  const { publicKey } = useWallet();
  const router = useRouter();
  const [pendingClaims, setPendingClaims] = useState<PendingClaimsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkPendingClaims = async () => {
    if (!publicKey) {
      setPendingClaims(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/api/match/check-pending-claims/${publicKey.toString()}`
      );

      if (!response.ok) {
        throw new Error('Failed to check pending claims');
      }

      const data = await response.json();
      setPendingClaims(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Error checking pending claims:', err);
    } finally {
      setLoading(false);
    }
  };

  const redirectToClaim = (matchId: string) => {
    router.push(`/result?matchId=${matchId}`);
  };

  const redirectToRefund = (matchId: string) => {
    router.push(`/result?matchId=${matchId}`);
  };

  // Check for pending claims when wallet connects
  useEffect(() => {
    if (publicKey) {
      checkPendingClaims();
    } else {
      setPendingClaims(null);
    }
  }, [publicKey]);

  // Auto-redirect logic
  useEffect(() => {
    if (!pendingClaims || !publicKey) return;

    const currentPath = router.pathname;
    
    // Don't redirect if already on result page or if on specific pages
    if (currentPath === '/result' || currentPath === '/') return;

    // If player has pending winnings, redirect to claim them
    if (pendingClaims.hasPendingWinnings && pendingClaims.pendingWinnings.length > 0) {
      const firstWinning = pendingClaims.pendingWinnings[0];
      console.log('🎯 Player has pending winnings, redirecting to claim:', firstWinning.matchId);
      redirectToClaim(firstWinning.matchId);
      return;
    }

    // If player has pending refunds and refund can be executed, redirect to claim refund
    if (pendingClaims.hasPendingRefunds && pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0) {
      const firstRefund = pendingClaims.pendingRefunds[0];
      console.log('🎯 Player has executable refund, redirecting to claim:', firstRefund.matchId);
      redirectToRefund(firstRefund.matchId);
      return;
    }

    // If player has pending refunds but refund cannot be executed yet, show warning
    if (pendingClaims.hasPendingRefunds && !pendingClaims.refundCanBeExecuted) {
      console.log('⏳ Player has pending refunds but cannot execute yet');
      // Don't redirect, but could show a notification
    }

  }, [pendingClaims, publicKey, router.pathname]);

  return {
    pendingClaims,
    loading,
    error,
    checkPendingClaims,
    redirectToClaim,
    redirectToRefund,
    hasBlockingClaims: pendingClaims?.hasPendingWinnings || 
                      (pendingClaims?.hasPendingRefunds && pendingClaims?.refundCanBeExecuted)
  };
};
