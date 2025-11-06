import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-4 sm:mb-6" />
        
        {/* Trust Badges - Quick visual trust signals */}
        <div className="flex flex-wrap justify-center gap-3 mb-6 max-w-md">
          <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 rounded-full px-3 py-1.5">
            <span className="text-green-400 text-xs">✓</span>
            <span className="text-white/90 text-xs font-medium">Non-Custodial</span>
          </div>
          <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 rounded-full px-3 py-1.5">
            <span className="text-green-400 text-xs">✓</span>
            <span className="text-white/90 text-xs font-medium">2-of-3 Multisig</span>
          </div>
          <div className="flex items-center gap-1.5 bg-green-500/10 border border-green-500/30 rounded-full px-3 py-1.5">
            <span className="text-green-400 text-xs">✓</span>
            <span className="text-white/90 text-xs font-medium">Squads Protocol</span>
          </div>
        </div>

        {/* Main CTA */}
        <Link href="/lobby">
          <button className="bg-gradient-to-r from-accent to-yellow-400 text-primary text-lg sm:text-xl font-bold px-10 py-5 rounded-2xl shadow-2xl hover:shadow-accent/50 hover:from-yellow-300 hover:to-accent transition-all duration-300 transform hover:scale-110 active:scale-95 mb-3 min-h-[56px] flex items-center justify-center border-2 border-accent/30 hover:border-accent/60">
            🎮 Play Now
          </button>
        </Link>
        <p className="text-xs sm:text-sm text-white/80 mb-6 sm:mb-8 text-center font-medium">Stake your skill, win with words</p>

        {/* How to Play - Simplified */}
        <div className="bg-gradient-to-br from-white/5 via-white/10 to-white/5 backdrop-blur-sm rounded-2xl p-6 sm:p-8 max-w-4xl w-full text-accent shadow-xl border border-white/20 mb-6 sm:mb-8 hover:shadow-2xl transition-all duration-300">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4 sm:mb-6 text-center">How It Works</h2>
          <div className="text-xs sm:text-sm text-white/90 space-y-2.5 sm:space-y-3">
            <div className="flex items-start space-x-2.5">
              <span className="text-accent font-bold text-base sm:text-lg flex-shrink-0">1.</span>
              <span><b>Choose your stake:</b> Select $5, $20, $50, or $100 (paid in SOL). Entry fees are held in a secure multisig vault</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <span className="text-accent font-bold text-base sm:text-lg flex-shrink-0">2.</span>
              <span><b>Get matched instantly:</b> Our matchmaking system pairs you with another player at the same stake level</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <span className="text-accent font-bold text-base sm:text-lg flex-shrink-0">3.</span>
              <span><b>Guess the 5-letter word:</b> You have 7 tries. Green = correct letter & position, Yellow = correct letter wrong position, Gray = not in word</span>
            </div>
            <div className="flex items-start space-x-2.5">
              <span className="text-accent font-bold text-base sm:text-lg flex-shrink-0">4.</span>
              <span><b>Win the pot:</b> Fewest guesses wins! Winner gets 95% of the pot (you must sign to claim). 5% platform fee covers infrastructure</span>
            </div>
          </div>
        </div>

        {/* Non-Custodial Security - Improved hierarchy */}
        <div className="bg-gradient-to-br from-green-900/30 via-green-800/20 to-green-900/30 backdrop-blur-sm border-2 border-green-400/50 rounded-2xl p-6 sm:p-8 max-w-4xl w-full text-accent shadow-xl hover:shadow-green-400/20 transition-all duration-300">
          <h2 className="text-xl sm:text-2xl font-bold text-green-400 mb-4 text-center flex items-center justify-center gap-3">
            <span className="text-2xl">🔒</span>
            <span>Your Funds Are Protected</span>
          </h2>
          <p className="text-xs sm:text-sm text-white/90 mb-4 text-center leading-relaxed">
            We <b>never</b> have custody of your money. Guess5 uses <b>Squads Protocol 2-of-3 multisig vaults</b> to ensure you're always in control.
          </p>
          
          <div className="bg-black bg-opacity-30 rounded-lg p-3 sm:p-4 mb-3 sm:mb-4">
            <div className="text-xs sm:text-sm text-white/90 space-y-3">
              <div className="flex items-start space-x-2.5">
                <span className="text-green-400 font-bold text-base flex-shrink-0">•</span>
                <span><b>2-of-3 Signatures:</b> Every match creates a vault requiring 2 of 3 signatures: <i>You</i>, <i>Your Opponent</i>, and <i>Guess5</i></span>
              </div>
              <div className="flex items-start space-x-2.5">
                <span className="text-green-400 font-bold text-base flex-shrink-0">•</span>
                <span><b>You Must Sign to Claim:</b> Winners must sign with their wallet to receive payouts. We propose, you approve</span>
              </div>
              <div className="flex items-start space-x-2.5">
                <span className="text-green-400 font-bold text-base flex-shrink-0">•</span>
                <span><b>Funds Locked On-Chain:</b> Your funds are stored in an audited Squads Protocol multisig vault on Solana blockchain during gameplay. We cannot access them alone—we need at least one player signature to move funds. Funds can only move after games complete or timeouts, and only when a player signs to approve the transaction.</span>
              </div>
            </div>
          </div>

          <p className="text-xs sm:text-sm text-green-400 text-center font-semibold">
            ✓ Squads Protocol • ✓ Non-Custodial • ✓ You're In Control
          </p>
        </div>

        {/* Quick Links */}
        <div className="flex gap-4 mt-6 sm:mt-8 mb-6 sm:mb-8 flex-wrap justify-center">
          <Link href="/info">
            <button className="bg-gradient-to-r from-white/10 to-white/5 hover:from-white/20 hover:to-white/10 text-white text-sm sm:text-base font-semibold px-6 py-3 sm:py-3.5 rounded-xl shadow-lg border border-white/20 hover:border-white/40 transition-all duration-300 min-h-[48px] flex items-center justify-center transform hover:scale-105 active:scale-95">
              📚 Rules, FAQ & Match History
            </button>
          </Link>
        </div>

        {/* Social Links */}
        <div className="flex gap-4 mt-6 mb-8 justify-center items-center">
          <a
            href="https://discord.gg/CcXWUv7r"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gradient-to-r from-indigo-600 to-indigo-700 hover:from-indigo-500 hover:to-indigo-600 text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-lg border border-indigo-400/40 hover:border-indigo-300/60 transition-all duration-300 min-h-[48px] flex items-center justify-center gap-2 transform hover:scale-105 active:scale-95"
          >
            <span>💬</span>
            <span>Join Discord</span>
          </a>
          <a
            href="https://instagram.com/Guess5.io"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 hover:from-purple-500 hover:via-pink-500 hover:to-purple-500 text-white text-sm font-semibold px-6 py-3 rounded-xl shadow-lg border border-purple-400/40 hover:border-purple-300/60 transition-all duration-300 min-h-[48px] flex items-center justify-center gap-2 transform hover:scale-105 active:scale-95"
          >
            <span>📷</span>
            <span>@Guess5.io</span>
          </a>
        </div>
      </div>
    </div>
  );
} 