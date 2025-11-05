import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { SquadsClient } from '../utils/squadsClient';

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
              proposalSigners: matchData.proposalSigners || [],
              needsSignatures: matchData.needsSignatures || 0,
              proposalExecutedAt: matchData.proposalExecutedAt,
              proposalTransactionId: matchData.proposalTransactionId,
              automatedPayout: matchData.payout?.paymentSuccess || false,
              payoutSignature: matchData.payout?.transactions?.[0]?.signature || matchData.proposalTransactionId || null
            };
            
            setPayoutData(payoutData);
            setLoading(false);

            // If proposalId exists, stop polling
            if (payoutData.proposalId) {
              setIsPolling(false);
            } else {
              // Start polling if no proposalId yet
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
        
        setPayoutData(data);
        setLoading(false);

        // If proposalId exists, stop polling; otherwise start polling
        if (data.proposalId) {
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

  // Poll for proposal updates when no proposalId exists
  useEffect(() => {
    if (!isPolling || !router.query.matchId || !publicKey) {
      return;
    }

    const pollInterval = setInterval(() => {
      console.log('🔄 Polling for proposal updates...');
      loadPayoutData();
    }, 3000); // Poll every 3 seconds

    return () => clearInterval(pollInterval);
  }, [isPolling, router.query.matchId, publicKey]);

  // Debug logging for payout data
  useEffect(() => {
    if (payoutData) {
      console.log('💰 Payout data in render:', {
        won: payoutData.won,
        isTie: payoutData.isTie,
        isWinningTie: payoutData.isWinningTie,
        refundAmount: payoutData.refundAmount,
        proposalId: payoutData.proposalId
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
          setNotification('Opponent has signed the transaction! Updating...');
          
          // If proposal is ready to execute or executed, automatically refresh and show updated status
          if (data.needsSignatures === 0 || data.proposalStatus === 'EXECUTED' || data.proposalStatus === 'READY_TO_EXECUTE') {
            // Refresh payout data immediately
            loadPayoutData();
            // Update notification
            setNotification('Proposal is ready! Payment will be processed shortly.');
          } else {
            setNotification(`Opponent signed. ${data.needsSignatures} signature(s) remaining.`);
          }
          
          // Refresh data periodically to catch execution
          const refreshInterval = setInterval(() => {
            loadPayoutData();
          }, 2000);
          
          // Stop refreshing after 10 seconds
          setTimeout(() => {
            clearInterval(refreshInterval);
          }, 10000);
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
              proposalSigners: matchData.proposalSigners || [],
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
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="text-green-400 text-xl font-semibold animate-pulse mb-3">
                              ✅ Payment Sent to Your Wallet!
                            </div>
                          ) : (
                            <p className="text-sm text-white/80 mb-3">
                              Sign the proposal below to claim your winnings.
                            </p>
                          )}
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures > 0 && (
                            <div className="mt-4">
                              <p className="text-sm text-white/60 mb-2">
                                {payoutData.proposalSigners?.includes(publicKey?.toString() || '') 
                                  ? '✓ You have already signed this proposal' 
                                  : 'Sign this proposal to execute the payout'
                                }
                              </p>
                              
                              {!payoutData.proposalSigners?.includes(publicKey?.toString() || '') && (
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
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures > 0 && (
                            <div className="mt-4">
                              <p className="text-sm text-white/60 mb-2">
                                {payoutData.proposalSigners?.includes(publicKey?.toString() || '') 
                                  ? 'You have already signed this proposal' 
                                  : 'Sign this proposal to execute the refund'
                                }
                              </p>
                              
                              {!payoutData.proposalSigners?.includes(publicKey?.toString() || '') && (
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
                          {payoutData.proposalStatus === 'EXECUTED' ? (
                            <div className="text-green-400 text-lg font-semibold mb-3">
                              ✅ Winner has been paid. You can play again!
                            </div>
                          ) : (
                            <p className="text-sm text-white/80 mb-3">
                              Sign the proposal to help process the payout and get back to playing faster.
                            </p>
                          )}
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures > 0 && (
                            <div className="mt-4">
                              <p className="text-sm text-white/60 mb-2">
                                {payoutData.proposalSigners?.includes(publicKey?.toString() || '') 
                                  ? 'You have already signed this proposal' 
                                  : 'Signing helps process the payout (you can still sign even though you lost)'
                                }
                              </p>
                              
                              {!payoutData.proposalSigners?.includes(publicKey?.toString() || '') && (
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
              <div className="flex justify-center">
                <button
                  onClick={handlePlayAgain}
                  className="bg-accent hover:bg-yellow-400 hover:shadow-lg text-primary px-8 py-3.5 rounded-lg font-bold transition-all duration-200 transform hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center"
                >
                  Play Again
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Result; 