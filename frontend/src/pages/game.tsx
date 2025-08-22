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
  const [playerSolved, setPlayerSolved] = useState(false);
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
  const [feeWalletAddress, setFeeWalletAddress] = useState<string>('');
  const [entryFee, setEntryFee] = useState<number>(0);
  const [remainingGuesses, setRemainingGuesses] = useState<number>(7);
  const [targetWord, setTargetWord] = useState<string>('');
  const [networkStatus, setNetworkStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');
  const [isSubmittingGuess, setIsSubmittingGuess] = useState(false);
  const [startTime, setStartTime] = useState<number>(0);

  // handleGameEnd with correct totalTime and immediate navigation for specific reasons
  const handleGameEnd = useCallback(async (won: boolean, reason?: string) => {
    console.log('🏁 handleGameEnd called with:', { won, reason, publicKey: publicKey?.toString(), matchId });
    if (!publicKey || !matchId) {
      console.log('❌ Missing publicKey or matchId, returning early');
      return;
    }
    setTimerActive(false);
    
    // Calculate time with millisecond precision for tie-breaking
    const endTime = Date.now();
    const gameDuration = Math.max(1, endTime - startTime);
    
    // Remove reason field from result object - backend validation doesn't allow it
    const result = { 
      won, 
      numGuesses: guesses.length, 
      totalTime: gameDuration, 
      guesses 
    };
    
    setPlayerResult(result);
    console.log('🏁 Game ended:', result);
    
    // Submit result to backend and wait for response to get payout data
    try {
      console.log('📤 Submitting result to backend:', { matchId, wallet: publicKey?.toString(), result });
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const response = await fetch(`${apiUrl}/api/match/submit-result`, {
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matchId, wallet: publicKey?.toString() || '', result }),
      });
      
      const data = await response.json();
      console.log('📝 Backend result submitted:', data);
      
      if (!response.ok) {
        console.error('❌ Backend returned error:', data);
        throw new Error(data.error || 'Failed to submit result');
      }
      
      // If the game is completed, store payout data and navigate
      if (data.status === 'completed' && data.payout) {
        console.log('💰 Storing payout data:', data.payout);
        
        // Create payout data object for localStorage
        const payoutData = {
          won: data.winner === publicKey?.toString(),
          isTie: data.winner === 'tie',
          winner: data.winner,
          numGuesses: result.numGuesses,
          entryFee: 0.1104, // This should come from the match data
          timeElapsed: `${Math.floor(result.totalTime / 1000)}s`,
          opponentTimeElapsed: 'N/A', // This should come from opponent's result
          winnerAmount: data.payout.paymentInstructions?.winnerAmount || 0,
          feeAmount: data.payout.paymentInstructions?.feeAmount || 0,
          feeWallet: data.payout.paymentInstructions?.feeWallet || '',
          transactions: data.payout.paymentInstructions?.transactions || [],
          automatedPayout: data.payout.automatedPayout || false,
          payoutSignature: data.payout.payoutSignature || null
        };
        
        // Store payout data in localStorage
        localStorage.setItem('payoutData', JSON.stringify(payoutData));
        console.log('✅ Payout data stored in localStorage');
        
        // Navigate to results page
        console.log('🏆 Game completed, navigating to results page');
        router.push(`/result?matchId=${matchId}`);
      } else if (data.status === 'waiting') {
        // Game is still waiting for other player, show waiting state
        console.log('⏳ Waiting for other player to finish');
        setGameState('waiting');
        // Don't navigate to results yet - stay on this page and show waiting message
      } else {
        // Fallback: show waiting state
        console.log('⚠️ Unexpected response, showing waiting state');
        setGameState('waiting');
      }
    } catch (error) {
      console.error('❌ Error submitting result:', error);
      // Fallback: show waiting state even if submission failed
      setGameState('waiting');
    }
  }, [publicKey, matchId, startTime, guesses, router]);

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
        
        // Set start time when game begins (only once)
        if (startTime === 0 && data.gameActive) {
          setStartTime(Date.now());
        }
        
        if (data.solved) {
          setGameState('solved');
          setTimerActive(false);
        }
        
        if (data.opponentSolved && !opponentSolved) {
          setOpponentSolved(true);
          // Note: handleGameEnd will be called in a separate effect when opponentSolved changes
        }
        
        // Check if game is completed on the server side (both players finished)
        if (data.gameCompleted && gameState === 'waiting') {
          console.log('🎮 Both players finished, fetching payout data and navigating to results');
          
          // Try to fetch the completed match data to get payout information
          try {
            const matchResponse = await fetch(`${apiUrl}/api/match/status/${matchId}`);
            if (matchResponse.ok) {
              const matchData = await matchResponse.json();
              if (matchData.payout && matchData.isCompleted) {
                // Create payout data from match data
                const payoutData = {
                  won: matchData.winner === publicKey?.toString(),
                  isTie: matchData.winner === 'tie',
                  winner: matchData.winner,
                  numGuesses: playerResult?.numGuesses || 0,
                  entryFee: matchData.entryFee || 0.1104,
                  timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : 'N/A',
                  opponentTimeElapsed: 'N/A',
                  winnerAmount: matchData.payout.paymentInstructions?.winnerAmount || 0,
                  feeAmount: matchData.payout.paymentInstructions?.feeAmount || 0,
                  feeWallet: matchData.payout.paymentInstructions?.feeWallet || '',
                  transactions: matchData.payout.paymentInstructions?.transactions || [],
                  automatedPayout: matchData.payout.automatedPayout || false,
                  payoutSignature: matchData.payout.payoutSignature || null
                };
                
                // Store payout data in localStorage
                localStorage.setItem('payoutData', JSON.stringify(payoutData));
                console.log('✅ Payout data stored from completed game:', payoutData);
              }
            }
          } catch (error) {
            console.error('❌ Error fetching payout data:', error);
          }
          
          router.push(`/result?matchId=${matchId}`);
        }
        
        // If player has solved but hasn't submitted result yet, and they've run out of guesses, submit now
        if (data.solved && gameState === 'solved' && data.remainingGuesses === 0 && !playerResult) {
          console.log('🏆 Player solved but ran out of guesses, submitting result');
          handleGameEnd(true);
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
  }, [matchId, publicKey, opponentSolved, gameState, router, startTime, playerResult, handleGameEnd]);

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

        setFeeWalletAddress(matchData.feeWalletAddress || matchData.escrowAddress || '');
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
  }, [timerActive, gameState, handleGameEnd]);

  // Start timer when game begins
  useEffect(() => {
    if (gameState === 'playing' && !timerActive) {
      setTimerActive(true);
    }
  }, [gameState, timerActive]);

  // Poll for game state updates
  useEffect(() => {
    if ((gameState !== 'playing' && gameState !== 'waiting') || !matchId) return;

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
    }, 12000); // Poll every 12 seconds

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
  }, [lastActivity, gameState, handleGameEnd]);

  // Handle opponent solved state change
  useEffect(() => {
    if (opponentSolved && gameState === 'playing') {
      handleGameEnd(false, 'opponent_solved');
    }
  }, [opponentSolved, gameState, handleGameEnd]);

  const handleGuess = async (guess: string) => {
    if (gameState !== 'playing' || isSubmittingGuess || playerSolved) return;

    // Prevent duplicate submissions
    if (guesses.includes(guess)) {
      setError('You already tried that word!');
      setTimeout(() => setError(null), 3000);
      return;
    }

    setIsSubmittingGuess(true);
    setLastActivity(Date.now());
    
    const submitGuessWithRetry = async (retryCount = 0): Promise<{ solved: boolean; totalGuesses: number } | null> => {
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
          console.warn('⚠️ Unexpected rate limit response, will retry automatically...');
          // Wait 2 seconds before retry
          await new Promise(resolve => setTimeout(resolve, 2000));
          throw new Error('Unexpected rate limit - retrying automatically...');
        }
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || 'Failed to submit guess');
        }

        const data = await response.json();
        console.log('✅ Guess submitted successfully:', data);
        
        // Add a small delay after successful guess to prevent rapid submissions
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Immediately fetch updated game state
        await memoizedFetchGameState();
        
        return data;
        
      } catch (error) {
        console.error(`❌ Error submitting guess (attempt ${retryCount + 1}):`, error);
        
        // Retry up to 2 times for network errors
        if (retryCount < 2 && error instanceof Error && 
            (error.name === 'AbortError' || error.message.includes('Failed to fetch'))) {
          console.log(`🔄 Retrying guess submission (attempt ${retryCount + 2})...`);
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry (increased from 1 second)
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
        return null;
      } finally {
        setIsSubmittingGuess(false);
      }
    };
    
    const result = await submitGuessWithRetry();
    
    // Handle the result after the guess submission is complete
    if (result) {
      console.log('🎯 Processing guess result:', result);
      if (result.solved) {
        console.log('🎉 Player solved the word! Submitting result immediately...');
        setGameState('solved');
        setPlayerSolved(true);
        setTimerActive(false);
        // Player solved the puzzle - submit result immediately
        handleGameEnd(true, 'solved');
        return; // Exit early to prevent further processing
      } else if (result.totalGuesses >= 7) {
        setGameState('solved');
        setTimerActive(false);
        // Player ran out of guesses, check if they solved earlier
        if (playerSolved) {
          handleGameEnd(true, 'solved');
        } else {
          handleGameEnd(false, 'out_of_guesses');
        }
      }
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
          <div className="text-center mb-6">
            <div className="text-2xl font-bold text-accent mb-2">
              {playerResult?.won ? '🎉 You solved it!' : '❌ Game Over'}
            </div>
            <div className="text-white text-lg mb-4">
              Your Guesses: {playerResult?.numGuesses || 0}/7
            </div>
            <div className="text-accent text-lg font-semibold">
              ⏳ Waiting for opponent to finish...
            </div>
            <div className="text-white/60 text-sm mt-2">
              Results will be available once both players complete the game
            </div>
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