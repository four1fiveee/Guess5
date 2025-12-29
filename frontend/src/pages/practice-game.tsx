import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { TopRightWallet } from '../components/WalletConnect';
import GameGrid from '../components/GameGrid';
import wordList from '../components/wordList';

export default function PracticeGame() {
  const router = useRouter();
  const [guesses, setGuesses] = useState<string[]>([]);
  const [currentGuess, setCurrentGuess] = useState('');
  const [gameState, setGameState] = useState<'playing' | 'solved' | 'completed'>('playing');
  const [playerResult, setPlayerResult] = useState<{
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null>(null);
  const [targetWord, setTargetWord] = useState<string>('');
  const [remainingGuesses, setRemainingGuesses] = useState<number>(7);
  const [timeRemaining, setTimeRemaining] = useState<number>(120); // 2 minutes
  const [timerActive, setTimerActive] = useState<boolean>(true);
  const [startTime, setStartTime] = useState<number>(0);
  const startTimeRef = useRef<number>(0);

  const handleGameEnd = (won: boolean, reason?: string) => {
    if (gameState !== 'playing') return;

    const endTime = Date.now();
    const totalTime = endTime - startTimeRef.current;
    const numGuesses = guesses.length + (won ? 1 : 0); // +1 if they just solved it

    const result = {
      won,
      numGuesses,
      totalTime,
      guesses: won ? [...guesses, currentGuess] : guesses,
    };

    setPlayerResult(result);
    setGameState('solved');

    // Store result for results page
    localStorage.setItem('practiceResult', JSON.stringify(result));
    localStorage.setItem('practiceTargetWord', targetWord);

    // Navigate to results page after a brief delay
    setTimeout(() => {
      router.push('/practice-result');
    }, 2000);
  };

  // Initialize game
  useEffect(() => {
    // Select random word
    const randomWord = wordList[Math.floor(Math.random() * wordList.length)].toUpperCase();
    setTargetWord(randomWord);
    setStartTime(Date.now());
    startTimeRef.current = Date.now();
    setTimerActive(true);
    console.log('🎮 Practice game started, target word:', randomWord);
  }, []);

  // Timer countdown
  useEffect(() => {
    if (!timerActive || gameState !== 'playing') {
      return;
    }

    const timer = setInterval(() => {
      setTimeRemaining(prev => {
        if (prev <= 0) {
          clearInterval(timer);
          setTimerActive(false);
          handleGameEnd(false, 'timeout');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [timerActive, gameState]);

  const handleGuess = async (guess: string) => {
    if (gameState !== 'playing') return;
    if (guesses.includes(guess)) return;
    if (guess.length !== 5) return;
    if (remainingGuesses <= 0) return;

    const upperGuess = guess.toUpperCase();
    const newGuesses = [...guesses, upperGuess];
    setGuesses(newGuesses);
    setCurrentGuess('');
    setRemainingGuesses(prev => prev - 1);

    // Check if solved
    if (upperGuess === targetWord) {
      setCurrentGuess(upperGuess);
      handleGameEnd(true, 'solved');
      return;
    }

    // Check if out of guesses
    if (newGuesses.length >= 7) {
      handleGameEnd(false, 'out_of_guesses');
      return;
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col items-center min-h-screen bg-primary px-6 py-12 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        
        {/* Header */}
        <div className="w-full mb-6">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 text-blue-300 text-sm font-semibold">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Practice Mode - No real money at stake
            </div>
          </div>
        </div>

        {/* Timer and Guesses */}
        <div className="flex gap-4 mb-6 flex-wrap justify-center">
          <div className="bg-white/10 rounded-lg px-6 py-3 border border-white/20">
            <div className="text-white/70 text-xs mb-1">Time Remaining</div>
            <div className={`text-2xl font-bold ${timeRemaining <= 30 ? 'text-red-400' : 'text-white'}`}>
              {formatTime(timeRemaining)}
            </div>
          </div>
          <div className="bg-white/10 rounded-lg px-6 py-3 border border-white/20">
            <div className="text-white/70 text-xs mb-1">Guesses Remaining</div>
            <div className="text-2xl font-bold text-white">
              {remainingGuesses}/7
            </div>
          </div>
        </div>

        {/* Game Grid */}
        {gameState === 'playing' && (
          <div className="mb-6 w-full">
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
        {gameState === 'solved' && playerResult && (
          <div className="bg-gradient-to-br from-white/5 via-white/10 to-white/5 backdrop-blur-sm rounded-2xl p-6 mb-6 border border-white/20 shadow-xl max-w-md w-full text-center">
            <div className="text-3xl font-bold text-accent mb-3">
              {playerResult.won ? '🎉 You solved it!' : '❌ Game Over'}
            </div>
            <div className="text-white text-xl font-semibold mb-2">
              Guesses: {playerResult.numGuesses}/7
            </div>
            <div className="text-white/70 text-sm mb-2">
              Time: {Math.floor(playerResult.totalTime / 1000)}s
            </div>
            {!playerResult.won && (
              <div className="text-white/60 text-sm mt-2">
                The word was: <span className="font-bold text-accent">{targetWord}</span>
              </div>
            )}
            <div className="text-white/50 text-xs mt-4">
              Redirecting to results...
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

