import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';

const Result: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [payoutData, setPayoutData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          console.log('🔍 Fetching fresh data from backend for match:', matchId);
          const apiUrl = process.env.NEXT_PUBLIC_API_URL;
          const response = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey?.toString()}`);
          
          if (response.ok) {
            const matchData = await response.json();
            console.log('📋 Match data from backend:', matchData);
            console.log('🔍 Debug match data fields:', {
              isCompleted: matchData.isCompleted,
              hasPayout: !!matchData.payout,
              player1Result: matchData.player1Result,
              player2Result: matchData.player2Result,
              winner: matchData.winner,
              player1: matchData.player1,
              player2: matchData.player2
            });
            
            if (matchData.isCompleted) {
              // Get player results from match data
              const isPlayer1 = publicKey?.toString() === matchData.player1;
              const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
              const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
              
              // Create payout data from match data
              const payoutData = {
                won: matchData.winner === publicKey?.toString(),
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
                automatedPayout: matchData.payout?.paymentSuccess || false,
                payoutSignature: matchData.payout?.transactions?.[0]?.signature || null
              };
              
              console.log('🔍 Debug payout data creation:', {
                playerResult,
                opponentResult,
                matchDataWinner: matchData.winner,
                playerWallet: publicKey?.toString(),
                won: matchData.winner === publicKey?.toString(),
                isTie: matchData.winner === 'tie',
                isWinningTie: matchData.payout?.isWinningTie,
                refundAmount: matchData.payout?.refundAmount,
                calculatedIsTie: matchData.winner === 'tie'
              });
              
              setPayoutData(payoutData);
              console.log('✅ Payout data created from backend data:', {
                ...payoutData,
                isTie: payoutData.isTie,
                isWinningTie: payoutData.isWinningTie,
                refundAmount: payoutData.refundAmount
              });
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
            console.log('🔧 Fixed missing isWinningTie flag in localStorage data - assuming losing tie');
          }
          
          setPayoutData(data);
          console.log('💰 Payout data loaded from localStorage (fallback):', {
            ...data,
            isTie: data.isTie,
            isWinningTie: data.isWinningTie,
            refundAmount: data.refundAmount
          });
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
                <div className="text-white/60 text-sm">
                  Debug: won={String(payoutData.won)}, winner={payoutData.winner}, isWinningTie={String(payoutData.isWinningTie)}, playerWallet={publicKey?.toString()}
                </div>
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
              
              {/* Payout Information - Always Automated */}
              <div className="mb-6">
                <h2 className="text-xl font-bold text-accent mb-3">Payout Details</h2>
                
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="text-center">
                    <div className="text-green-600 text-lg font-semibold mb-2">
                      ✅ Automated Payout Completed
                    </div>
                                         {payoutData.won ? (
                       <div className="text-green-700">
                         <p>You won {payoutData.winnerAmount?.toFixed(4)} SOL!</p>
                         <p className="text-sm text-green-600 mt-1">
                           Payment has been sent to your wallet automatically by the fee wallet.
                         </p>
                       </div>
                     ) : payoutData.isTie ? (
                       <div className="text-yellow-700">
                         {payoutData.isWinningTie ? (
                          // Winning tie: Both solved with same moves AND same time (within 1ms tolerance)
                          <>
                            <p className="font-semibold text-green-600">Winning Tie - Perfect Match!</p>
                            <p className="text-sm text-yellow-600 mt-1">
                              Both players solved the puzzle with the same moves and time! You get a full refund of your entry fee: {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL.
                            </p>
                            <p className="text-sm text-yellow-500 mt-1">
                              Full refund processed automatically by the fee wallet.
                            </p>
                          </>
                        ) : (
                          // Losing tie: Both failed to solve
                          <>
                            <p className="font-semibold text-yellow-600">Losing Tie - Both Players Failed</p>
                            <p className="text-sm text-yellow-600 mt-1">
                              Neither player solved the puzzle. You get a 95% refund of your entry fee: {payoutData.refundAmount?.toFixed(4) || '0.0000'} SOL.
                            </p>
                            <p className="text-sm text-yellow-500 mt-1">
                              Refund processed automatically by the fee wallet.
                            </p>
                          </>
                        )}
                      </div>
                    ) : (
                      <div className="text-gray-700">
                        {/* Regular loss */}
                        <p>Better luck next time!</p>
                        <p className="text-sm text-gray-600 mt-1">
                          The winner has been paid automatically by the fee wallet.
                        </p>
                      </div>
                    )}
                    {payoutData.payoutSignature && (
                      <div className="mt-3">
                        <a 
                          href={`https://explorer.solana.com/tx/${payoutData.payoutSignature}?cluster=devnet`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 text-sm underline"
                        >
                          View Transaction on Explorer
                        </a>
                      </div>
                    )}
                  </div>
                </div>
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