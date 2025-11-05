import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-6 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        <Image src={logo} alt="Guess5 Logo" width={220} height={220} className="mb-2" />
        
        {/* Main CTA */}
        <Link href="/lobby">
          <button className="bg-accent text-primary text-xl font-bold px-8 py-4 rounded-lg shadow-lg hover:bg-yellow-400 hover:shadow-xl transition-all duration-200 transform hover:scale-105 active:scale-95 mb-2">
            Play Now
          </button>
        </Link>
        <p className="text-sm text-white/80 mb-3 text-center">Stake your skill, win with words</p>

        {/* How to Play - Detailed */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-3.5 max-w-4xl w-full text-accent shadow">
          <h2 className="text-lg font-bold text-accent mb-2.5 text-center">How It Works</h2>
          <div className="text-xs text-white/90 space-y-2">
            <div className="flex items-start space-x-2">
              <span className="text-accent font-bold text-sm flex-shrink-0">1.</span>
              <span><b>Choose your stake:</b> Select $1, $5, $20, or $100 (paid in SOL). Entry fees are held in a secure multisig vault</span>
            </div>
            <div className="flex items-start space-x-2">
              <span className="text-accent font-bold text-sm flex-shrink-0">2.</span>
              <span><b>Get matched instantly:</b> Our matchmaking system pairs you with another player at the same stake level</span>
            </div>
            <div className="flex items-start space-x-2">
              <span className="text-accent font-bold text-sm flex-shrink-0">3.</span>
              <span><b>Guess the 5-letter word:</b> You have 7 tries. Green = correct letter & position, Yellow = correct letter wrong position, Gray = not in word</span>
            </div>
            <div className="flex items-start space-x-2">
              <span className="text-accent font-bold text-sm flex-shrink-0">4.</span>
              <span><b>Win the pot:</b> Fewest guesses wins! Winner gets 95% of the pot (you must sign to claim). 5% platform fee covers infrastructure</span>
            </div>
          </div>
        </div>

        {/* Non-Custodial Security */}
        <div className="bg-green-900 bg-opacity-20 border border-green-400 rounded-lg p-3.5 max-w-4xl w-full text-accent shadow mt-2.5">
          <h2 className="text-lg font-bold text-green-400 mb-2 text-center flex items-center justify-center gap-2">
            <span>🔒</span>
            <span>Your Funds Are Protected</span>
          </h2>
          <p className="text-xs text-white/90 mb-2.5 text-center">
            We <b>never</b> have custody of your money. Guess5 uses <b>Squads Protocol 2-of-3 multisig vaults</b> to ensure you're always in control.
          </p>
          
          <div className="bg-black bg-opacity-30 rounded-lg p-2.5 mb-2.5">
            <div className="text-xs text-white/90 space-y-1.5">
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-sm flex-shrink-0">•</span>
                <span><b>2-of-3 Signatures:</b> Every match creates a vault requiring 2 of 3 signatures: <i>You</i>, <i>Your Opponent</i>, and <i>Guess5</i></span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-sm flex-shrink-0">•</span>
                <span><b>You Must Sign to Claim:</b> Winners must sign with their wallet to receive payouts. We propose, you approve</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-sm flex-shrink-0">•</span>
                <span><b>We Can't Take Funds:</b> Even if you lose, we cannot withdraw without your signature. Your funds are <b>always safe</b></span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-sm flex-shrink-0">•</span>
                <span><b>Auto Refunds:</b> If payouts aren't signed within timeout period, either player can accept automatic refunds</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-green-400 text-center font-semibold">
            ✓ Squads Protocol • ✓ Non-Custodial • ✓ You're In Control
          </p>
        </div>

        {/* Quick Links */}
        <div className="flex gap-3 mt-3 mb-3 flex-wrap justify-center">
          <Link href="/info">
            <button className="bg-white/10 hover:bg-white/20 text-white text-sm font-medium px-5 py-2.5 rounded-lg shadow border border-white/20 hover:border-white/30 transition-all duration-200">
              📚 Rules, FAQ & Match History
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
} 