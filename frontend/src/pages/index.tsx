import Image from 'next/image'
import Link from 'next/link'
import { WalletConnectButton } from '../components/WalletConnect'

// Home page: shows logo, rules, and "Play" button
export default function Home() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2">
      <WalletConnectButton />
      {/* Prominent logo */}
      <Image src="/logo.png" alt="Guess5 Logo" width={180} height={180} className="mb-2" />
      {/* Subtitle */}
      <p className="text-secondary mt-1 text-base mb-4 text-center">A head-to-head 5-letter word guessing game with real staking and payouts.</p>
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
  )
} 