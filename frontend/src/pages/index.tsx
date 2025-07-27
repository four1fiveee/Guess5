import Image from 'next/image';
import logo from '../../public/logo.png';
import Link from 'next/link'
import { WalletConnectButton } from '../components/WalletConnect'

// Home page: shows logo, rules, and "Play" button
export default function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={180} height={180} className="mb-6" />
        <h1 className="text-5xl font-extrabold text-white mb-4">Guess5</h1>
        <p className="text-xl text-white/80 mb-8">The Solana-powered word game for real rewards</p>
        <WalletConnectButton />
        {/* Compact Rules Section */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-3 max-w-md w-full mb-4 text-accent shadow">
          <h2 className="text-xl font-bold mb-1 text-accent text-center">How to Play</h2>
          <ol className="list-decimal list-inside text-base text-accent space-y-1">
            <li>Connect your Phantom wallet (top right).</li>
            <li>Choose a lobby: $1, $5, or $20 entry.</li>
            <li>Get matched with an opponent.</li>
            <li>Guess the secret 5-letter word in up to 7 tries (15s per guess).</li>
            <li>Hints show if letters are correct or misplaced.</li>
            <li><b>Payouts:</b> Winner gets 90% of the pot, Guess5 takes 10% fee.</li>
            <li><b>Tie-breaker:</b> If both solve in the same number of guesses, fastest total time wins.</li>
            <li><b>Double loss:</b> If neither solves, both get 45% (total 90%), Guess5 takes 10% fee.</li>
          </ol>
        </div>
        <Link href="/lobby">
          <button className="mt-1 px-8 py-3 bg-accent text-primary rounded-lg text-xl font-bold hover:bg-orange-500 transition">
            Play
          </button>
        </Link>
      </div>
    </div>
  );
} 