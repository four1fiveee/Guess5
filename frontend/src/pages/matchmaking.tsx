import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'matched' | 'error'>('waiting');
  const [timeoutMessage, setTimeoutMessage] = useState('');
  const [matchId, setMatchId] = useState<string | null>(null);
  const [timeLeft, setTimeLeft] = useState(120); // 2 minutes in seconds
  const [waitingCount, setWaitingCount] = useState<number>(0);

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
          clearInterval(countdownInterval);
          // Store match data
          localStorage.setItem('matchId', data.matchId);
          localStorage.setItem('word', data.word);
          // Redirect to game with matchId in URL
          setTimeout(() => {
            router.push(`/game?matchId=${data.matchId}`);
          }, 1000);
        } else if (data.status === 'waiting') {
          console.log('⏳ Waiting for opponent...', data);
          setStatus('waiting');
          setWaitingCount(data.waitingCount || 0);
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
      // Poll every 1 second to check if we've been matched (faster response)
      pollInterval = setInterval(async () => {
        try {
          console.log('🔍 Polling for match status...');
          
          // Use the dedicated endpoint to check if we've been matched
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/check-match/${wallet}`);
          const data = await response.json();
          
          if (data.matched) {
            console.log('✅ We have been matched!', data);
            const ourMatch = data;
            
            // Validate that this is a proper match with both players
            if (ourMatch && ourMatch.status === 'active' && ourMatch.player1 && ourMatch.player2) {
              // CRITICAL: Check that this is not a self-match
              if (ourMatch.player1 === ourMatch.player2) {
                console.log('❌ Found self-match, ignoring:', ourMatch);
                return;
              }
              
              console.log('✅ Found our active match!', ourMatch);
              setStatus('matched');
              clearTimeout(timeoutId);
              clearInterval(pollInterval);
              clearInterval(countdownInterval);
              // Store match data
              localStorage.setItem('matchId', ourMatch.matchId);
              // Redirect to game
              setTimeout(() => {
                router.push(`/game?matchId=${ourMatch.matchId}`);
              }, 1000);
            } else {
              console.log('⚠️ Found incomplete match, ignoring:', ourMatch);
            }
          }
        } catch (error) {
          console.error('❌ Polling error:', error);
        }
      }, 1000); // Poll every 1 second for faster response
    };

    startMatchmaking();
    
    // Countdown timer
    const countdownInterval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    // 2-minute timeout to return to home
    timeoutId = setTimeout(() => {
      setTimeoutMessage('No opponents found after 2 minutes. Returning to lobby...');
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
      setTimeout(() => router.push('/lobby'), 3000);
    }, 120000); // 2 minutes = 120 seconds

    return () => {
      clearTimeout(timeoutId);
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
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
              {waitingCount > 0 && (
                <div className="text-accent text-sm">
                  {waitingCount === 1 ? 'You are the only player waiting' : `${waitingCount} players waiting`}
                </div>
              )}
              <div className="text-accent text-sm">
                Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </div>
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
                className="bg-accent hover:bg-accent/80 text-white px-6 py-2 rounded-lg transition-colors"
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