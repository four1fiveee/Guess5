import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-6 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center max-w-4xl w-full">
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-2" />
        <Link href="/lobby">
          <button className="bg-accent text-primary text-base font-bold px-6 py-2 rounded-lg shadow hover:bg-yellow-400 transition mb-4">Play</button>
        </Link>
        <p className="text-sm text-white/80 mb-4 text-center">The Solana-powered word game for real rewards</p>
        <div className="bg-secondary bg-opacity-10 rounded-lg p-4 max-w-4xl w-full text-accent shadow">
          <h2 className="text-xl font-bold text-accent mb-3 text-center">How to Play</h2>
          <ol className="list-decimal list-inside text-sm text-white/90 space-y-1">
            <li><b>Connect your Phantom wallet</b> (top right).</li>
            <li><b>Choose a lobby:</b> $1, $5, or $20 entry (paid in SOL at the current rate).</li>
            <li><b>Get matched</b> with another player.</li>
            <li><b>Guess the secret 5-letter word</b> in up to 7 tries.</li>
            <li><b>Hints</b> show if letters are correct or misplaced.</li>
            <li><b>Winner:</b> Fewest moves wins. If same moves, fastest time wins.</li>
            <li><b>Payouts:</b> Winner gets 95% of pot, platform takes 5% fee.</li>
          </ol>
          
          <h3 className="text-lg font-bold text-accent mt-4 mb-2 text-center">Tie Scenarios</h3>
          <ul className="list-disc list-inside text-sm text-white/90 space-y-1">
            <li><b>Winning Tie:</b> Both solve same moves + same time → <span className="text-green-400">Full refund to both players</span></li>
            <li><b>Losing Tie:</b> Both fail to solve → <span className="text-red-400">5% fee kept, 95% refunded to both players</span></li>
            <li><b>Disconnect:</b> If opponent disconnects, you win if you solved, otherwise it's a losing tie.</li>
            <li><b>Game Timeout:</b> If game doesn't start within 1 minute → <span className="text-green-400">Full refund to both players</span></li>
          </ul>
        </div>

        {/* Transparency & Fairness Section */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-4 max-w-4xl w-full text-accent shadow mt-4">
          <h2 className="text-xl font-bold text-accent mb-3 text-center">Complete Transparency & Fairness</h2>
          <p className="text-sm text-white/90 mb-4 text-center">
            Guess5 believes in complete transparency. Every match, transaction, and fee is publicly verifiable on the Solana blockchain.
          </p>
          
          <div className="text-sm text-white/90 space-y-3">
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Blockchain Verified:</b> All transactions are permanently recorded on Solana's public blockchain</span>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Real-Time Data:</b> Access complete match history with actual blockchain fees and timestamps</span>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Click to Verify:</b> Every transaction includes direct links to Solana Explorer for instant verification</span>
            </div>
            <div className="flex items-start space-x-3">
              <span className="text-green-400 font-bold">✓</span>
              <span><b>Fair Play Guaranteed:</b> All game outcomes, moves, and completion times are publicly auditable</span>
            </div>
          </div>

          <div className="mt-5 text-center">
            <a 
              href="https://guess5.onrender.com/api/match/generate-report" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center bg-accent text-primary text-base font-bold px-5 py-3 rounded-lg shadow hover:bg-yellow-400 transition-colors"
            >
              Download Complete Match Data (CSV)
            </a>
            <p className="text-sm text-white/70 mt-3">
              Includes all matches from 8/16/2025 with blockchain verification links, actual fees, and complete audit trail
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 