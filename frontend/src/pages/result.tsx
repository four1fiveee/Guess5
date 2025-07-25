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

  // Remove demo/testing simulated opponent data block
  // (If you want to display opponent data, fetch it from the backend or game state)

  return (
    <div className="result-page">
      <h1>Game Result</h1>
      <p>{message}</p>
      {showWord && <p>The correct word was: <b>{word}</b></p>}
      <WalletConnectButton />
      {/* Add any real opponent/game data here if available from backend */}
    </div>
  );
} 