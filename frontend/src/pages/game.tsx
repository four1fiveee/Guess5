import React, { useState, useEffect, useCallback } from 'react';
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
  const [remainingGuesses, setRemainingGuesses] = useState<number>(7);
  const [targetWord, setTargetWord] = useState<string>('');
  const [networkStatus, setNetworkStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);

  // Memoize fetchGameState to avoid dependency issues
  const memoizedFetchGameState = useCallback(async () => {
    if (!matchId || !publicKey) return;
    
    try {
      setNetworkStatus('reconnecting');
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
      
      const response = await fetch(`${apiUrl}/api/match/game-state?matchId=${matchId}&wallet=${publicKey.toString()}`, {
        signal: controller.signal
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        console.log('🔄 Fetched game state:', data);
        
        // Update local state with server data
        setGuesses(data.playerGuesses || []);
        setRemainingGuesses(data.remainingGuesses || 7);
        setTargetWord(data.targetWord || '');
        
        if (data.solved) {
          setGameState('solved');
          setTimerActive(false);
        }
        
        if (data.opponentSolved && !opponentSolved) {
          setOpponentSolved(true);
          // Note: handleGameEnd will be called in a separate effect when opponentSolved changes
        }
        
        // Check if game is completed on the server side
        if (data.gameCompleted && gameState === 'waiting') {
          console.log('🎮 Game completed on server, navigating to results');
          router.push(`/result?matchId=${matchId}`);
        }
        
        setNetworkStatus('connected');
      } else {
        console.error('❌ Failed to fetch game state:', response.status, response.statusText);
        setNetworkStatus('disconnected');
        // Don't show error to user for polling failures, just log them
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn('⚠️ Game state fetch timed out, will retry...');
        setNetworkStatus('reconnecting');
      } else {
        console.error('❌ Error fetching game state:', error);
        setNetworkStatus('disconnected');
      }
      // Don't show error to user for polling failures, just log them
    }
  }, [matchId, publicKey, opponentSolved, gameState, router]);

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

        // Fetch initial game state
        await memoizedFetchGameState();

        setLastActivity(Date.now());
        setLoading(false);

      } catch (error) {
        console.error('❌ Error initializing game:', error);
        setError(error instanceof Error ? error.message : 'Failed to initialize game');
        setLoading(false);
      }
    };

    initializeGame();
  }, [publicKey, router, memoizedFetchGameState]);

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

  // Poll for game state updates
  useEffect(() => {
    if (gameState !== 'playing' || !matchId) return;

    let retryCount = 0;
    const maxRetries = 3;

    const pollInterval = setInterval(async () => {
      try {
        await memoizedFetchGameState();
        retryCount = 0; // Reset retry count on success
      } catch (error) {
        retryCount++;
        console.warn(`⚠️ Poll attempt ${retryCount} failed, will retry...`);
        
        if (retryCount >= maxRetries) {
          console.error('❌ Max retries reached for game state polling');
          // Don't stop polling, just log the error
          retryCount = 0; // Reset for next cycle
        }
      }
    }, 5000); // Poll every 5 seconds (increased from 2 seconds to reduce rate limiting)

    return () => clearInterval(pollInterval);
  }, [matchId, gameState, publicKey, memoizedFetchGameState]);

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

  // Handle opponent solved state change
  useEffect(() => {
    if (opponentSolved && gameState === 'playing') {
      handleGameEnd(false, 'opponent_solved');
    }
  }, [opponentSolved, gameState]);

  const handleGuess = async (guess: string) => {
    if (gameState !== 'playing' || isSubmittingGuess) return;

    // Prevent duplicate submissions
    if (guesses.includes(guess)) {
      setError('You already tried that word!');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsSubmittingGuess(true);
    setLastActivity(Date.now());
    
    const submitGuessWithRetry = async (retryCount = 0): Promise<void> => {
      try {
        // Submit guess to server with timeout
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for guess submission
        
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
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.status === 429) {
          console.warn('⚠️ Rate limited, will retry automatically...');
          // Wait 3 seconds and retry automatically
          await new Promise(resolve => setTimeout(resolve, 3000));
          throw new Error('Rate limited - retrying automatically...');
        }
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to submit guess');
        }

        const data = await response.json();
        console.log('✅ Guess submitted successfully:', data);
        
        // Immediately fetch updated game state
        await memoizedFetchGameState();
        
        if (data.solved) {
          setGameState('solved');
          setTimerActive(false);
          handleGameEnd(true);
        } else if (data.totalGuesses >= 7) {
          setGameState('solved');
          setTimerActive(false);
          handleGameEnd(false, 'out_of_guesses');
        }
        
      } catch (error) {
        console.error(`❌ Error submitting guess (attempt ${retryCount + 1}):`, error);
        
        // Retry up to 2 times for network errors
        if (retryCount < 2 && error instanceof Error && 
            (error.name === 'AbortError' || error.message.includes('Failed to fetch'))) {
          console.log(`🔄 Retrying guess submission (attempt ${retryCount + 2})...`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
          return submitGuessWithRetry(retryCount + 1);
        }
        
        // Show error to user after all retries failed
        let errorMessage = 'Failed to submit guess';
        
        if (error instanceof Error) {
          if (error.name === 'AbortError') {
            errorMessage = 'Request timed out - please try again';
          } else {
            errorMessage = error.message;
          }
        }
        
        setError(errorMessage);
        
        // Clear error after 5 seconds
        setTimeout(() => setError(null), 5000);
      } finally {
        setIsSubmittingGuess(false);
      }
    };
    
    await submitGuessWithRetry();
  };

  const handleGameEnd = async (won: boolean, reason?: string) => {
    if (!publicKey || !matchId) return;

    // Stop the timer
    setTimerActive(false);

    // Calculate actual game duration (120 seconds - remaining time)
    const gameDuration = Math.max(1, 120 - timeRemaining); // Ensure at least 1 second

    const result = {
      won,
      numGuesses: guesses.length,
      totalTime: gameDuration, // Use actual game duration instead of 0
      guesses: guesses,
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
      } else if (reason === 'out_of_guesses') {
        // Player ran out of guesses - navigate to result immediately
        console.log('⏰ Player ran out of guesses, navigating to result');
        router.push(`/result?matchId=${matchId}`);
      } else {
        console.log('⏳ Waiting for other player...');
        setGameState('waiting');
        
        // No timeout needed - let the game logic handle completion naturally
        // The existing polling will detect when the opponent finishes
      }
    } catch (error) {
      console.error('❌ Error submitting result:', error);
      
      // If result submission fails, still navigate to result page to avoid getting stuck
      console.log('🔄 Result submission failed, navigating to result page anyway...');
      setGameState('completed');
      setTimeout(() => {
        router.push('/result');
      }, 2000);
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
        <Image src={logo} alt="Guess5 Logo" width={250} height={250} className="mb-6" />
        
        {/* Timer */}
        {gameState === 'playing' && (
          <div className="text-accent text-lg mb-6 font-semibold">
            ⏰ Time Remaining: {formatTime(timeRemaining)}
            {/* Network Status Indicator */}
            <div className="text-sm mt-2">
              {networkStatus === 'connected' && (
                <span className="text-green-400">🟢 Connected</span>
              )}
              {networkStatus === 'reconnecting' && (
                <span className="text-yellow-400">🟡 Reconnecting...</span>
              )}
              {networkStatus === 'disconnected' && (
                <span className="text-red-400">🔴 Disconnected</span>
              )}
            </div>
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
              guesses={guesses}
              currentGuess={currentGuess}
              setCurrentGuess={setCurrentGuess}
              onGuess={handleGuess}
              remainingGuesses={remainingGuesses}
              targetWord={targetWord}
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