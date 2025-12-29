import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function PracticeResult() {
  const router = useRouter();
  const [practiceResult, setPracticeResult] = useState<{
    won: boolean;
    numGuesses: number;
    totalTime: number;
    guesses: string[];
  } | null>(null);
  const [targetWord, setTargetWord] = useState<string>('');

  useEffect(() => {
    // Load practice result from localStorage
    const storedResult = localStorage.getItem('practiceResult');
    const storedWord = localStorage.getItem('practiceTargetWord');
    
    if (storedResult) {
      setPracticeResult(JSON.parse(storedResult));
    }
    if (storedWord) {
      setTargetWord(storedWord);
    }

    // Clean up localStorage
    return () => {
      localStorage.removeItem('practiceResult');
      localStorage.removeItem('practiceTargetWord');
    };
  }, []);

  if (!practiceResult) {
    return (
      <div className="flex flex-col items-center min-h-screen bg-primary px-6 py-12">
        <TopRightWallet />
        <div className="text-white text-lg">Loading results...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center min-h-screen bg-primary px-6 py-12 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        
        {/* Practice Mode Banner */}
        <div className="w-full mb-6">
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2 text-blue-300 text-sm font-semibold">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Practice Mode - This is a practice round
            </div>
          </div>
        </div>

        {/* Results Header */}
        <h1 className="text-4xl font-bold text-accent mb-8 text-center">Game Results</h1>

        {/* Results Card */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            {/* Player 1 (You) */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3">Your Results</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/70">Status:</span>
                  <span className={`font-bold ${practiceResult.won ? 'text-green-400' : 'text-red-400'}`}>
                    {practiceResult.won ? 'Solved' : 'Not Solved'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Guesses:</span>
                  <span className="text-white font-bold">{practiceResult.numGuesses}/7</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Time:</span>
                  <span className="text-white font-bold">{Math.floor(practiceResult.totalTime / 1000)}s</span>
                </div>
                {!practiceResult.won && targetWord && (
                  <div className="flex justify-between">
                    <span className="text-white/70">Word was:</span>
                    <span className="text-accent font-bold">{targetWord}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Player 2 (N/A) */}
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3">Opponent Results</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/70">Status:</span>
                  <span className="text-white/50 font-bold">N/A</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Guesses:</span>
                  <span className="text-white/50 font-bold">N/A</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/70">Time:</span>
                  <span className="text-white/50 font-bold">N/A</span>
                </div>
              </div>
            </div>
          </div>

          {/* Practice Mode Explanation */}
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4 mb-6">
            <h4 className="text-lg font-bold text-yellow-300 mb-2">Why is Player 2 showing N/A?</h4>
            <p className="text-white/80 text-sm leading-relaxed mb-3">
              This is a <strong className="text-white">practice round</strong>, so you're playing solo. In a real game, you would be matched with another player, and you would see their results here.
            </p>
            <p className="text-white/80 text-sm leading-relaxed">
              In a real game, you would also see:
            </p>
            <ul className="list-disc list-inside ml-4 mt-2 space-y-1 text-white/80 text-sm">
              <li>The amount you won (if you were the winner)</li>
              <li>Your entry fee and potential winnings</li>
              <li>Transaction signatures for the payout</li>
              <li>Platform bonus information (if eligible)</li>
            </ul>
          </div>

          {/* Outcome Summary */}
          <div className="bg-white/5 rounded-lg p-4 border border-white/10 mb-6">
            <h4 className="text-lg font-bold text-accent mb-2">Practice Round Summary</h4>
            <p className="text-white/80 text-sm">
              {practiceResult.won 
                ? `Great job! You solved the word in ${practiceResult.numGuesses} ${practiceResult.numGuesses === 1 ? 'guess' : 'guesses'} in ${Math.floor(practiceResult.totalTime / 1000)} seconds.`
                : `You used all 7 guesses. The word was "${targetWord}". Keep practicing!`
              }
            </p>
            <p className="text-white/70 text-xs mt-2">
              In a real game, the player who solves the word in fewer guesses wins. If both players use the same number of guesses, the fastest time wins.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="w-full flex flex-col sm:flex-row justify-center gap-4">
          <Link href="/lobby">
            <button className="bg-gradient-to-r from-accent via-yellow-400 to-accent text-primary text-lg font-black px-8 py-4 rounded-lg shadow-lg hover:from-yellow-300 hover:via-accent hover:to-yellow-300 transition-all duration-300 transform hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center gap-2">
              <span>Return to Lobby</span>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </button>
          </Link>
          <Link href="/practice-intro">
            <button className="bg-white/10 hover:bg-white/20 text-white text-lg font-medium px-8 py-4 rounded-lg transition-all duration-200 border border-white/20 hover:border-white/30 min-h-[52px] flex items-center justify-center">
              Play Another Practice Round
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

