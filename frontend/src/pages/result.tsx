import React, { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { SquadsClient } from '../utils/squadsClient';

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
  competitive: 3,
  highRoller: 12,
  vip: 30
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

  const normalizedProposalSigners = useMemo(
    () => normalizeProposalSigners(payoutData?.proposalSigners),
    [payoutData?.proposalSigners]
  );

  const loadPayoutData = async () => {
    // Always try to fetch fresh data from backend first if we have a matchId
    const matchId = router.query.matchId as string;
    if (matchId) {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey?.toString()}`);
        
        if (response.ok) {
          const matchData = await response.json();

          if (matchData.isCompleted) {
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
            const payoutData = {
              won: matchData.winner === publicKey?.toString() && matchData.winner !== 'tie',
              isTie: matchData.winner === 'tie',
              winner: matchData.winner,
              numGuesses: playerResult?.numGuesses || 0,
              entryFee: matchData.entryFee || 0.1104,
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
              proposalId: matchData.payoutProposalId || matchData.tieRefundProposalId,
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
                  : matchData.payout?.winnerAmount || 0
            };
            
            setPayoutData(payoutData);
            setLoading(false);

            // Continue polling if:
            // 1. No proposalId yet (waiting for proposal creation)
            // 2. Proposal exists but is ACTIVE and needs signatures (waiting for signing/execution)
            // Stop polling only when proposal is EXECUTED or needsSignatures is 0
            if (!payoutData.proposalId) {
              // No proposal yet - start polling
              setIsPolling(true);
            } else if (payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures > 0) {
              // Proposal exists but needs signatures - continue polling
              setIsPolling(true);
            } else if (payoutData.proposalStatus === 'EXECUTED' || payoutData.needsSignatures === 0) {
              // Proposal executed or ready - stop polling
              setIsPolling(false);
            } else {
              // Other status - continue polling to catch updates
              setIsPolling(true);
            }
            return;
          } else {
            console.log('⏳ Game not yet completed, falling back to localStorage');
          }
        } else {
          console.error('❌ Failed to fetch match data from backend, falling back to localStorage');
        }
      } catch (error) {
        console.error('❌ Error fetching match data, falling back to localStorage:', error);
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
        
        setPayoutData(data);
        setLoading(false);

        // Continue polling if proposal is active and needs signatures
        if (!data.proposalId) {
          setIsPolling(true);
        } else if (data.proposalStatus === 'ACTIVE' && data.needsSignatures > 0) {
          setIsPolling(true);
        } else if (data.proposalStatus === 'EXECUTED' || data.needsSignatures === 0) {
          setIsPolling(false);
        } else {
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

    setError('Failed to load game results');
    setLoading(false);
    setIsPolling(false);
  };

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    loadPayoutData();
  }, [publicKey, router]);

  // Poll for proposal updates when polling is active
  useEffect(() => {
    if (!isPolling || !router.query.matchId || !publicKey) {
      return;
    }

    const pollInterval = setInterval(() => {
      console.log('🔄 Polling for proposal updates...');
      loadPayoutData();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling, router.query.matchId, publicKey]);

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

  // Listen for SSE proposal signing events
  useEffect(() => {
    const matchId = router.query.matchId as string;
    if (!matchId || !publicKey) return;

    const apiUrl = process.env.NEXT_PUBLIC_API_URL;
    const eventSource = new EventSource(
      `${apiUrl}/api/wallet/${publicKey.toString()}/balance/stream`
    );

    eventSource.addEventListener('proposal_signed', (event: any) => {
      try {
        const data = JSON.parse(event.data);
        if (data.matchId === matchId) {
          console.log('📢 Received proposal signed notification:', data);
          
          // Check if opponent signed (not current user)
          const eventSigners = normalizeProposalSigners(data.proposalSigners);
          const currentUserSigned = eventSigners.includes(publicKey?.toString() || '');
          
          if (!currentUserSigned && eventSigners.length > 0) {
            // Opponent signed - show notification
            setNotification('🎉 Other player has signed! Proposal is ready to execute.');
          } else if (currentUserSigned) {
            // Current user signed - show waiting message
            setNotification('✅ You have signed! Waiting for other player...');
          }
          
          // Immediately refresh payout data to get latest status
          loadPayoutData();
          
          // Hide sign button since only 1 signature needed
          setSigningProposal(false);
          
          // Refresh data periodically to catch execution
          const refreshInterval = setInterval(() => {
            loadPayoutData();
          }, 2000);
          
          // Stop refreshing after 20 seconds
          setTimeout(() => {
            clearInterval(refreshInterval);
            // Update notification based on final status
            loadPayoutData().then(() => {
              // Notification will be updated by loadPayoutData
            });
          }, 20000);
        }
      } catch (error) {
        console.error('❌ Error parsing proposal_signed event:', error);
      }
    });
    
    // Also listen for balance updates which might indicate payment execution
    eventSource.addEventListener('balance_update', () => {
      // Refresh payout data when balance updates (might indicate payment received)
      if (matchId) {
        loadPayoutData();
      }
    });

    return () => {
      eventSource.close();
    };
  }, [router.query.matchId, publicKey]);

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
      
      // Step 1: Get the transaction from backend
      const getTxResponse = await fetch(`${apiUrl}/api/match/get-proposal-approval-transaction?matchId=${matchId}&wallet=${publicKey.toString()}`);
      
      if (!getTxResponse.ok) {
        const errorData = await getTxResponse.json();
        throw new Error(errorData.error || 'Failed to get approval transaction');
      }
      
      const txData = await getTxResponse.json();
      
      // Step 2: Deserialize and sign the transaction
      const { VersionedTransaction } = await import('@solana/web3.js');
      const txBuffer = Buffer.from(txData.transaction, 'base64');
      const approveTx = VersionedTransaction.deserialize(txBuffer);
      
      // Step 3: Sign the transaction with the wallet
      const signedTx = await signTransaction(approveTx);
      
      // Step 4: Serialize the signed transaction
      const serialized = signedTx.serialize();
      // Convert Uint8Array to base64 string (browser-compatible)
      const base64Tx = Buffer.from(serialized).toString('base64');
      
      // Step 5: Send to backend to submit
      const response = await fetch(`${apiUrl}/api/match/sign-proposal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          wallet: publicKey.toString(),
          signedTransaction: base64Tx,
        }),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to sign proposal');
      }
      
      const result = await response.json();
      console.log('✅ Proposal signed successfully:', result);
      
      // Refresh payout data
      if (matchId && publicKey) {
        const statusResponse = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey.toString()}`);
        if (statusResponse.ok) {
          const matchData = await statusResponse.json();
          if (matchData.isCompleted) {
            const isPlayer1 = publicKey.toString() === matchData.player1;
            const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
            const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
            
            const updatedPayoutData = {
              ...payoutData,
              won: matchData.winner === publicKey.toString() && matchData.winner !== 'tie',
              isTie: matchData.winner === 'tie',
              winner: matchData.winner,
              numGuesses: playerResult?.numGuesses || 0,
              entryFee: matchData.entryFee || 0.1104,
              timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : 'N/A',
              opponentTimeElapsed: opponentResult ? `${Math.floor(opponentResult.totalTime / 1000)}s` : 'N/A',
              opponentGuesses: opponentResult?.numGuesses || 0,
              winnerAmount: matchData.payout?.winnerAmount || 0,
              feeAmount: matchData.payout?.feeAmount || 0,
              refundAmount: matchData.payout?.refundAmount || 0,
              isWinningTie: matchData.payout?.isWinningTie || false,
              feeWallet: matchData.payout?.feeWallet || '',
              transactions: matchData.payout?.transactions || [],
              proposalId: matchData.payoutProposalId,
              proposalStatus: matchData.proposalStatus,
              proposalSigners: normalizeProposalSigners(matchData.proposalSigners),
              needsSignatures: matchData.needsSignatures || 0,
              proposalExecutedAt: matchData.proposalExecutedAt,
              proposalTransactionId: matchData.proposalTransactionId,
              automatedPayout: matchData.payout?.paymentSuccess || false,
              payoutSignature: matchData.payout?.transactions?.[0]?.signature || matchData.proposalTransactionId || null
            };
            
            setPayoutData(updatedPayoutData);
          }
        }
      }
    } catch (err) {
      console.error('❌ Error signing proposal:', err);
      setError(err instanceof Error ? err.message : 'Failed to sign proposal');
    } finally {
      setSigningProposal(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-primary relative">
      <TopRightWallet />
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          {/* Logo prominently displayed at the top */}
          <div className="flex justify-center mb-8">
            <Image src={logo} alt="Guess5 Logo" width={250} height={250} className="mb-4" />
          </div>
          
          {/* Game Results */}
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            <div className="text-center">
              <h1 className="text-3xl font-bold text-white mb-6">Game Results</h1>
              
              {/* Result Status */}
              <div className="mb-6">
                {payoutData.won ? (
                  <div className="text-green-400 text-2xl font-bold mb-2">🏆 You Won!</div>
                ) : payoutData.isTie ? (
                  <div className="text-yellow-400 text-2xl font-bold mb-2">🤝 It's a Tie!</div>
                ) : (
                  <div className="text-red-400 text-2xl font-bold mb-2">😔 You Lost</div>
                )}

              </div>
              
              {/* Game Details */}
              <div className="bg-white/5 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-white/60">Your Guesses:</span>
                    <div className="text-white font-semibold">{payoutData.numGuesses || 0}/7</div>
                  </div>
                  <div>
                    <span className="text-white/60">Opponent Guesses:</span>
                    <div className="text-white font-semibold">{payoutData.opponentGuesses || 0}/7</div>
                  </div>
                  <div>
                    <span className="text-white/60">Your Time:</span>
                    <div className="text-white font-semibold">{payoutData.timeElapsed || 'N/A'}</div>
                  </div>
                  <div>
                    <span className="text-white/60">Opponent Time:</span>
                    <div className="text-white font-semibold">{payoutData.opponentTimeElapsed || 'N/A'}</div>
                  </div>
                </div>
              </div>
              
              {/* Notification Banner */}
              {notification && (
                <div className="mb-4 bg-accent/20 border border-accent rounded-lg p-4 text-center animate-pulse">
                  <p className="text-accent font-semibold text-lg">{notification}</p>
                </div>
              )}
              
              {/* Payout Information - Non-Custodial Proposal System */}
              <div className="mb-6">
                <h2 className="text-xl font-bold text-accent mb-3">Payout Details</h2>
                
                {payoutData.proposalId ? (
                  <div className={`
                    ${payoutData.won && payoutData.proposalStatus === 'EXECUTED' 
                      ? 'bg-gradient-to-br from-accent/20 to-yellow-500/20 border-2 border-accent shadow-lg shadow-accent/50' 
                      : payoutData.isTie && payoutData.proposalStatus === 'EXECUTED'
                      ? 'bg-gradient-to-br from-blue-500/20 to-purple-500/20 border-2 border-blue-400 shadow-lg shadow-blue-400/50'
                      : !payoutData.won && payoutData.proposalStatus === 'EXECUTED'
                      ? 'bg-gradient-to-br from-gray-500/20 to-gray-600/20 border-2 border-gray-400 shadow-lg shadow-gray-400/50'
                      : 'bg-secondary bg-opacity-10 border border-accent'
                    } rounded-lg p-6 transform transition-all duration-300
                    ${(payoutData.won || payoutData.isTie || !payoutData.won) && payoutData.proposalStatus === 'EXECUTED' ? 'animate-pulse hover:scale-105' : ''}
                  `}>
                  <div className="text-center">
                      <div className="text-accent text-lg font-semibold mb-2">
                        💰 Non-Custodial Payout System
                    </div>
                                         {payoutData.won ? (
                        <div className="text-white">
                          <div className="text-3xl font-bold text-accent mb-3 animate-bounce">
                            🎉 YOU WON! 🎉
                          </div>
                          <div className="text-4xl font-bold text-yellow-400 mb-2">
                            {payoutData.winnerAmount?.toFixed(4)} SOL
                          </div>
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
                            </div>
                          ) : (
                          <p className="text-sm text-white/80 mb-3">
                              Sign the proposal below to claim your winnings.
                          </p>
                          )}
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures >= 0 && (
                            <div className="mt-4">
                              <p className={`text-sm mb-2 ${
                                payoutData.needsSignatures === 0 
                                  ? 'text-green-400 font-semibold'
                                  : normalizedProposalSigners.includes(publicKey?.toString() || '')
                                  ? 'text-yellow-400'
                                  : normalizedProposalSigners.length > 0
                                  ? 'text-green-400 font-semibold'
                                  : 'text-white/60'
                              }`}>
                                {payoutData.needsSignatures === 0 
                                  ? '✅ Proposal is ready to execute - waiting for processing...'
                                  : normalizedProposalSigners.includes(publicKey?.toString() || '')
                                  ? '✓ You have signed. Waiting for proposal execution...'
                                  : normalizedProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                  : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Only show sign button if proposal needs signatures AND user hasn't signed AND other player hasn't signed yet */}
                              {payoutData.needsSignatures > 0 && 
                               !normalizedProposalSigners.includes(publicKey?.toString() || '') && 
                               normalizedProposalSigners.length === 0 && (
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
                                  ) : 'Sign to Claim Winnings'}
                                </button>
                              )}
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
                              <p className="text-lg text-white/90 mb-2 font-semibold">Perfect Match - Both players solved with same moves and time!</p>
                              <div className="text-3xl font-bold text-yellow-400 mb-2">
                                {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL
                              </div>
                              {payoutData.proposalStatus === 'EXECUTED' ? (
                                <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                                  ✅ Full Refund Sent to Your Wallet!
                                </div>
                              ) : (
                                <p className="text-sm text-white/80 mb-3">
                                  Full refund: Sign proposal to claim
                            </p>
                              )}
                          </>
                        ) : (
                          <>
                              <p className="text-lg text-white/90 mb-2 font-semibold">Both players failed to solve the puzzle</p>
                              <div className="text-3xl font-bold text-yellow-400 mb-2">
                                {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL
                              </div>
                              {payoutData.proposalStatus === 'EXECUTED' ? (
                                <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                                  ✅ 95% Refund Sent to Your Wallet!
                                </div>
                              ) : (
                                <p className="text-sm text-white/80 mb-3">
                                  95% refund: Sign proposal to claim
                            </p>
                              )}
                          </>
                        )}
                          
                          {payoutData.bonus?.eligible && (
                            <div className="text-white/50 text-xs mb-3">
                              House bonus sparks only on wins—secure the next {getBonusTierLabel(payoutData.bonus.tier)} victory to unlock +${payoutData.bonus.expectedUSD?.toFixed(2)}.
                            </div>
                          )}
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures >= 0 && (
                            <div className="mt-4">
                              <p className={`text-sm mb-2 ${
                                payoutData.needsSignatures === 0 
                                  ? 'text-green-400 font-semibold'
                                  : normalizedProposalSigners.includes(publicKey?.toString() || '')
                                  ? 'text-yellow-400'
                                  : normalizedProposalSigners.length > 0
                                  ? 'text-green-400 font-semibold'
                                  : 'text-white/60'
                              }`}>
                                {payoutData.needsSignatures === 0 
                                  ? '✅ Proposal is ready to execute - waiting for processing...'
                                  : normalizedProposalSigners.includes(publicKey?.toString() || '')
                                  ? '✓ You have signed. Waiting for proposal execution...'
                                  : normalizedProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                  : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Only show sign button if proposal needs signatures AND user hasn't signed AND other player hasn't signed yet */}
                              {payoutData.needsSignatures > 0 && 
                               !normalizedProposalSigners.includes(publicKey?.toString() || '') && 
                               normalizedProposalSigners.length === 0 && (
                                <button
                                  onClick={handleSignProposal}
                                  disabled={signingProposal}
                                  className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                >
                                  {signingProposal ? 'Signing...' : 'Sign to Claim Refund'}
                                </button>
                              )}
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
                              Sign the proposal to help process the payout and get back to playing faster.
                          </p>
                          )}
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures >= 0 && (
                            <div className="mt-4">
                              <p className={`text-sm mb-2 ${
                                payoutData.needsSignatures === 0 
                                  ? 'text-green-400 font-semibold'
                                  : normalizedProposalSigners.includes(publicKey?.toString() || '')
                                  ? 'text-yellow-400'
                                  : normalizedProposalSigners.length > 0
                                  ? 'text-green-400 font-semibold'
                                  : 'text-white/60'
                              }`}>
                                {payoutData.needsSignatures === 0 
                                  ? '✅ Proposal is ready to execute - waiting for processing...'
                                  : normalizedProposalSigners.includes(publicKey?.toString() || '')
                                  ? '✓ You have signed. Waiting for proposal execution...'
                                  : normalizedProposalSigners.length > 0
                                  ? '🎉 Other player has signed! Proposal is ready to execute. No action needed from you.'
                                  : '⏳ Waiting for either player to sign (only 1 signature needed)...'
                                }
                              </p>
                              
                              {/* Only show sign button if proposal needs signatures AND user hasn't signed AND other player hasn't signed yet */}
                              {payoutData.needsSignatures > 0 && 
                               !normalizedProposalSigners.includes(publicKey?.toString() || '') && 
                               normalizedProposalSigners.length === 0 && (
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
                  <div className="bg-secondary bg-opacity-10 border border-accent rounded-lg p-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center mb-3">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent mr-3"></div>
                        <div className="text-accent text-lg font-semibold">
                          ⏳ Processing Payout
                        </div>
                      </div>
                      <p className="text-white/80 text-sm">
                        The payout proposal is being created. Please wait...
                      </p>
                      {isPolling && (
                        <p className="text-white/60 text-xs mt-2">
                          Checking for updates...
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
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Result; 