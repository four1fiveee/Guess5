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
          <button className="bg-accent text-primary text-lg sm:text-xl font-bold px-8 py-4 rounded-lg shadow-lg hover:bg-yellow-400 hover:shadow-xl transition-all duration-200 transform hover:scale-105 active:scale-95 mb-2 min-h-[52px] flex items-center justify-center">
            Play Now
          </button>
        </Link>
        <p className="text-xs sm:text-sm text-white/80 mb-4 sm:mb-6 text-center">Stake your skill, win with words</p>

        {/* How to Play - Simplified */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-4 sm:p-6 max-w-4xl w-full text-accent shadow mb-4 sm:mb-6">
          <h2 className="text-base sm:text-lg font-bold text-accent mb-3 sm:mb-4 text-center">How It Works</h2>
          <div className="text-xs sm:text-sm text-white/90 space-y-2.5 sm:space-y-3">
            <div className="flex items-start space-x-2.5">
              <span className="text-accent font-bold text-base sm:text-lg flex-shrink-0">1.</span>
              <span><b>Choose your stake:</b> Select $1, $5, $20, or $100 (paid in SOL). Entry fees are held in a secure multisig vault</span>
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
        <div className="bg-green-900 bg-opacity-20 border border-green-400 rounded-lg p-4 sm:p-6 max-w-4xl w-full text-accent shadow">
          <h2 className="text-base sm:text-lg font-bold text-green-400 mb-3 text-center flex items-center justify-center gap-2">
            <span>🔒</span>
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
        <div className="flex gap-3 mt-4 sm:mt-6 mb-4 sm:mb-6 flex-wrap justify-center">
          <Link href="/info">
            <button className="bg-white/10 hover:bg-white/20 text-white text-xs sm:text-sm font-medium px-5 py-2.5 sm:py-3 rounded-lg shadow border border-white/20 hover:border-white/30 transition-all duration-200 min-h-[44px] flex items-center justify-center">
              📚 Rules, FAQ & Match History
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
} 