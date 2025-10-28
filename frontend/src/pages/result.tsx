import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { SquadsClient } from '../utils/squadsClient';

const Result: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [payoutData, setPayoutData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [signingProposal, setSigningProposal] = useState(false);
  const [squadsClient] = useState(() => new SquadsClient());

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

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
                won: matchData.payout?.winner === publicKey?.toString(),
                isTie: matchData.payout?.winner === 'tie',
                winner: matchData.payout?.winner || matchData.winner,
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
                proposalId: matchData.payoutProposalId,
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
              return;
            } else {
              console.log('⚠️ Game not yet completed, falling back to localStorage');
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
          return;
        } catch (error) {
          console.error('❌ Error parsing stored payout data:', error);
        }
      }

      // If no matchId and no localStorage data, show error
      if (!matchId) {
        setError('No match ID provided');
        setLoading(false);
        return;
      }

      setError('Failed to load game results');
      setLoading(false);
    };

    loadPayoutData();
  }, [publicKey, router]);

  // Debug logging for payout data
  useEffect(() => {
    if (payoutData) {
      console.log('🎯 Payout data in render:', {
        won: payoutData.won,
        isTie: payoutData.isTie,
        isWinningTie: payoutData.isWinningTie,
        refundAmount: payoutData.refundAmount
      });
    }
  }, [payoutData]);

  const handlePlayAgain = () => {
    // Clear stored data
    localStorage.removeItem('matchId');
    localStorage.removeItem('word');
    localStorage.removeItem('payoutData');
    
    router.push('/lobby');
  };

  const handleSignProposal = async () => {
    if (!payoutData?.proposalId || !payoutData?.vaultAddress || !publicKey) {
      setError('Missing required data for proposal signing');
      return;
    }

    setSigningProposal(true);
    try {
      await squadsClient.signProposal(payoutData.vaultAddress, payoutData.proposalId, publicKey);
      setError(null);
      // Refresh payout data to show updated status
      const matchId = router.query.matchId as string;
      if (matchId && publicKey) {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey.toString()}`);
        if (response.ok) {
          const matchData = await response.json();
          if (matchData.isCompleted) {
            const isPlayer1 = publicKey.toString() === matchData.player1;
            const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
            const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
            
            const updatedPayoutData = {
              ...payoutData,
              won: matchData.payout?.winner === publicKey.toString(),
              isTie: matchData.payout?.winner === 'tie',
              winner: matchData.payout?.winner || matchData.winner,
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
              
              {/* Payout Information - Non-Custodial Proposal System */}
              <div className="mb-6">
                <h2 className="text-xl font-bold text-accent mb-3">Payout Details</h2>
                
                {payoutData.proposalId ? (
                  <div className="bg-secondary bg-opacity-10 border border-accent rounded-lg p-4">
                    <div className="text-center">
                      <div className="text-accent text-lg font-semibold mb-2">
                        🔐 Non-Custodial Payout System
                      </div>
                      {payoutData.won ? (
                        <div className="text-white">
                          <p className="text-lg font-semibold text-accent mb-2">🏆 You Won!</p>
                          <p className="text-sm text-white/80 mb-3">
                            You won {payoutData.winnerAmount?.toFixed(4)} SOL! 
                            {payoutData.proposalStatus === 'EXECUTED' ? 
                              ' Payment has been sent to your wallet.' :
                              ' Sign the proposal below to claim your winnings.'
                            }
                          </p>
                          
                          {payoutData.proposalStatus === 'ACTIVE' && payoutData.needsSignatures > 0 && (
                            <div className="mt-4">
                              <p className="text-sm text-white/60 mb-2">
                                {payoutData.proposalSigners?.includes(publicKey?.toString() || '') 
                                  ? 'You have already signed this proposal' 
                                  : 'Sign this proposal to execute the payout'
                                }
                              </p>
                              
                              {!payoutData.proposalSigners?.includes(publicKey?.toString() || '') && (
                                <button
                                  onClick={handleSignProposal}
                                  disabled={signingProposal}
                                  className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-6 rounded-lg transition-colors"
                                >
                                  {signingProposal ? 'Signing...' : 'Sign to Claim Winnings'}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : payoutData.isTie ? (
                        <div className="text-white">
                          <p className="text-lg font-semibold text-accent mb-2">🤝 It's a Tie!</p>
                          {payoutData.isWinningTie ? (
                            <>
                              <p className="text-sm text-white/80 mb-2">Perfect Match - Both players solved with same moves and time!</p>
                              <p className="text-sm text-white/60 mb-3">
                                You get a full refund: {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL
                                {payoutData.proposalStatus === 'EXECUTED' ? 
                                  ' (Refund sent to your wallet)' :
                                  ' (Sign proposal to claim refund)'
                                }
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm text-white/80 mb-2">Both players failed to solve the puzzle</p>
                              <p className="text-sm text-white/60 mb-3">
                                You get a 95% refund: {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL
                                {payoutData.proposalStatus === 'EXECUTED' ? 
                                  ' (Refund sent to your wallet)' :
                                  ' (Sign proposal to claim refund)'
                                }
                              </p>
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
                          <p className="text-lg font-semibold text-red-400 mb-2">😔 You Lost</p>
                          <p className="text-sm text-white/80 mb-2">Better luck next time!</p>
                          <p className="text-sm text-white/60">
                            {payoutData.proposalStatus === 'EXECUTED' ? 
                              'The winner has been paid.' :
                              'The winner needs to sign the proposal to claim their winnings.'
                            }
                          </p>
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
                      <div className="text-accent text-lg font-semibold mb-2">
                        ⏳ Processing Payout
                      </div>
                      <p className="text-white/80">
                        The payout proposal is being created. Please check back in a moment.
                      </p>
                    </div>
                  </div>
                )}
              </div>
              
              {/* Action Buttons */}
              <div className="flex justify-center">
                <button
                  onClick={handlePlayAgain}
                  className="bg-accent hover:bg-accent/80 text-white px-8 py-3 rounded-lg font-bold transition-colors"
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