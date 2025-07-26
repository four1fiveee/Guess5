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

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    // Get match data from localStorage
    const storedMatchId = localStorage.getItem('matchId');
    const storedWord = localStorage.getItem('word');

    if (!storedMatchId || !storedWord) {
      console.error('❌ Missing match data');
      router.push('/lobby');
      return;
    }

    setMatchId(storedMatchId);
    setWord(storedWord);

    console.log('🎮 Starting game with word:', storedWord);
    console.log('🎮 Match ID:', storedMatchId);

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

  if (!word) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-white text-xl">Loading game...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
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