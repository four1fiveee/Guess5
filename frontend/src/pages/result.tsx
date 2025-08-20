import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import PayoutInstructions from '../components/PayoutInstructions';
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
      // First try to get payout data from localStorage
      const storedPayoutData = localStorage.getItem('payoutData');
      if (storedPayoutData) {
        try {
          const data = JSON.parse(storedPayoutData);
          setPayoutData(data);
          console.log('💰 Payout data loaded from localStorage:', data);
          setLoading(false);
          return;
        } catch (error) {
          console.error('❌ Error parsing stored payout data:', error);
        }
      }

      // If no stored payout data, try to fetch from backend using matchId
      const matchId = router.query.matchId as string;
      if (matchId) {
        try {
          console.log('🔍 No stored payout data, fetching from backend for match:', matchId);
          const apiUrl = process.env.NEXT_PUBLIC_API_URL;
          const response = await fetch(`${apiUrl}/api/match/status/${matchId}`);
          
          if (response.ok) {
            const matchData = await response.json();
            console.log('📋 Match data from backend:', matchData);
            
            if (matchData.payout && matchData.isCompleted) {
              // Create payout data from match data
              const payoutData = {
                won: matchData.winner === publicKey?.toString(),
                isTie: matchData.winner === 'tie',
                winner: matchData.winner,
                numGuesses: 0, // This should be populated from player results
                entryFee: matchData.entryFee || 0.1104,
                timeElapsed: 'N/A',
                opponentTimeElapsed: 'N/A',
                winnerAmount: matchData.payout.paymentInstructions?.winnerAmount || 0,
                feeAmount: matchData.payout.paymentInstructions?.feeAmount || 0,
                feeWallet: matchData.payout.paymentInstructions?.feeWallet || '',
                transactions: matchData.payout.paymentInstructions?.transactions || [],
                automatedPayout: matchData.payout.automatedPayout || false,
                payoutSignature: matchData.payout.payoutSignature || null
              };
              
              setPayoutData(payoutData);
              console.log('✅ Payout data created from backend data:', payoutData);
            } else {
              setError('Game not yet completed or no payout data available');
            }
          } else {
            console.error('❌ Failed to fetch match data from backend');
            setError('Failed to load game results');
          }
        } catch (error) {
          console.error('❌ Error fetching match data:', error);
          setError('Failed to load game results');
        }
      } else {
        setError('No match ID provided');
      }

      setLoading(false);
    };

    loadPayoutData();
  }, [publicKey, router]);

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
              </div>
              
              {/* Game Details */}
              <div className="bg-white/5 rounded-lg p-4 mb-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-white/60">Your Guesses:</span>
                    <div className="text-white font-semibold">{payoutData.numGuesses || 0}/7</div>
                  </div>
                  <div>
                    <span className="text-white/60">Entry Fee:</span>
                    <div className="text-white font-semibold">{payoutData.entryFee} SOL</div>
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
              
              {/* Payout Information */}
              <div className="mb-6">
                <h2 className="text-xl font-bold text-accent mb-3">Payout Details</h2>
                <PayoutInstructions 
                  winner={payoutData.winner}
                  winnerAmount={payoutData.winnerAmount || 0}
                  feeAmount={payoutData.feeAmount || 0}
                  feeWallet={payoutData.feeWallet || ''}
                  transactions={payoutData.transactions || []}
                  playerWallet={playerWallet}
                  automatedPayout={payoutData.automatedPayout}
                  payoutSignature={payoutData.payoutSignature}
                />
              </div>
              
              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <button
                  onClick={handlePlayAgain}
                  className="bg-accent hover:bg-accent/80 text-white px-8 py-3 rounded-lg font-bold transition-colors"
                >
                  Play Again
                </button>
                <button
                  onClick={() => router.push('/')}
                  className="bg-white/10 hover:bg-white/20 text-white px-8 py-3 rounded-lg font-bold transition-colors"
                >
                  Back to Home
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