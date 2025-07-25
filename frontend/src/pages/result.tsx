import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'

export default function Result() {
  const router = useRouter()
  const { result, word } = router.query

  // Get the entry fee from localStorage (default to 1 if not set)
  const entryFee = Number(typeof window !== 'undefined' ? localStorage.getItem('entryFee') : 1) || 1
  const pot = entryFee * 2
  let payout = 0
  let message = ''

  if (result === 'win') {
    payout = pot * 0.9
    message = `You Win! +$${payout.toFixed(2)} USD`
  } else if (result === 'lose') {
    payout = 0
    message = `You Lose! +$0.00 USD`
  } else if (result === 'timeout') {
    payout = pot * 0.45
    message = `Timeout! +$${payout.toFixed(2)} USD (45% refund)`
  } else if (result === 'tie') {
    payout = entryFee
    message = `Tie! Refund +$${payout.toFixed(2)} USD`
  }

  // Show the correct word if not a win
  const showWord = result !== 'win' && word

  // --- DEMO/TESTING: Simulate opponent data ---
  // You can change these values to test different scenarios
  const opponentSolved = true; // set to false to test failed case
  const opponentMoves = 5;
  const opponentTime = 32.45; // seconds
  // -------------------------------------------

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary">
      <WalletConnectButton />
      <h2 className="text-3xl font-bold text-accent mb-4">Game Result</h2>
      <p className={`text-2xl mb-4 ${result === 'win' ? 'text-success' : result === 'lose' ? 'text-error' : 'text-secondary'}`}>{message}</p>
      {showWord && (
        <div className="mb-4 text-lg text-secondary">
          The correct word was: <span className="font-bold text-accent">{typeof word === 'string' ? word.toUpperCase() : ''}</span>
        </div>
      )}
      {/* Opponent result (demo/testing) */}
      <div className="mb-4 text-lg text-secondary">
        {opponentSolved
          ? <>Opponent solved the puzzle in <b>{opponentMoves} moves</b> ({opponentTime.toFixed(2)} seconds)</>
          : <>Opponent failed to solve the puzzle</>
        }
      </div>
      <button
        className="mt-8 px-8 py-3 bg-accent text-primary rounded-lg text-xl font-semibold hover:bg-yellow-400 transition"
        onClick={() => router.push('/lobby')}
      >
        Play Again
      </button>
    </div>
  )
} 