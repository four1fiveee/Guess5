import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import GameGrid from '../components/GameGrid';

const Game: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [word, setWord] = useState('');
  const [guesses, setGuesses] = useState<string[]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameState, setGameState] = useState<'playing' | 'won' | 'lost'>('playing');
  const [matchId, setMatchId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [gameStartTime, setGameStartTime] = useState<number>(0);
  const [lastActivity, setLastActivity] = useState<number>(0);
  const [opponentSolved, setOpponentSolved] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    const initializeGame = async () => {
      try {
        // Get matchId from URL or localStorage as fallback
        const urlMatchId = router.query.matchId as string;
        const storedMatchId = localStorage.getItem('matchId');
        const gameMatchId = urlMatchId || storedMatchId;

        if (!gameMatchId) {
          console.error('❌ No match ID found');
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
        
        // Verify player is part of this match
        if (matchData.player1 !== publicKey.toString() && matchData.player2 !== publicKey.toString()) {
          throw new Error('You are not part of this match');
        }

        setWord(matchData.word);
        // console.log('🎮 Starting game with word:', matchData.word);
        // console.log('🎮 Match ID:', gameMatchId);

        // Set game start time with microsecond precision
        const startTime = performance.now();
        setGameStartTime(startTime);
        setLastActivity(Date.now()); // Keep activity tracking in milliseconds
        (window as any).gameStartTime = startTime;

        // Check if there are existing results for this player
        const isPlayer1 = matchData.player1 === publicKey.toString();
        const existingResult = isPlayer1 ? matchData.player1Result : matchData.player2Result;
        
        if (existingResult) {
          console.log('🔄 Found existing result, restoring game state');
          setGuesses(existingResult.guesses || []);
          setGameState(existingResult.won ? 'won' : 'lost');
        }

      } catch (error) {
        console.error('❌ Error initializing game:', error);
        setError(error instanceof Error ? error.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    };

    initializeGame();
  }, [publicKey, router]);

  // Update last activity on any user interaction
  useEffect(() => {
    const updateActivity = () => {
      setLastActivity(Date.now());
    };

    window.addEventListener('click', updateActivity);
    window.addEventListener('keydown', updateActivity);
    window.addEventListener('focus', updateActivity);

    return () => {
      window.removeEventListener('click', updateActivity);
      window.removeEventListener('keydown', updateActivity);
      window.removeEventListener('focus', updateActivity);
    };
  }, []);

  // Poll for opponent's status
  useEffect(() => {
    if (!matchId || gameState !== 'playing') return;

    const pollInterval = setInterval(async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/status/${matchId}`);
        
        if (response.ok) {
          const matchData = await response.json();
          
          // Check if opponent has solved
          const isPlayer1 = matchData.player1 === publicKey?.toString();
          const opponentResult = isPlayer1 ? matchData.player2Result : matchData.player1Result;
          
          if (opponentResult && opponentResult.won) {
            console.log('🏆 Opponent solved the puzzle!');
            setOpponentSolved(true);
            
            // If we haven't solved yet, we lost
            if (gameState === 'playing') {
              console.log('❌ We lost - opponent solved first');
              handleGameEnd(false, 'opponent_solved');
            }
          }
          
          // Check if game is completed
          if (matchData.status === 'completed') {
            console.log('🏁 Game completed by backend');
            clearInterval(pollInterval);
            
            // Navigate to result page
            router.push(`/result?matchId=${matchId}`);
          }
        }
      } catch (error) {
        console.error('❌ Error polling match status:', error);
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(pollInterval);
  }, [matchId, gameState, publicKey, router]);

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

  const handleGuess = (guess: string) => {
    if (gameState !== 'playing') return;

    setLastActivity(Date.now()); // Update activity on guess
    const newGuesses = [...guesses, guess];
    setGuesses(newGuesses);

    if (guess === word) {
      setGameState('won');
      handleGameEnd(true);
    } else if (newGuesses.length >= 6) {
      setGameState('lost');
      handleGameEnd(false);
    }
  };

  const handleGameEnd = async (won: boolean, reason?: string) => {
    if (!publicKey || !matchId) return;

    // Calculate time with microsecond precision
    const endTime = performance.now();
    const totalTime = endTime - gameStartTime;

    const result = {
      won,
      numGuesses: guesses.length + 1,
      totalTime: totalTime, // Microsecond precision
      guesses: [...guesses, currentGuess],
      reason: reason || 'normal'
    };

    console.log('🏁 Game ended:', result);
    console.log('⏱️ Time precision:', {
      startTime: gameStartTime,
      endTime: endTime,
      totalTime: totalTime,
      precision: 'microseconds'
    });

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      const response = await fetch(`${apiUrl}/api/match/submit-result`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId,
          wallet: publicKey.toString(),
          result
        }),
      });

      const data = await response.json();
      console.log('📝 Result submitted:', data);

      if (data.status === 'completed') {
        // Store payout data for results page
        localStorage.setItem('payoutData', JSON.stringify(data.payout));
        router.push('/result');
      } else if (reason === 'opponent_solved') {
        // Opponent solved first - navigate to result immediately
        console.log('🏆 Opponent solved first, navigating to result');
        router.push(`/result?matchId=${matchId}`);
      } else {
        console.log('⏳ Waiting for other player...');
      }

    } catch (error) {
      console.error('❌ Error submitting result:', error);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading game...</div>
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
              onClick={() => router.push('/lobby')}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-lg transition-colors"
            >
              Back to Lobby
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!word) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading game...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-primary">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-md mx-auto">
          <div className="text-center mb-8">
            <p className="text-white/80">Guess the 5-letter word in 6 tries</p>
          </div>

          <GameGrid
            word={word}
            guesses={guesses}
            currentGuess={currentGuess}
            setCurrentGuess={setCurrentGuess}
            onGuess={handleGuess}
            gameState={gameState}
          />

          {gameState !== 'playing' && (
            <div className="mt-8 text-center">
              <div className="text-white text-xl mb-4">
                {gameState === 'won' ? '🎉 You Won!' : '😔 Game Over'}
              </div>
              <p className="text-white/80 mb-4">
                The word was: <span className="font-bold">{word}</span>
              </p>
              <p className="text-white/60 text-sm">
                Waiting for other player to finish...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Game; 