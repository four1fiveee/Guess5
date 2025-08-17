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