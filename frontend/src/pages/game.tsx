
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import GameGrid from '../components/GameGrid';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { submitResult, getMatchStatus, getGameState, submitGuess } from '../utils/api';


const Game: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [guesses, setGuesses] = useState<string[]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameState, setGameState] = useState<'playing' | 'solved' | 'waiting' | 'completed' | 'error'>('playing');
  const [playerSolved, setPlayerSolved] = useState(false);
  const [playerResult, setPlayerResult] = useState<{
  won: boolean;
  numGuesses: number;
  totalTime: number;
  guesses: string[];
} | null>(null);

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
  const [isSubmittingResult, setIsSubmittingResult] = useState(false);
  const handleGameEndRef = useRef<typeof handleGameEnd>();
  const memoizedFetchGameStateRef = useRef<typeof memoizedFetchGameState>();

  // Safe localStorage wrapper with error handling
  const safeLocalStorage = {
    setItem: (key: string, value: string) => {
      try {
        localStorage.setItem(key, value);
      } catch (error) {
        console.error(`❌ localStorage.setItem failed for ${key}:`, error);
        // Fallback: try to clear some space and retry
        try {
          // Remove old data to make space
          const keysToRemove = ['oldMatchData', 'tempData'];
          keysToRemove.forEach(k => localStorage.removeItem(k));
          localStorage.setItem(key, value);
        } catch (retryError) {
          console.error(`❌ localStorage retry failed for ${key}:`, retryError);
          setError('Storage error - game data may not be saved');
        }
      }
    },
    getItem: (key: string): string | null => {
      try {
        return localStorage.getItem(key);
      } catch (error) {
        console.error(`❌ localStorage.getItem failed for ${key}:`, error);
        return null;
      }
    },
    removeItem: (key: string) => {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        console.error(`❌ localStorage.removeItem failed for ${key}:`, error);
      }
    }
  };

  // handleGameEnd with correct totalTime and immediate navigation for specific reasons
  const handleGameEnd = useCallback(async (won: boolean, reason?: string, customGuesses?: string[]) => {
    console.log('🏁 handleGameEnd called:', { won, reason, customGuesses, isSubmittingResult, hasPlayerResult: !!playerResult });
    
    if (isSubmittingResult) {
      console.log('⏳ Already submitting result, ignoring duplicate call');
      return;
    }

    setIsSubmittingResult(true);
    setGameState('waiting');

    console.log('🏁 Game ended:', { won, reason, customGuesses });

    // Use custom guesses if provided (for testing), otherwise use current guesses
    const finalGuesses = customGuesses || guesses;
    const endTime = Date.now();
    const totalTime = startTime > 0 ? endTime - startTime : 120000; // Use 2 minutes if startTime not set

    const result = {
      won,
      numGuesses: finalGuesses.length,
      totalTime,
      guesses: finalGuesses,
      reason: reason || 'game_completed'
    };



    // Store result locally for potential retry
    setPlayerResult(result);

    const submitResultWithRetry = async () => {
      const maxRetries = 3;
      let lastError: any = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
      
          
          // Use the proper submitResult function that handles ReCaptcha
          const data = await submitResult(matchId, publicKey?.toString() || '', result);
  
          
          return data;
        } catch (error: any) {
          lastError = error;
          console.error(`❌ Result submission failed (attempt ${attempt}):`, error);
          
          if (attempt < maxRetries) {
            console.log(`⏳ Retrying in ${attempt * 1000}ms...`);
            await new Promise(resolve => setTimeout(resolve, attempt * 1000));
          } else {
            console.error('❌ All retry attempts failed');
            throw error;
          }
        }
      }
      
      throw lastError;
    };

    try {
      const data = await submitResultWithRetry();
      
      // If the game is completed, store payout data and navigate
      if (data.status === 'completed' && data.payout) {
    
        
        // Create payout data object for localStorage
        const payoutData = {
          won: data.winner === publicKey?.toString(),
          isTie: data.winner === 'tie',
          winner: data.winner,
          numGuesses: result.numGuesses,
          entryFee: entryFee, // Use the actual entry fee from match data
          timeElapsed: `${Math.floor(result.totalTime / 1000)}s`,
          opponentTimeElapsed: 'N/A', // This will be updated when opponent finishes
          opponentGuesses: 0, // This will be updated when opponent finishes
          winnerAmount: data.payout?.winnerAmount || 0,
          feeAmount: data.payout?.feeAmount || 0,
          refundAmount: data.payout?.refundAmount || 0,
          isWinningTie: data.payout?.isWinningTie || false,
          feeWallet: data.payout?.feeWallet || '',
          transactions: data.payout?.transactions || [],
          automatedPayout: data.payout?.paymentSuccess || false,
          payoutSignature: data.payout?.transactions?.[0]?.signature || null
        };
        
        // Store payout data in localStorage
        safeLocalStorage.setItem('payoutData', JSON.stringify(payoutData));

        
        // Navigate to results page
        console.log('🏆 Game completed, navigating to results page');
        router.push(`/result?matchId=${matchId}`);
      } else if (data.status === 'waiting') {
        // Game is still waiting for other player, show waiting state
        console.log('⏳ Waiting for other player to finish...');
        setGameState('waiting');
        
        // Start polling for game completion
        const pollForCompletion = async () => {
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL;
            const response = await fetch(`${apiUrl}/api/match/status/${matchId}?wallet=${publicKey?.toString()}`);
            
            if (response.ok) {
              const matchData = await response.json();
              
              if (matchData.isCompleted && matchData.payout) {
                console.log('🏆 Game completed via polling:', matchData);
                
                // Create payout data from match data
                const isPlayer1 = publicKey?.toString() === matchData.player1;
                const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
                const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
                
                const payoutData = {
                  won: matchData.winner === publicKey?.toString(),
                  isTie: matchData.winner === 'tie',
                  winner: matchData.winner,
                  numGuesses: playerResult?.numGuesses || result.numGuesses,
                  entryFee: matchData.entryFee || entryFee,
                  timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : `${Math.floor(result.totalTime / 1000)}s`,
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
                
                safeLocalStorage.setItem('payoutData', JSON.stringify(payoutData));
        
                
                router.push(`/result?matchId=${matchId}`);
                return;
              }
            }
          } catch (error) {
            console.error('❌ Error polling for completion:', error);
          }
          
          // Continue polling if not completed
          setTimeout(pollForCompletion, 2000);
        };
        
        // Start polling after a short delay
        setTimeout(pollForCompletion, 2000);
      }
    } catch (error: any) {
      console.error('❌ Failed to submit result:', error);
      setError(`Failed to submit result: ${error.message}`);
      setGameState('error');
    } finally {
      setIsSubmittingResult(false);
    }
  }, [matchId, publicKey, guesses, startTime, entryFee, router, isSubmittingResult]);

  // Update the ref whenever handleGameEnd changes
  useEffect(() => {
    handleGameEndRef.current = handleGameEnd;
  }, [handleGameEnd]);

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
    
        
        if (!data.success) {
          console.error('❌ Game state fetch failed:', data.error);
          setNetworkStatus('disconnected');
          return;
        }
        
        setNetworkStatus('connected');
        
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
          console.log('⏰ Timer stopped - player solved the puzzle');
          // Don't show solved state - immediately submit result and go to waiting
          if (!playerResult && !isSubmittingResult) {
            console.log('🏆 Player solved, immediately submitting result');
            handleGameEnd(true, undefined, data.playerGuesses);
          }
        }
        
        if (data.opponentSolved && !opponentSolved) {
          setOpponentSolved(true);
          // Note: opponent solved, but current player continues playing until they finish
        }
        
        // Check if game is completed on the server side (both players finished)
        // Redirect if game is completed regardless of current state
        if (data.gameCompleted) {
      
          
          // Try to fetch the completed match data to get payout information
          try {
            const matchResponse = await fetch(`${apiUrl}/api/match/status/${matchId}`);
            if (matchResponse.ok) {
              const matchData = await matchResponse.json();
              if (matchData.payout && matchData.isCompleted) {
                // Create payout data from match data
                const isPlayer1 = publicKey?.toString() === matchData.player1;
                const playerResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
                const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
                
                const payoutData = {
                  won: matchData.winner === publicKey?.toString() && matchData.winner !== 'tie',
                  isTie: matchData.winner === 'tie',
                  winner: matchData.winner,
                  numGuesses: playerResult?.numGuesses || 0,
                  entryFee: matchData.entryFee || entryFee,
                  timeElapsed: playerResult ? `${Math.floor(playerResult.totalTime / 1000)}s` : 'N/A',
                  opponentTimeElapsed: opponentResult ? `${Math.floor(opponentResult.totalTime / 1000)}s` : 'N/A',
                  opponentGuesses: opponentResult?.numGuesses || 0,
                  winnerAmount: matchData.payout?.winnerAmount || 0,
                  feeAmount: matchData.payout?.feeAmount || 0,
                  feeWallet: matchData.payout?.feeWallet || '',
                  transactions: matchData.payout?.transactions || [],
                  automatedPayout: matchData.payout?.paymentSuccess || false,
                  payoutSignature: matchData.payout?.transactions?.[0]?.signature || null,
                  proposalId: matchData.payoutProposalId,
                  proposalStatus: matchData.proposalStatus
                };
                
                        // Store payout data in localStorage
        safeLocalStorage.setItem('payoutData', JSON.stringify(payoutData));
        
              }
            }
          } catch (error) {
            console.error('❌ Error fetching payout data:', error);
          }
          
          router.push(`/result?matchId=${matchId}`);
        }
        
        // If player has solved but hasn't submitted result yet, and they've run out of guesses, submit now
        if (data.solved && gameState === 'solved' && data.remainingGuesses === 0 && !playerResult && !isSubmittingResult) {
          console.log('🏆 Player solved but ran out of guesses, submitting result');
          handleGameEnd(true, undefined, data.playerGuesses);
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
  }, [matchId, publicKey, opponentSolved, gameState, router, startTime, playerResult, handleGameEnd, entryFee]);

  // Update the ref whenever memoizedFetchGameState changes
  useEffect(() => {
    memoizedFetchGameStateRef.current = memoizedFetchGameState;
  }, [memoizedFetchGameState]);

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
        gameMatchId = safeLocalStorage.getItem('matchId') || '';
      
        }

        if (!gameMatchId) {
          console.error('❌ No match ID found in URL or localStorage');
          router.push('/lobby');
          return;
        }

        setMatchId(gameMatchId);

        // Fetch match data from backend
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/status/${gameMatchId}?wallet=${publicKey?.toString()}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch match data');
        }

        const matchData = await response.json();
        
        // Verify match is active and player is part of this match
        if (matchData.status !== 'active') {
          console.log('⚠️ Match is not active, status:', matchData.status);
          
          // Handle cancelled matches
          if (matchData.status === 'cancelled') {
            console.log('⚠️ Match was cancelled, redirecting to lobby');
            // Clear stale match data before redirecting
            safeLocalStorage.removeItem('matchId');
            safeLocalStorage.removeItem('word');
            safeLocalStorage.removeItem('entryFee');
            router.push('/lobby');
            return;
          }
          
          // If both players have paid but status is still payment_required, wait a moment and retry
          if (matchData.status === 'payment_required' && matchData.player1Paid && matchData.player2Paid) {
            console.log('⏳ Both players paid but game not yet active, waiting...');
            setTimeout(() => {
              router.reload();
            }, 2000);
            return;
          }
          
          // If match is completed, redirect to result page
          if (matchData.status === 'completed' || matchData.isCompleted) {
            console.log('✅ Match is completed, redirecting to result page');
            router.push(`/result?matchId=${gameMatchId}`);
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
        await memoizedFetchGameStateRef.current?.();

        setLastActivity(Date.now());
        setLoading(false);

      } catch (error) {
        console.error('❌ Error initializing game:', error);
        setError(error instanceof Error ? error.message : 'Failed to initialize game');
        setLoading(false);
      }
    };

    initializeGame();
  }, [publicKey, router, entryFee]);

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

  // Enhanced edge case handling for browser/tab management
  useEffect(() => {
    // Handle browser visibility changes (tab switching, minimizing)
    const handleVisibilityChange = () => {
      if (document.hidden) {
        console.log('📱 Tab/window hidden - pausing game updates');
        setNetworkStatus('disconnected');
      } else {
        console.log('📱 Tab/window visible - resuming game updates');
        setNetworkStatus('connected');
        // Refresh game state when tab becomes visible
        if (gameState === 'playing') {
          memoizedFetchGameStateRef.current?.();
        }
      }
    };

    // Handle page focus/blur events
    const handleFocus = () => {
      console.log('📱 Page focused - refreshing game state');
      if (gameState === 'playing') {
        memoizedFetchGameStateRef.current?.();
      }
    };

    // Handle beforeunload (page refresh/close)
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (gameState === 'playing' && !playerSolved) {
        const message = 'Game in progress! Are you sure you want to leave?';
        e.preventDefault();
        e.returnValue = message;
        return message;
      }
    };

    // Handle storage quota exceeded errors
    const handleStorageError = (e: StorageEvent) => {
      if (e.key === null && e.newValue === null) {
        console.error('❌ localStorage quota exceeded or corrupted');
        setError('Storage error - please refresh the page');
      }
    };

    // Add event listeners
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('storage', handleStorageError);

    // Mobile-specific handling
    const handleOrientationChange = () => {
      console.log('📱 Orientation changed - refreshing layout');
      // Force a small delay to let orientation settle
      setTimeout(() => {
        window.dispatchEvent(new Event('resize'));
      }, 100);
    };

    window.addEventListener('orientationchange', handleOrientationChange);

    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('storage', handleStorageError);
      window.removeEventListener('orientationchange', handleOrientationChange);
    };
  }, [gameState, playerSolved]);

  // Timer countdown
  useEffect(() => {
    if (!timerActive || gameState !== 'playing') {
      if (timerActive && gameState !== 'playing') {
        console.log('⏰ Timer stopped - game state changed to:', gameState);
        setTimerActive(false);
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 0) {
          clearInterval(timer);
          setTimerActive(false);
          console.log('⏰ Timer reached zero, submitting timeout result');
          if (!isSubmittingResult && !playerResult) {
            console.log('⏰ Calling handleGameEnd with timeout reason');
            handleGameEndRef.current?.(false, 'timeout');
          } else {
            console.log('⏰ Skipping timeout submission - already submitting or has result:', { isSubmittingResult, hasPlayerResult: !!playerResult });
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timerActive, gameState, isSubmittingResult, playerResult]);

  // Start timer when game begins
  useEffect(() => {
    if (gameState === 'playing' && !timerActive) {
      console.log('⏰ Starting 2-minute timer');
      setTimeRemaining(120); // Reset timer to 2 minutes
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
        await memoizedFetchGameStateRef.current?.();
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
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(pollInterval);
  }, [matchId, gameState, publicKey]);

  // Check for inactivity timeout (5 minutes)
  useEffect(() => {
    const checkTimeout = setInterval(() => {
      const now = Date.now();
      const inactiveTime = now - lastActivity;
      const timeoutMs = 5 * 60 * 1000; // 5 minutes

      if (inactiveTime > timeoutMs && gameState === 'playing') {
        console.log('⏰ Player inactive for too long, auto-losing');
        if (!isSubmittingResult) {
          handleGameEndRef.current?.(false, 'timeout');
        }
      }
    }, 30000); // Check every 30 seconds

    return () => clearInterval(checkTimeout);
  }, [lastActivity, gameState]);

  // Handle opponent solved state change - but don't end current player's game
  // Players should continue until they either solve or reach 7 guesses
  useEffect(() => {
    if (opponentSolved && gameState === 'playing') {
      console.log('🏆 Opponent solved, but continuing to play until I finish');
      // Don't call handleGameEnd - let the player continue making guesses
      // The game will end naturally when both players have finished
    }
  }, [opponentSolved, gameState]);

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
    
    const submitGuessWithRetry = async (retryCount = 0): Promise<{ solved: boolean; totalGuesses: number; remainingGuesses: number } | null> => {
      try {
        // Submit guess to server with timeout
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout for guess submission
        
        // Use the proper submitGuess function that handles ReCaptcha
        const guessData = await submitGuess(matchId, publicKey?.toString() || '', guess);

        clearTimeout(timeoutId);

        
        // Add a small delay after successful guess to prevent rapid submissions
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Immediately fetch updated game state
        await memoizedFetchGameStateRef.current?.();
        
        return guessData;
        
      } catch (error) {
        console.error(`❌ Error submitting guess (attempt ${retryCount + 1}):`, error);
        
        // Retry up to 2 times for network errors
        if (retryCount < 2 && error instanceof Error && 
            (error.name === 'AbortError' || error.message.includes('Failed to fetch'))) {
  
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
  

      if (result.solved) {
        console.log('🎉 Player solved the word! Submitting result immediately...');
        setGameState('solved');
        setPlayerSolved(true);
        setTimerActive(false);
        // FIXED: Use the current guesses array since the server response doesn't include guesses
        const currentGuesses = [...guesses, currentGuess];
        if (!isSubmittingResult) {
          handleGameEnd(true, 'solved', currentGuesses);
        }
        return; // Exit early to prevent further processing
      } else if (result.remainingGuesses === 0) {
        setGameState('solved');
        setTimerActive(false);
        // FIXED: Use current guesses array for consistency
        const currentGuesses = [...guesses, currentGuess];
        if (playerSolved && !isSubmittingResult) {
          handleGameEnd(true, 'solved', currentGuesses);
        } else if (!isSubmittingResult) {
          handleGameEnd(false, 'out_of_guesses', currentGuesses);
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
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-6" />
        
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
              {playerResult?.won ? '🎉 You solved it!' : '🏁 You finished!'}
            </div>
            <div className="text-white text-lg mb-4">
              Your Guesses: {playerResult?.numGuesses || guesses.length}/7
              {playerResult?.numGuesses === 7 && ' (All guesses used)'}
            </div>
            <div className="text-accent text-lg font-semibold mb-4">
              ⏳ Waiting for opponent to finish...
            </div>
            <div className="text-white/60 text-sm mb-4">
              Results will be available once both players complete the game
            </div>
            <div className="text-white/40 text-xs">
              Processing your result... Please wait
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
              {playerResult?.won ? '🏆 You won!' : '😔 You lost'}
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