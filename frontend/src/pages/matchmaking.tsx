import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'matched' | 'error'>('waiting');
  const [timeoutMessage, setTimeoutMessage] = useState('');
  const [matchId, setMatchId] = useState<string | null>(null);

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    let timeoutId: NodeJS.Timeout;
    let pollInterval: NodeJS.Timeout;
    const wallet = publicKey.toString();
    const entryFee = Number(localStorage.getItem('entryFeeSOL') || 0.1);

    const startMatchmaking = async () => {
      try {
        console.log('🎮 Starting matchmaking...');
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/request-match`, {
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
          clearTimeout(timeoutId);
          clearInterval(pollInterval);
          // Store match data
          localStorage.setItem('matchId', data.matchId);
          localStorage.setItem('word', data.word);
          // Redirect to game with matchId in URL
          setTimeout(() => {
            router.push(`/game?matchId=${data.matchId}`);
          }, 1000);
        } else if (data.status === 'waiting') {
          console.log('⏳ Waiting for opponent...');
          setStatus('waiting');
          // Start polling to check if we get matched
          startPolling();
        }
      } catch (error) {
        console.error('❌ Matchmaking error:', error);
        setStatus('error');
        clearTimeout(timeoutId);
        clearInterval(pollInterval);
      }
    };

    const startPolling = () => {
      // Poll every 2 seconds to check if we've been matched
      pollInterval = setInterval(async () => {
        try {
          console.log('🔍 Polling for match status...');
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/debug/waiting`);
          const data = await response.json();
          
          // Check if we're in an active match
          const activeMatches = data.database?.activeMatches || [];
          const memoryMatches = data.memory?.activeMatches || [];
          const allActiveMatches = [...activeMatches, ...memoryMatches];
          
          const ourMatch = allActiveMatches.find((match: any) => 
            match.player1 === wallet || match.player2 === wallet
          );
          
          if (ourMatch && ourMatch.status === 'active') {
            console.log('✅ Found our active match!', ourMatch);
            setStatus('matched');
            clearTimeout(timeoutId);
            clearInterval(pollInterval);
            // Store match data
            localStorage.setItem('matchId', ourMatch.id);
            // Redirect to game
            setTimeout(() => {
              router.push(`/game?matchId=${ourMatch.id}`);
            }, 1000);
          }
        } catch (error) {
          console.error('❌ Polling error:', error);
        }
      }, 2000);
    };

    startMatchmaking();
    // 1-minute timeout to return to home
    timeoutId = setTimeout(() => {
      setTimeoutMessage('Unable to find a match in your staking category. You will now be returned home.');
      clearInterval(pollInterval);
      setTimeout(() => router.push('/'), 3000);
    }, 60000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(pollInterval);
    };
  }, [publicKey, router]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-primary">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-6">Finding Opponent...</h1>
          {timeoutMessage && (
            <div className="text-yellow-400 text-lg mb-4">{timeoutMessage}</div>
          )}
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