import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-6 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        <Image src={logo} alt="Guess5 Logo" width={250} height={250} className="mb-3" />
        
        {/* Main CTA */}
        <Link href="/lobby">
          <button className="bg-accent text-primary text-xl font-bold px-8 py-3 rounded-lg shadow hover:bg-yellow-400 transition mb-3">
            Play Now
          </button>
        </Link>
        <p className="text-sm text-white/80 mb-4 text-center">Stake your skill, win with words</p>

        {/* How to Play - Simplified */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-4 max-w-4xl w-full text-accent shadow">
          <h2 className="text-xl font-bold text-accent mb-3 text-center">How It Works</h2>
          <ol className="list-decimal list-inside text-sm text-white/90 space-y-1.5">
            <li><b>Choose your stake:</b> $1, $5, or $20 (in SOL)</li>
            <li><b>Get matched</b> with another player</li>
            <li><b>Guess the 5-letter word</b> in 7 tries or less</li>
            <li><b>Winner takes 95%</b> of the pot (5% platform fee)</li>
          </ol>
        </div>

        {/* Non-Custodial Security - NEW! */}
        <div className="bg-green-900 bg-opacity-20 border border-green-400 rounded-lg p-4 max-w-4xl w-full text-accent shadow mt-3">
          <h2 className="text-xl font-bold text-green-400 mb-3 text-center">🔒 Your Funds Are Protected</h2>
          <p className="text-sm text-white/90 mb-3 text-center">
            We <b>never</b> have custody of your money. Guess5 uses <b>Squads Protocol</b> multisig vaults 
            to ensure you're always in control.
          </p>
          
          <div className="bg-black bg-opacity-30 rounded-lg p-3 mb-3">
            <h3 className="text-base font-bold text-green-400 mb-2 text-center">How It Works:</h3>
            <div className="text-xs text-white/90 space-y-2">
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-base flex-shrink-0">1</span>
                <span><b>2-of-3 Signatures Required:</b> Every match creates a secure vault requiring 2 out of 3 signatures: <i>You</i>, <i>Your Opponent</i>, and <i>Guess5</i></span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-base flex-shrink-0">2</span>
                <span><b>Winner Must Sign:</b> When you win, we propose the payout. <u>You must sign with your wallet</u> to claim your winnings</span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-base flex-shrink-0">3</span>
                <span><b>We Can't Take Your Money:</b> Even if you lose, we cannot withdraw your funds without your signature. Your funds are <b>always protected</b></span>
              </div>
              <div className="flex items-start space-x-2">
                <span className="text-green-400 font-bold text-base flex-shrink-0">4</span>
                <span><b>Automatic Refunds:</b> If payouts aren't signed, the system automatically proposes refunds that either player can accept</span>
              </div>
            </div>
          </div>

          <p className="text-xs text-green-400 text-center font-semibold">
            ✓ Audited by Squads Protocol • ✓ Non-Custodial • ✓ You're Always In Control
          </p>
        </div>

        {/* Quick Links */}
        <div className="flex gap-3 mt-4 mb-4 flex-wrap justify-center">
          <Link href="/info">
            <button className="bg-accent text-primary text-sm font-bold px-6 py-2.5 rounded-lg shadow hover:bg-yellow-400 transition">
              📚 Rules, FAQ & Match History
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
} 