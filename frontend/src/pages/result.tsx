import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { SquadsClient } from '../utils/squadsClient';
import config from '../config/environment';

// Helper functions for base64 encoding/decoding that work in both browser and Node.js
const base64ToUint8Array = (base64: string): Uint8Array => {
  // Use browser APIs if available, otherwise use manual conversion
  if (typeof window !== 'undefined' && typeof atob !== 'undefined') {
    // Browser environment
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } else {
    // SSR/build environment - use manual base64 decoding
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let bufferLength = base64.length * 0.75;
    if (base64[base64.length - 1] === '=') {
      bufferLength--;
      if (base64[base64.length - 2] === '=') {
        bufferLength--;
      }
    }
    const bytes = new Uint8Array(bufferLength);
    let p = 0;
    for (let i = 0; i < base64.length; i += 4) {
      const encoded1 = chars.indexOf(base64[i]);
      const encoded2 = chars.indexOf(base64[i + 1]);
      const encoded3 = chars.indexOf(base64[i + 2]);
      const encoded4 = chars.indexOf(base64[i + 3]);
      bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);
      if (encoded3 !== -1) bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
      if (encoded4 !== -1) bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
    }
    return bytes;
  }
};

const uint8ArrayToBase64 = (bytes: Uint8Array): string => {
  // Use browser APIs if available, otherwise use manual conversion
  if (typeof window !== 'undefined' && typeof btoa !== 'undefined') {
    // Browser environment
    const binaryString = Array.from(bytes, byte => String.fromCharCode(byte)).join('');
    return btoa(binaryString);
  } else {
    // SSR/build environment - use manual base64 encoding
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let result = '';
    let i = 0;
    while (i < bytes.length) {
      const a = bytes[i++];
      const b = i < bytes.length ? bytes[i++] : 0;
      const c = i < bytes.length ? bytes[i++] : 0;
      const bitmap = (a << 16) | (b << 8) | c;
      result += chars.charAt((bitmap >> 18) & 63);
      result += chars.charAt((bitmap >> 12) & 63);
      result += i - 2 < bytes.length ? chars.charAt((bitmap >> 6) & 63) : '=';
      result += i - 1 < bytes.length ? chars.charAt(bitmap & 63) : '=';
    }
    return result;
  }
};

// Helper function to calculate rounded USD amounts (5, 20, 50, 100)
const calculateRoundedUSD = (solAmount: number, solPrice: number | null): number | null => {
  if (!solPrice) return null;
  const usdAmount = solAmount * solPrice;
  const categories = [5, 20, 50, 100];
  return categories.reduce((prev, curr) => 
    Math.abs(curr - usdAmount) < Math.abs(prev - usdAmount) ? curr : prev
  );
};

// Fallback SOL price (USD) used when we don't have per-match pricing.
// This is only for display-tier rounding (5, 20, 50, 100), not accounting.
const FALLBACK_SOL_PRICE_USD = 125;

// Helper function to get expected USD amount based on entry fee tier
// This ensures consistent USD display regardless of SOL price fluctuations
const getExpectedEntryFeeUSD = (solAmount: number, solPrice: number | null): number | null => {
  if (!solPrice) return null;
  return calculateRoundedUSD(solAmount, solPrice);
};

// Helper function to calculate expected winnings USD (95% of 2x entry fee)
// CRITICAL: Always uses entry fee tier amount (5, 20, 50, 100), never database value
// This ensures consistent display: $5 tier always shows $9.50, not $9.52
const getExpectedWinningsUSD = (entryFeeUSD: number | null, entryFeeSOL: number | null, solPrice: number | null): number | null => {
  // CRITICAL FIX: Always calculate from tier amount, never database value
  // This ensures $5 tier always shows $9.50 (95% of $10), not $9.52
  
  // Method 1: Determine tier from SOL amount (preferred)
  if (entryFeeSOL && solPrice) {
    const tierUSD = getExpectedEntryFeeUSD(entryFeeSOL, solPrice);
    if (tierUSD) {
      return tierUSD * 2 * 0.95;
    }
  }
  
  // Method 2: Determine tier from USD amount (if SOL not available)
  // Round the USD amount to nearest tier, then calculate
  if (entryFeeUSD && solPrice) {
    const calculatedTier = calculateRoundedUSD(entryFeeUSD / solPrice, solPrice);
    if (calculatedTier) {
      return calculatedTier * 2 * 0.95;
    }
    // If calculateRoundedUSD somehow returns null, round entryFeeUSD directly to nearest tier
    const categories = [5, 20, 50, 100];
    const nearestTier = categories.reduce((prev, curr) => 
      Math.abs(curr - entryFeeUSD) < Math.abs(prev - entryFeeUSD) ? curr : prev
    );
    return nearestTier * 2 * 0.95;
  }
  
  // Method 3: If only USD is available without solPrice, round to nearest tier
  if (entryFeeUSD && !solPrice) {
    const categories = [5, 20, 50, 100];
    const nearestTier = categories.reduce((prev, curr) => 
      Math.abs(curr - entryFeeUSD) < Math.abs(prev - entryFeeUSD) ? curr : prev
    );
    return nearestTier * 2 * 0.95;
  }
  
  return null;
};

const normalizeProposalSigners = (value: any): string[] => {
  const normalize = (input: any): string[] => {
    if (!input) {
      return [];
    }

    if (Array.isArray(input)) {
      return input
        .flatMap((entry) => normalize(entry))
        .filter((entry) => typeof entry === 'string' && entry.length > 0);
    }

    if (typeof input === 'string') {
      const trimmed = input.trim();
      if (!trimmed) {
        return [];
      }

      // Attempt to parse JSON arrays/objects stored as strings
      if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          return normalize(JSON.parse(trimmed));
        } catch {
          // Not valid JSON, fall through to other handling
        }
      }

      if (trimmed.includes(',')) {
        return trimmed
          .split(',')
          .map((entry) => entry.trim())
          .filter((entry) => entry.length > 0);
      }

      return [trimmed];
    }

    if (typeof input === 'object') {
      return normalize(Object.values(input));
    }

    return [];
  };

  const normalized = normalize(value);
  return Array.from(new Set(normalized)); // Deduplicate while preserving order
};

const BONUS_USD_BY_TIER: Record<string, number> = {
  starter: 0,
  competitive: 0.25,
  highRoller: 0.75,
  vip: 2.00
};

const BONUS_LABEL_BY_TIER: Record<string, string> = {
  starter: 'Starter',
  competitive: 'Competitive',
  highRoller: 'High Roller',
  vip: 'VIP Elite'
};

const getBonusTierLabel = (tier?: string | null) => {
  if (!tier) return 'Premium';
  return BONUS_LABEL_BY_TIER[tier] || 'Premium';
};

const Result: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const [payoutData, setPayoutData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingProposal, setSigningProposal] = useState(false);
  const [squadsClient] = useState(() => new SquadsClient());
  const [isPolling, setIsPolling] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const [proposalCreationProgress, setProposalCreationProgress] = useState(0);
  const [proposalCreationStartTime, setProposalCreationStartTime] = useState<number | null>(null);
  const [actualBonusAmount, setActualBonusAmount] = useState<number | null>(null);
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [onChainVerified, setOnChainVerified] = useState<boolean | null>(null);
  const [verificationError, setVerificationError] = useState<string | null>(null);
  const [explorerLink, setExplorerLink] = useState<string | null>(null);
  const [executionStartTime, setExecutionStartTime] = useState<number | null>(null);
  const [verificationStartTime, setVerificationStartTime] = useState<number | null>(null);
  const refreshIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const refreshTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const stopRefreshLoops = () => {
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
  };

  const shouldContinuePolling = (info: any) => {
    // CRITICAL: Stop polling if proposal is executed
    if (info?.proposalStatus === 'EXECUTED' || info?.proposalExecutedAt) {
      console.log('🛑 Stopping polling: Proposal is executed', {
        proposalStatus: info?.proposalStatus,
        proposalExecutedAt: info?.proposalExecutedAt,
      });
      return false;
    }
    
    // CRITICAL: Continue polling if no proposal exists yet
    if (!info?.proposalId) {
      console.log('🔄 Continue polling: No proposal ID yet', {
        proposalId: info?.proposalId,
        hasPlayerResults: !!(info?.player1Result && info?.player2Result),
        bothPlayersFinished: !!(info?.player1Result && info?.player2Result),
        currentPlayer: publicKey?.toString(),
        isPlayer1: publicKey?.toString() === info?.player1,
        isPlayer2: publicKey?.toString() === info?.player2
      });
      return true;
    }
    
    if (!info) return false;
    const normalizedStatus = (info.proposalStatus || '').toString().toUpperCase();
    const needs = Number.isFinite(info.needsSignatures)
      ? Number(info.needsSignatures)
      : 0;

    // If both players have results, check if payout is complete
    if (info.player1Result && info.player2Result) {
      // CRITICAL: Stop polling ONLY if proposal is EXECUTED (not just EXECUTING)
      // proposalTransactionId can be the approval signature, not execution signature
      // So we must check proposalExecutedAt or EXECUTED status, not just proposalTransactionId
      if (normalizedStatus === 'EXECUTED' || info.proposalExecutedAt) {
        console.log('🛑 Stopping polling: Proposal is executed', {
          proposalStatus: normalizedStatus,
          proposalExecutedAt: info.proposalExecutedAt,
        });
        return false;
      }
      
      // CRITICAL: Continue polling during EXECUTING status until it becomes EXECUTED
      if (normalizedStatus === 'EXECUTING') {
        console.log('🔄 Continue polling: Proposal is EXECUTING, waiting for EXECUTED', {
          proposalStatus: normalizedStatus,
          proposalExecutedAt: info.proposalExecutedAt,
        });
        return true;
      }
      
      // CRITICAL: Continue polling even if proposal is READY_TO_EXECUTE until it's actually EXECUTED
      // This ensures we detect when the proposal is executed and stop the spinning
      // Don't stop polling just because it's ready - wait for execution
      // Continue polling if proposal exists but hasn't been executed yet
      // CRITICAL: Even if proposal exists, continue polling until it's executed
      // This ensures the sign button appears immediately when proposal is ready
      if (info.proposalId) {
        // If proposal exists but needs signatures, continue polling
        if (needs > 0) {
          return true;
        }
        // If proposal is ready but not executed, continue polling
        // NOTE: proposalTransactionId might be approval signature, not execution signature
        // So we check proposalExecutedAt instead
        if (normalizedStatus !== 'EXECUTED' && !info.proposalExecutedAt) {
          return true;
        }
      }
      // If no proposal yet but both players finished, continue polling for proposal creation
      return true;
    }

    // If no proposalId yet, continue polling (proposal being created)
    if (!info.proposalId) {
      return true;
    }

    // If proposal has transaction ID, payout is complete
    if (info.proposalTransactionId) {
      return false;
    }

    // If proposal is executed, stop polling
    if (normalizedStatus === 'EXECUTED') {
      return false;
    }

    // CRITICAL: Continue polling even if proposal is READY_TO_EXECUTE until it's actually EXECUTED
    // Don't stop polling just because it's ready - wait for execution
    // Only stop if it's actually executed or has a transaction ID

    // If signatures are still needed, continue polling
    if (needs > 0) {
      return true;
    }

    // CRITICAL: Continue polling if proposal is active, pending, or executing
    // We need to keep polling during EXECUTING to detect when it becomes EXECUTED
    // Also continue polling if needsSignatures is 0 but not yet executed (execution in progress)
    const isExecuting = normalizedStatus === 'EXECUTING' || (needs === 0 && !info.proposalExecutedAt);
    return normalizedStatus === 'ACTIVE' || normalizedStatus === 'PENDING' || isExecuting;
  };

  const normalizedProposalSigners = useMemo(
    () => normalizeProposalSigners(payoutData?.proposalSigners),
    [payoutData?.proposalSigners]
  );

  const playerProposalSigners = useMemo(() => {
    const feeWallet = config.FEE_WALLET_ADDRESS?.toLowerCase?.();
    const filtered = normalizedProposalSigners.filter(
      (signer) => signer && signer.toLowerCase() !== feeWallet
    );
    console.log('🔍 COMPREHENSIVE: Proposal signer state', {
      matchId: typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('matchId') : 'unknown',
      raw: payoutData?.proposalSigners,
      normalized: normalizedProposalSigners,
      playerOnly: filtered,
      feeWallet,
      needsSignatures: payoutData?.needsSignatures,
      proposalId: payoutData?.proposalId,
      proposalStatus: payoutData?.proposalStatus,
      timestamp: new Date().toISOString(),
      action: 'calculating_player_signers'
    });
    return filtered;
  }, [normalizedProposalSigners, payoutData?.proposalSigners, payoutData?.needsSignatures]);

  const loadPayoutData = async () => {
    // Always try to fetch fresh data from backend first if we have a matchId
    const matchId = router.query.matchId as string;
    if (matchId) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey?.toString()}`, {
          // Add credentials to help with CORS
          credentials: 'include',
          // Add headers to help with CORS
          headers: {
            'Content-Type': 'application/json',
          },
        });
        
        if (response.ok) {
          const matchData = await response.json();
          
          console.log('🔍 CRITICAL DEBUG: Raw API response data:', {
            matchId,
            payoutProposalId: matchData.payoutProposalId,
            tieRefundProposalId: matchData.tieRefundProposalId,
            proposalStatus: matchData.proposalStatus,
            proposalSigners: matchData.proposalSigners,
            needsSignatures: matchData.needsSignatures,
            winner: matchData.winner,
            isCompleted: matchData.isCompleted,
            status: matchData.status,
            currentPlayer: publicKey?.toString(),
            isPlayer1: publicKey?.toString() === matchData.player1,
            isPlayer2: publicKey?.toString() === matchData.player2,
            player1Result: !!matchData.player1Result,
            player2Result: !!matchData.player2Result,
            bothPlayersHaveResults: !!(matchData.player1Result && matchData.player2Result)
          });

          // Check if both players have results (more reliable indicator of completion)
          const bothPlayersHaveResults = matchData.player1Result && matchData.player2Result;
          const isCompleted = matchData.isCompleted || bothPlayersHaveResults;

          // Detect "no game played" cancellation where only one player paid
          const exactlyOnePlayerPaid =
            (matchData.player1Paid && !matchData.player2Paid) ||
            (!matchData.player1Paid && matchData.player2Paid);
          const isCancelledNoPlay =
            (matchData.matchOutcome === 'cancelled' || matchData.status === 'cancelled') &&
            exactlyOnePlayerPaid;

          if (isCancelledNoPlay) {
            const currentWallet = publicKey?.toString() || '';
            const viewerIsPlayer1 = currentWallet === matchData.player1;
            const viewerIsPlayer2 = currentWallet === matchData.player2;
            const payerWallet = matchData.player1Paid ? matchData.player1 : matchData.player2;
            const viewerPaid = !!currentWallet && currentWallet === payerWallet;

            const currentPayoutData = payoutData || {};
            const cancelledNoGamePayout = {
              ...currentPayoutData,
              matchId,
              entryFee: matchData.entryFee || currentPayoutData.entryFee || 0,
              player1: matchData.player1,
              player2: matchData.player2,
              player1Paid: !!matchData.player1Paid,
              player2Paid: !!matchData.player2Paid,
              viewerWallet: currentWallet,
              viewerIsPlayer1,
              viewerIsPlayer2,
              viewerPaid,
              won: false,
              isTie: false,
              winner: null,
              refundAmount: 0,
              refundReason: currentPayoutData.refundReason || 'single_player_paid_no_game',
              matchOutcome: matchData.matchOutcome || matchData.status || 'cancelled',
              rawStatus: matchData.status || currentPayoutData.rawStatus || null,
              noGamePlayed: true,
            };

            console.log('🔍 Detected cancelled match with no game played:', {
              matchId,
              status: matchData.status,
              matchOutcome: matchData.matchOutcome,
              player1Paid: matchData.player1Paid,
              player2Paid: matchData.player2Paid,
              viewerWallet: currentWallet,
              viewerPaid,
            });

            setPayoutData(cancelledNoGamePayout);
            setIsPolling(false);
            stopRefreshLoops();
            setLoading(false);
            return;
          }

          // Determine whether this match uses a legacy multisig proposal (payoutProposalId)
          // or the new direct smart contract payout (no proposal IDs at all).
          const extractedProposalId = matchData.payoutProposalId || matchData.tieRefundProposalId;
          const hasOnchainProposal = !!extractedProposalId;
          const isSmartContractPayout = !hasOnchainProposal;

          if (isCompleted) {
            // Get player results from match data
            const isPlayer1 = publicKey?.toString() === matchData.player1;
            const playerResultRaw = isPlayer1 ? matchData.player1Result : matchData.player2Result;
            const opponentResultRaw = isPlayer1 ? matchData.player2Result : matchData.player1Result;
            
            // Parse results (handle both string JSON and object)
            const playerResult = typeof playerResultRaw === 'string' ? JSON.parse(playerResultRaw) : playerResultRaw;
            const opponentResult = typeof opponentResultRaw === 'string' ? JSON.parse(opponentResultRaw) : opponentResultRaw;
            
            // Create payout data from match data
            const bonusInfo = matchData.bonus || {};
            const solPriceForMatch =
              matchData.solPriceAtTransaction
                ? Number(matchData.solPriceAtTransaction)
                : matchData.entryFeeUSD && matchData.entryFee
                ? Number(matchData.entryFeeUSD) / Number(matchData.entryFee)
                : undefined;
            const bonusAmountSol = bonusInfo.amountSol ? Number(bonusInfo.amountSol) : 0;
            const bonusAmountUsd = bonusInfo.amountUSD ? Number(bonusInfo.amountUSD) : 0;
            const expectedBonusUsd =
              bonusInfo.tier && BONUS_USD_BY_TIER[bonusInfo.tier]
                ? BONUS_USD_BY_TIER[bonusInfo.tier]
                : bonusAmountUsd;
            const expectedBonusSol =
              expectedBonusUsd && solPriceForMatch
                ? expectedBonusUsd / solPriceForMatch
                : bonusAmountSol;
            
            console.log('🔍 CRITICAL DEBUG: Proposal ID extraction:', {
              matchId,
              payoutProposalId: matchData.payoutProposalId,
              tieRefundProposalId: matchData.tieRefundProposalId,
              extractedProposalId,
              proposalStatus: matchData.proposalStatus,
              winner: matchData.winner
            });
            
            // CRITICAL: Merge new data with existing state to prevent UI flashing
            // Preserve valid states like EXECUTING, signed status, etc.
            const currentPayoutData = payoutData || {};
            const currentUserWallet = publicKey?.toString() || '';
            const currentSigners = Array.isArray(currentPayoutData?.proposalSigners) 
              ? currentPayoutData.proposalSigners 
              : [];
            const newSigners = normalizeProposalSigners(matchData.proposalSigners);
            
            // CRITICAL: Preserve user's signature if they've signed (even if backend hasn't updated yet)
            // This prevents UI from reverting to "needs signature" after user signs
            const mergedSigners = Array.from(new Set([
              ...currentSigners.filter((s: string) => s?.toLowerCase() === currentUserWallet.toLowerCase()),
              ...newSigners,
              ...currentSigners.filter((s: string) => s?.toLowerCase() !== currentUserWallet.toLowerCase())
            ]));
            
            // CRITICAL: Preserve EXECUTING status if it exists in current state
            // Don't overwrite with null/undefined from backend
            const preservedStatus = hasOnchainProposal
              ? (currentPayoutData?.proposalStatus === 'EXECUTING' && !matchData.proposalStatus
                  ? 'EXECUTING'
                  : (matchData.proposalStatus || currentPayoutData?.proposalStatus))
              : undefined;
            
            // CRITICAL: Preserve needsSignatures if it's 0 in current state and backend hasn't updated yet
            const preservedNeedsSignatures = hasOnchainProposal
              ? (currentPayoutData?.needsSignatures === 0 && 
                  (matchData.needsSignatures === null || matchData.needsSignatures === undefined)
                    ? 0
                    : (matchData.needsSignatures ?? currentPayoutData?.needsSignatures ?? 0))
              : undefined;
            
            // Determine tie reason for better UX
            let tieReason: string | null = null;
            if (matchData.winner === 'tie' && playerResult && opponentResult) {
              const playerTimedOut = playerResult.reason === 'timeout';
              const playerUsedAllGuesses = playerResult.numGuesses === 7 && playerResult.reason === 'server-validated';
              const opponentTimedOut = opponentResult.reason === 'timeout';
              const opponentUsedAllGuesses = opponentResult.numGuesses === 7 && opponentResult.reason === 'server-validated';
              
              if (playerTimedOut && opponentUsedAllGuesses) {
                tieReason = 'timeout_and_all_guesses';
              } else if (opponentTimedOut && playerUsedAllGuesses) {
                tieReason = 'timeout_and_all_guesses';
              } else if (playerTimedOut && opponentTimedOut) {
                tieReason = 'both_timeout';
              } else if (playerUsedAllGuesses && opponentUsedAllGuesses) {
                tieReason = 'both_all_guesses';
              }
            }
            
            const updatedPayoutData = {
              ...(currentPayoutData || {}), // Preserve existing state (handle null)
              won: matchData.winner === publicKey?.toString() && matchData.winner !== 'tie',
              isTie: matchData.winner === 'tie',
              winner: matchData.winner,
              tieReason, // Add tie reason for better UX
              numGuesses: playerResult?.numGuesses || currentPayoutData?.numGuesses || 0,
              // Preserve client-computed entryFee / entryFeeUSD if present; otherwise fall back to backend-derived values
              entryFee: currentPayoutData?.entryFee ?? matchData.entryFee ?? 0,
              entryFeeUSD:
                currentPayoutData?.entryFeeUSD ??
                (matchData.entryFee && solPriceForMatch
                  ? getExpectedEntryFeeUSD(Number(matchData.entryFee), solPriceForMatch)
                  : null),
              solPriceAtTransaction: currentPayoutData?.solPriceAtTransaction || solPriceForMatch || null,
              timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : (currentPayoutData?.timeElapsed || 'N/A'),
              opponentTimeElapsed: opponentResult ? `${Math.floor(opponentResult.totalTime / 1000)}s` : (currentPayoutData?.opponentTimeElapsed || 'N/A'),
              opponentGuesses: opponentResult?.numGuesses || currentPayoutData?.opponentGuesses || 0,
              winnerAmount: matchData.payout?.winnerAmount || currentPayoutData?.winnerAmount || 0,
              feeAmount: matchData.payout?.feeAmount || currentPayoutData?.feeAmount || 0,
              refundAmount: matchData.payout?.refundAmount || currentPayoutData?.refundAmount || 0,
              isWinningTie: matchData.payout?.isWinningTie ?? currentPayoutData?.isWinningTie ?? false,
              feeWallet: matchData.payout?.feeWallet || currentPayoutData?.feeWallet || '',
              transactions: matchData.payout?.transactions || currentPayoutData?.transactions || [],
              vaultAddress: matchData.squadsVaultAddress || matchData.vaultAddress || currentPayoutData?.vaultAddress,
              vaultDepositAddress: matchData.squadsVaultPda || matchData.vaultPda || currentPayoutData?.vaultDepositAddress || null,
              // For legacy multisig/proposal matches, keep proposal fields.
              // For smart contract payouts (no proposal IDs), intentionally leave them undefined.
              proposalId: hasOnchainProposal ? (extractedProposalId || currentPayoutData?.proposalId) : currentPayoutData?.proposalId,
              proposalStatus: hasOnchainProposal ? preservedStatus : undefined,
              proposalSigners: hasOnchainProposal ? mergedSigners : [],
              needsSignatures: hasOnchainProposal ? preservedNeedsSignatures : undefined,
              proposalExecutedAt: matchData.proposalExecutedAt || currentPayoutData?.proposalExecutedAt,
              proposalTransactionId: matchData.proposalTransactionId || currentPayoutData.proposalTransactionId,
              automatedPayout: matchData.payout?.paymentSuccess ?? currentPayoutData.automatedPayout ?? false,
              payoutSignature: matchData.payout?.transactions?.[0]?.signature || matchData.proposalTransactionId || currentPayoutData.payoutSignature || null,
              bonus: {
                eligible: expectedBonusUsd > 0 || currentPayoutData.bonus?.eligible || false,
                paid: !!bonusInfo.paid || currentPayoutData.bonus?.paid || false,
                amountSol: bonusAmountSol || currentPayoutData.bonus?.amountSol || 0,
                amountUSD: bonusAmountUsd || currentPayoutData.bonus?.amountUSD || 0,
                percent: bonusInfo.percent ? Number(bonusInfo.percent) : (currentPayoutData.bonus?.percent || 0),
                tier: bonusInfo.tier || currentPayoutData.bonus?.tier || null,
                signature: bonusInfo.signature || currentPayoutData.bonus?.signature || null,
                paidAt: bonusInfo.paidAt ? new Date(bonusInfo.paidAt) : (currentPayoutData.bonus?.paidAt || null),
                expectedUSD: expectedBonusUsd || currentPayoutData.bonus?.expectedUSD || 0,
                expectedSol: expectedBonusSol || currentPayoutData.bonus?.expectedSol || 0
              },
              totalPayoutSol:
                matchData.winner === publicKey?.toString() && matchData.winner !== 'tie'
                  ? (matchData.payout?.winnerAmount || 0) + bonusAmountSol
                  : matchData.payout?.winnerAmount || currentPayoutData.totalPayoutSol || 0,
              refundReason: matchData.refundReason || currentPayoutData.refundReason || null,
              matchOutcome: matchData.matchOutcome || matchData.status || currentPayoutData.matchOutcome || null,
              rawStatus: matchData.status || currentPayoutData.rawStatus || null,
              isSmartContractPayout,
            };
            
            // CRITICAL: Prevent regressions from rate-limited backend responses
            // If backend returns 0 signers but we previously had signers, don't regress
            const currentSignerCount = currentPayoutData?.proposalSigners?.length || 0;
            const newSignerCount = updatedPayoutData.proposalSigners?.length || 0;
            const isRegression = newSignerCount < currentSignerCount && currentSignerCount > 0;
            
            // If backend returns null/undefined status but we have a valid status, preserve it
            const statusRegression = 
              !matchData.proposalStatus && 
              currentPayoutData?.proposalStatus && 
              ['ACTIVE', 'APPROVED', 'EXECUTING', 'EXECUTED'].includes(currentPayoutData.proposalStatus);
            
            // If backend returns higher needsSignatures but we had 0, don't regress
            const needsSignaturesRegression = 
              updatedPayoutData.needsSignatures > 0 && 
              currentPayoutData?.needsSignatures === 0;
            
            // Don't update if we detect a regression (likely due to rate limiting)
            if (isRegression || statusRegression || needsSignaturesRegression) {
              console.warn('⚠️ Preventing status regression (likely rate-limited backend response)', {
                matchId,
                isRegression,
                statusRegression,
                needsSignaturesRegression,
                currentSignerCount,
                newSignerCount,
                currentStatus: currentPayoutData?.proposalStatus,
                newStatus: matchData.proposalStatus,
                currentNeedsSignatures: currentPayoutData?.needsSignatures,
                newNeedsSignatures: matchData.needsSignatures,
                note: 'Backend likely hit rate limit - preserving previous valid state',
              });
              return; // Don't update state with regressed data
            }
            
            // CRITICAL: Only update state if there are meaningful changes
            // This prevents UI flashing from unnecessary state updates
            // CRITICAL FIX: Use optional chaining to prevent null access errors
            const hasMeaningfulChanges = 
              updatedPayoutData.proposalId !== (currentPayoutData?.proposalId ?? null) ||
              updatedPayoutData.proposalStatus !== (currentPayoutData?.proposalStatus ?? null) ||
              updatedPayoutData.needsSignatures !== (currentPayoutData?.needsSignatures ?? null) ||
              updatedPayoutData.proposalExecutedAt !== (currentPayoutData?.proposalExecutedAt ?? null) ||
              updatedPayoutData.proposalTransactionId !== (currentPayoutData?.proposalTransactionId ?? null) ||
              JSON.stringify(updatedPayoutData.proposalSigners) !== JSON.stringify(currentPayoutData?.proposalSigners ?? []);
            
            if (hasMeaningfulChanges) {
              console.log('✅ Updating payout data with meaningful changes', {
                proposalId: updatedPayoutData.proposalId !== currentPayoutData.proposalId,
                proposalStatus: updatedPayoutData.proposalStatus !== currentPayoutData.proposalStatus,
                needsSignatures: updatedPayoutData.needsSignatures !== currentPayoutData.needsSignatures,
                proposalExecutedAt: updatedPayoutData.proposalExecutedAt !== currentPayoutData.proposalExecutedAt,
                proposalTransactionId: updatedPayoutData.proposalTransactionId !== currentPayoutData.proposalTransactionId,
                proposalSigners: JSON.stringify(updatedPayoutData.proposalSigners) !== JSON.stringify(currentPayoutData.proposalSigners),
              });
              // Telemetry calls removed - they were causing ERR_CONNECTION_REFUSED errors
              setPayoutData(updatedPayoutData);
            } else {
              console.log('⏸️ Skipping state update - no meaningful changes', {
              proposalId: updatedPayoutData?.proposalId ?? null,
              proposalStatus: updatedPayoutData?.proposalStatus ?? null,
              needsSignatures: updatedPayoutData?.needsSignatures ?? null,
              });
            }
            setLoading(false);
            
            // CRITICAL FIX: Set proposal creation start time based on when match was completed or proposal was created
            // This ensures both players see the same progress percentage
            if (bothPlayersHaveResults && !proposalCreationStartTime) {
              // Use proposalCreatedAt if available, otherwise use match createdAt or current time minus offset
              let startTime: number;
              if (matchData.proposalCreatedAt) {
                startTime = new Date(matchData.proposalCreatedAt).getTime();
                console.log('📊 Using proposalCreatedAt from backend for progress bar', {
                  matchId,
                  proposalCreatedAt: matchData.proposalCreatedAt,
                  startTime: new Date(startTime).toISOString(),
                });
              } else if (matchData.createdAt) {
                // Use match creation time as fallback (proposal is created shortly after match completion)
                startTime = new Date(matchData.createdAt).getTime();
                console.log('📊 Using match createdAt as fallback for progress bar', {
                  matchId,
                  createdAt: matchData.createdAt,
                  startTime: new Date(startTime).toISOString(),
                });
              } else {
                // Last resort: assume match completed 2 seconds ago
                startTime = Date.now() - 2000;
                console.log('📊 Using estimated match completion time for progress bar', {
                  matchId,
                  startTime: new Date(startTime).toISOString(),
                });
              }
              setProposalCreationStartTime(startTime);
              console.log('📊 Setting proposal creation start time', {
                matchId,
                startTime: new Date(startTime).toISOString(),
                bothPlayersHaveResults,
                hasProposal: !!payoutData?.proposalId,
                note: 'This ensures both players see consistent progress percentages'
              });
            }
            // CRITICAL: Check for irrecoverable proposal creation failure
            if (updatedPayoutData.proposalStatus === 'VAULT_TX_CREATION_FAILED' || 
                matchData.proposalStatus === 'VAULT_TX_CREATION_FAILED') {
              console.error('❌ FATAL: Match failed to initialize - VaultTransaction creation failed', {
                matchId,
                proposalStatus: updatedPayoutData.proposalStatus || matchData.proposalStatus,
                note: 'VaultTransaction was never created on-chain. This match cannot proceed. No amount of retries will fix this.',
              });
              
              setError('Match failed to initialize: This match could not be set up properly. Please try creating a new match or contact support if this issue persists. (Code: VAULT_TX_NOT_CREATED)');
              setIsPolling(false);
              stopRefreshLoops();
              setLoading(false);
              return;
            }
            
            // CRITICAL: Always stop loading even if proposal doesn't exist yet
            // This prevents the spinning wheel from blocking the UI
            // CRITICAL FIX: Continue polling until proposal is executed or user has signed
            const keepPolling = shouldContinuePolling(updatedPayoutData);
            console.log('🔄 Polling Decision (API):', {
              matchId: router.query.matchId,
              keepPolling,
              proposalId: updatedPayoutData?.proposalId,
              proposalStatus: updatedPayoutData.proposalStatus,
              bothPlayersHaveResults,
              isPolling: isPolling,
              extractedProposalId
            });
            
            setIsPolling(keepPolling);
            if (!keepPolling) {
              stopRefreshLoops();
            } else if (!updatedPayoutData.proposalId) {
              // CRITICAL: If no proposalId yet, ensure polling is active
              // This ensures both players see the signing button as soon as proposal is created
              setIsPolling(true);
            }

            // CRITICAL FIX: Check if user has signed (case-insensitive comparison)
            // Also check raw proposalSigners in case normalization missed it
            const checkUserWallet = publicKey?.toString() || '';
            const userHasSigned = playerProposalSigners.some(s => s?.toLowerCase() === checkUserWallet.toLowerCase()) ||
                                  normalizedProposalSigners.some(s => s?.toLowerCase() === checkUserWallet.toLowerCase());
            
            // Don't show "user hasn't signed" message if:
            // 1. Proposal is EXECUTING (already has all signatures)
            // 2. needsSignatures is 0 (all signatures collected)
            // 3. User has actually signed
            // CRITICAL FIX: Use optional chaining to prevent null access errors
            const proposalReadyToSign = payoutData?.proposalId && 
                                        !userHasSigned && 
                                        payoutData?.proposalStatus !== 'EXECUTED' && 
                                        payoutData?.proposalStatus !== 'EXECUTING' &&
                                        payoutData?.needsSignatures !== 0 &&
                                        !payoutData?.proposalExecutedAt;
            
            if (proposalReadyToSign) {
              console.log('🔄 Proposal is available but user hasn\'t signed yet - triggering page refresh', {
                proposalId: payoutData?.proposalId,
                needsSignatures: payoutData?.needsSignatures,
                proposalStatus: payoutData?.proposalStatus,
                userHasSigned,
                userWallet: checkUserWallet,
                playerProposalSigners,
                normalizedProposalSigners,
                proposalExecutedAt: payoutData?.proposalExecutedAt,
              });
              
              // REMOVED: No more automatic page reload - let React update naturally
              console.log('✅ Proposal detected, React will update UI automatically');
            }
            return;
          } else {
            console.log('⏳ Game not yet completed, falling back to localStorage');
          }
        } else {
          console.error('❌ Failed to fetch match data from backend', {
            status: response.status,
            statusText: response.statusText,
            matchId,
          });
          // If it's a CORS error or network error, don't fail completely - try localStorage
          // The polling will retry later
        }
      } catch (error) {
        console.error('❌ Error fetching match data:', error);
        // CORS/network errors are non-fatal - continue with localStorage and polling will retry
        // Don't set error state for network issues
      }
    }

    // Fallback to localStorage if no matchId or backend fetch failed
    // CRITICAL: Only use localStorage if we don't already have EXECUTING status in current state
    // Check current state before falling back to avoid overwriting EXECUTING status
    const currentState = payoutData;
    // CRITICAL FIX: Only consider executing if status is explicitly EXECUTING or READY_TO_EXECUTE
    const isExecutingState = currentState?.proposalStatus === 'EXECUTING' || 
                             currentState?.proposalStatus === 'READY_TO_EXECUTE' ||
                             (currentState?.proposalStatus === 'APPROVED' && currentState?.needsSignatures === 0 && !currentState?.proposalExecutedAt);
    if (isExecutingState) {
      console.log('✅ Skipping localStorage fallback - already have EXECUTING status in state', {
        proposalStatus: currentState.proposalStatus,
        needsSignatures: currentState.needsSignatures,
        proposalId: currentState.proposalId,
      });
      return; // Don't overwrite with stale localStorage data
    }
    
    const storedPayoutData = localStorage.getItem('payoutData');
    if (storedPayoutData) {
      try {
        const data = JSON.parse(storedPayoutData);
        
        // CRITICAL: Warn user if using localStorage fallback - data may be stale
        console.warn('⚠️ Using localStorage fallback - data may be stale. API call failed or matchId missing.', {
          matchId: router.query.matchId,
          hasProposalId: !!data.proposalId,
          proposalStatus: data.proposalStatus,
          proposalSigners: data.proposalSigners,
        });
        
        // Ensure isWinningTie flag exists (fallback for old localStorage data)
        if (data.isTie && data.isWinningTie === undefined) {
          // If it's a tie but isWinningTie is missing, assume losing tie (more common)
          data.isWinningTie = false;
        }
        
        if (!data.bonus) {
          data.bonus = {
            eligible: false,
            paid: false,
            amountSol: 0,
            amountUSD: 0,
            percent: 0,
            tier: null,
            signature: null,
            paidAt: null,
            expectedUSD: 0,
            expectedSol: 0
          };
        }

        if (typeof data.matchOutcome === 'undefined') {
          data.matchOutcome = null;
        }

        if (typeof data.refundReason === 'undefined') {
          data.refundReason = null;
        }
        
        // CRITICAL: Mark data as potentially stale when using localStorage fallback
        // CRITICAL FIX: Ensure data is not null before accessing properties
        if (!data) {
          console.error('❌ localStorage data is null - cannot use fallback', {
            matchId: router.query.matchId,
            storedPayoutData: storedPayoutData?.substring(0, 100),
          });
          setLoading(false);
          return;
        }
        
        data._isStaleFallback = true;
        
        // Telemetry calls removed - they were causing ERR_CONNECTION_REFUSED errors
        setPayoutData(data);
        setLoading(false);
        // CRITICAL FIX: Continue polling until proposal is executed or user has signed
        // CRITICAL FIX: Use optional chaining to prevent null access errors
        const keepPolling = shouldContinuePolling(data);
        console.log('🔄 Polling Decision (API):', {
          matchId: router.query.matchId,
          keepPolling,
          proposalId: data?.proposalId,
          proposalStatus: data?.proposalStatus,
          bothPlayersHaveResults: data?.player1Result && data?.player2Result,
          isPolling: isPolling
        });
        
        setIsPolling(keepPolling);
        if (!keepPolling) {
          stopRefreshLoops();
        } else if (!data?.proposalId) {
          // CRITICAL: If no proposalId yet, ensure polling is active
          // This ensures both players see the signing button as soon as proposal is created
          setIsPolling(true);
        }
        return;
      } catch (error) {
        console.error('❌ Error parsing stored payout data:', error);
      }
    }

    // If no matchId and no localStorage data, show error
    if (!matchId) {
      setError('No match ID provided');
      setLoading(false);
      setIsPolling(false);
      return;
    }

    // CRITICAL: Don't set error if we have localStorage data or if it's just a network issue
    // Only set error if we truly have no data at all
    // This prevents CORS errors from blocking the UI
    if (!storedPayoutData) {
      setError('Failed to load game results');
    }
    setLoading(false);
    // CRITICAL: If we have a matchId but no proposalId, we MUST continue polling
    // This ensures both players see the signing button as soon as proposal is created
    // Expert recommendation: Always poll if we have matchId, even if initial fetch fails
    if (matchId) {
      // Start polling to wait for proposal creation
      setIsPolling(true);
      console.log('🔄 Starting polling for proposal creation (matchId present but no proposalId yet)', {
        matchId,
        hasStoredData: !!storedPayoutData,
      });
    } else {
      setIsPolling(false);
      stopRefreshLoops();
    }
  };

  useEffect(() => {
    // CRITICAL FIX: Don't immediately redirect if wallet not connected
    // Give wallet time to connect, especially after game completion
    if (!publicKey) {
      console.log('⚠️ Wallet not connected on results page, waiting for connection...');
      // Set a timeout to redirect only if wallet doesn't connect within 5 seconds
      const redirectTimeout = setTimeout(() => {
        if (!publicKey) {
          console.log('🔌 Wallet still not connected after 5s, redirecting to home');
          router.push('/');
        }
      }, 5000);
      
      return () => clearTimeout(redirectTimeout);
    }

    console.log('✅ Wallet connected on results page, loading payout data');
    // CRITICAL FIX: Don't set proposalCreationStartTime here - wait until we know the match is completed
    // This prevents the progress bar from starting at different times for different players
    // The start time will be set in loadPayoutData when we detect bothPlayersHaveResults
    loadPayoutData();
  }, [publicKey, router]);

  // Track proposal creation progress
  useEffect(() => {
    if (!proposalCreationStartTime) {
      setProposalCreationProgress(0);
      return;
    }

    // CRITICAL FIX: Show progress even when proposalStatus is 'PENDING'
    // Only hide progress when we have a proposal AND it's not PENDING
    if (payoutData?.proposalId && payoutData?.proposalStatus !== 'PENDING') {
      setProposalCreationProgress(100); // Complete if we have a proposal and it's not pending
      return;
    }

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - proposalCreationStartTime;
      const maxTime = 45000; // 45 seconds max expected time
      const progress = Math.min((elapsed / maxTime) * 100, 95); // Cap at 95% until actual completion
      setProposalCreationProgress(progress);
    }, 500);

    return () => clearInterval(progressInterval);
  }, [proposalCreationStartTime, payoutData?.proposalId, payoutData?.proposalStatus]);

  // Poll for proposal updates when polling is active
  // Expert recommendation: More aggressive polling when game is active
  useEffect(() => {
    if (!isPolling || !router.query.matchId || !publicKey) {
      return;
    }
    
    // Smart polling: 1s until proposal exists, 2s during EXECUTING (faster to detect completion), 3s otherwise
    const hasProposal = !!payoutData?.proposalId;
    // CRITICAL FIX: Only consider executing if status is explicitly EXECUTING or READY_TO_EXECUTE
    // Don't infer from needsSignatures === 0 - APPROVED with 0 signatures means waiting for ExecuteReady
    const isExecuting = payoutData?.proposalStatus === 'EXECUTING' || 
                        payoutData?.proposalStatus === 'READY_TO_EXECUTE' ||
                        (payoutData?.proposalStatus === 'APPROVED' && payoutData?.needsSignatures === 0 && !payoutData?.proposalExecutedAt);
    const baseInterval = hasProposal ? (isExecuting ? 2000 : 3000) : 1000; // Faster polling during execution
    
    console.log('🔄 Starting smart proposal polling...', {
      matchId: router.query.matchId,
      hasProposalId: hasProposal,
      baseInterval,
      bothPlayersHaveResults: !!(payoutData?.player1Result && payoutData?.player2Result),
      currentPlayer: publicKey?.toString(),
      isPlayer1: publicKey?.toString() === payoutData?.player1,
      isPlayer2: publicKey?.toString() === payoutData?.player2,
      proposalId: payoutData?.proposalId,
      proposalStatus: payoutData?.proposalStatus,
      needsSignatures: payoutData?.needsSignatures
    });

    let pollCount = 0;
    
    // CRITICAL: Debounce loadPayoutData to prevent rapid state updates
    let lastLoadTime = 0;
    const minLoadInterval = 1000; // Minimum 1 second between loads
    
    const pollInterval = setInterval(() => {
      pollCount++;
      // CRITICAL FIX: Only consider executing if status is explicitly EXECUTING or READY_TO_EXECUTE
    // Don't infer from needsSignatures === 0 - APPROVED with 0 signatures means waiting for ExecuteReady
    const isExecuting = payoutData?.proposalStatus === 'EXECUTING' || 
                        payoutData?.proposalStatus === 'READY_TO_EXECUTE' ||
                        (payoutData?.proposalStatus === 'APPROVED' && payoutData?.needsSignatures === 0 && !payoutData?.proposalExecutedAt);
      const currentInterval = hasProposal ? (isExecuting ? 2000 : 3000) : 1000; // Faster polling during execution
      
      // CRITICAL: Debounce to prevent rapid state updates that cause UI flashing
      const now = Date.now();
      if (now - lastLoadTime < minLoadInterval) {
        console.log('⏸️ Skipping poll - too soon since last load', {
          timeSinceLastLoad: now - lastLoadTime,
          minInterval: minLoadInterval,
        });
        return;
      }
      lastLoadTime = now;
      
      console.log('🔄 Smart polling for proposal updates...', {
        matchId: router.query.matchId,
        hasProposalId: !!payoutData?.proposalId,
        pollCount,
        interval: currentInterval,
        mode: hasProposal ? 'signature_waiting' : 'proposal_creation',
      });
      
      loadPayoutData();
    }, baseInterval); // Use smart interval based on proposal existence
    
    // Store initial interval in ref for cleanup
    refreshIntervalRef.current = pollInterval;

    return () => {
      console.log('🛑 Stopping proposal polling');
      clearInterval(pollInterval);
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling, router.query.matchId, publicKey]);

  // Fetch SOL price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';
        const response = await fetch(`${API_URL}/api/match/sol-price`);
        if (response.ok) {
          const data = await response.json();
          if (data.price && typeof data.price === 'number' && data.price > 0) {
            setSolPrice(data.price);
          }
        }
      } catch (error) {
        console.error('❌ Failed to fetch SOL price:', error);
      }
    };
    fetchPrice();
  }, []);

  // Track execution start time and force re-renders during execution
  const [executionElapsedSeconds, setExecutionElapsedSeconds] = useState<number>(0);
  
  useEffect(() => {
    // CRITICAL FIX: Only start execution timer if status is explicitly EXECUTING or READY_TO_EXECUTE
    const shouldStartTimer = payoutData?.proposalStatus === 'EXECUTING' || 
                             payoutData?.proposalStatus === 'READY_TO_EXECUTE' ||
                             (payoutData?.proposalStatus === 'APPROVED' && payoutData?.needsSignatures === 0 && !payoutData?.proposalExecutedAt);
    if (shouldStartTimer && !executionStartTime) {
      setExecutionStartTime(Date.now());
      setExecutionElapsedSeconds(0);
    } else if (payoutData?.proposalExecutedAt && executionStartTime) {
      // Reset when execution completes
      setExecutionStartTime(null);
      setExecutionElapsedSeconds(0);
    }
  }, [payoutData?.proposalStatus, payoutData?.needsSignatures, payoutData?.proposalExecutedAt, executionStartTime]);

  // Update elapsed time every second during execution to force re-renders
  useEffect(() => {
    if (!executionStartTime || payoutData?.proposalExecutedAt) {
      return;
    }

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - executionStartTime) / 1000);
      setExecutionElapsedSeconds(elapsed);
    }, 1000);

    return () => clearInterval(interval);
  }, [executionStartTime, payoutData?.proposalExecutedAt]);

  // Track verification start time
  useEffect(() => {
    if (
      payoutData?.proposalStatus === 'EXECUTED' &&
      (payoutData?.proposalTransactionId || payoutData?.payoutSignature) &&
      onChainVerified === null &&
      !verificationStartTime
    ) {
      setVerificationStartTime(Date.now());
    } else if (onChainVerified !== null && verificationStartTime) {
      // Reset when verification completes
      setVerificationStartTime(null);
    }
  }, [payoutData?.proposalStatus, payoutData?.proposalTransactionId, payoutData?.payoutSignature, onChainVerified, verificationStartTime]);

  // Verify proposal execution on-chain when status is EXECUTED
  useEffect(() => {
    const verifyOnChain = async () => {
      if (
        payoutData?.proposalStatus === 'EXECUTED' &&
        (payoutData?.proposalTransactionId || payoutData?.payoutSignature) &&
        onChainVerified === null
      ) {
        const transactionSignature = payoutData.proposalTransactionId || payoutData.payoutSignature;
        if (!transactionSignature) return;
        
        try {
          const apiUrl = process.env.NEXT_PUBLIC_API_URL;
          const matchId = router.query.matchId as string;
          const response = await fetch(`${apiUrl}/api/match/verify-proposal-execution/${matchId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ transactionSignature }),
          });
          
          if (response.ok) {
            const result = await response.json();
            setOnChainVerified(result.verified);
            setExplorerLink(result.explorerLink || null);
            if (!result.verified) {
              setVerificationError(result.error || 'Transaction verification failed');
            }
          } else {
            setOnChainVerified(false);
            setVerificationError('Failed to verify transaction');
          }
        } catch (error: any) {
          console.error('❌ Error verifying on-chain:', error);
          setOnChainVerified(false);
          setVerificationError(error?.message || 'Verification error');
        }
      }
    };
    
    verifyOnChain();
  }, [payoutData?.proposalStatus, payoutData?.proposalTransactionId, payoutData?.payoutSignature, onChainVerified, router.query.matchId]);

  // Fetch actual bonus amount from blockchain when proposal is executed
  useEffect(() => {
    const fetchBonusAmount = async () => {
      if (
        payoutData?.proposalStatus === 'EXECUTED' &&
        payoutData?.bonus?.signature &&
        payoutData?.bonus?.eligible &&
        publicKey &&
        !actualBonusAmount
      ) {
        try {
          const connection = new Connection(
            process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com'
          );
          const transaction = await connection.getTransaction(payoutData.bonus.signature, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0,
          });

          if (transaction && transaction.meta && !transaction.meta.err) {
            // Handle both legacy and versioned transactions
            const message = transaction.transaction.message;
            let accountKeys: any[];
            if ('accountKeys' in message) {
              // Legacy transaction
              accountKeys = message.accountKeys;
            } else if ('getAccountKeys' in message && typeof message.getAccountKeys === 'function') {
              // Versioned transaction (MessageV0)
              accountKeys = message.getAccountKeys().staticAccountKeys;
            } else {
              // Fallback: use staticAccountKeys if available
              accountKeys = (message as any).staticAccountKeys || [];
            }
            const playerPubkey = publicKey.toString();
            const playerIndex = accountKeys.findIndex(
              (key: any) => key.toString() === playerPubkey
            );

            if (playerIndex !== -1) {
              const preBalance = transaction.meta.preBalances[playerIndex] || 0;
              const postBalance = transaction.meta.postBalances[playerIndex] || 0;
              const bonusLamports = postBalance - preBalance;
              if (bonusLamports > 0) {
                const bonusSol = bonusLamports / LAMPORTS_PER_SOL;
                setActualBonusAmount(bonusSol);
              }
            }
          }
        } catch (error) {
          console.error('❌ Failed to fetch bonus transaction:', error);
        }
      }
    };

    fetchBonusAmount();
  }, [payoutData?.proposalStatus, payoutData?.bonus?.signature, payoutData?.bonus?.eligible, publicKey, actualBonusAmount]);

  // Debug logging for payout data
  useEffect(() => {
    // #region agent log
    // Telemetry calls removed - they were causing ERR_CONNECTION_REFUSED errors
    // Verbose console.log removed to reduce noise
  }, [payoutData]);

  // TODO: Implement SSE proposal signing events when backend endpoint is ready
  // Currently disabled to prevent 404 errors - using polling instead
  // useEffect(() => {
  //   const matchId = router.query.matchId as string;
  //   if (!matchId || !publicKey) return;

  //   const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  //   const eventSource = new EventSource(
  //     `${apiUrl}/api/wallet/${publicKey.toString()}/balance/stream`
  //   );

  //   eventSource.addEventListener('proposal_signed', (event: any) => {
  //     try {
  //       const data = JSON.parse(event.data);
  //       if (data.matchId === matchId) {
  //         console.log('📢 Received proposal signed notification:', data);
          
  //         // Check if opponent signed (not current user)
  //         const eventSigners = normalizeProposalSigners(data.proposalSigners);
  //         const feeWallet = config.FEE_WALLET_ADDRESS?.toLowerCase?.();
  //         const eventPlayerSigners = eventSigners.filter(
  //           (signer) => signer && signer.toLowerCase() !== feeWallet
  //         );
  //         const currentUserSigned = eventPlayerSigners.includes(publicKey?.toString() || '');
          
  //         if (!currentUserSigned && eventPlayerSigners.length > 0) {
  //           // Opponent signed - show notification
  //           setNotification('🎉 Other player has signed! Proposal is ready to execute.');
  //         } else if (currentUserSigned) {
  //           // Current user signed - show waiting message
  //           setNotification('✅ You have signed! Waiting for other player...');
  //         }
          
  //         // Immediately refresh payout data to get latest status
  //         stopRefreshLoops();
  //         loadPayoutData();
          
  //         // Hide sign button since only 1 signature needed
  //         setSigningProposal(false);
          
  //         // Poll a little faster for a short period to detect execution
  //         refreshIntervalRef.current = setInterval(() => {
  //           loadPayoutData();
  //         }, 4000);
          
  //         refreshTimeoutRef.current = setTimeout(() => {
  //           stopRefreshLoops();
  //           loadPayoutData();
  //         }, 20000);
  //       }
  //     } catch (error) {
  //       console.error('❌ Error parsing proposal_signed event:', error);
  //     }
  //   });

  //   return () => {
  //     stopRefreshLoops();
  //     eventSource.close();
  //   };
  // }, [router.query.matchId, publicKey]);

  const handlePlayAgain = () => {
    // Clear stored data
    localStorage.removeItem('matchId');
    localStorage.removeItem('word');
    localStorage.removeItem('payoutData');
    
    router.push('/lobby');
  };

  const handleSignProposal = async () => {
    // CRITICAL: Log function entry to verify button click is working
    console.log('🖱️ handleSignProposal called', {
      timestamp: new Date().toISOString(),
      hasProposalId: !!payoutData?.proposalId,
      hasVaultAddress: !!payoutData?.vaultAddress,
      hasPublicKey: !!publicKey,
      hasSignTransaction: !!signTransaction,
      proposalId: payoutData?.proposalId,
      vaultAddress: payoutData?.vaultAddress,
      wallet: publicKey?.toString(),
      needsSignatures: payoutData?.needsSignatures,
      proposalStatus: payoutData?.proposalStatus,
    });
    
    // CRITICAL FIX: Check if proposal is already approved/executed before attempting to sign
    if (payoutData?.needsSignatures === 0 || 
        payoutData?.proposalStatus === 'APPROVED' || 
        payoutData?.proposalStatus === 'EXECUTING' || 
        payoutData?.proposalStatus === 'EXECUTED' ||
        payoutData?.proposalExecutedAt) {
      console.warn('⚠️ Proposal already approved/executed - signing not needed', {
        matchId: router.query.matchId,
        needsSignatures: payoutData?.needsSignatures,
        proposalStatus: payoutData?.proposalStatus,
        proposalExecutedAt: payoutData?.proposalExecutedAt,
        note: 'Frontend should not show sign button in this state - this is a safety check',
      });
      setError('This proposal has already been approved and does not need additional signatures.');
      return;
    }
    
    if (!payoutData?.proposalId || !payoutData?.vaultAddress || !publicKey || !signTransaction) {
      const missingFields = [];
      if (!payoutData?.proposalId) missingFields.push('proposalId');
      if (!payoutData?.vaultAddress) missingFields.push('vaultAddress');
      if (!publicKey) missingFields.push('publicKey');
      if (!signTransaction) missingFields.push('signTransaction');
      
      const errorMsg = `Missing required data for proposal signing: ${missingFields.join(', ')}`;
      console.error('❌', errorMsg, {
        payoutData: payoutData ? Object.keys(payoutData) : null,
        hasPublicKey: !!publicKey,
        hasSignTransaction: !!signTransaction,
      });
      setError(errorMsg);
      return;
    }

    setSigningProposal(true);
    setError(null);
    
    // CRITICAL: Declare matchId and apiUrl outside try block so they're accessible in catch block
      const matchId = router.query.matchId as string;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
    
    try {
      // Get the approval transaction from backend (backend has access to rpc.vaultTransactionApprove)
      
      // CRITICAL: Log API URL configuration
      console.log('🔧 API Configuration', {
        apiUrl,
        envVar: process.env.NEXT_PUBLIC_API_URL,
        isConfigured: !!apiUrl && apiUrl.trim() !== '',
        matchId,
        timestamp: new Date().toISOString(),
      });
      
      // ✅ ENHANCEMENT 1: Force fresh sync before signing to prevent stale state
      // This ensures we're working with the latest on-chain proposal status
      console.log('🔄 Force syncing proposal status before signing...', {
        matchId,
        currentProposalId: payoutData?.proposalId,
        currentStatus: payoutData?.proposalStatus,
        currentNeedsSignatures: payoutData?.needsSignatures,
        timestamp: new Date().toISOString(),
      });
      
      const statusResponse = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey?.toString()}`, {
        credentials: 'include',
      });
      
      if (!statusResponse.ok) {
        throw new Error(`Failed to fetch match status: ${statusResponse.status}`);
      }
      
      const latestMatchData = await statusResponse.json();
      const latestProposalId = latestMatchData.payoutProposalId || latestMatchData.tieRefundProposalId;
      
      if (!latestProposalId) {
        throw new Error('No proposal ID found in latest match status');
      }
      
      // ✅ ENHANCEMENT 2: Check if proposal is already finalized after fresh sync
      // This is a second layer of defense after the initial check
      const isFinalizedAfterSync = 
        latestMatchData.needsSignatures === 0 ||
        latestMatchData.proposalStatus === 'APPROVED' ||
        latestMatchData.proposalStatus === 'EXECUTING' ||
        latestMatchData.proposalStatus === 'EXECUTED' ||
        !!latestMatchData.proposalExecutedAt;
      
      if (isFinalizedAfterSync) {
        console.warn('⚠️ Proposal already finalized after fresh sync - aborting signing', {
          matchId,
          proposalId: latestProposalId,
          needsSignatures: latestMatchData.needsSignatures,
          proposalStatus: latestMatchData.proposalStatus,
          proposalExecutedAt: latestMatchData.proposalExecutedAt,
          note: 'Fresh sync revealed proposal is already approved/executed',
        });
        
        // Update payoutData with latest state
        setPayoutData((prev: any) => ({
          ...prev,
          proposalId: latestProposalId,
          proposalStatus: latestMatchData.proposalStatus,
          proposalSigners: latestMatchData.proposalSigners || prev.proposalSigners,
          needsSignatures: latestMatchData.needsSignatures ?? prev.needsSignatures,
          proposalExecutedAt: latestMatchData.proposalExecutedAt || prev.proposalExecutedAt,
        }));
        
        setError('This proposal has already been approved and does not need additional signatures.');
        setSigningProposal(false);
        return;
      }
      
      // CRITICAL: If proposal ID changed, update payoutData and warn user
      if (latestProposalId !== payoutData?.proposalId) {
        console.warn('⚠️ Proposal ID changed! Updating to latest proposal', {
          matchId,
          oldProposalId: payoutData?.proposalId,
          newProposalId: latestProposalId,
          note: 'This can happen if a new proposal was created after the page loaded',
        });
        
        // Update payoutData with latest proposal ID
        setPayoutData((prev: any) => ({
          ...prev,
          proposalId: latestProposalId,
          proposalStatus: latestMatchData.proposalStatus || prev.proposalStatus,
          proposalSigners: latestMatchData.proposalSigners || prev.proposalSigners,
          needsSignatures: latestMatchData.needsSignatures ?? prev.needsSignatures,
        }));
      } else {
        // Even if proposal ID didn't change, update status in case it changed
        setPayoutData((prev: any) => ({
          ...prev,
          proposalStatus: latestMatchData.proposalStatus || prev.proposalStatus,
          proposalSigners: latestMatchData.proposalSigners || prev.proposalSigners,
          needsSignatures: latestMatchData.needsSignatures ?? prev.needsSignatures,
          proposalExecutedAt: latestMatchData.proposalExecutedAt || prev.proposalExecutedAt,
        }));
      }
      
      console.log('🖊️ Preparing to sign proposal', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: latestProposalId,
        vaultAddress: payoutData.vaultAddress,
        vaultDepositAddress: payoutData.vaultDepositAddress,
      });
      
      // Step 1: Get the transaction from backend (using latest proposal ID)
      // CRITICAL: Add retry logic for "proposal not ready" errors (VaultTransaction missing)
      // Backend atomic proposal creation can take up to 30 seconds (12 attempts × 2.5s)
      // Frontend should retry for at least that long to match backend wait time
      const maxGetTxRetries = 15; // Increased from 3 to 15 to match backend's 30s wait
      let getTxResponse: Response | null = null;
      let getTxError: Error | null = null;
      let isRetryableAfterExhaustion = false; // Track if final error was retryable
      
      for (let retry = 0; retry < maxGetTxRetries; retry++) {
        try {
          if (retry > 0) {
            // Exponential backoff: 2s, 2.5s, 2.5s, 2.5s... (matches backend retry delay)
            const delay = retry === 1 ? 2000 : 2500;
            console.log(`🔄 Retrying get-proposal-approval-transaction (attempt ${retry + 1}/${maxGetTxRetries}) after ${delay}ms...`, {
              matchId,
              wallet: publicKey.toString(),
              note: 'Backend atomic proposal creation can take up to 30s - continuing to retry',
            });
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          getTxResponse = await fetch(`${apiUrl}/api/match/get-proposal-approval-transaction?matchId=${matchId}&wallet=${publicKey.toString()}`);
          
          if (getTxResponse.ok) {
            break; // Success - exit retry loop
          }
          
          const errorData = await getTxResponse.json();
          
          // CRITICAL: Check if this is a FATAL error (proposal creation failure)
          const isFatal = errorData.fatal === true || errorData.retryable === false;
          
          if (isFatal) {
            // FATAL ERROR: Do not retry, show match failed message
            console.error('❌ FATAL: Match failed to initialize - proposal creation failure', {
              matchId,
              wallet: publicKey.toString(),
              error: errorData.error || errorData.message,
              fatal: errorData.fatal,
              details: errorData.details,
            });
            
            const fatalMessage = errorData.message || 
                                'This match could not be initialized properly. Please contact support or try creating a new match.';
            throw new Error(fatalMessage);
          }
          
          // Check if this is a retryable error (proposal not ready)
          const isRetryable = errorData.retryable === true || 
                              errorData.error?.includes('not ready') ||
                              errorData.error?.includes('VaultTransaction') ||
                              errorData.message?.includes('still being created');
          
          if (isRetryable && retry < maxGetTxRetries - 1) {
            console.warn(`⚠️ Proposal not ready yet (attempt ${retry + 1}/${maxGetTxRetries}), will retry...`, {
              matchId,
              error: errorData.error || errorData.message,
              retryable: errorData.retryable,
            });
            getTxError = new Error(errorData.message || errorData.error || 'Proposal not ready yet');
            continue; // Retry
          } else if (isRetryable && retry === maxGetTxRetries - 1) {
            // CRITICAL: Final retry failed but error is still retryable - don't throw, continue polling
            console.warn(`⚠️ Proposal still being created after ${maxGetTxRetries} attempts - will continue polling`, {
              matchId,
              error: errorData.error || errorData.message,
              note: 'Backend is still creating the proposal. Frontend will continue polling until it appears.',
            });
            
            isRetryableAfterExhaustion = true;
            // Don't throw - just show a message and let polling continue
            setError(`Proposal is still being created on-chain. Please wait a few seconds and try again. (This can take up to 30 seconds)`);
            setSigningProposal(false);
            return; // Exit gracefully, polling will continue
          } else {
            // Non-retryable error - throw it
            throw new Error(errorData.message || errorData.error || 'Failed to get approval transaction');
          }
        } catch (fetchError: any) {
          if (retry === maxGetTxRetries - 1) {
            // Final retry failed - check if it was a retryable error
            if (isRetryableAfterExhaustion) {
              // Already handled above, just return
              return;
            }
            // Final retry failed with non-retryable error
            throw fetchError instanceof Error ? fetchError : new Error(String(fetchError));
          }
          getTxError = fetchError instanceof Error ? fetchError : new Error(String(fetchError));
          // Continue to next retry
        }
      }
      
      // CRITICAL: Only check getTxResponse if we didn't exit early due to retryable error
      if (isRetryableAfterExhaustion) {
        return; // Already handled, exit gracefully
      }
      
      if (!getTxResponse || !getTxResponse.ok) {
        throw getTxError || new Error('Failed to get approval transaction after retries');
      }
      
      const txData = await getTxResponse.json();
      
      // CRITICAL: Sign BOTH proposal AND vault transaction (expert recommendation)
      // Squads v4 requires both to be signed for ExecuteReady
      const { VersionedTransaction } = await import('@solana/web3.js');
      
      // Step 2a: Sign proposal approval transaction
      const bytes = base64ToUint8Array(txData.transaction);
      const approveTx = VersionedTransaction.deserialize(bytes);
      const signedProposalTx = await signTransaction(approveTx);
      
      // ✅ CRITICAL FIX: Verify transaction is actually signed before serializing
      // This prevents sending unsigned transactions to the backend
      const signatures = signedProposalTx.signatures;
      const hasValidSignature = signatures.some(sig => 
        sig && sig.length > 0 && !sig.every(b => b === 0)
      );
      
      if (!hasValidSignature) {
        const errorMsg = 'Transaction was not signed. Please try again and approve the signing request in your wallet.';
        console.error('❌ Transaction signature validation failed', {
          matchId,
          wallet: publicKey.toString(),
          signatureCount: signatures.length,
          signatures: signatures.map(sig => sig ? Buffer.from(sig).toString('hex').substring(0, 16) + '...' : 'null'),
        });
        throw new Error(errorMsg);
      }
      
      console.log('✅ Transaction signature verified before serialization', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData?.proposalId,
        validSignatures: signatures.filter(sig => sig && !sig.every(b => b === 0)).length,
      });
      
      const proposalSerialized = signedProposalTx.serialize(); // Uint8Array
      
      console.log('✅ Proposal transaction signed and verified', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData?.proposalId,
        transactionSize: proposalSerialized.length,
      });
      
      // NOTE: Vault transactions do NOT require approval in Squads v4
      // Only Proposals require signatures. VaultTransaction automatically becomes ExecuteReady
      // when the linked Proposal reaches ExecuteReady.
      
      // Step 3: Send signed proposal transaction to backend with retry logic
      // CRITICAL: Send raw transaction bytes (application/octet-stream) instead of base64 JSON
      // This ensures the backend receives the exact bytes from Phantom and can broadcast directly
      // Format: POST /api/match/sign-proposal?matchId=xxx&wallet=xxx
      // Body: raw signed transaction bytes (Uint8Array)
      // CRITICAL: Verify API URL is set
      if (!apiUrl || apiUrl.trim() === '') {
        const errorMsg = 'API URL is not configured. Please check NEXT_PUBLIC_API_URL environment variable.';
        console.error('❌', errorMsg, { apiUrl, envVar: process.env.NEXT_PUBLIC_API_URL });
        throw new Error(errorMsg);
      }
      
      const requestUrl = `${apiUrl}/api/match/sign-proposal?matchId=${encodeURIComponent(matchId)}&wallet=${encodeURIComponent(publicKey.toString())}`;
      
      // ✅ EXPERT RECOMMENDATION: Log what's actually being sent before sending
      console.log('Sending sign-proposal POST', {
        matchId,
        proposalId: payoutData?.proposalId,
        wallet: publicKey.toString(),
        apiUrl,
        bodyLength: proposalSerialized.length,
        requestUrl,
        timestamp: new Date().toISOString(),
      });
      
      // Telemetry calls removed - they were causing ERR_CONNECTION_REFUSED errors
      console.log('📤 Submitting signed proposal transaction to backend (raw bytes format)', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData?.proposalId,
        transactionSize: proposalSerialized.length,
        format: 'raw-bytes',
        apiUrl,
        requestUrl,
        bodyType: proposalSerialized instanceof Uint8Array ? 'Uint8Array' : typeof proposalSerialized,
        bodyLength: proposalSerialized.length,
        timestamp: new Date().toISOString(),
      });
      
      // CRITICAL: Retry logic with exponential backoff for network/CORS errors
      const maxRetries = 3;
      let lastError: Error | null = null;
      let response: Response | null = null;
      let result: any = null;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          if (attempt > 0) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
            console.log(`🔄 Retrying sign-proposal request (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms...`, {
              matchId,
              wallet: publicKey.toString(),
              requestUrl,
            });
            await new Promise(resolve => setTimeout(resolve, delay));
          }
          
          console.log('🌐 Sending POST request to backend', {
            attempt: attempt + 1,
            maxRetries,
            matchId,
            wallet: publicKey.toString(),
            requestUrl,
            contentType: 'application/octet-stream',
            bodyLength: proposalSerialized.length,
            timestamp: new Date().toISOString(),
          });
          
          // CRITICAL: Send raw bytes with application/octet-stream content type
          // Backend will broadcast, confirm, then update DB
          // Convert Uint8Array to ArrayBuffer for better browser compatibility
          const bodyBuffer = proposalSerialized.buffer.slice(
            proposalSerialized.byteOffset,
            proposalSerialized.byteOffset + proposalSerialized.byteLength
          );
          
          // ✅ FIX: Ensure bodyBuffer is ArrayBuffer, not SharedArrayBuffer (for TypeScript compatibility)
          // Check if SharedArrayBuffer exists and if bodyBuffer is an instance of it
          // If SharedArrayBuffer is not available (common in browsers without COOP/COEP headers), treat as ArrayBuffer
          const bodyArrayBuffer: ArrayBuffer = (typeof SharedArrayBuffer !== 'undefined' && bodyBuffer instanceof SharedArrayBuffer)
            ? (() => {
                const newBuffer = new ArrayBuffer(bodyBuffer.byteLength);
                const view = new Uint8Array(newBuffer);
                const sourceView = new Uint8Array(bodyBuffer);
                view.set(sourceView);
                return newBuffer;
              })()
            : bodyBuffer as ArrayBuffer;
          
          const fetchStartTime = Date.now();
          
          // Add timeout to prevent hanging requests (30 seconds)
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 30000);
          
          try {
            // ✅ ENHANCED: Log frontend-side proposal ID for debugging
            console.log('🌐 Sending POST /api/match/sign-proposal', {
              length: proposalSerialized.byteLength,
              matchId,
              wallet: publicKey.toString(),
              frontendProposalId: payoutData?.proposalId,
              url: requestUrl,
              timestamp: new Date().toISOString(),
              note: 'If proposalId mismatch, user may be signing wrong proposal',
            });
            
            response = await fetch(requestUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/octet-stream',
              },
              mode: 'cors', // Explicitly enable CORS
              credentials: 'include',
              body: bodyArrayBuffer, // ArrayBuffer for better browser compatibility
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            
            // Telemetry calls removed - they were causing ERR_CONNECTION_REFUSED errors
            console.log('🌐 sign-proposal response', {
              status: response.status,
              ok: response.ok,
              url: response.url,
              timeMs: Date.now() - fetchStartTime,
              headers: Object.fromEntries(response.headers.entries()),
            });
          } catch (fetchErr: any) {
            clearTimeout(timeoutId);
            if (fetchErr.name === 'AbortError') {
              console.error('❌ sign-proposal timeout after 30s', { matchId });
              throw new Error('Request timeout: The backend did not respond within 30 seconds. Please check your connection and try again.');
            }
            console.error('❌ Network error calling sign-proposal', { 
              matchId, 
              error: fetchErr.message,
              errorName: fetchErr.name,
              errorType: fetchErr.constructor?.name,
              url: requestUrl,
            });
            throw fetchErr;
          }
          
          const fetchDuration = Date.now() - fetchStartTime;
          console.log('📡 POST request completed', {
            attempt: attempt + 1,
            matchId,
            wallet: publicKey.toString(),
            status: response.status,
            statusText: response.statusText,
            ok: response.ok,
            duration: `${fetchDuration}ms`,
            headers: Object.fromEntries(response.headers.entries()),
            timestamp: new Date().toISOString(),
          });
          
          // CRITICAL: Check if response is ok before parsing
          if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
              errorData = JSON.parse(errorText);
            } catch {
              errorData = { error: errorText || 'Unknown error' };
            }
            
            const errorMessage = errorData.error || `Failed to sign proposal: ${response.status} ${response.statusText}`;
            
            // Don't retry on 4xx errors (client errors) - these won't succeed on retry
            if (response.status >= 400 && response.status < 500) {
              console.error('❌ Backend sign-proposal failed (client error, not retrying)', {
                matchId,
                wallet: publicKey.toString(),
                status: response.status,
                statusText: response.statusText,
                error: errorMessage,
                attempt: attempt + 1,
                responseHeaders: Object.fromEntries(response.headers.entries()),
              });
              throw new Error(errorMessage);
            }
            
            // Retry on 5xx errors (server errors)
            if (response.status >= 500 && attempt < maxRetries - 1) {
              console.warn(`⚠️ Backend sign-proposal failed (server error, will retry)`, {
                matchId,
                wallet: publicKey.toString(),
                status: response.status,
                statusText: response.statusText,
                error: errorMessage,
                attempt: attempt + 1,
                maxRetries,
              });
              lastError = new Error(errorMessage);
              continue; // Retry
            }
            
            // Non-retryable error
            console.error('❌ Backend sign-proposal failed', {
              matchId,
              wallet: publicKey.toString(),
              status: response.status,
              statusText: response.statusText,
              error: errorMessage,
              attempt: attempt + 1,
              responseHeaders: Object.fromEntries(response.headers.entries()),
            });
            throw new Error(errorMessage);
          }
          
          // Success - parse response
          result = await response.json();
          break; // Exit retry loop on success
          
        } catch (fetchError: any) {
          lastError = fetchError instanceof Error ? fetchError : new Error(String(fetchError));
          
          // ✅ EXPERT RECOMMENDATION: Enhanced catch() with error tracking
          // Log ALL error details to diagnose HTTP communication failure
          console.error(`❌ Fetch error on sign-proposal (attempt ${attempt + 1}/${maxRetries})`, {
            matchId,
            wallet: publicKey.toString(),
            requestUrl,
            error: fetchError.message || 'Unknown error',
            errorType: fetchError.constructor?.name,
            errorName: fetchError.name,
            errorStack: fetchError.stack,
            isTypeError: fetchError instanceof TypeError,
            isNetworkError: fetchError instanceof TypeError || fetchError.message?.includes('Failed to fetch'),
            isCORSError: fetchError.message?.includes('CORS') || fetchError.message?.includes('Access-Control'),
            attempt: attempt + 1,
            maxRetries,
            timestamp: new Date().toISOString(),
          });
          
          // Check if it's a network/CORS error
          const isNetworkError = 
            fetchError instanceof TypeError || 
            fetchError.message?.includes('Failed to fetch') ||
            fetchError.message?.includes('NetworkError') ||
            fetchError.message?.includes('CORS') ||
            fetchError.message?.includes('Access-Control') ||
            !fetchError.message; // No message often indicates network error
          
          if (isNetworkError) {
            console.error(`❌ Network/CORS error confirmed (attempt ${attempt + 1}/${maxRetries})`, {
              matchId,
              wallet: publicKey.toString(),
              requestUrl,
              error: fetchError.message || 'Network request failed',
              errorType: fetchError.constructor?.name,
              note: 'This indicates the request never reached the backend. Check CORS configuration and network connectivity.',
              attempt: attempt + 1,
              maxRetries,
            });
            
            // Retry network errors
            if (attempt < maxRetries - 1) {
              continue; // Retry
            } else {
              // Final attempt failed
              const errorMsg = `Network error: Failed to send signed transaction to backend. The request never reached the server. Please check your connection, CORS configuration, and API URL (${apiUrl}).`;
              console.error('❌ Final network error - all retries exhausted', {
                matchId,
                wallet: publicKey.toString(),
                requestUrl,
                error: errorMsg,
                totalAttempts: maxRetries,
              });
              throw new Error(errorMsg);
            }
          } else {
            // Non-network error - don't retry
            console.error('❌ Non-network error on sign-proposal (not retrying)', {
              matchId,
              wallet: publicKey.toString(),
              requestUrl,
              error: fetchError.message,
              errorType: fetchError.constructor?.name,
              attempt: attempt + 1,
            });
            throw fetchError;
          }
        }
      }
      
      // CRITICAL: Verify we got a successful response
      if (!response || !result) {
        throw lastError || new Error('Failed to get response from backend after retries');
      }
      
      // CRITICAL: Only log success after backend confirms (expert recommendation)
      console.log('✅ Proposal signed & backend confirmed', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: result?.proposalId || payoutData.proposalId,
        response: result,
        backendStatus: response.status,
        verifying: result?.verifying,
      });
      
      // CRITICAL: Handle response structure - backend may send immediate response with verifying flag
      // Backend now sends status: 'VERIFYING_ON_CHAIN' when signature is being verified
      // Use response data if available, otherwise use current payoutData
      const responseProposalId = result?.proposalId || payoutData.proposalId;
      const responseProposalStatus = result?.proposalStatus || payoutData.proposalStatus || 'ACTIVE';
      const responseProposalSigners = result?.proposalSigners || payoutData.proposalSigners || [];
      const responseNeedsSignatures = result?.needsSignatures ?? payoutData.needsSignatures ?? 0;
      const isVerifying = result?.verifying === true || result?.status === 'VERIFYING_ON_CHAIN';
      const verificationStatus = result?.status || (isVerifying ? 'VERIFYING_ON_CHAIN' : null);
      
      // CRITICAL: Only update UI optimistically AFTER backend confirms success
      // This prevents UI from showing success when the request actually failed
      const userWallet = publicKey.toString();
      const currentSigners = Array.isArray(responseProposalSigners) 
        ? responseProposalSigners 
        : (Array.isArray(payoutData.proposalSigners) ? payoutData.proposalSigners : []);
      
      // Update local state to reflect user has signed (only after backend confirms)
      // CRITICAL: If status is VERIFYING_ON_CHAIN, do NOT add signer to list yet
      // Database will only be updated after verification succeeds
      const shouldAddSigner = verificationStatus !== 'VERIFYING_ON_CHAIN';
      const updatedPayoutData = {
        ...payoutData,
        proposalId: responseProposalId,
        proposalStatus: verificationStatus === 'VERIFYING_ON_CHAIN' ? 'ACTIVE' : responseProposalStatus,
        proposalSigners: shouldAddSigner && currentSigners.some((s: string) => s?.toLowerCase() === userWallet.toLowerCase())
          ? currentSigners
          : shouldAddSigner
          ? [...currentSigners, userWallet]
          : currentSigners, // Don't add signer if still verifying
        needsSignatures: responseNeedsSignatures,
        verifying: isVerifying, // Track if backend is still verifying
        verificationStatus, // Track verification status
      };
      
      // Log verification status for debugging
      if (verificationStatus === 'VERIFYING_ON_CHAIN') {
        console.log('⏳ Backend is verifying signature on-chain - will poll for updates', {
          matchId,
          wallet: publicKey.toString(),
          proposalId: responseProposalId,
          note: 'Database will be updated after verification succeeds',
        });
      }
      
      // CRITICAL FIX: Only set EXECUTING if backend explicitly says so
      // Don't infer from needsSignatures === 0 - backend must return READY_TO_EXECUTE or EXECUTING
      // needsSignatures === 0 with APPROVED status means waiting for ExecuteReady transition
      if (updatedPayoutData.needsSignatures === 0 && 
          updatedPayoutData.proposalStatus === 'APPROVED' && 
          updatedPayoutData.proposalStatus !== 'EXECUTED') {
        // Keep as APPROVED - don't infer EXECUTING
        // Backend will update to READY_TO_EXECUTE or EXECUTING when ready
        updatedPayoutData.proposalStatus = 'APPROVED';
      }
      
      // CRITICAL FIX: Ensure proposalStatus is set to prevent showing "Creating Proposal" after signing
      if (!updatedPayoutData.proposalStatus && updatedPayoutData.proposalId) {
        updatedPayoutData.proposalStatus = 'ACTIVE'; // Default to ACTIVE if status is missing
      }
      
      // Update state immediately after backend confirms
      setPayoutData(updatedPayoutData);
      
      // Refresh payout data from backend to get latest state
      // This is non-critical - if it fails, we've already updated state optimistically
      if (matchId && publicKey) {
        try {
          const statusResponse = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey.toString()}`);
          if (statusResponse.ok) {
            const matchData = await statusResponse.json();
            // Check if both players have results (more reliable indicator of completion)
            const bothPlayersHaveResults = matchData.player1Result && matchData.player2Result;
            const isCompleted = matchData.isCompleted || bothPlayersHaveResults;
            
            if (isCompleted) {
              const isPlayer1 = publicKey.toString() === matchData.player1;
              const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
              const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
              
              const refreshedPayoutData = {
                ...updatedPayoutData,
                won: matchData.winner === publicKey.toString() && matchData.winner !== 'tie',
                isTie: matchData.winner === 'tie',
                winner: matchData.winner,
                numGuesses: playerResult?.numGuesses || 0,
                entryFee: matchData.entryFee || updatedPayoutData.entryFee || 0,
                timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : 'N/A',
                opponentTimeElapsed: opponentResult ? `${Math.floor(opponentResult.totalTime / 1000)}s` : 'N/A',
                opponentGuesses: opponentResult?.numGuesses || 0,
                winnerAmount: matchData.payout?.winnerAmount || 0,
                feeAmount: matchData.payout?.feeAmount || 0,
                refundAmount: matchData.payout?.refundAmount || 0,
                isWinningTie: matchData.payout?.isWinningTie || false,
                feeWallet: matchData.payout?.feeWallet || '',
                transactions: matchData.payout?.transactions || [],
                proposalId: matchData.payoutProposalId || matchData.tieRefundProposalId || updatedPayoutData.proposalId,
                proposalStatus: matchData.proposalStatus || updatedPayoutData.proposalStatus,
                proposalSigners: normalizeProposalSigners(matchData.proposalSigners) || updatedPayoutData.proposalSigners,
                needsSignatures: matchData.needsSignatures ?? updatedPayoutData.needsSignatures,
                proposalExecutedAt: matchData.proposalExecutedAt,
                proposalTransactionId: matchData.proposalTransactionId,
                automatedPayout: matchData.payout?.paymentSuccess || false,
                payoutSignature: matchData.payout?.transactions?.[0]?.signature || matchData.proposalTransactionId || null,
                refundReason: matchData.refundReason || null,
                matchOutcome: matchData.matchOutcome || matchData.status || null,
                rawStatus: matchData.status || null
              };
              
              setPayoutData(refreshedPayoutData);
            }
          }
        } catch (statusError) {
          // Status refresh failure is non-critical - signing was successful and state already updated
          console.warn('⚠️ Error refreshing status after signing (non-critical):', statusError);
        }
      }
      
      // CRITICAL: Start aggressive polling after signing (expert recommendation)
      console.log('🚀 Starting aggressive polling (1s interval) for 10 seconds after signing...');
      let aggressivePollCount = 0;
      const aggressiveInterval = setInterval(() => {
        aggressivePollCount++;
        if (aggressivePollCount >= 10) {
          clearInterval(aggressiveInterval);
          console.log('✅ Aggressive polling complete, returning to normal polling');
        } else {
          loadPayoutData();
        }
      }, 1000); // 1 second intervals for first 10 seconds
      
      // Fallback: stop aggressive polling after 10 seconds
      setTimeout(() => {
        clearInterval(aggressiveInterval);
      }, 10000);
      
      // CRITICAL FIX: Don't reset signingProposal after successful sign
      // The button will be hidden because userHasSigned will be true
      // Only reset if there's an error
      console.log('✅ Signing completed successfully - button will be hidden on next render');
    } catch (err) {
      // ✅ EXPERT RECOMMENDATION: Enhanced catch() with comprehensive error tracking
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign proposal';
      const errorName = err instanceof Error ? err.name : 'Unknown';
      const errorStack = err instanceof Error ? err.stack : undefined;
      
      console.error('❌ Error signing proposal:', {
        error: err,
        errorMessage,
        errorName,
        errorType: err?.constructor?.name,
        errorStack,
        matchId,
        wallet: publicKey?.toString(),
        proposalId: payoutData?.proposalId,
        apiUrl,
        timestamp: new Date().toISOString(),
      });
      
      // CRITICAL: Check if it's a FATAL error (match failed to initialize)
      const isFatalError = 
        errorMessage.includes('Match failed to initialize') ||
        errorMessage.includes('could not be initialized') ||
        errorMessage.includes('proposal creation failure') ||
        errorMessage.includes('contact support');
      
      // CRITICAL: Check if it's a network/CORS error that we retried
      const isNetworkError = 
        errorMessage.includes('Network error') ||
        errorMessage.includes('Failed to fetch') ||
        errorMessage.includes('CORS') ||
        errorMessage.includes('Network request failed') ||
        errorMessage.includes('request never reached the server');
      
      if (isFatalError) {
        // FATAL ERROR: Match initialization failure - show clear message
        setError('Match failed to initialize: This match could not be set up properly. Please try creating a new match or contact support if this issue persists.');
      } else if (isNetworkError) {
        // Network errors after retries - show user-friendly error
        setError('Network error: Could not send signed transaction to backend. Please check your connection and try again. If the problem persists, the transaction may have been signed in your wallet but not confirmed by the server.');
      } else {
        // Other errors (validation, server errors, etc.)
        setError(errorMessage);
      }
      
      // CRITICAL FIX: Only reset signingProposal on error
      // After successful sign, the button should remain disabled/hidden
      setSigningProposal(false);
    }
  };

  // CRITICAL FIX: Show loading state while waiting for wallet connection
  if (!publicKey) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="text-yellow-400 text-xl mb-4">🔌 Connecting Wallet</div>
            <p className="text-white/80 mb-6">Waiting for wallet connection to load results...</p>
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-white text-xl">Loading results...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="text-red-400 text-xl mb-4">❌ Error</div>
            <p className="text-white/80 mb-6">{error}</p>
            <button
              onClick={handlePlayAgain}
              className="bg-accent hover:bg-accent/80 text-white px-6 py-2 rounded-lg transition-colors"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!payoutData) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="text-yellow-400 text-xl mb-4">⚠️ No Results</div>
            <p className="text-white/80 mb-6">No game results found.</p>
            <button
              onClick={handlePlayAgain}
              className="bg-accent hover:bg-accent/80 text-white px-6 py-2 rounded-lg transition-colors"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  const playerWallet = publicKey?.toString() || '';
  const matchWasCancelled =
    payoutData.matchOutcome === 'cancelled' ||
    payoutData.matchOutcome === 'cancelled_no_play' ||
    payoutData.winner === 'cancelled' ||
    (!!payoutData.refundReason &&
      !payoutData.won &&
      !payoutData.isTie &&
      payoutData.winner !== playerWallet);

  const readableRefundReason = (() => {
    if (!payoutData.refundReason) return null;
    switch (payoutData.refundReason) {
      case 'single_player_paid_no_game':
        return 'Only one player paid. Match cancelled before it started.';
      case 'payment_timeout':
        return 'Opponent payment timeout';
      case 'player_cancelled_after_payment':
        return 'Opponent cancelled after payment';
      case 'player_cancelled_before_payment':
        return 'Opponent cancelled before payment';
      default:
        return payoutData.refundReason.replace(/_/g, ' ');
    }
  })();

  const cancellationSubtitle = (() => {
    if (!matchWasCancelled) {
      return '';
    }
    switch (payoutData.refundReason) {
      case 'payment_timeout':
        return 'Opponent never completed their deposit. Refund proposal is queued below.';
      case 'player_cancelled_after_payment':
        return 'Opponent cancelled after escrow. Sign the refund proposal once it appears.';
      case 'player_cancelled_before_payment':
        return 'Match ended before funds moved into escrow. No SOL left your wallet.';
      default:
        return 'Match ended before play could begin. Refund details are outlined below.';
    }
  })();

  const hasRefundProposal =
    typeof payoutData.refundAmount === 'number' && payoutData.refundAmount > 0;

  const resultTheme = (() => {
    if (matchWasCancelled) {
      return {
        emoji: '💸',
        title: 'Match Cancelled',
        subtitle: cancellationSubtitle,
        background: 'from-yellow-500/20 via-amber-500/10 to-amber-400/10',
        border: 'border-yellow-400/40',
        accentText: 'text-yellow-300',
      };
    }
    if (payoutData.won) {
      return {
        emoji: '🏆',
        title: 'Victory Secured',
        subtitle: 'You outguessed your opponent. Sign the proposal below to sweep the vault.',
        background: 'from-green-500/20 via-emerald-500/10 to-green-400/10',
        border: 'border-green-400/40',
        accentText: 'text-green-300',
      };
    }
    if (payoutData.isTie) {
      // Determine tie reason for better UX
      const tieReason = (payoutData as any).tieReason || null;
      let subtitle = 'Neither player cracked the puzzle this round. Refunds are queued below.';
      
      if (tieReason === 'timeout_and_all_guesses') {
        subtitle = 'One player timed out while the other used all guesses. Refunds are queued below.';
      } else if (tieReason === 'both_timeout') {
        subtitle = 'Both players timed out. Refunds are queued below.';
      } else if (tieReason === 'both_all_guesses') {
        subtitle = 'Both players used all guesses without solving. Refunds are queued below.';
      }
      
      return {
        emoji: '🤝',
        title: payoutData.isWinningTie ? 'Perfectly Matched' : 'Deadlock Draw',
        subtitle,
        background: 'from-blue-500/20 via-purple-500/10 to-indigo-500/10',
        border: 'border-blue-400/40',
        accentText: 'text-blue-300',
      };
    }
    return {
      emoji: '🔥',
      title: 'Tough Loss',
      subtitle: 'Your opponent outguessed you. Sign below to finalize the payout and queue again.',
      background: 'from-red-500/15 via-orange-500/10 to-rose-500/10',
      border: 'border-red-400/40',
      accentText: 'text-red-300',
    };
  })();

  const parseSeconds = (value: string | null | undefined) => {
    if (!value) return null;
    const trimmed = value.toString().trim().toLowerCase();
    if (trimmed === 'n/a') return null;
    const numeric = parseInt(trimmed.replace('s', ''), 10);
    return Number.isFinite(numeric) ? numeric : null;
  };

  const playerSeconds = parseSeconds(payoutData.timeElapsed);
  const opponentSeconds = parseSeconds(payoutData.opponentTimeElapsed);
  let tempoCopy: string | null = null;
  if (matchWasCancelled) {
    tempoCopy = cancellationSubtitle || 'Match ended before any moves were recorded.';
  } else if (playerSeconds !== null && opponentSeconds !== null) {
    const diff = Math.abs(playerSeconds - opponentSeconds);
    if (diff > 0) {
      tempoCopy =
        playerSeconds < opponentSeconds
          ? `You solved it ${diff}s faster.`
          : `Opponent finished ${diff}s quicker.`;
    } else {
      // Only show "matched pace exactly" for winning ties
      if (payoutData.isTie && payoutData.isWinningTie) {
        tempoCopy = 'Both players matched pace exactly.';
      } else {
        // For losing ties or non-ties, don't show tempo copy
        tempoCopy = null;
      }
    }
  }

  return (
    <div className="min-h-screen bg-primary relative">
      <TopRightWallet />
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Logo prominently displayed at the top */}
          <div className="flex justify-center mb-8">
            <div className="logo-shell">
              <Image src={logo} alt="Guess5 Logo" width={220} height={220} priority />
            </div>
          </div>
          
          {/* Game Results */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-white mb-6">Match Recap</h1>
              
              {/* Result Hero Banner */}
              <div
                className={`mb-6 rounded-3xl border ${resultTheme.border} bg-gradient-to-br ${resultTheme.background} px-6 py-8 sm:px-8 sm:py-10 shadow-xl`}
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="text-4xl sm:text-5xl">{resultTheme.emoji}</div>
                  <h2 className={`text-2xl sm:text-3xl font-black tracking-tight text-white`}>
                    {resultTheme.title}
                  </h2>
                  <p className="text-white/70 text-sm sm:text-base max-w-md">
                    {resultTheme.subtitle}
                  </p>
                </div>
              </div>
              
              {/* Game Details */}
              {matchWasCancelled ? (
                <div className="space-y-4 mb-6">
                  <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-5 text-left">
                    <div className="text-white/60 text-xs uppercase tracking-[0.3em] mb-2">Status</div>
                    <div className="text-white font-semibold text-base">
                      {cancellationSubtitle}
                    </div>
                    {payoutData.refundAmount ? (
                      <div className="text-yellow-200 text-sm font-semibold mt-3">
                        Refund amount: {payoutData.refundAmount.toFixed(4)} SOL
                      </div>
                    ) : (
                      <div className="text-white/60 text-xs mt-3">
                        No funds left escrow, so no refund is required.
                      </div>
                    )}
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                      <span className="text-white/60 uppercase tracking-[0.25em] text-xs">
                        Next Steps
                      </span>
                      <span className={`text-sm font-semibold ${resultTheme.accentText}`}>
                        {tempoCopy || 'Monitor the proposal below to reclaim your SOL.'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4 mb-6">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
                      <div className="text-white/50 text-xs uppercase tracking-[0.3em] mb-2">Your Run</div>
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="text-white/60 text-xs">Guesses Used</div>
                          <div className="text-white text-2xl font-semibold">
                            {payoutData.numGuesses || 0}/7
                          </div>
                          {payoutData.numGuesses === 7 && (
                            <span className="flex items-center gap-1 text-sm ml-1 mt-1">
                              {payoutData.won ? (
                                <>
                                  <span className="text-green-400">✅</span>
                                  <span className="text-green-300">Solved on last guess</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-red-400">❌</span>
                                  <span className="text-red-300">Used all guesses</span>
                                </>
                              )}
                            </span>
                          )}
                          {payoutData.isTie && (payoutData as any).tieReason === 'both_timeout' && (
                            <span className="flex items-center gap-1 text-sm ml-1 mt-1 text-orange-300">
                              <span>⏱️</span>
                              <span>Timed out – puzzle not solved</span>
                            </span>
                          )}
                        </div>
                  <div>
                          <div className="text-white/60 text-xs">Time to Solve</div>
                          <div className="text-white text-lg font-medium">
                            {payoutData.timeElapsed || '—'}
                  </div>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
                      <div className="text-white/50 text-xs uppercase tracking-[0.3em] mb-2">Opponent</div>
                      <div className="flex flex-col gap-3">
                        <div>
                          <div className="text-white/60 text-xs">Guesses Used</div>
                          <div className="text-white text-2xl font-semibold">
                            {payoutData.opponentGuesses || 0}/7
                          </div>
                          {payoutData.opponentGuesses === 7 && (
                            <span className="flex items-center gap-1 text-sm ml-1 mt-1">
                              {payoutData.winner !== 'tie' && payoutData.winner !== publicKey?.toString() ? (
                                <>
                                  <span className="text-green-400">✅</span>
                                  <span className="text-green-300">Solved on last guess</span>
                                </>
                              ) : (
                                <>
                                  <span className="text-red-400">❌</span>
                                  <span className="text-red-300">Used all guesses</span>
                                </>
                              )}
                            </span>
                          )}
                          {payoutData.isTie && (payoutData as any).tieReason === 'both_timeout' && (
                            <span className="flex items-center gap-1 text-sm ml-1 mt-1 text-orange-300">
                              <span>⏱️</span>
                              <span>Timed out – puzzle not solved</span>
                            </span>
                          )}
                        </div>
                  <div>
                          <div className="text-white/60 text-xs">Time to Solve</div>
                          <div className="text-white text-lg font-medium">
                            {payoutData.opponentTimeElapsed || '—'}
                  </div>
                </div>
              </div>
                    </div>
                  </div>
                  {payoutData.isTie && payoutData.isWinningTie && (
                    <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                        <span className="text-white/60 uppercase tracking-[0.25em] text-xs">
                          Tie Breaker
                        </span>
                        <span className={`text-sm font-semibold ${resultTheme.accentText}`}>
                          {tempoCopy || 'Timing data will appear once both players finish.'}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {/* Notification Banner */}
              {notification && (
                <div className="mb-4 bg-accent/20 border border-accent rounded-lg p-4 text-center animate-pulse">
                  <p className="text-accent font-semibold text-lg">{notification}</p>
                </div>
              )}
              
              {/* Payout Information - Smart Contract / Legacy Multisig */}
              <div className="mb-6">
                <h2 className="text-xl font-bold text-accent mb-3">Payout Details</h2>

                {/* Special case: match was cancelled before it ever started (only one player paid) */}
                {payoutData?.noGamePlayed ? (
                  <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-6 text-left">
                    <div className="text-white/60 text-xs uppercase tracking-[0.3em] mb-2">
                      Match Cancelled – No Game Played
                    </div>
                    <p className="text-white font-semibold text-base mb-3">
                      {payoutData.viewerPaid
                        ? 'You paid the entry fee, but your opponent never joined. No game was started and no winner was decided.'
                        : 'Your opponent paid the entry fee, but you never joined. No game was started and no winner was decided.'}
                    </p>
                    <p className="text-white/60 text-sm">
                      Your wallet balance is unchanged by this cancelled match. You can safely create or join a new game from the lobby.
                    </p>
                  </div>
                ) : payoutData && payoutData.proposalId ? (
                  <div className={`
                    ${payoutData.won && payoutData.proposalStatus === 'EXECUTED' 
                      ? 'bg-gradient-to-br from-accent/20 to-yellow-500/20 border-2 border-accent shadow-lg shadow-accent/50' 
                      : payoutData.isTie && payoutData.proposalStatus === 'EXECUTED'
                      ? 'bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-400 shadow-lg shadow-blue-400/50'
                      : matchWasCancelled && payoutData.proposalStatus === 'EXECUTED'
                      ? 'bg-gradient-to-br from-yellow-500/20 to-amber-400/20 border-2 border-yellow-400 shadow-lg shadow-yellow-400/50'
                      : !payoutData.won && payoutData.proposalStatus === 'EXECUTED'
                      ? 'bg-gradient-to-br from-gray-500/20 to-gray-600/20 border-2 border-gray-400 shadow-lg shadow-gray-400/50'
                      : matchWasCancelled
                      ? 'bg-yellow-500/10 border border-yellow-400/40'
                      : 'bg-secondary bg-opacity-10 border border-accent'
                    } rounded-lg p-6 transform transition-all duration-300
                    ${(payoutData.won || payoutData.isTie || !payoutData.won) && payoutData.proposalStatus === 'EXECUTED' ? 'animate-pulse hover:scale-105' : ''}
                  `}>
                  <div className="text-center">
                      <div className="text-accent text-lg font-semibold mb-2">
                        💰 Non-Custodial Payout System
                    </div>
                                         {matchWasCancelled ? (
                        <div className="text-white">
                          <div className="text-3xl font-bold text-yellow-300 mb-3 animate-bounce">
                            💸 REFUND MODE
                          </div>
                          <p className="text-white/90 mb-3 font-semibold">
                            {cancellationSubtitle}
                          </p>
                          {hasRefundProposal ? (
                            <>
                              <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
                                <div className="text-white/60 text-xs uppercase tracking-[0.25em] mb-1">Entry Fee Paid</div>
                                <div className="text-white text-lg font-semibold">
                                  {solPrice && payoutData.entryFee ? (
                                    <>
                                      ${getExpectedEntryFeeUSD(payoutData.entryFee, solPrice) || '—'} USD
                                    <span className="text-white/60 text-sm ml-2">
                                        ({payoutData.entryFee.toFixed(4)} SOL)
                                    </span>
                                    </>
                                  ) : (
                                    `${payoutData.entryFee?.toFixed(4) || '0.0000'} SOL`
                                  )}
                                </div>
                              </div>
                              <div className="text-3xl font-bold text-yellow-400 mb-2">
                                {payoutData.refundAmount?.toFixed(4)} SOL
                                {solPrice && payoutData.refundAmount && (
                                  <span className="text-yellow-300 text-xl ml-2">
                                    (${(payoutData.refundAmount * solPrice).toFixed(2)} USD)
                                  </span>
                                )}
                              </div>
                              {payoutData.entryFee && payoutData.refundAmount && (
                                <div className={`text-sm mb-2 ${
                                  Math.abs(payoutData.entryFee - payoutData.refundAmount) < 0.0001
                                    ? 'text-green-400'
                                    : 'text-yellow-400'
                                }`}>
                                  {Math.abs(payoutData.entryFee - payoutData.refundAmount) < 0.0001
                                    ? '✅ Full refund verified'
                                    : `⚠️ Refund differs from entry fee by ${Math.abs(payoutData.entryFee - payoutData.refundAmount).toFixed(4)} SOL`}
                                </div>
                              )}
                            </>
                          ) : (
                            <div className="text-white/70 text-sm mb-2">
                              No escrow transfer occurred, so no refund needs to be signed.
                            </div>
                          )}
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="mb-3">
                              <div className="text-green-400 text-xl font-semibold animate-pulse mb-2">
                                ✅ Refund returned to your wallet!
                              </div>
                              {/* On-chain verification status */}
                              {onChainVerified === true && (
                                <div className="flex items-center gap-2 text-green-300 text-sm mb-2">
                                  <span>✓</span>
                                  <span>Confirmed on blockchain</span>
                                  {explorerLink && (
                                    <a
                                      href={explorerLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-accent underline hover:text-yellow-300 ml-2"
                                    >
                                      View transaction ↗
                                    </a>
                                  )}
                                </div>
                              )}
                              {onChainVerified === false && (
                                <div className="text-yellow-400 text-sm mb-2">
                                  ⚠️ {verificationError || 'Unable to verify on blockchain'}
                                </div>
                              )}
                              {onChainVerified === null && (payoutData.proposalTransactionId || payoutData.payoutSignature) && (
                                <div className="text-white/60 text-sm mb-2">
                                  🔍 Verifying on blockchain...
                                  {verificationStartTime && (
                                    <span className="ml-2 text-white/40 text-xs">
                                      ({Math.floor((Date.now() - verificationStartTime) / 1000)}s)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (payoutData.proposalStatus === 'EXECUTING' || payoutData.proposalStatus === 'READY_TO_EXECUTE') ? (
                            <div className="mb-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                              <div className="flex items-center gap-2 text-yellow-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                                <span>Processing Refund...</span>
                              </div>
                              <p className="text-sm text-white/80 mb-1">
                                Your refund is being sent to your wallet. This usually takes 10-30 seconds.
                              </p>
                              {executionStartTime && (
                                <p className="text-xs text-white/50 mb-1">
                                  {executionElapsedSeconds}s elapsed
                                </p>
                              )}
                              {/* CRITICAL: Show clear execution status */}
                              <div className="mt-2 text-xs text-white/60">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${payoutData.proposalStatus === 'EXECUTING' ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></span>
                                  <span>
                                    {payoutData.proposalStatus === 'EXECUTING' 
                                      ? 'Executing on blockchain...' 
                                      : 'All signatures collected, execution starting...'}
                                  </span>
                                </div>
                                {payoutData.proposalId && (
                                  <div className="mt-1 text-white/40 text-xs font-mono">
                                    Proposal: {payoutData.proposalId.substring(0, 8)}...
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (payoutData.proposalStatus === 'APPROVED' && payoutData.needsSignatures === 0 && !payoutData.proposalExecutedAt) ? (
                            <div className="mb-3 p-4 rounded-lg bg-blue-500/10 border border-blue-400/30">
                              <div className="flex items-center gap-2 text-blue-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-400 border-t-transparent"></div>
                                <span>All signatures collected. Waiting for ExecuteReady transition...</span>
                              </div>
                              <p className="text-sm text-white/80 mb-1">
                                The proposal has all required signatures but is waiting to transition to ExecuteReady state. Execution will begin automatically once ready.
                              </p>
                              {payoutData.proposalId && (
                                <div className="mt-1 text-white/40 text-xs font-mono">
                                  Proposal: {payoutData.proposalId.substring(0, 8)}...
                                </div>
                              )}
                            </div>
                          ) : hasRefundProposal ? (
                            <p className="text-sm text-white/80 mb-3">
                              Sign the refund proposal below to release your SOL back to your wallet.
                            </p>
                          ) : payoutData?.verificationStatus === 'VERIFYING_ON_CHAIN' || payoutData?.verifying ? (
                            <div className="mb-3 p-4 rounded-lg bg-blue-500/10 border border-blue-400/30">
                              <div className="flex items-center gap-2 text-blue-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-400 border-t-transparent"></div>
                                <span>Verifying on chain...</span>
                              </div>
                              <p className="text-sm text-white/80 mb-1">
                                Your signature is being verified on the blockchain. This can take up to ~30 seconds.
                              </p>
                              <p className="text-xs text-white/50">
                                💡 The database will only update after verification succeeds. Please wait...
                              </p>
                            </div>
                          ) : null}
                          {readableRefundReason && (
                            <div className="text-white/50 text-xs uppercase tracking-[0.25em] mt-2">
                              Reason: {readableRefundReason}
                            </div>
                          )}
                          {(payoutData.proposalStatus === 'ACTIVE' || payoutData.proposalStatus === 'PROPOSAL_CREATED' || !payoutData.proposalStatus || payoutData.proposalStatus === 'PENDING') && 
                           (payoutData.needsSignatures === undefined || payoutData.needsSignatures === null || payoutData.needsSignatures > 0) && (
                            <div className="mt-4">
                              {playerProposalSigners.length > 0 && !playerProposalSigners.includes(publicKey?.toString() || '') ? (
                                <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                  <p className="text-green-400 text-sm font-semibold mb-1">
                                    ✅ Other player has signed
                                  </p>
                                  <p className="text-xs text-white/70">
                                    Refund is executing automatically. No action needed.
                                  </p>
                                </div>
                              ) : playerProposalSigners.includes(publicKey?.toString() || '') ? (
                                <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                  <div className="flex items-center gap-2 text-yellow-400 text-sm font-semibold mb-1">
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-yellow-400 border-t-transparent"></div>
                                    <span>✓ You have signed. Waiting for execution...</span>
                                  </div>
                                  {executionStartTime && (
                                    <div className="text-xs text-white/60 mt-1">
                                      <div>⏱️ {executionElapsedSeconds}s elapsed</div>
                                      {executionElapsedSeconds > 60 && (
                                        <div className="text-yellow-400 mt-1">
                                          ⚠️ Execution taking longer than expected. The proposal may be waiting for ExecuteReady state or network confirmation.
                                        </div>
                                      )}
                                      {executionElapsedSeconds > 120 && (
                                        <div className="text-orange-400 mt-1 font-semibold">
                                          ⚠️ Execution has been waiting for 2+ minutes. The backend reconciliation worker will retry if needed.
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {payoutData?.proposalId && (
                                    <div className="text-xs text-white/40 mt-1 font-mono">
                                      Proposal: {payoutData.proposalId.substring(0, 8)}...
                                    </div>
                                  )}
                                  <div className="text-xs text-white/50 mt-2">
                                    💡 Execution typically takes 10-30 seconds. If it takes longer, the backend is automatically retrying.
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-white/60 mb-2">
                                  ⏳ Sign the refund proposal to release your SOL
                                </p>
                              )}
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {(() => {
                                const hasProposalId = !!payoutData.proposalId;
                                const userHasSigned = playerProposalSigners.includes(publicKey?.toString() || '');
                                
                                if (!hasProposalId || userHasSigned) {
                                  return null;
                                }
                                
                                // CRITICAL: Disable button if proposal creation failed or has retryable error
                                const isProposalCreationFailed = payoutData.proposalStatus === 'VAULT_TX_CREATION_FAILED';
                                const hasRetryableError = Boolean(error && (
                                  error.includes('still being created') ||
                                  error.includes('not ready') ||
                                  error.includes('VaultTransaction')
                                ));
                                const isButtonDisabled = Boolean(signingProposal || 
                                                         userHasSigned ||
                                                         isProposalCreationFailed ||
                                                         hasRetryableError);
                                
                                return (
                                  <button
                                    onClick={handleSignProposal}
                                    disabled={isButtonDisabled}
                                    className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                  >
                                    {signingProposal ? 'Signing...' : 
                                     userHasSigned ? '✓ Signed - Processing...' : 
                                     isProposalCreationFailed ? 'Match Failed to Initialize' :
                                     hasRetryableError ? 'Proposal Not Ready Yet' :
                                     'Sign Refund Proposal'}
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      ) : payoutData.won ? (
                        <div className="text-white">
                          <div className="text-3xl font-bold text-accent mb-3 animate-bounce">
                            🎉 YOU WON! 🎉
                          </div>
                          <div className="text-4xl font-bold text-yellow-400 mb-2">
                            {(() => {
                              // Calculate expected USD based on entry fee tier (stable, doesn't fluctuate)
                              // CRITICAL: Use entryFeeUSD from database if available, otherwise calculate from SOL
                              const entryFeeUSD = payoutData.entryFeeUSD 
                                ? Number(payoutData.entryFeeUSD)  // Use database value if available
                                : (solPrice && payoutData.entryFee 
                                  ? getExpectedEntryFeeUSD(payoutData.entryFee, solPrice) 
                                  : null);
                              const expectedWinningsUSD = getExpectedWinningsUSD(
                                entryFeeUSD, 
                                payoutData.entryFee || null, 
                                solPrice
                              );
                              
                              // Calculate current USD value of actual SOL received (for reference)
                              const actualSOLUSD = solPrice && payoutData.winnerAmount 
                                ? payoutData.winnerAmount * solPrice 
                                : null;
                              
                              // Always show expected USD if we can calculate it, regardless of winnerAmount
                              if (expectedWinningsUSD) {
                                return (
                                  <>
                                    <div className="mb-1">
                                      ${expectedWinningsUSD.toFixed(2)} USD
                                      <span className="text-yellow-300 text-xl ml-2">
                                        (Expected)
                                      </span>
                                    </div>
                                    {payoutData.winnerAmount ? (
                                      <div className="text-2xl text-yellow-300/80 mt-2">
                                        {payoutData.winnerAmount.toFixed(4)} SOL
                                        {actualSOLUSD && (
                                          <span className="text-yellow-200/60 text-lg ml-2">
                                            (≈ ${actualSOLUSD.toFixed(2)} USD at current rate)
                                          </span>
                                        )}
                                      </div>
                                    ) : null}
                                  </>
                                );
                              } else if (solPrice && payoutData.winnerAmount) {
                                return (
                                  <>
                                    ${(payoutData.winnerAmount * solPrice).toFixed(2)} USD
                                    <span className="text-yellow-300 text-xl ml-2">
                                      ({payoutData.winnerAmount.toFixed(4)} SOL)
                                    </span>
                                  </>
                                );
                              } else {
                                return `${payoutData.winnerAmount?.toFixed(4) || '0.0000'} SOL`;
                              }
                            })()}
                          </div>
                          {/* Disclaimer about rounding and gas costs */}
                          {payoutData.winnerAmount && (
                            <div className="mt-3 p-3 rounded-lg bg-blue-500/10 border border-blue-400/30">
                              <div className="text-blue-300 text-xs font-semibold mb-1">ℹ️ Amount Explanation</div>
                              <div className="text-white/70 text-xs leading-relaxed">
                                Expected USD is calculated as 95% of the combined entry fees (rounded to tier amounts). 
                                The actual SOL amount received may differ slightly due to small rounding differences and transaction fees. 
                                SOL amounts are always accurate and represent what was actually transferred.
                              </div>
                            </div>
                          )}
                          {payoutData.entryFee && payoutData.winnerAmount && (
                            <div className={`text-sm mb-2 ${
                              Math.abs(payoutData.winnerAmount - (payoutData.entryFee * 2 - (payoutData.feeAmount || 0))) < 0.0001
                                ? 'text-green-400'
                                : 'text-yellow-400'
                            }`}>
                              {Math.abs(payoutData.winnerAmount - (payoutData.entryFee * 2 - (payoutData.feeAmount || 0))) < 0.0001
                                ? `✅ Payout verified: ${(payoutData.entryFee * 2).toFixed(4)} SOL (both entry fees) - ${(payoutData.feeAmount || 0).toFixed(4)} SOL (platform fee) = ${payoutData.winnerAmount.toFixed(4)} SOL`
                                : `⚠️ Payout verification: Expected ~${((payoutData.entryFee * 2) - (payoutData.feeAmount || 0)).toFixed(4)} SOL, got ${payoutData.winnerAmount.toFixed(4)} SOL`}
                            </div>
                          )}
                          {/* Entry Fee - moved down, smaller, category shown prominently */}
                          {payoutData.entryFee && (
                            <div className="mt-4 mb-3 p-2 rounded-lg bg-white/5 border border-white/10">
                              <div className="text-white/50 text-xs uppercase tracking-[0.25em] mb-1">Entry Fee</div>
                              <div className="text-white/80 text-sm font-medium">
                                {solPrice && payoutData.entryFee ? (
                                  <>
                                    <span className="font-semibold">${getExpectedEntryFeeUSD(payoutData.entryFee, solPrice) || '—'} USD</span>
                                    <span className="text-white/50 text-xs ml-2">
                                      ({payoutData.entryFee.toFixed(4)} SOL)
                                    </span>
                                  </>
                                ) : (
                                  `${payoutData.entryFee?.toFixed(4) || '0.0000'} SOL`
                                )}
                              </div>
                            </div>
                          )}
                          {payoutData.bonus?.eligible ? (
                            <div
                              className={`mb-3 rounded-2xl px-4 py-3 border ${
                                payoutData.bonus.paid
                                  ? 'bg-green-500/15 border-green-400/40'
                                  : 'bg-yellow-500/10 border-yellow-400/40'
                              }`}
                            >
                              <div className="flex flex-col items-center gap-1 text-sm">
                                <div className="flex items-center gap-2 font-semibold">
                                  <span className="text-xl">🎁</span>
                                  <span className="text-white/90 uppercase tracking-wide">
                                    Platform Bonus
                                  </span>
                                </div>
                                {payoutData.bonus.paid ? (
                                  <>
                                    {/* Show expected USD based on tier */}
                                    {payoutData.bonus.tier && BONUS_USD_BY_TIER[payoutData.bonus.tier] !== undefined ? (
                                    <div className="text-green-300 font-bold text-lg">
                                        +${BONUS_USD_BY_TIER[payoutData.bonus.tier].toFixed(2)} USD
                                        <span className="text-green-200 text-base ml-2">
                                          (Expected)
                                        </span>
                                    </div>
                                    ) : null}
                                    {/* Show actual SOL received */}
                                    {payoutData.bonus.amountSol ? (
                                      <div className="text-green-200 font-semibold text-base mt-1">
                                        +{payoutData.bonus.amountSol.toFixed(4)} SOL
                                        {solPrice && (
                                          <span className="text-green-300/70 text-sm ml-2">
                                            (≈ ${(payoutData.bonus.amountSol * solPrice).toFixed(2)} USD at current rate)
                                          </span>
                                        )}
                                      </div>
                                    ) : null}
                                    {payoutData.totalPayoutSol && (
                                      <div className="text-white/70 text-xs mt-2">
                                        Total received: {payoutData.totalPayoutSol.toFixed(4)} SOL
                                        {solPrice && ` ($${(payoutData.totalPayoutSol * solPrice).toFixed(2)} USD)`}
                                      </div>
                                    )}
                                    {payoutData.bonus.signature && (
                                      <a
                                        href={`https://explorer.solana.com/tx/${payoutData.bonus.signature}?cluster=devnet`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent text-xs underline hover:text-yellow-300 mt-1"
                                      >
                                        View bonus transaction ↗
                                      </a>
                                    )}
                                  </>
                                ) : (
                                  <>
                                    {/* Show expected USD when bonus is pending */}
                                    {payoutData.bonus.tier && BONUS_USD_BY_TIER[payoutData.bonus.tier] !== undefined ? (
                                      <div className="text-yellow-300 font-bold text-lg">
                                        +${BONUS_USD_BY_TIER[payoutData.bonus.tier].toFixed(2)} USD
                                        <span className="text-yellow-200 text-base ml-2">
                                          (Expected)
                                        </span>
                                      </div>
                                    ) : null}
                                    <div className="text-yellow-300 text-sm text-center mt-1">
                                    Bonus triggered! +{payoutData.bonus.expectedSol?.toFixed(4)} SOL arriving when the proposal executes.
                                  </div>
                                  </>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-white/40 text-xs mb-3">
                              Play higher tiers to unlock platform bonus rewards.
                            </div>
                          )}
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="mb-3">
                              <div className="text-green-400 text-xl font-semibold animate-pulse mb-2">
                                ✅ Payment Sent to Your Wallet!
                                {payoutData.bonus?.eligible && actualBonusAmount !== null && (
                                  <div className="text-green-300 text-sm mt-2">
                                    Bonus: +{actualBonusAmount.toFixed(4)} SOL
                                    {solPrice && ` (+$${(actualBonusAmount * solPrice).toFixed(2)} USD)`}
                                  </div>
                                )}
                              </div>
                              {/* On-chain verification status */}
                              {onChainVerified === true && (
                                <div className="flex items-center gap-2 text-green-300 text-sm mb-2">
                                  <span>✓</span>
                                  <span>Confirmed on blockchain</span>
                                  {explorerLink && (
                                    <a
                                      href={explorerLink}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-accent underline hover:text-yellow-300 ml-2"
                                    >
                                      View transaction ↗
                                    </a>
                                  )}
                                </div>
                              )}
                              {onChainVerified === false && (
                                <div className="text-yellow-400 text-sm mb-2">
                                  ⚠️ {verificationError || 'Unable to verify on blockchain'}
                                </div>
                              )}
                              {onChainVerified === null && (payoutData.proposalTransactionId || payoutData.payoutSignature) && (
                                <div className="text-white/60 text-sm mb-2">
                                  🔍 Verifying on blockchain...
                                  {verificationStartTime && (
                                    <span className="ml-2 text-white/40 text-xs">
                                      ({Math.floor((Date.now() - verificationStartTime) / 1000)}s)
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (payoutData.proposalStatus === 'EXECUTING' || payoutData.proposalStatus === 'READY_TO_EXECUTE') ? (
                            <div className="mb-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                              <div className="flex items-center gap-2 text-yellow-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                                <span>Processing Payout...</span>
                              </div>
                              <p className="text-sm text-white/80 mb-1">
                                Your winnings are being sent to your wallet. This usually takes 10-30 seconds.
                              </p>
                              {executionStartTime && (
                                <p className="text-xs text-white/50 mb-1">
                                  {executionElapsedSeconds}s elapsed
                                </p>
                              )}
                              {/* CRITICAL: Show clear execution status */}
                              <div className="mt-2 text-xs text-white/60">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${payoutData.proposalStatus === 'EXECUTING' ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></span>
                                  <span>
                                    {payoutData.proposalStatus === 'EXECUTING' 
                                      ? 'Executing on blockchain...' 
                                      : 'All signatures collected, execution starting...'}
                                  </span>
                                </div>
                                {payoutData.proposalId && (
                                  <div className="mt-1 text-white/40 text-xs font-mono">
                                    Proposal: {payoutData.proposalId.substring(0, 8)}...
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (payoutData.proposalStatus === 'APPROVED' && payoutData.needsSignatures === 0 && !payoutData.proposalExecutedAt) ? (
                            <div className="mb-3 p-4 rounded-lg bg-blue-500/10 border border-blue-400/30">
                              <div className="flex items-center gap-2 text-blue-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-400 border-t-transparent"></div>
                                <span>All signatures collected. Waiting for ExecuteReady transition...</span>
                              </div>
                              <p className="text-sm text-white/80 mb-1">
                                The proposal has all required signatures but is waiting to transition to ExecuteReady state. Execution will begin automatically once ready.
                              </p>
                              {payoutData.proposalId && (
                                <div className="mt-1 text-white/40 text-xs font-mono">
                                  Proposal: {payoutData.proposalId.substring(0, 8)}...
                                </div>
                              )}
                            </div>
                          ) : (
                          <p className="text-sm text-white/80 mb-3">
                              Sign the proposal below to claim your winnings.
                              {payoutData.bonus?.eligible && payoutData.bonus?.expectedSol && (
                                <span className="block mt-1 text-yellow-300">
                                  Bonus: +{payoutData.bonus.expectedSol.toFixed(4)} SOL
                                  {solPrice && ` (+$${(payoutData.bonus.expectedSol * solPrice).toFixed(2)} USD)`}
                                </span>
                              )}
                          </p>
                          )}
                          
                          {(payoutData.proposalStatus === 'ACTIVE' || payoutData.proposalStatus === 'PROPOSAL_CREATED' || !payoutData.proposalStatus || payoutData.proposalStatus === 'PENDING') && 
                           (payoutData.needsSignatures === undefined || payoutData.needsSignatures === null || payoutData.needsSignatures > 0) && (
                            <div className="mt-4">
                              {playerProposalSigners.length > 0 && !playerProposalSigners.includes(publicKey?.toString() || '') ? (
                                <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                  <p className="text-green-400 text-sm font-semibold mb-1">
                                    ✅ Other player has signed
                                  </p>
                                  <p className="text-xs text-white/70">
                                    Proposal is executing automatically. No action needed.
                                  </p>
                                </div>
                              ) : playerProposalSigners.includes(publicKey?.toString() || '') ? (
                                <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                  <div className="flex items-center gap-2 text-yellow-400 text-sm font-semibold mb-1">
                                    <div className="animate-spin rounded-full h-4 w-4 border-2 border-yellow-400 border-t-transparent"></div>
                                    <span>✓ You have signed. Waiting for execution...</span>
                                  </div>
                                  {executionStartTime && (
                                    <div className="text-xs text-white/60 mt-1">
                                      <div>⏱️ {executionElapsedSeconds}s elapsed</div>
                                      {executionElapsedSeconds > 60 && (
                                        <div className="text-yellow-400 mt-1">
                                          ⚠️ Execution taking longer than expected. The proposal may be waiting for ExecuteReady state or network confirmation.
                                        </div>
                                      )}
                                      {executionElapsedSeconds > 120 && (
                                        <div className="text-orange-400 mt-1 font-semibold">
                                          ⚠️ Execution has been waiting for 2+ minutes. The backend reconciliation worker will retry if needed.
                                        </div>
                                      )}
                                    </div>
                                  )}
                                  {payoutData?.proposalId && (
                                    <div className="text-xs text-white/40 mt-1 font-mono">
                                      Proposal: {payoutData.proposalId.substring(0, 8)}...
                                    </div>
                                  )}
                                  <div className="text-xs text-white/50 mt-2">
                                    💡 Execution typically takes 10-30 seconds. If it takes longer, the backend is automatically retrying.
                                  </div>
                                </div>
                              ) : (
                                <p className="text-sm text-white/60 mb-2">
                                  ⏳ Sign the proposal to claim your winnings
                                </p>
                              )}
                              
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {(() => {
                                const hasProposalId = !!payoutData.proposalId;
                                
                                // ✅ FIX: Use latest polling response for userHasSigned calculation
                                // Get raw signers from latest payoutData (from polling)
                                const rawSigners = Array.isArray(payoutData.proposalSigners) 
                                  ? payoutData.proposalSigners 
                                  : (typeof payoutData.proposalSigners === 'string' 
                                      ? JSON.parse(payoutData.proposalSigners || '[]') 
                                      : []);
                                
                                // ✅ FIX: Check if user's public key is in the latest proposalSigners
                                // Use case-insensitive comparison to handle address format differences
                                const currentUserWallet = publicKey?.toString() || '';
                                const userHasSigned = rawSigners.some((s: string) => 
                                  s && s.toLowerCase() === currentUserWallet.toLowerCase()
                                );
                                
                                // Also check normalized signers as fallback
                                const normalizedUserSigned = playerProposalSigners.some((s: string) =>
                                  s && s.toLowerCase() === currentUserWallet.toLowerCase()
                                );
                                const userHasSignedFinal = userHasSigned || normalizedUserSigned;
                                
                                // Verbose debug logging removed to reduce console noise
                                // Key info: frontendProposalId, hasProposalId, userHasSignedFinal
                                
                                // ✅ ENHANCEMENT 3: Enhanced proposal finalized check
                                const isProposalFinalized = 
                                  payoutData.needsSignatures === 0 ||
                                  payoutData.proposalStatus === 'APPROVED' ||
                                  payoutData.proposalStatus === 'EXECUTING' || 
                                                               payoutData.proposalStatus === 'EXECUTED' ||
                                                               !!payoutData.proposalExecutedAt;
                                
                                // ✅ ENHANCEMENT 4: Show appropriate status messages for finalized proposals
                                if (isProposalFinalized && hasProposalId) {
                                  if (payoutData.proposalStatus === 'APPROVED') {
                                    return (
                                      <div className="mb-3 p-3 rounded-lg bg-green-500/10 border border-green-400/30">
                                        <div className="flex items-center gap-2 text-green-400 text-sm font-semibold mb-1">
                                          <span>✅</span>
                                          <span>Proposal already approved. Execution starting...</span>
                                        </div>
                                        <p className="text-xs text-white/70">
                                          Proposal ID: {payoutData.proposalId}
                                        </p>
                                      </div>
                                    );
                                  }
                                  if (payoutData.proposalStatus === 'EXECUTING') {
                                    return (
                                      <div className="mb-3 p-3 rounded-lg bg-blue-500/10 border border-blue-400/30">
                                        <div className="flex items-center gap-2 text-blue-400 text-sm font-semibold mb-1">
                                          <span>⏳</span>
                                          <span>Proposal is executing. Your winnings are being sent...</span>
                                        </div>
                                        <p className="text-xs text-white/70">
                                          Proposal ID: {payoutData.proposalId}
                                        </p>
                                      </div>
                                    );
                                  }
                                  if (payoutData.proposalStatus === 'EXECUTED' || payoutData.proposalExecutedAt) {
                                    return (
                                      <div className="mb-3 p-3 rounded-lg bg-purple-500/10 border border-purple-400/30">
                                        <div className="flex items-center gap-2 text-purple-400 text-sm font-semibold mb-1">
                                          <span>🎉</span>
                                          <span>Proposal executed. Winnings have been sent!</span>
                                        </div>
                                        <p className="text-xs text-white/70">
                                          Proposal ID: {payoutData.proposalId}
                                        </p>
                                      </div>
                                    );
                                  }
                                }
                                
                                // ✅ FIX: Show fallback UI if already signed (skip signing flow)
                                if (userHasSignedFinal && hasProposalId && !isProposalFinalized) {
                                  return (
                                    <div className="mb-3 p-3 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                      <div className="flex items-center gap-2 text-yellow-400 text-sm font-semibold mb-1">
                                        <span>✓</span>
                                        <span>You have signed. Waiting for execution...</span>
                                      </div>
                                      <p className="text-xs text-white/70">
                                        Proposal ID: {payoutData.proposalId}
                                      </p>
                                    </div>
                                  );
                                }
                                
                                const shouldShowButton = hasProposalId && !userHasSignedFinal && !isProposalFinalized;
                                
                                // Show Proposal sign button if user hasn't signed Proposal yet
                                if (!shouldShowButton) {
                                  // Show warning if using stale data and button would be hidden
                                  if ((payoutData as any)._isStaleFallback && !userHasSignedFinal && hasProposalId) {
                                    return (
                                      <div className="text-yellow-500 text-sm mt-2">
                                        ⚠️ Unable to verify signature status. Please refresh the page.
                                      </div>
                                    );
                                  }
                                  return null;
                                }

                                // ✅ ENHANCEMENT 5: Enhanced button disabled logic
                                // Disable button if:
                                // 1. User has signed OR currently signing
                                // 2. Proposal is finalized (approved/executing/executed)
                                // 3. Proposal creation failed (VAULT_TX_CREATION_FAILED)
                                // 4. There's a retryable error indicating proposal isn't ready
                                const isProposalCreationFailed = payoutData.proposalStatus === 'VAULT_TX_CREATION_FAILED';
                                const hasRetryableError = Boolean(error && (
                                  error.includes('still being created') ||
                                  error.includes('not ready') ||
                                  error.includes('VaultTransaction')
                                ));
                                const isButtonDisabled = Boolean(
                                  signingProposal || 
                                                         userHasSignedFinal || 
                                  isProposalFinalized ||
                                                         isProposalCreationFailed ||
                                  hasRetryableError
                                );
                                
                                return (
                                  <button
                                    onClick={handleSignProposal}
                                    disabled={isButtonDisabled}
                                    className="bg-accent hover:bg-yellow-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-primary font-bold py-2.5 px-6 rounded-lg transition-all duration-200 shadow hover:shadow-lg transform hover:scale-105 active:scale-95 min-h-[44px] flex items-center justify-center mx-auto"
                                  >
                                    {signingProposal ? (
                                      <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                                        Signing...
                                      </>
                                    ) : userHasSignedFinal ? (
                                      <>
                                        <span className="mr-2">✓</span>
                                        Signed - Processing...
                                      </>
                                    ) : 'Sign Proposal to Claim Winnings'}
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                       </div>
                     ) : payoutData.isTie ? (
                        <div className="text-white">
                          <div className="text-3xl font-bold text-accent mb-3 animate-bounce">
                            🤝 IT'S A TIE! 🤝
                          </div>
                         {payoutData.isWinningTie ? (
                          <>
                              <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
                                <div className="text-white/60 text-xs uppercase tracking-[0.25em] mb-1">Entry Fee Paid</div>
                                <div className="text-white text-lg font-semibold">
                                  {solPrice && payoutData.entryFee ? (
                                    <>
                                      ${calculateRoundedUSD(payoutData.entryFee, solPrice)} USD
                                    <span className="text-white/60 text-sm ml-2">
                                        ({payoutData.entryFee.toFixed(4)} SOL)
                                    </span>
                                    </>
                                  ) : (
                                    `${payoutData.entryFee?.toFixed(4) || '0.0000'} SOL`
                                  )}
                                </div>
                              </div>
                              <p className="text-lg text-white/90 mb-2 font-semibold">Perfect Match - Both players solved with same moves and time!</p>
                              <div className="text-3xl font-bold text-yellow-400 mb-2">
                                {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL
                                {solPrice && payoutData.refundAmount && (
                                  <span className="text-yellow-300 text-xl ml-2">
                                    (${(payoutData.refundAmount * solPrice).toFixed(2)} USD)
                                  </span>
                                )}
                              </div>
                              {payoutData.entryFee && payoutData.refundAmount && (
                                <div className={`text-sm mb-2 ${
                                  Math.abs(payoutData.entryFee - payoutData.refundAmount) < 0.0001
                                    ? 'text-green-400'
                                    : 'text-yellow-400'
                                }`}>
                                  {Math.abs(payoutData.entryFee - payoutData.refundAmount) < 0.0001
                                    ? '✅ Full refund verified'
                                    : `⚠️ Refund differs from entry fee by ${Math.abs(payoutData.entryFee - payoutData.refundAmount).toFixed(4)} SOL`}
                                </div>
                              )}
                              {payoutData.proposalStatus === 'EXECUTED' ? (
                                <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                                  ✅ Full Refund Sent to Your Wallet!
                                </div>
                              ) : (payoutData.proposalStatus === 'EXECUTING' || payoutData.proposalStatus === 'READY_TO_EXECUTE' || (payoutData.proposalStatus === 'APPROVED' && payoutData.needsSignatures === 0 && !payoutData.proposalExecutedAt)) ? (
                                <div className="mb-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                  <div className="flex items-center gap-2 text-yellow-400 text-lg font-semibold mb-2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                                    <span>Processing Refund...</span>
                                  </div>
                                  <p className="text-sm text-white/80 mb-1">
                                    Your refund is being sent to your wallet. This usually takes 10-30 seconds.
                                  </p>
                                  {executionStartTime && (
                                    <p className="text-xs text-white/50">
                                      {Math.floor((Date.now() - executionStartTime) / 1000)}s elapsed
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-white/80 mb-3">
                                  Sign the proposal below to receive your refund.
                            </p>
                              )}
                          </>
                        ) : (
                          <>
                              <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
                                <div className="text-white/60 text-xs uppercase tracking-[0.25em] mb-1">Entry Fee Paid</div>
                                <div className="text-white text-lg font-semibold">
                                  {solPrice && payoutData.entryFee ? (
                                    <>
                                      ${calculateRoundedUSD(payoutData.entryFee, solPrice)} USD
                                    <span className="text-white/60 text-sm ml-2">
                                        ({payoutData.entryFee.toFixed(4)} SOL)
                                    </span>
                                    </>
                                  ) : (
                                    `${payoutData.entryFee?.toFixed(4) || '0.0000'} SOL`
                                  )}
                                </div>
                              </div>
                              <p className="text-lg text-white/90 mb-2 font-semibold">Both players failed to solve the puzzle</p>
                              <div className="text-3xl font-bold text-yellow-400 mb-2">
                                {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL
                                {solPrice && payoutData.refundAmount && (
                                  <span className="text-yellow-300 text-xl ml-2">
                                    (${(payoutData.refundAmount * solPrice).toFixed(2)} USD)
                                  </span>
                                )}
                              </div>
                              {payoutData.entryFee && payoutData.refundAmount && (() => {
                                // Calculate expected refund based on rounded tier amount * 0.95
                                const entryFeeUSD = payoutData.entryFeeUSD 
                                  ? Number(payoutData.entryFeeUSD)
                                  : (solPrice && payoutData.entryFee 
                                    ? getExpectedEntryFeeUSD(payoutData.entryFee, solPrice) 
                                    : null);
                                const expectedRefundUSD = entryFeeUSD ? entryFeeUSD * 0.95 : null;
                                const expectedRefundSOL = expectedRefundUSD && solPrice ? expectedRefundUSD / solPrice : payoutData.entryFee * 0.95;
                                
                                return (
                                  <div className={`text-sm mb-2 ${
                                    Math.abs(expectedRefundSOL - payoutData.refundAmount) < 0.0001
                                      ? 'text-green-400'
                                      : 'text-yellow-400'
                                  }`}>
                                    {Math.abs(expectedRefundSOL - payoutData.refundAmount) < 0.0001
                                      ? `✅ 95% refund verified (${expectedRefundSOL.toFixed(4)} SOL expected)`
                                      : `⚠️ Refund differs from expected 95% (${expectedRefundSOL.toFixed(4)} SOL) by ${Math.abs(expectedRefundSOL - payoutData.refundAmount).toFixed(4)} SOL. Entry fee: ${payoutData.entryFee.toFixed(4)} SOL, Refund: ${payoutData.refundAmount.toFixed(4)} SOL`}
                                  </div>
                                );
                              })()}
                              {payoutData.proposalStatus === 'EXECUTED' ? (
                                <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                                  ✅ 95% Refund Sent to Your Wallet!
                                </div>
                              ) : (payoutData.proposalStatus === 'EXECUTING' || payoutData.proposalStatus === 'READY_TO_EXECUTE' || (payoutData.proposalStatus === 'APPROVED' && payoutData.needsSignatures === 0 && !payoutData.proposalExecutedAt)) ? (
                                <div className="mb-3 p-4 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                                  <div className="flex items-center gap-2 text-yellow-400 text-lg font-semibold mb-2">
                                    <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                                    <span>Processing Refund...</span>
                                  </div>
                                  <p className="text-sm text-white/80 mb-1">
                                    Your refund is being sent to your wallet. This usually takes 10-30 seconds.
                                  </p>
                                  {executionStartTime && (
                                    <p className="text-xs text-white/50">
                                      {Math.floor((Date.now() - executionStartTime) / 1000)}s elapsed
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="text-sm text-white/80 mb-3">
                                  Sign the proposal below to receive your refund.
                            </p>
                              )}
                          </>
                        )}
                          
                          {payoutData.bonus?.eligible && (
                            <div className="text-white/50 text-xs mb-3">
                              Platform bonus rewards are earned on wins—secure the next {getBonusTierLabel(payoutData.bonus.tier)} victory to unlock +${payoutData.bonus.expectedUSD?.toFixed(2)}.
                            </div>
                          )}
                          
                          {(payoutData.proposalStatus === 'ACTIVE' || payoutData.proposalStatus === 'PROPOSAL_CREATED' || !payoutData.proposalStatus || payoutData.proposalStatus === 'PENDING') && (payoutData.needsSignatures === undefined || payoutData.needsSignatures === null || payoutData.needsSignatures >= 0) && (
                            <div className="mt-4">
                              <p className={`text-sm mb-2 ${
                                (payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                  ? 'text-green-400 font-semibold'
                                  : playerProposalSigners.includes(publicKey?.toString() || '')
                                  ? 'text-yellow-400'
                                  : playerProposalSigners.length > 0
                                  ? 'text-green-400 font-semibold'
                                  : 'text-white/60'
                              }`}>
                                {payoutData.proposalStatus === 'READY_TO_EXECUTE' || payoutData.proposalStatus === 'EXECUTING'
                                  ? `✅ Proposal is ready to execute - ${payoutData.proposalStatus === 'EXECUTING' ? 'executing on blockchain' : 'waiting for processing'}...${executionStartTime ? ` (${executionElapsedSeconds}s)` : ''}`
                                  : (payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                  ? payoutData.proposalStatus === 'APPROVED'
                                    ? `✅ All signatures collected. Waiting for ExecuteReady transition...${executionStartTime ? ` (${executionElapsedSeconds}s)` : ''}`
                                    : `✅ Proposal is ready to execute - waiting for processing...${executionStartTime ? ` (${executionElapsedSeconds}s)` : ''}`
                                  : playerProposalSigners.includes(publicKey?.toString() || '')
                                  ? `✓ You have signed. Waiting for proposal execution...${executionStartTime ? ` (${executionElapsedSeconds}s elapsed)` : ''}`
                                  : playerProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                  : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {(() => {
                                const hasProposalId = !!payoutData.proposalId;
                                // CRITICAL: Check both normalized signers and raw signers array
                                const normalizedUserSigned = playerProposalSigners.includes(publicKey?.toString() || '');
                                const rawSigners = Array.isArray(payoutData.proposalSigners) 
                                  ? payoutData.proposalSigners 
                                  : (typeof payoutData.proposalSigners === 'string' 
                                      ? JSON.parse(payoutData.proposalSigners || '[]') 
                                      : []);
                                const rawUserSigned = rawSigners.some((s: string) => 
                                  s && s.toLowerCase() === (publicKey?.toString() || '').toLowerCase()
                                );
                                const userHasSigned = normalizedUserSigned || rawUserSigned;
                                
                                // CRITICAL: Don't show sign button if proposal is executing or executed
                                const isExecutingOrExecuted = payoutData.proposalStatus === 'EXECUTING' || 
                                                               payoutData.proposalStatus === 'EXECUTED' ||
                                                               !!payoutData.proposalExecutedAt;
                                
                                const shouldShowButton = hasProposalId && !userHasSigned && !isExecutingOrExecuted;
                                
                                console.log('🔍 TIE Sign Button Debug:', {
                                  hasProposalId,
                                  proposalId: payoutData?.proposalId,
                                  userHasSigned,
                                  normalizedUserSigned,
                                  rawUserSigned,
                                  playerProposalSigners,
                                  rawSigners,
                                  publicKey: publicKey?.toString(),
                                  shouldShowButton,
                                  proposalStatus: payoutData.proposalStatus,
                                  needsSignatures: payoutData.needsSignatures,
                                  isExecutingOrExecuted,
                                  isPlayer1: publicKey?.toString() === payoutData.player1,
                                  isPlayer2: publicKey?.toString() === payoutData.player2,
                                  winner: payoutData.winner,
                                  rawProposalSigners: payoutData.proposalSigners,
                                  normalizedSigners: playerProposalSigners,
                                  isStaleFallback: (payoutData as any)._isStaleFallback
                                });
                                
                                // Show Proposal sign button if user hasn't signed Proposal yet
                                if (!shouldShowButton) {
                                  // Show warning if using stale data and button would be hidden
                                  if ((payoutData as any)._isStaleFallback && !userHasSigned && hasProposalId) {
                                    return (
                                      <div className="text-yellow-500 text-sm mt-2">
                                        ⚠️ Unable to verify signature status. Please refresh the page.
                                      </div>
                                    );
                                  }
                                  return null;
                                }

                                // CRITICAL FIX: Disable button if user has signed OR if currently signing
                                const isButtonDisabled = signingProposal || userHasSigned;
                                
                                return (
                                  <button
                                    onClick={handleSignProposal}
                                    disabled={isButtonDisabled}
                                    className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                  >
                                    {signingProposal ? 'Signing...' : userHasSigned ? '✓ Signed - Processing...' : 'Sign Proposal to Claim Refund'}
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                      </div>
                    ) : (
                        <div className="text-white">
                          <div className="text-3xl font-bold text-red-400 mb-3 animate-pulse">
                            😔 YOU LOST
                          </div>
                          <p className="text-lg text-white/90 mb-2 font-semibold">Better luck next time!</p>
                          {payoutData.bonus?.eligible && (
                            <div className="text-white/50 text-xs mb-3">
                              Win your next {getBonusTierLabel(payoutData.bonus.tier)} match to grab an extra +${payoutData.bonus.expectedUSD?.toFixed(2)} platform bonus.
                            </div>
                          )}
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="mb-3">
                              <div className="text-green-400 text-lg font-semibold mb-2">
                                ✅ Winner has been paid
                              </div>
                              {(payoutData.proposalTransactionId || payoutData.payoutSignature) && (
                                <a
                                  href={`https://explorer.solana.com/tx/${payoutData.proposalTransactionId || payoutData.payoutSignature}?cluster=devnet`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-accent hover:text-yellow-300 text-sm underline inline-flex items-center gap-1"
                                >
                                  View Execution Transaction ↗
                                </a>
                              )}
                            </div>
                          ) : (payoutData.proposalStatus === 'EXECUTING' || payoutData.proposalStatus === 'READY_TO_EXECUTE' || (payoutData.proposalStatus === 'APPROVED' && payoutData.needsSignatures === 0 && !payoutData.proposalExecutedAt)) ? (
                            <div className="mb-3">
                              <div className="flex items-center gap-2 text-yellow-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400"></div>
                                <span>Payout Executing...</span>
                              </div>
                              <p className="text-sm text-white/70 mb-2">
                                The winner's payout is being processed on the blockchain. This usually takes 10-30 seconds.
                                {executionStartTime && (
                                  <span className="ml-2 text-white/50 text-xs">
                                    ({Math.floor((Date.now() - executionStartTime) / 1000)}s elapsed)
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-white/50 italic">
                                No action needed from you - the transaction is executing automatically.
                              </p>
                            </div>
                          ) : playerProposalSigners.length > 0 && !playerProposalSigners.includes(publicKey?.toString() || '') ? (
                            <div className="mb-3">
                              <div className="text-green-400 text-sm font-semibold mb-2">
                                ✅ Other player has signed
                              </div>
                              <p className="text-sm text-white/70">
                                The payout proposal is ready to execute. No action needed from you.
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm text-white/80 mb-3">
                              Waiting for the winner to sign the payout proposal...
                            </p>
                          )}
                          
                          {(payoutData.proposalStatus === 'ACTIVE' || payoutData.proposalStatus === 'PROPOSAL_CREATED' || !payoutData.proposalStatus || payoutData.proposalStatus === 'PENDING') && 
                           (payoutData.needsSignatures === undefined || payoutData.needsSignatures === null || payoutData.needsSignatures > 0) &&
                           playerProposalSigners.length === 0 && (
                            <div className="mt-4">
                              <p className="text-sm text-white/60 mb-2">
                                ⏳ Waiting for winner to sign the payout proposal...
                              </p>
                            </div>
                          )}
                        </div>
                    )}
                  </div>
                </div>
                ) : (
                  <div className="bg-secondary bg-opacity-10 border border-accent rounded-lg p-6">
                    <div className="text-center">
                      {(() => {
                        // New smart-contract payout path: no proposal to create or sign.
                        if (payoutData?.isSmartContractPayout && !payoutData?.proposalId) {
                          const isTie = payoutData.isTie || payoutData.winner === 'tie';
                          const didWin = !!payoutData.won && !isTie;

                          // Base pricing information (from match data or derived)
                          const solPrice =
                            (payoutData as any).solPriceAtTransaction ??
                            (payoutData as any).solPrice ??
                            FALLBACK_SOL_PRICE_USD; // e.g. 125

                          // Entry fee in SOL (from payoutData or derived from refund + fee)
                          const rawEntryFeeSol =
                            typeof payoutData.entryFee === 'string'
                              ? Number(payoutData.entryFee)
                              : payoutData.entryFee ?? null;

                          const refundSolRaw =
                            typeof payoutData.refundAmount === 'string'
                              ? Number(payoutData.refundAmount)
                              : payoutData.refundAmount ?? null;

                          const feeAmountRaw =
                            typeof payoutData.feeAmount === 'string'
                              ? Number(payoutData.feeAmount)
                              : payoutData.feeAmount ?? null;

                          const perPlayerFeeSol =
                            feeAmountRaw != null && isTie ? feeAmountRaw / 2 : null;

                          // SOL amounts from on-chain / SQL data
                          const winnerSol =
                            typeof payoutData.winnerAmount === 'string'
                              ? Number(payoutData.winnerAmount)
                              : payoutData.winnerAmount ??
                                (payoutData as any).payoutResult?.winnerAmount ??
                                null;

                          const refundSol = refundSolRaw;

                          // Derive entry fee in SOL from best available data
                          let entryFeeSol = rawEntryFeeSol;

                          // 1) Tie case: derive from refund + per-player fee
                          if ((!entryFeeSol || entryFeeSol === 0) && refundSolRaw != null && perPlayerFeeSol != null) {
                            entryFeeSol = refundSolRaw + perPlayerFeeSol;
                          }

                          // 2) Winner case: back-solve entry fee from on-chain winner amount
                          // winnerSol = 2 * entryFeeSol * 0.95  => entryFeeSol = winnerSol / (2 * 0.95)
                          if (
                            (!entryFeeSol || entryFeeSol === 0) &&
                            !isTie &&
                            winnerSol != null &&
                            winnerSol > 0
                          ) {
                            entryFeeSol = winnerSol / (2 * 0.95);
                          }

                          // Clean entry-fee tier and winnings USD
                          // CRITICAL: For smart-contract payouts, always derive from SOL + solPrice
                          // to ensure stable 5/20/50/100 tiers, ignoring any raw DB USD values.
                          const roundedEntryFeeUsd =
                            entryFeeSol && solPrice
                              ? getExpectedEntryFeeUSD(entryFeeSol, solPrice) // snaps to 5/20/50/100
                              : null;

                          const cleanUsdWinnings =
                            didWin && roundedEntryFeeUsd != null
                              ? (roundedEntryFeeUsd * 2 * 0.95).toFixed(2)
                              : null;

                          // 95% of combined entry fees in SOL (for display alongside USD)
                          const combinedEntrySol = entryFeeSol != null ? entryFeeSol * 2 : null;
                          const ninetyFivePctSol =
                            combinedEntrySol != null ? combinedEntrySol * 0.95 : winnerSol ?? null;

                          return (
                            <div>
                              <div className="text-accent text-lg font-semibold mb-2">
                                ✅ On-Chain Payout Completed
                              </div>

                              {/* Winner view */}
                              {!isTie && didWin && winnerSol != null && winnerSol > 0 && (
                                <p className="text-white text-sm mb-1">
                                  You received{' '}
                                  {cleanUsdWinnings && (
                                    <>
                                      <span className="font-semibold">${cleanUsdWinnings} USD</span>,{' '}
                                    </>
                                  )}
                                  <span className="font-semibold">{winnerSol} SOL</span> on-chain.
                                  {roundedEntryFeeUsd != null && (
                                    <>
                                      {' '}
                                      95% of combined entry fees:{' '}
                                      <span className="font-semibold">
                                        ${(roundedEntryFeeUsd * 2 * 0.95).toFixed(2)} USD
                                      </span>
                                      {ninetyFivePctSol != null && ninetyFivePctSol > 0 && (
                                        <> / {ninetyFivePctSol.toFixed(6)} SOL (from {(combinedEntrySol ?? 0).toFixed(4)} SOL pot).</>
                                      )}
                                    </>
                                  )}
                                </p>
                              )}

                              {/* Loser view */}
                              {!isTie && !didWin && winnerSol != null && winnerSol > 0 && (
                                <p className="text-white/80 text-sm mb-1">
                                  You did not receive a payout this match. Your opponent received{' '}
                                  <span className="font-semibold">{winnerSol} SOL</span> on-chain.
                                  {roundedEntryFeeUsd != null && (
                                    <>
                                      {' '}
                                      (95% of combined entry fees:{' '}
                                      <span className="font-semibold">
                                        ${(roundedEntryFeeUsd * 2 * 0.95).toFixed(2)} USD
                                      </span>
                                      {ninetyFivePctSol != null && ninetyFivePctSol > 0 && (
                                        <> / {ninetyFivePctSol.toFixed(6)} SOL (from {(combinedEntrySol ?? 0).toFixed(4)} SOL pot)</>
                                      )}
                                      .
                                    </>
                                  )}
                                </p>
                              )}

                              {/* Tie refund view */}
                              {isTie && refundSol != null && refundSol > 0 && (
                                <p className="text-white text-sm mb-1">
                                  You were refunded <span className="font-semibold">{refundSol} SOL</span> on-chain.
                                  {roundedEntryFeeUsd != null && (
                                    <>
                                      {' '}
                                      95% of entry fee paid:{' '}
                                      <span className="font-semibold">
                                        ${(roundedEntryFeeUsd * 0.95).toFixed(2)} USD
                                      </span>
                                      {entryFeeSol != null && entryFeeSol > 0 && (
                                        <> ({entryFeeSol.toFixed(6)} SOL − ${roundedEntryFeeUsd.toFixed(2)} USD).</>
                                      )}
                                    </>
                                  )}
                                </p>
                              )}

                              {/* Entry fee line */}
                              {(entryFeeSol != null && entryFeeSol > 0) || roundedEntryFeeUsd != null ? (
                                <p className="text-white/70 text-xs mt-1">
                                  Entry fee paid:{' '}
                                  {roundedEntryFeeUsd != null ? `$${roundedEntryFeeUsd} USD` : '—'}{' '}
                                  {entryFeeSol != null && entryFeeSol > 0 ? `(${entryFeeSol} SOL).` : null}
                                </p>
                              ) : null}

                              <p className="text-white/80 text-sm mt-3">
                                Your match result has been settled directly by the smart contract. Your winnings (or refunds)
                                have been handled on-chain. For a full breakdown of this match and its transactions, visit
                                the Match History section from the home page.
                              </p>
                            </div>
                          );
                        }
                        // CRITICAL: Check EXECUTING status first - highest priority
                        const isExecuting = payoutData?.proposalStatus === 'EXECUTING' || 
                                           (payoutData?.needsSignatures === 0 && !payoutData?.proposalExecutedAt);
                        if (isExecuting) {
                          return (
                            <div className="p-4 rounded-lg bg-yellow-500/10 border border-yellow-400/30">
                              <div className="flex items-center justify-center gap-2 text-yellow-400 text-lg font-semibold mb-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-yellow-400 border-t-transparent"></div>
                                <span>Processing Transaction...</span>
                              </div>
                              <p className="text-sm text-white/80 mb-1">
                                The payout transaction is being processed on the blockchain.
                              </p>
                              {executionStartTime && (
                                <p className="text-xs text-white/50">
                                  {executionElapsedSeconds}s elapsed
                                </p>
                              )}
                            </div>
                          );
                        }
                        // Check EXECUTED status
                        if (payoutData?.proposalStatus === 'EXECUTED') {
                          return (
                            <div className="text-green-400 text-lg font-semibold">
                              ✅ Transaction Executed
                            </div>
                          );
                        }
                        // Check if proposal exists and has a valid status (not PENDING)
                        if (payoutData?.proposalId && payoutData?.proposalStatus && payoutData?.proposalStatus !== 'PENDING') {
                          return (
                            <div>
                              <div className="flex items-center justify-center mb-3">
                                <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent border-t-transparent mr-2"></div>
                                <div className="text-accent text-lg font-semibold">
                                  ⏳ Waiting for Signature
                                </div>
                              </div>
                              <p className="text-white/70 text-sm">
                                {payoutData.needsSignatures > 0 
                                  ? `Waiting for ${payoutData.needsSignatures} signature${payoutData.needsSignatures !== 1 ? 's' : ''}...`
                                  : 'Proposal ready for execution...'}
                              </p>
                            </div>
                          );
                        }
                        // Default: Creating Proposal
                        return (
                          <div>
                            <div className="flex items-center justify-center mb-4">
                              <div className="animate-spin rounded-full h-6 w-6 border-2 border-accent border-t-transparent mr-3"></div>
                              <div className="text-accent text-lg font-semibold">
                                Creating Secure Proposal
                              </div>
                            </div>
                            {/* Progress bar for proposal creation */}
                            <div className="mb-4">
                              <div className="w-full bg-white/10 rounded-full h-2 mb-2">
                                <div 
                                  className="bg-accent h-2 rounded-full transition-all duration-500 ease-out"
                                  style={{ width: `${proposalCreationProgress}%` }}
                                ></div>
                              </div>
                              <p className="text-white/60 text-xs">
                                {Math.round(proposalCreationProgress)}% complete
                                {proposalCreationStartTime && (
                                  <span className="ml-2 text-white/40">
                                    ({Math.floor((Date.now() - proposalCreationStartTime) / 1000)}s)
                                  </span>
                                )}
                              </p>
                            </div>
                            <p className="text-white/70 text-sm">
                              Setting up your secure payout on the blockchain. This usually takes 15-30 seconds.
                            </p>
                            {proposalCreationProgress >= 95 && proposalCreationStartTime && (Date.now() - proposalCreationStartTime) > 90000 && (
                              <p className="text-yellow-400 text-xs mt-2">
                                ⚠️ Taking longer than expected. Please refresh if this persists.
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col gap-4 items-center">
                <button
                  onClick={handlePlayAgain}
                  disabled={
                    payoutData?.isSmartContractPayout
                      ? false
                      : (!payoutData?.proposalExecutedAt || 
                         payoutData?.proposalStatus !== 'EXECUTED' ||
                         onChainVerified !== true)
                  }
                  className={`
                    ${payoutData?.isSmartContractPayout
                      ? 'bg-accent hover:bg-yellow-400 hover:shadow-lg'
                      : (!payoutData?.proposalExecutedAt || payoutData?.proposalStatus !== 'EXECUTED' || onChainVerified !== true
                          ? 'bg-gray-600 cursor-not-allowed opacity-50'
                          : 'bg-accent hover:bg-yellow-400 hover:shadow-lg')
                    } text-primary px-8 py-3.5 rounded-lg font-bold transition-all duration-200 transform hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center
                  `}
                >
                  {payoutData?.isSmartContractPayout
                    ? 'Play Again'
                    : (!payoutData?.proposalExecutedAt || payoutData?.proposalStatus !== 'EXECUTED' || onChainVerified !== true
                        ? (onChainVerified === null ? 'Verifying Transaction...' : 'Waiting for Execution...')
                        : 'Play Again')}
                </button>
                
                {/* Social Links */}
                <div className="flex gap-3 justify-center items-center mt-2">
                  <a
                    href="https://discord.gg/CcXWUv7r"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium px-4 py-2 rounded-lg shadow border border-indigo-500/30 hover:border-indigo-400/50 transition-all duration-200 min-h-[36px] flex items-center justify-center gap-1.5"
                  >
                    <span>💬</span>
                    <span>Discord</span>
                  </a>
                  <a
                    href="https://instagram.com/Guess5.io"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white text-xs font-medium px-4 py-2 rounded-lg shadow border border-purple-500/30 hover:border-purple-400/50 transition-all duration-200 min-h-[36px] flex items-center justify-center gap-1.5"
                  >
                    <span>📷</span>
                    <span>@Guess5.io</span>
                  </a>
                </div>
              </div>
              
              {/* Match ID and Transaction ID Footer */}
              <div className="mt-6 pt-4 border-t border-white/10">
                <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-white/40">
                  {router.query.matchId && (
                    <span className="font-mono">
                      Match: {String(router.query.matchId).slice(0, 8)}...
                    </span>
                  )}
                  {payoutData?.payoutSignature && (
                    <span className="font-mono">
                      TX: {payoutData.payoutSignature.slice(0, 8)}...
                    </span>
                  )}
                  {payoutData?.proposalTransactionId && !payoutData?.payoutSignature && (
                    <span className="font-mono">
                      TX: {payoutData.proposalTransactionId.slice(0, 8)}...
                    </span>
                  )}
                  {payoutData?.refundTxHash && (
                    <span className="font-mono">
                      Refund TX: {payoutData.refundTxHash.slice(0, 8)}...
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Result; 