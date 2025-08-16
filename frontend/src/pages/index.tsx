import Image from 'next/image';
import logo from '../../public/logo.png';
import { WalletConnectButton, TopRightWallet } from '../components/WalletConnect';
import Link from 'next/link';

export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
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
            <li><b>Payouts:</b> Winner gets 95% of pot, platform takes 5% fee. <span className="text-white/90">(Better than American roulette's -5.26% return!)</span></li>
          </ol>
          
          <h3 className="text-xl font-bold text-accent mt-4 mb-2 text-center">Tie Scenarios</h3>
          <ul className="list-disc list-inside text-base text-white/90 space-y-1">
            <li><b>Winning Tie:</b> Both solve same moves + same time → <span className="text-green-400">Full refund to both players</span></li>
            <li><b>Losing Tie:</b> Both fail to solve → <span className="text-red-400">5% fee kept, 95% refunded to both players</span></li>
            <li><b>Disconnect:</b> If opponent disconnects, you win if you solved, otherwise it's a losing tie.</li>
            <li><b>Game Timeout:</b> If game doesn't start within 1 minute → <span className="text-green-400">Full refund to both players</span></li>
          </ul>
        </div>
        <Link href="/lobby">
          <button className="bg-accent text-primary text-xl font-bold px-10 py-3 rounded-lg shadow hover:bg-yellow-400 transition">Play</button>
        </Link>
      </div>
    </div>
  );
} 