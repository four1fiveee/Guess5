import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import PayoutInstructions from '../components/PayoutInstructions';

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

    // Get payout data from localStorage
    const storedPayoutData = localStorage.getItem('payoutData');
    if (storedPayoutData) {
      try {
        const data = JSON.parse(storedPayoutData);
        setPayoutData(data);
        console.log('💰 Payout data loaded:', data);
      } catch (error) {
        console.error('❌ Error parsing payout data:', error);
        setError('Failed to load payout data');
      }
    } else {
      setError('No payout data found');
    }

    setLoading(false);
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
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading results...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="text-red-400 text-xl mb-4">❌ Error</div>
            <p className="text-white/80 mb-6">{error}</p>
            <button
              onClick={handlePlayAgain}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
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
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
          <div className="text-center">
            <div className="text-yellow-400 text-xl mb-4">⚠️ No Results</div>
            <p className="text-white/80 mb-6">No game results found.</p>
            <button
              onClick={handlePlayAgain}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
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
    <div className="min-h-screen bg-primary">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto">
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20">
            {payoutData.winner === 'tie' ? (
              <div className="text-center">
                <div className="text-yellow-400 text-2xl mb-4">🤝 It's a Tie!</div>
                <p className="text-white/80 mb-6">Both players had the same result. No payout required.</p>
                <button
                  onClick={handlePlayAgain}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
                >
                  Play Again
                </button>
              </div>
            ) : (
              <div>
                <div className="text-center mb-6">
                  <div className="text-2xl font-bold text-white mb-2">
                    {payoutData.winner === playerWallet ? '🎉 You Won!' : '😔 You Lost'}
                  </div>
                  <p className="text-white/80">
                    {payoutData.winner === playerWallet 
                      ? `You won ${payoutData.winnerAmount} SOL!`
                      : 'Better luck next time!'
                    }
                  </p>
                </div>

                <PayoutInstructions
                  winner={payoutData.winner}
                  winnerAmount={payoutData.winnerAmount}
                  feeAmount={payoutData.feeAmount}
                  feeWallet={payoutData.feeWallet}
                  transactions={payoutData.transactions}
                  playerWallet={playerWallet}
                />

                <div className="mt-8 text-center">
                  <button
                    onClick={handlePlayAgain}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
                  >
                    Play Again
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Result; 