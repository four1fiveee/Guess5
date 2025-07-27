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
            <li><b>Guess the secret 5-letter word</b> in up to 7 tries (15 seconds per guess).</li>
            <li><b>Hints</b> show if letters are correct or misplaced.</li>
            <li><b>Payouts:</b> Winner receives 90% of the pot (in SOL), Guess5 takes a 10% fee.</li>
            <li><b>Tie-breaker:</b> If both solve in the same number of guesses, the fastest total time wins.</li>
            <li><b>Double loss:</b> If neither solves, both get 45% back, Guess5 takes a 10% fee.</li>
          </ol>
        </div>
        <Link href="/lobby">
          <button className="bg-accent text-primary text-xl font-bold px-10 py-3 rounded-lg shadow hover:bg-yellow-400 transition">Play</button>
        </Link>
      </div>
    </div>
  );
} 