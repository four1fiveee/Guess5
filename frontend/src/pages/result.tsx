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
      // If proposal is executed or has transaction ID, stop polling
      if (info.proposalTransactionId || normalizedStatus === 'EXECUTED') {
        return false;
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
        if (normalizedStatus !== 'EXECUTED' && !info.proposalTransactionId) {
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

    // Continue polling if proposal is active or pending
    return normalizedStatus === 'ACTIVE' || normalizedStatus === 'PENDING';
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
          
          if (isCompleted) {
            // Get player results from match data
            const isPlayer1 = publicKey?.toString() === matchData.player1;
            const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
            const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
            
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
            const extractedProposalId = matchData.payoutProposalId || matchData.tieRefundProposalId;
            
            console.log('🔍 CRITICAL DEBUG: Proposal ID extraction:', {
              matchId,
              payoutProposalId: matchData.payoutProposalId,
              tieRefundProposalId: matchData.tieRefundProposalId,
              extractedProposalId,
              proposalStatus: matchData.proposalStatus,
              winner: matchData.winner
            });
            
            const payoutData = {
              won: matchData.winner === publicKey?.toString() && matchData.winner !== 'tie',
              isTie: matchData.winner === 'tie',
              winner: matchData.winner,
              numGuesses: playerResult?.numGuesses || 0,
              entryFee: matchData.entryFee || 0,
              timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : 'N/A',
              opponentTimeElapsed: opponentResult ? `${Math.floor(opponentResult.totalTime / 1000)}s` : 'N/A',
              opponentGuesses: opponentResult?.numGuesses || 0,
              winnerAmount: matchData.payout?.winnerAmount || 0,
              feeAmount: matchData.payout?.feeAmount || 0,
              refundAmount: matchData.payout?.refundAmount || 0,
              isWinningTie: matchData.payout?.isWinningTie || false,
              feeWallet: matchData.payout?.feeWallet || '',
              transactions: matchData.payout?.transactions || [],
              vaultAddress: matchData.squadsVaultAddress || matchData.vaultAddress,
              vaultDepositAddress: matchData.squadsVaultPda || matchData.vaultPda || null,
              proposalId: extractedProposalId,
              proposalStatus: matchData.proposalStatus,
              proposalSigners: normalizeProposalSigners(matchData.proposalSigners),
              needsSignatures: matchData.needsSignatures || 0,
              proposalExecutedAt: matchData.proposalExecutedAt,
              proposalTransactionId: matchData.proposalTransactionId,
              automatedPayout: matchData.payout?.paymentSuccess || false,
              payoutSignature: matchData.payout?.transactions?.[0]?.signature || matchData.proposalTransactionId || null,
              bonus: {
                eligible: expectedBonusUsd > 0,
                paid: !!bonusInfo.paid,
                amountSol: bonusAmountSol,
                amountUSD: bonusAmountUsd,
                percent: bonusInfo.percent ? Number(bonusInfo.percent) : 0,
                tier: bonusInfo.tier || null,
                signature: bonusInfo.signature || null,
                paidAt: bonusInfo.paidAt ? new Date(bonusInfo.paidAt) : null,
                expectedUSD: expectedBonusUsd || 0,
                expectedSol: expectedBonusSol || 0
              },
              totalPayoutSol:
                matchData.winner === publicKey?.toString() && matchData.winner !== 'tie'
                  ? (matchData.payout?.winnerAmount || 0) + bonusAmountSol
                  : matchData.payout?.winnerAmount || 0,
              refundReason: matchData.refundReason || null,
              matchOutcome: matchData.matchOutcome || matchData.status || null,
              rawStatus: matchData.status || null
            };
            
            setPayoutData(payoutData);
            setLoading(false);
            
            // CRITICAL FIX: Set proposal creation start time based on when match was completed, not when player arrived
            // This ensures both players see the same progress percentage
            if (bothPlayersHaveResults && !proposalCreationStartTime && !payoutData.proposalId) {
              // Use current time minus a small offset to account for the time it took to detect completion
              // This ensures the progress bar starts from a reasonable point for both players
              const matchCompletionTime = Date.now() - 2000; // Assume match completed 2 seconds ago
              setProposalCreationStartTime(matchCompletionTime);
              console.log('📊 Setting proposal creation start time based on match completion', {
                matchId,
                matchCompletionTime: new Date(matchCompletionTime).toISOString(),
                bothPlayersHaveResults,
                note: 'This ensures both players see consistent progress percentages'
              });
            }
            // CRITICAL: Always stop loading even if proposal doesn't exist yet
            // This prevents the spinning wheel from blocking the UI
            // CRITICAL FIX: Continue polling until proposal is executed or user has signed
            const keepPolling = shouldContinuePolling(payoutData);
            console.log('🔄 Polling Decision (API):', {
              matchId: router.query.matchId,
              keepPolling,
              proposalId: payoutData.proposalId,
              proposalStatus: payoutData.proposalStatus,
              bothPlayersHaveResults,
              isPolling: isPolling,
              extractedProposalId
            });
            
            setIsPolling(keepPolling);
            if (!keepPolling) {
              stopRefreshLoops();
            } else if (!payoutData.proposalId) {
              // CRITICAL: If no proposalId yet, ensure polling is active
              // This ensures both players see the signing button as soon as proposal is created
              setIsPolling(true);
            }

            // CRITICAL FIX: Auto-refresh when proposal becomes available to sign
            // This fixes the issue where users need to manually refresh to see the sign button
            const userHasSigned = playerProposalSigners.includes(publicKey?.toString() || '');
            const proposalReadyToSign = payoutData.proposalId && !userHasSigned && payoutData.proposalStatus !== 'EXECUTED' && !payoutData.proposalExecutedAt;
            
            if (proposalReadyToSign) {
              console.log('🔄 Proposal is available but user hasn\'t signed yet - triggering page refresh', {
                proposalId: payoutData.proposalId,
                needsSignatures: payoutData.needsSignatures,
                proposalStatus: payoutData.proposalStatus,
                userHasSigned,
                proposalExecutedAt: payoutData.proposalExecutedAt,
              });
              
              // REMOVED: No more automatic page reload - let React update naturally
              console.log('✅ Proposal detected, React will update UI automatically');
            }
            return;
          } else {
            console.log('⏳ Game not yet completed, falling back to localStorage');
          }
        } else {
          console.error('❌ Failed to fetch match data from backend, falling back to localStorage', {
            status: response.status,
            statusText: response.statusText,
          });
          // If it's a CORS error or network error, don't fail completely - try localStorage
          // The polling will retry later
        }
      } catch (error) {
        console.error('❌ Error fetching match data, falling back to localStorage:', error);
        // CORS/network errors are non-fatal - continue with localStorage and polling will retry
        // Don't set error state for network issues
      }
    }

    // Fallback to localStorage if no matchId or backend fetch failed
    const storedPayoutData = localStorage.getItem('payoutData');
    if (storedPayoutData) {
      try {
        const data = JSON.parse(storedPayoutData);
        
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
        
        setPayoutData(data);
        setLoading(false);
        // CRITICAL FIX: Continue polling until proposal is executed or user has signed
        const keepPolling = shouldContinuePolling(data);
        console.log('🔄 Polling Decision (API):', {
          matchId: router.query.matchId,
          keepPolling,
          proposalId: data.proposalId,
          proposalStatus: data.proposalStatus,
          bothPlayersHaveResults: data.player1Result && data.player2Result,
          isPolling: isPolling
        });
        
        setIsPolling(keepPolling);
        if (!keepPolling) {
          stopRefreshLoops();
        } else if (!data.proposalId) {
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
    if (!proposalCreationStartTime || payoutData?.proposalId) {
      setProposalCreationProgress(100); // Complete if we have a proposal
      return;
    }

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - proposalCreationStartTime;
      const maxTime = 45000; // 45 seconds max expected time
      const progress = Math.min((elapsed / maxTime) * 100, 95); // Cap at 95% until actual completion
      setProposalCreationProgress(progress);
    }, 500);

    return () => clearInterval(progressInterval);
  }, [proposalCreationStartTime, payoutData?.proposalId]);

  // Poll for proposal updates when polling is active
  // Expert recommendation: More aggressive polling when game is active
  useEffect(() => {
    if (!isPolling || !router.query.matchId || !publicKey) {
      return;
    }
    
    // Smart polling: 1s until proposal exists, then 3s for signatures
    const hasProposal = !!payoutData?.proposalId;
    const baseInterval = hasProposal ? 3000 : 1000; // Slower polling once we have proposal
    
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
    
    const pollInterval = setInterval(() => {
      pollCount++;
      const currentInterval = hasProposal ? 3000 : 1000; // Consistent with base interval
      
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
    if (payoutData) {
      console.log('💰 Payout data in render:', {
        won: payoutData.won,
        isTie: payoutData.isTie,
        isWinningTie: payoutData.isWinningTie,
        refundAmount: payoutData.refundAmount,
        proposalId: payoutData.proposalId,
        bonus: payoutData.bonus
      });
    }
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
    if (!payoutData?.proposalId || !payoutData?.vaultAddress || !publicKey || !signTransaction) {
      setError('Missing required data for proposal signing');
      return;
    }

    setSigningProposal(true);
    setError(null);
    
    try {
      // Get the approval transaction from backend (backend has access to rpc.vaultTransactionApprove)
      const matchId = router.query.matchId as string;
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
      
      console.log('🖊️ Preparing to sign proposal', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData.proposalId,
        vaultAddress: payoutData.vaultAddress,
        vaultDepositAddress: payoutData.vaultDepositAddress,
      });
      
      // Step 1: Get the transaction from backend
      const getTxResponse = await fetch(`${apiUrl}/api/match/get-proposal-approval-transaction?matchId=${matchId}&wallet=${publicKey.toString()}`);
      
      if (!getTxResponse.ok) {
        const errorData = await getTxResponse.json();
        throw new Error(errorData.error || 'Failed to get approval transaction');
      }
      
      const txData = await getTxResponse.json();
      
      // CRITICAL: Sign BOTH proposal AND vault transaction (expert recommendation)
      // Squads v4 requires both to be signed for ExecuteReady
      const { VersionedTransaction } = await import('@solana/web3.js');
      
      // Step 2a: Sign proposal approval transaction
      const bytes = base64ToUint8Array(txData.transaction);
      const approveTx = VersionedTransaction.deserialize(bytes);
      const signedProposalTx = await signTransaction(approveTx);
      const proposalSerialized = signedProposalTx.serialize();
      const base64ProposalTx = uint8ArrayToBase64(proposalSerialized);
      
      console.log('✅ Proposal transaction signed', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData.proposalId,
      });
      
      // NOTE: Vault transactions do NOT require approval in Squads v4
      // Only Proposals require signatures. VaultTransaction automatically becomes ExecuteReady
      // when the linked Proposal reaches ExecuteReady.
      
      // Step 3: Send signed proposal transaction to backend
      console.log('📤 Submitting signed proposal transaction to backend', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData.proposalId,
        hasProposalTx: !!base64ProposalTx,
      });
      
      const response = await fetch(`${apiUrl}/api/match/sign-proposal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          matchId,
          wallet: publicKey.toString(),
          signedTransaction: base64ProposalTx, // Proposal approval only
        }),
      });
      
      // CRITICAL: Log detailed error information if request fails (expert recommendation)
      if (!response.ok) {
        const errorText = await response.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Unknown error' };
        }
        
        console.error('❌ Backend sign-proposal failed', {
          matchId,
          wallet: publicKey.toString(),
          status: response.status,
          statusText: response.statusText,
          error: errorData.error || errorData,
          responseHeaders: Object.fromEntries(response.headers.entries()),
        });
        
        throw new Error(errorData.error || `Failed to sign proposal: ${response.status} ${response.statusText}`);
      }
      
      const result = await response.json();
      // CRITICAL: Only log success after backend confirms (expert recommendation)
      console.log('✅ Proposal signed & backend confirmed', {
        matchId,
        wallet: publicKey.toString(),
        proposalId: payoutData.proposalId,
        response: result,
        backendStatus: response.status,
      });
      
      // Refresh payout data (non-critical - if this fails, signing was still successful)
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
            
            const updatedPayoutData = {
              ...payoutData,
              won: matchData.winner === publicKey.toString() && matchData.winner !== 'tie',
              isTie: matchData.winner === 'tie',
              winner: matchData.winner,
              numGuesses: playerResult?.numGuesses || 0,
              entryFee: matchData.entryFee || (() => {
                // Try to get from localStorage as fallback
                const storedFee = localStorage.getItem('entryFee');
                return storedFee ? Number(storedFee) : 0;
              })(),
              timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : 'N/A',
              opponentTimeElapsed: opponentResult ? `${Math.floor(opponentResult.totalTime / 1000)}s` : 'N/A',
              opponentGuesses: opponentResult?.numGuesses || 0,
              winnerAmount: matchData.payout?.winnerAmount || 0,
              feeAmount: matchData.payout?.feeAmount || 0,
              refundAmount: matchData.payout?.refundAmount || 0,
              isWinningTie: matchData.payout?.isWinningTie || false,
              feeWallet: matchData.payout?.feeWallet || '',
              transactions: matchData.payout?.transactions || [],
              proposalId: matchData.payoutProposalId || matchData.tieRefundProposalId,
              proposalStatus: matchData.proposalStatus,
              proposalSigners: normalizeProposalSigners(matchData.proposalSigners),
              needsSignatures: matchData.needsSignatures || 0,
              proposalExecutedAt: matchData.proposalExecutedAt,
              proposalTransactionId: matchData.proposalTransactionId,
              automatedPayout: matchData.payout?.paymentSuccess || false,
              payoutSignature: matchData.payout?.transactions?.[0]?.signature || matchData.proposalTransactionId || null,
              refundReason: matchData.refundReason || null,
              matchOutcome: matchData.matchOutcome || matchData.status || null,
              rawStatus: matchData.status || null
            };
            
            setPayoutData(updatedPayoutData);
            
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
          }
        } else {
          console.warn('⚠️ Failed to refresh status after signing (non-critical)', {
            status: statusResponse.status,
            statusText: statusResponse.statusText,
          });
        }
        } catch (statusError) {
          // Status refresh failure is non-critical - signing was successful
          console.warn('⚠️ Error refreshing status after signing (non-critical):', statusError);
          // Don't set error - signing was successful, status refresh is just for UI update
        }
      }
    } catch (err) {
      console.error('❌ Error signing proposal:', err);
      // Only set error if it's actually a signing error, not a status refresh error
      const errorMessage = err instanceof Error ? err.message : 'Failed to sign proposal';
      // Check if it's a CORS or network error (likely status refresh issue)
      if (errorMessage.includes('Failed to fetch') || errorMessage.includes('CORS')) {
        console.warn('⚠️ Network/CORS error after signing - signing may have succeeded, check status');
        // Don't show error to user - signing likely succeeded, just status refresh failed
      } else {
        setError(errorMessage);
      }
    } finally {
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
    payoutData.winner === 'cancelled' ||
    (!!payoutData.refundReason &&
      !payoutData.won &&
      !payoutData.isTie &&
      payoutData.winner !== playerWallet);

  const readableRefundReason = (() => {
    if (!payoutData.refundReason) return null;
    switch (payoutData.refundReason) {
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
      return {
        emoji: '🤝',
        title: payoutData.isWinningTie ? 'Perfectly Matched' : 'Deadlock Draw',
        subtitle: payoutData.isWinningTie
          ? 'Both players landed identical runs. Refund details are below.'
          : 'Neither player cracked the puzzle this round. Refunds are queued below.',
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
              
              {/* Payout Information - Non-Custodial Proposal System */}
              <div className="mb-6">
                <h2 className="text-xl font-bold text-accent mb-3">Payout Details</h2>
                
                {payoutData && payoutData.proposalId ? (
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
                                  {payoutData.entryFee?.toFixed(4) || '0.0000'} SOL
                                  {solPrice && payoutData.entryFee && (
                                    <span className="text-white/60 text-sm ml-2">
                                      (${(payoutData.entryFee * solPrice).toFixed(2)} USD)
                                    </span>
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
                            <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                              ✅ Refund returned to your wallet!
                            </div>
                          ) : hasRefundProposal ? (
                            <p className="text-sm text-white/80 mb-3">
                              Sign the refund proposal below to release your SOL back to your wallet.
                            </p>
                          ) : null}
                          {readableRefundReason && (
                            <div className="text-white/50 text-xs uppercase tracking-[0.25em] mt-2">
                              Reason: {readableRefundReason}
                            </div>
                          )}
                          {(payoutData.proposalStatus === 'ACTIVE' || payoutData.proposalStatus === 'PROPOSAL_CREATED' || !payoutData.proposalStatus || payoutData.proposalStatus === 'PENDING') && (payoutData.needsSignatures === undefined || payoutData.needsSignatures === null || payoutData.needsSignatures >= 0) && (
                            <div className="mt-4">
                              <p
                                className={`text-sm mb-2 ${
                                  (payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                    ? playerProposalSigners.includes(publicKey?.toString() || '')
                                      ? 'text-green-400 font-semibold'
                                      : playerProposalSigners.length > 0
                                      ? 'text-green-400 font-semibold'
                                      : 'text-green-400 font-semibold'
                                    : playerProposalSigners.includes(publicKey?.toString() || '')
                                    ? 'text-yellow-400'
                                    : playerProposalSigners.length > 0
                                    ? 'text-green-400 font-semibold'
                                    : 'text-white/60'
                                }`}
                              >
                                {(payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                  ? playerProposalSigners.includes(publicKey?.toString() || '')
                                    ? '✓ You have signed. Waiting for refund execution...'
                                    : playerProposalSigners.length > 0
                                    ? '🎉 Other player has signed! Refund is executing shortly.'
                                    : '✅ Refund proposal is ready to execute - waiting for processing...'
                                  : playerProposalSigners.includes(publicKey?.toString() || '')
                                  ? '✓ You have signed. Waiting for refund execution...'
                                  : playerProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Refund will execute soon. No action needed.'
                                  : '⏳ Waiting for either player to sign the refund (only one signature needed)...'}
                              </p>
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {payoutData.proposalId && 
                               !playerProposalSigners.includes(publicKey?.toString() || '') && (
                                <button
                                  onClick={handleSignProposal}
                                  disabled={signingProposal}
                                  className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                >
                                  {signingProposal ? 'Signing...' : 'Sign Refund Proposal'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : payoutData.won ? (
                        <div className="text-white">
                          <div className="text-3xl font-bold text-accent mb-3 animate-bounce">
                            🎉 YOU WON! 🎉
                          </div>
                          <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
                            <div className="text-white/60 text-xs uppercase tracking-[0.25em] mb-1">Entry Fee Paid</div>
                            <div className="text-white text-lg font-semibold">
                              {payoutData.entryFee?.toFixed(4) || '0.0000'} SOL
                              {solPrice && payoutData.entryFee && (
                                <span className="text-white/60 text-sm ml-2">
                                  (${(payoutData.entryFee * solPrice).toFixed(2)} USD)
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="text-4xl font-bold text-yellow-400 mb-2">
                            {payoutData.winnerAmount?.toFixed(4)} SOL
                          </div>
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
                                    House Bonus
                                  </span>
                                </div>
                                {payoutData.bonus.paid ? (
                                  <>
                                    <div className="text-green-300 font-bold text-lg">
                                      +{payoutData.bonus.amountSol?.toFixed(4)} SOL
                                      {payoutData.bonus.amountUSD
                                        ? ` ($${payoutData.bonus.amountUSD.toFixed(2)})`
                                        : ''}
                                    </div>
                                    {payoutData.totalPayoutSol && (
                                      <div className="text-white/70 text-xs">
                                        Total received: {payoutData.totalPayoutSol.toFixed(4)} SOL
                                        {solPrice && ` ($${(payoutData.totalPayoutSol * solPrice).toFixed(2)} USD)`}
                                      </div>
                                    )}
                                    {payoutData.bonus.signature && (
                                      <a
                                        href={`https://explorer.solana.com/tx/${payoutData.bonus.signature}?cluster=devnet`}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="text-accent text-xs underline hover:text-yellow-300"
                                      >
                                        View bonus transaction ↗
                                      </a>
                                    )}
                                  </>
                                ) : (
                                  <div className="text-yellow-300 text-sm text-center">
                                    Bonus triggered! +{payoutData.bonus.expectedSol?.toFixed(4)} SOL arriving when the proposal executes.
                                  </div>
                                )}
                              </div>
                            </div>
                          ) : (
                            <div className="text-white/40 text-xs mb-3">
                              Play higher tiers to unlock our house bonus boosts.
                            </div>
                          )}
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                              ✅ Payment Sent to Your Wallet!
                              {payoutData.bonus?.eligible && actualBonusAmount !== null && (
                                <div className="text-green-300 text-sm mt-2">
                                  Bonus: +{actualBonusAmount.toFixed(4)} SOL
                                  {solPrice && ` (+$${(actualBonusAmount * solPrice).toFixed(2)} USD)`}
                                </div>
                              )}
                            </div>
                          ) : (
                          <p className="text-sm text-white/80 mb-3">
                              You must sign to claim your winnings before starting a new game. Sign the proposal below to receive your payout.
                              {payoutData.bonus?.eligible && payoutData.bonus?.expectedSol && (
                                <span className="block mt-1 text-yellow-300">
                                  Bonus: +{payoutData.bonus.expectedSol.toFixed(4)} SOL
                                  {solPrice && ` (+$${(payoutData.bonus.expectedSol * solPrice).toFixed(2)} USD)`} will be sent when proposal executes.
                                </span>
                              )}
                          </p>
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
                                {(payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                  ? playerProposalSigners.includes(publicKey?.toString() || '')
                                    ? '✓ You have signed. Waiting for proposal execution...'
                                    : playerProposalSigners.length > 0
                                      ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                      : '✅ Proposal is ready to execute - waiting for processing...'
                                  : playerProposalSigners.includes(publicKey?.toString() || '')
                                    ? '✓ You have signed. Waiting for proposal execution...'
                                    : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {(() => {
                                const hasProposalId = !!payoutData.proposalId;
                                const userHasSigned = playerProposalSigners.includes(publicKey?.toString() || '');
                                const shouldShowButton = hasProposalId && !userHasSigned;
                                
                                console.log('🔍 WINNER Sign Button Debug:', {
                                  hasProposalId,
                                  proposalId: payoutData.proposalId,
                                  userHasSigned,
                                  playerProposalSigners,
                                  publicKey: publicKey?.toString(),
                                  shouldShowButton,
                                  proposalStatus: payoutData.proposalStatus,
                                  needsSignatures: payoutData.needsSignatures,
                                  isPlayer1: publicKey?.toString() === payoutData.player1,
                                  isPlayer2: publicKey?.toString() === payoutData.player2,
                                  winner: payoutData.winner,
                                  rawProposalSigners: payoutData.proposalSigners,
                                  normalizedSigners: playerProposalSigners
                                });
                                
                                // Show Proposal sign button if user hasn't signed Proposal yet
                                if (!shouldShowButton) {
                                  return null;
                                }

                                return (
                                  <button
                                    onClick={handleSignProposal}
                                    disabled={signingProposal}
                                    className="bg-accent hover:bg-yellow-400 disabled:bg-gray-600 disabled:cursor-not-allowed text-primary font-bold py-2.5 px-6 rounded-lg transition-all duration-200 shadow hover:shadow-lg transform hover:scale-105 active:scale-95 min-h-[44px] flex items-center justify-center mx-auto"
                                  >
                                    {signingProposal ? (
                                      <>
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                                        Signing...
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
                                  {payoutData.entryFee?.toFixed(4) || '0.0000'} SOL
                                  {solPrice && payoutData.entryFee && (
                                    <span className="text-white/60 text-sm ml-2">
                                      (${(payoutData.entryFee * solPrice).toFixed(2)} USD)
                                    </span>
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
                              ) : (
                                <p className="text-sm text-white/80 mb-3">
                                  You must sign to receive your refund. Full refund: Sign proposal to claim your funds back.
                            </p>
                              )}
                          </>
                        ) : (
                          <>
                              <div className="mb-3 p-3 rounded-lg bg-white/5 border border-white/10">
                                <div className="text-white/60 text-xs uppercase tracking-[0.25em] mb-1">Entry Fee Paid</div>
                                <div className="text-white text-lg font-semibold">
                                  {payoutData.entryFee?.toFixed(4) || '0.0000'} SOL
                                  {solPrice && payoutData.entryFee && (
                                    <span className="text-white/60 text-sm ml-2">
                                      (${(payoutData.entryFee * solPrice).toFixed(2)} USD)
                                    </span>
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
                              {payoutData.entryFee && payoutData.refundAmount && (
                                <div className={`text-sm mb-2 ${
                                  Math.abs(payoutData.entryFee * 0.95 - payoutData.refundAmount) < 0.0001
                                    ? 'text-green-400'
                                    : 'text-yellow-400'
                                }`}>
                                  {Math.abs(payoutData.entryFee * 0.95 - payoutData.refundAmount) < 0.0001
                                    ? `✅ 95% refund verified (${(payoutData.entryFee * 0.95).toFixed(4)} SOL expected)`
                                    : `⚠️ Refund differs from expected 95% (${(payoutData.entryFee * 0.95).toFixed(4)} SOL) by ${Math.abs((payoutData.entryFee * 0.95) - payoutData.refundAmount).toFixed(4)} SOL. Entry fee: ${payoutData.entryFee.toFixed(4)} SOL, Refund: ${payoutData.refundAmount.toFixed(4)} SOL`}
                                </div>
                              )}
                              {payoutData.proposalStatus === 'EXECUTED' ? (
                                <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                                  ✅ 95% Refund Sent to Your Wallet!
                                </div>
                              ) : (
                                <p className="text-sm text-white/80 mb-3">
                                  You must sign to receive your refund. 95% refund: Sign proposal to claim your funds back.
                            </p>
                              )}
                          </>
                        )}
                          
                          {payoutData.bonus?.eligible && (
                            <div className="text-white/50 text-xs mb-3">
                              House bonus sparks only on wins—secure the next {getBonusTierLabel(payoutData.bonus.tier)} victory to unlock +${payoutData.bonus.expectedUSD?.toFixed(2)}.
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
                                {(payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                  ? '✅ Proposal is ready to execute - waiting for processing...'
                                  : playerProposalSigners.includes(publicKey?.toString() || '')
                                  ? '✓ You have signed. Waiting for proposal execution...'
                                  : playerProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                  : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {(() => {
                                const hasProposalId = !!payoutData.proposalId;
                                const userHasSigned = playerProposalSigners.includes(publicKey?.toString() || '');
                                const shouldShowButton = hasProposalId && !userHasSigned;
                                
                                console.log('🔍 TIE Sign Button Debug:', {
                                  hasProposalId,
                                  proposalId: payoutData.proposalId,
                                  userHasSigned,
                                  playerProposalSigners,
                                  publicKey: publicKey?.toString(),
                                  shouldShowButton,
                                  proposalStatus: payoutData.proposalStatus,
                                  needsSignatures: payoutData.needsSignatures,
                                  isPlayer1: publicKey?.toString() === payoutData.player1,
                                  isPlayer2: publicKey?.toString() === payoutData.player2,
                                  winner: payoutData.winner,
                                  rawProposalSigners: payoutData.proposalSigners,
                                  normalizedSigners: playerProposalSigners
                                });
                                
                                // Show Proposal sign button if user hasn't signed Proposal yet
                                if (!shouldShowButton) {
                                  return null;
                                }

                                return (
                                  <button
                                    onClick={handleSignProposal}
                                    disabled={signingProposal}
                                    className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                  >
                                    {signingProposal ? 'Signing...' : 'Sign Proposal to Claim Refund'}
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
                              Win your next {getBonusTierLabel(payoutData.bonus.tier)} match to grab an extra +${payoutData.bonus.expectedUSD?.toFixed(2)} house bonus.
                            </div>
                          )}
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="text-green-400 text-lg font-semibold mb-3">
                              ✅ Winner has been paid. You can play again!
                            </div>
                          ) : (
                            <p className="text-sm text-white/80 mb-3">
                              You must sign to finalize the payout before starting a new game. Sign the proposal to help process the payout and get back to playing faster.
                          </p>
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
                                {(payoutData.needsSignatures === 0 || payoutData.needsSignatures === undefined || payoutData.needsSignatures === null)
                                  ? '✅ Proposal is ready to execute - waiting for processing...'
                                  : playerProposalSigners.includes(publicKey?.toString() || '')
                                  ? '✓ You have signed. Waiting for proposal execution...'
                                  : playerProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                  : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Show sign button if proposal exists AND user hasn't signed yet */}
                              {payoutData.proposalId && 
                               !playerProposalSigners.includes(publicKey?.toString() || '') && (
                                <button
                                  onClick={handleSignProposal}
                                  disabled={signingProposal}
                                  className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                >
                                  {signingProposal ? 'Signing...' : 'Sign Proposal'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                    )}
                    {payoutData.payoutSignature && (
                      <div className="mt-3">
                        <a 
                          href={`https://explorer.solana.com/tx/${payoutData.payoutSignature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                            className="text-accent hover:text-yellow-400 text-sm underline"
                        >
                          View Transaction on Explorer
                        </a>
                      </div>
                    )}
                  </div>
                </div>
                ) : (
                  <div className="bg-secondary bg-opacity-10 border border-accent rounded-lg p-6">
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-4">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mr-3"></div>
                        <div className="text-accent text-lg font-semibold">
                          {payoutData?.proposalId ? '⏳ Processing Payout' : '🔄 Creating Proposal'}
                        </div>
                      </div>
                      
                      {/* Progress bar for proposal creation */}
                      {!payoutData?.proposalId && (
                        <div className="mb-4">
                          <div className="w-full bg-white/10 rounded-full h-2 mb-2">
                            <div 
                              className="bg-accent h-2 rounded-full transition-all duration-500 ease-out"
                              style={{ width: `${proposalCreationProgress}%` }}
                            ></div>
                          </div>
                          <p className="text-white/60 text-xs">
                            Creating secure blockchain proposal... {Math.round(proposalCreationProgress)}%
                          </p>
                        </div>
                      )}
                      
                      <p className="text-white/80 text-sm">
                        {payoutData?.proposalId 
                          ? (payoutData.needsSignatures > 0 
                              ? `Waiting for ${payoutData.needsSignatures} signature${payoutData.needsSignatures !== 1 ? 's' : ''}...`
                              : 'Proposal ready for execution...')
                          : 'Please wait while we create your secure payout proposal on the blockchain. This usually takes 15-30 seconds.'}
                      </p>
                      {isPolling && (
                        <p className="text-white/60 text-xs mt-2">
                          Checking for updates...
                        </p>
                      )}
                      {payoutData?.proposalId && payoutData?.needsSignatures > 0 && (
                        <p className="text-white/60 text-xs mt-2">
                          {payoutData.needsSignatures} signature{payoutData.needsSignatures !== 1 ? 's' : ''} needed
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col gap-4 items-center">
                <button
                  onClick={handlePlayAgain}
                  className="bg-accent hover:bg-yellow-400 hover:shadow-lg text-primary px-8 py-3.5 rounded-lg font-bold transition-all duration-200 transform hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center"
                >
                  Play Again
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