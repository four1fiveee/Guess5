import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import GameGrid from '../components/GameGrid';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';


const Game: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [guesses, setGuesses] = useState<string[]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameState, setGameState] = useState<'playing' | 'solved' | 'waiting' | 'completed'>('playing');
  const [playerResult, setPlayerResult] = useState<any>(null);
  const [opponentResult, setOpponentResult] = useState<any>(null);
  const [finalResult, setFinalResult] = useState<any>(null);
  const [matchId, setMatchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastActivity, setLastActivity] = useState<number>(0);
  const [opponentSolved, setOpponentSolved] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<number>(120); // 2 minutes in seconds
  const [timerActive, setTimerActive] = useState<boolean>(false);
  const [escrowAddress, setEscrowAddress] = useState<string>('');
  const [entryFee, setEntryFee] = useState<number>(0);
  const [serverGuesses, setServerGuesses] = useState<string[]>([]);
  const [remainingGuesses, setRemainingGuesses] = useState<number>(7);

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    const initializeGame = async () => {
      try {
        // Get matchId from URL first, then localStorage as fallback
        let gameMatchId = router.query.matchId as string;
        
        if (!gameMatchId) {
          // Fallback to localStorage if not in URL
          gameMatchId = localStorage.getItem('matchId') || '';
          console.log('🔍 No matchId in URL, checking localStorage:', gameMatchId);
        }

        if (!gameMatchId) {
          console.error('❌ No match ID found in URL or localStorage');
          router.push('/lobby');
          return;
        }

        setMatchId(gameMatchId);

        // Fetch match data from backend
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/status/${gameMatchId}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch match data');
        }

        const matchData = await response.json();
        
        // Verify match is active and player is part of this match
        if (matchData.status !== 'active') {
          console.log('⚠️ Match is not active, status:', matchData.status);
          
          // If both players have paid but status is still payment_required, wait a moment and retry
          if (matchData.status === 'payment_required' && matchData.player1Paid && matchData.player2Paid) {
            console.log('💰 Both players paid but status not updated yet, waiting...');
            setTimeout(() => {
              router.reload();
            }, 2000);
            return;
          }
          
          router.push('/matchmaking');
          return;
        }
        
        if (matchData.isCompleted) {
          console.log('⚠️ Match is already completed, redirecting to result page');
          router.push(`/result?matchId=${gameMatchId}`);
          return;
        }
        
        if (matchData.player1 !== publicKey.toString() && matchData.player2 !== publicKey.toString()) {
          throw new Error('You are not part of this match');
        }

        setEscrowAddress(matchData.escrowAddress || '');
        setEntryFee(matchData.entryFee || 0);

        // Get server-side game state
        const gameStateResponse = await fetch(`${apiUrl}/api/match/game-state?matchId=${gameMatchId}&wallet=${publicKey?.toString()}`);
        if (gameStateResponse.ok) {
          const gameStateData = await gameStateResponse.json();
          setServerGuesses(gameStateData.playerGuesses || []);
          setRemainingGuesses(gameStateData.remainingGuesses || 7);
          
          if (gameStateData.solved) {
            setGameState('solved');
            setTimerActive(false);
          }
          
          if (gameStateData.opponentSolved) {
            setOpponentSolved(true);
          }
        }

        setLastActivity(Date.now());
        setLoading(false);

      } catch (error) {
        console.error('❌ Error initializing game:', error);
        setError(error instanceof Error ? error.message : 'Failed to initialize game');
        setLoading(false);
      }
    };

    initializeGame();
  }, [publicKey, router]);

  // Update activity tracking
  useEffect(() => {
    const updateActivity = () => {
      setLastActivity(Date.now());
    };

    // Update activity on user interaction
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('click', updateActivity);
    window.addEventListener('touchstart', updateActivity);

    return () => {
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('touchstart', updateActivity);
    };
  }, []);

  // Timer countdown
  useEffect(() => {
    if (!timerActive || gameState !== 'playing') return;

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleGameEnd(false, 'timeout');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timerActive, gameState]);

  // Start timer when game begins
  useEffect(() => {
    if (gameState === 'playing' && !timerActive) {
      setTimerActive(true);
    }
  }, [gameState, timerActive]);

  // Poll for opponent status
  useEffect(() => {
    if (gameState !== 'playing' || !matchId) return;

    const pollInterval = setInterval(async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/game-state?matchId=${matchId}&wallet=${publicKey?.toString()}`);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.opponentSolved && !opponentSolved) {
            console.log('🏆 Opponent solved the puzzle!');
            setOpponentSolved(true);
            handleGameEnd(false, 'opponent_solved');
          }
        }
      } catch (error) {
        console.error('❌ Error polling opponent status:', error);
      }
    }, 5000); // Poll every 5 seconds (increased to avoid rate limits)

    return () => clearInterval(pollInterval);
  }, [matchId, gameState, publicKey, router, opponentSolved]);

  // Check for inactivity timeout (5 minutes)
  useEffect(() => {
    const checkTimeout = setInterval(() => {
      const now = Date.now();
      const inactiveTime = now - lastActivity;
      const timeoutMs = 5 * 60 * 1000; // 5 minutes

      if (inactiveTime > timeoutMs && gameState === 'playing') {
        console.log('⏰ Player inactive for too long, auto-losing');
        handleGameEnd(false, 'timeout');
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(checkTimeout);
  }, [lastActivity, gameState]);

  const handleGuess = async (guess: string) => {
    if (gameState !== 'playing') return;

    setLastActivity(Date.now());
    
    try {
      // Submit guess to server
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const response = await fetch(`${apiUrl}/api/match/submit-guess`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          wallet: publicKey?.toString() || '',
          guess
        }),
      });

      if (response.status === 429) {
        throw new Error('Rate limited - please wait a moment before trying again');
      }
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to submit guess');
      }

      const data = await response.json();
      
      // Update local state with server response
      setServerGuesses(data.playerGuesses || []);
      setRemainingGuesses(data.remainingGuesses || 7);
      
      if (data.solved) {
        setGameState('solved');
        setTimerActive(false);
        handleGameEnd(true);
      } else if (data.totalGuesses >= 7) {
        setGameState('solved');
        setTimerActive(false);
        handleGameEnd(false);
      }
      
    } catch (error) {
      console.error('❌ Error submitting guess:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to submit guess';
      setError(errorMessage);
      
      // Clear error after 3 seconds
      setTimeout(() => setError(null), 3000);
    }
  };

  const handleGameEnd = async (won: boolean, reason?: string) => {
    if (!publicKey || !matchId) return;

    // Stop the timer
    setTimerActive(false);

    const result = {
      won,
      numGuesses: serverGuesses.length,
      totalTime: 0, // Server will calculate this
      guesses: serverGuesses,
      reason: reason || 'normal'
    };

    // Store player's result
    setPlayerResult(result);

    console.log('🏁 Game ended:', result);

    try {
      // Submit result to backend for game state tracking and automated payouts
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const response = await fetch(`${apiUrl}/api/match/submit-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          wallet: publicKey?.toString() || '',
          result
        }),
      });

      const data = await response.json();
      console.log('📝 Backend result submitted:', data);

      if (data.status === 'completed') {
        // Store opponent's result if available
        if (data.player1Result && data.player1Result.wallet !== publicKey?.toString()) {
          setOpponentResult(data.player1Result);
        } else if (data.player2Result && data.player2Result.wallet !== publicKey?.toString()) {
          setOpponentResult(data.player2Result);
        }

        // Determine final result
        const isWinner = data.payout?.winner === publicKey?.toString();
        setFinalResult({
          won: isWinner,
          payout: data.payout
        });

        // Backend handles automated payouts
        console.log('💰 Backend handled payout automatically');
        data.payout.paymentSuccess = data.payout.automatedPayout || false;
        data.payout.transactionSignature = data.payout.payoutSignature;

        // Store payout data for results page
        localStorage.setItem('payoutData', JSON.stringify(data.payout));
        
        // IMMEDIATE CLEANUP: Set game state to completed and stop all polling
        setGameState('completed');
        setTimerActive(false);
        
        // Navigate to result page after a short delay
        setTimeout(() => {
          router.push('/result');
        }, 3000);
      } else if (reason === 'opponent_solved') {
        // Opponent solved first - navigate to result immediately
        console.log('🏆 Opponent solved first, navigating to result');
        router.push(`/result?matchId=${matchId}`);
      } else {
        console.log('⏳ Waiting for other player...');
        setGameState('waiting');
      }
    } catch (error) {
      console.error('❌ Error submitting result:', error);
    }
  };

  // Format time remaining as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-white text-xl">Loading game...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="text-white text-xl">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        {/* Logo prominently displayed at the top */}
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-4" />
        
        {/* Timer */}
        {gameState === 'playing' && (
          <div className="text-accent text-lg mb-6 font-semibold">
            ⏰ Time Remaining: {formatTime(timeRemaining)}
          </div>
        )}
        
        {/* Error Display */}
        {error && (
          <div className="bg-red-500 text-white px-4 py-2 rounded-lg mb-4 text-center">
            ❌ {error}
          </div>
        )}
        
        {/* Waiting Message */}
        {gameState === 'waiting' && (
          <div className="text-accent text-lg mb-6 font-semibold">
            ⏳ Waiting for opponent to finish...
          </div>
        )}

        {/* Game Grid - No box wrapper */}
        {gameState === 'playing' && (
          <div className="mb-6">
            <GameGrid
              guesses={serverGuesses}
              currentGuess={currentGuess}
              setCurrentGuess={setCurrentGuess}
              onGuess={handleGuess}
              remainingGuesses={remainingGuesses}
            />
          </div>
        )}

        {/* Game Results */}
        {gameState === 'solved' && (
          <div className="text-center mb-6">
            <div className="text-2xl font-bold text-accent mb-2">
              {playerResult?.won ? '🎉 You solved it!' : '❌ Game Over'}
            </div>
            <div className="text-white text-lg">
              Guesses: {playerResult?.numGuesses || 0}/7
            </div>
          </div>
        )}

        {/* Game Completed */}
        {gameState === 'completed' && (
          <div className="text-center mb-6">
            <div className="text-2xl font-bold text-accent mb-2">
              {finalResult?.won ? '🏆 You won!' : '😔 You lost'}
            </div>
            <div className="text-white text-lg">
              Processing payment...
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Game; 