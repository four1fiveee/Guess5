import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'matched' | 'error'>('waiting');

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    const startMatchmaking = async () => {
      const wallet = publicKey.toString();
      const entryFee = Number(localStorage.getItem('entryFee') || 0.1);

      try {
        console.log('🎮 Starting matchmaking...');
        const response = await fetch('http://localhost:4000/api/match/request-match', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            entryFee,
            wallet
          }),
        });

        const data = await response.json();
        
        if (data.status === 'matched') {
          console.log('✅ Match found!', data);
          setStatus('matched');
          
          // Store match data
          localStorage.setItem('matchId', data.matchId);
          localStorage.setItem('word', data.word);
          
          // Redirect to game with matchId in URL
          setTimeout(() => {
            router.push(`/game?matchId=${data.matchId}`);
          }, 1000);
        } else {
          console.log('⏳ Waiting for opponent...');
          setStatus('waiting');
        }
      } catch (error) {
        console.error('❌ Matchmaking error:', error);
        setStatus('error');
      }
    };

    startMatchmaking();
  }, [publicKey, router]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-6">Finding Opponent...</h1>
          
          {status === 'waiting' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <p className="text-white/80">Waiting for another player to join...</p>
            </div>
          )}
          
          {status === 'matched' && (
            <div className="space-y-4">
              <div className="text-green-400 text-xl">✓ Match Found!</div>
              <p className="text-white/80">Redirecting to game...</p>
            </div>
          )}
          
          {status === 'error' && (
            <div className="space-y-4">
              <div className="text-red-400 text-xl">✗ Error</div>
              <p className="text-white/80">Failed to find match. Please try again.</p>
              <button
                onClick={() => window.location.reload()}
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Matchmaking; 