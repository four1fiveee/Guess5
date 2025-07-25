import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch } from '../utils/api'

// Lobby: choose entry fee
export default function Lobby() {
  const router = useRouter()
  const { publicKey } = useWallet()

  const handleSelect = async (amount: number) => {
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return
    }
    
    localStorage.setItem('entryFee', amount.toString())
    localStorage.setItem('wallet', publicKey.toString())
    
    // Request a match from the backend
    try {
      const data = await requestMatch(amount, publicKey.toString())
      
      if (data.status === 'waiting') {
        router.push('/matchmaking')
      } else if (data.status === 'matched') {
        localStorage.setItem('matchId', data.matchId)
        localStorage.setItem('word', data.word)
        router.push('/game')
      }
    } catch (err) {
      console.error('Match request error:', err)
      alert('Error connecting to server. Please try again.')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary">
      <WalletConnectButton />
      <h2 className="text-3xl font-bold text-accent mb-6">Choose Entry Fee</h2>
      <div className="flex gap-6">
        {[1, 5, 20].map(amount => (
          <button
            key={amount}
            className="px-8 py-4 bg-accent text-primary rounded-lg text-2xl font-semibold hover:bg-yellow-400 transition"
            onClick={() => handleSelect(amount)}
          >
            ${amount}
          </button>
        ))}
      </div>
    </div>
  )
} 