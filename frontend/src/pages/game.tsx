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
        const response = await fetch(`http://localhost:4000/api/match/status/${gameMatchId}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch match data');
        }

        const matchData = await response.json();
        
        // Verify player is part of this match
        if (matchData.player1 !== publicKey.toString() && matchData.player2 !== publicKey.toString()) {
          throw new Error('You are not part of this match');
        }

        setWord(matchData.word);
        console.log('🎮 Starting game with word:', matchData.word);
        console.log('🎮 Match ID:', gameMatchId);

      } catch (error) {
        console.error('❌ Error initializing game:', error);
        setError(error instanceof Error ? error.message : 'Failed to load game');
      } finally {
        setLoading(false);
      }
    };

    initializeGame();
  }, [publicKey, router]);

  const handleGuess = (guess: string) => {
    if (gameState !== 'playing') return;

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

  const handleGameEnd = async (won: boolean) => {
    if (!publicKey || !matchId) return;

    const result = {
      won,
      numGuesses: guesses.length + 1,
      totalTime: Date.now() - (window as any).gameStartTime || 0,
      guesses: [...guesses, currentGuess]
    };

    console.log('🏁 Game ended:', result);

    try {
      const response = await fetch('http://localhost:4000/api/match/submit-result', {
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
            <h1 className="text-3xl font-bold text-white mb-2">Guess5</h1>
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