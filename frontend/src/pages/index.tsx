import Image from 'next/image';
import logo from '../../public/logo.png';
import { WalletConnectButton } from '../components/WalletConnect';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2">
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={300} height={300} className="mb-6" />
        <WalletConnectButton />
        <p className="text-xl text-white/80 mb-8 text-center">The Solana-powered word game for real rewards</p>
        <div className="bg-secondary bg-opacity-10 rounded-lg p-5 max-w-md w-full mb-8 text-accent shadow">
          <h2 className="text-2xl font-bold text-accent mb-3 text-center">How to Play</h2>
          <ol className="list-decimal list-inside text-base text-white/90 space-y-1">
            <li><b>Connect your Phantom wallet</b> (top right).</li>
            <li><b>Choose a lobby:</b> $1, $5, or $20 entry (paid in SOL at the current rate).</li>
            <li><b>Get matched</b> with another player.</li>
            <li><b>Guess the secret 5-letter word</b> in up to 7 tries.</li>
            <li><b>Hints</b> show if letters are correct or misplaced.</li>
            <li><b>Winner:</b> Fewest moves wins. If same moves, fastest time wins.</li>
            <li><b>Payouts:</b> Winner gets 95% of pot, platform takes 5% fee.</li>
          </ol>
          
          <h3 className="text-xl font-bold text-accent mt-4 mb-2 text-center">Tie Scenarios</h3>
          <ul className="list-disc list-inside text-base text-white/90 space-y-1">
            <li><b>Winning Tie:</b> Both solve same moves + same time → No payments, just a draw.</li>
            <li><b>Losing Tie:</b> Both fail to solve → Each pays 5% fee, no other transactions.</li>
            <li><b>Disconnect:</b> If opponent disconnects, you win if you solved, otherwise it's a losing tie.</li>
            <li><b>Better than Roulette:</b> With 50% win rate, this game offers better returns than American roulette (0 and 00).</li>
          </ul>
        </div>

          <div className="bg-gradient-to-r from-green-500/20 to-blue-500/20 border border-green-500/30 rounded-lg p-6 mt-6">
            <h3 className="text-xl font-bold text-green-400 mb-3 text-center">🎯 Why Guess5 is Better than Roulette</h3>
            <div className="space-y-3 text-white/90">
              <div className="flex items-start">
                <span className="text-green-400 mr-3 mt-1">💰</span>
                <div>
                  <strong>American Roulette:</strong> 18/38 chance to win (47.37%), pays 1:1
                  <br />
                  <span className="text-red-400">Expected return: -5.26% per bet</span>
                </div>
              </div>
              <div className="flex items-start">
                <span className="text-green-400 mr-3 mt-1">🎮</span>
                <div>
                  <strong>Guess5:</strong> 50% chance to win, pays 1.9:1 (95% of pot)
                  <br />
                  <span className="text-green-400">Expected return: -5% per game (only the fee)</span>
                </div>
              </div>
              <div className="text-center text-green-400 font-semibold mt-3">
                Guess5 gives you better odds than any casino game!
              </div>
            </div>
          </div>
        <Link href="/lobby">
          <button className="bg-accent text-primary text-xl font-bold px-10 py-3 rounded-lg shadow hover:bg-yellow-400 transition">Play</button>
        </Link>
      </div>
    </div>
  );
} 