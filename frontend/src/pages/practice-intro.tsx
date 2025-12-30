import React from 'react';
import { useRouter } from 'next/router';
import { TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function PracticeIntro() {
  const router = useRouter();

  return (
    <div className="flex flex-col items-center min-h-screen bg-primary px-6 py-12 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        
        {/* Header */}
        <div className="w-full mb-8">
          <Link href="/lobby">
            <button className="bg-accent text-primary text-xs sm:text-sm font-bold px-4 py-2.5 sm:py-3 rounded-lg shadow hover:bg-yellow-400 hover:shadow-lg transition-all duration-200 min-h-[44px] flex items-center justify-center">
              ← Back to Lobby
            </button>
          </Link>
        </div>

        <h1 className="text-4xl font-bold text-accent mb-8 text-center">Practice Round</h1>

        {/* Practice Explanation */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-4xl w-full text-accent shadow mb-6">
          <h2 className="text-2xl font-bold text-accent mb-4">How Practice Mode Works</h2>
          
          <div className="space-y-4 text-sm text-white/90">
            <div className="bg-white/5 rounded-lg p-4 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-2">What is Practice Mode?</h3>
              <p className="text-white/80">
                Practice mode lets you play a full game without any real money at stake. It's perfect for learning the rules and getting comfortable with the gameplay before competing for real rewards.
              </p>
            </div>

            <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
              <h3 className="text-lg font-bold text-blue-300 mb-2">Practice vs. Real Games</h3>
              <div className="space-y-2 text-white/80 text-sm">
                <p><strong className="text-white">In Practice Mode:</strong></p>
                <ul className="list-disc list-inside ml-4 space-y-1">
                  <li>No wallet deposit required</li>
                  <li>No queue or waiting for opponents</li>
                  <li>Play at your own pace (within 2 minutes)</li>
                  <li>No real money at stake</li>
                  <li>See how the game works end-to-end</li>
                </ul>
                <p className="mt-3"><strong className="text-white">In Real Games:</strong></p>
                <ul className="list-disc list-inside ml-4 space-y-1">
                  <li>You'll be matched with another player</li>
                  <li>Both players deposit entry fee to secure escrow vault</li>
                  <li>Winner receives 95% of the pot (both entry fees)</li>
                  <li>Platform fee: 5%</li>
                  <li>Fastest completion time wins if tied on guesses</li>
                </ul>
              </div>
            </div>

            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
              <h3 className="text-lg font-bold text-yellow-300 mb-2">Ready to Practice?</h3>
              <p className="text-white/80 text-sm">
                Click the button below to start your practice round. You'll play a complete game just like a real match, 
                but without any financial commitment. After you finish, you'll see what the results page looks like, 
                and then you can return to the lobby to compete for real rewards!
              </p>
            </div>
          </div>
        </div>

        {/* Start Practice Button */}
        <div className="w-full flex justify-center gap-4 mb-6">
          <button
            onClick={() => router.push('/practice-game')}
            className="bg-gradient-to-r from-accent via-yellow-400 to-accent text-primary text-lg font-black px-8 py-4 rounded-lg shadow-lg hover:from-yellow-300 hover:via-accent hover:to-yellow-300 transition-all duration-300 transform hover:scale-105 active:scale-95 min-h-[52px] flex items-center justify-center gap-2"
          >
            <span>Start Practice Round</span>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>

        {/* Back to Lobby */}
        <div className="w-full text-center">
          <Link href="/lobby">
            <button className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-6 py-3 rounded-lg transition-all duration-200 border border-white/20 hover:border-white/30">
              Return to Lobby
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

