import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch } from '../utils/api'
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState } from 'react'

// Lobby: choose entry fee
export default function Lobby() {
  const router = useRouter()
  const { publicKey } = useWallet()
  const [checkingBalance, setCheckingBalance] = useState(false)

  const checkBalance = async (amount: number) => {
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return
    }

    setCheckingBalance(true)
    
    try {
      // Check balance on devnet
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
      const balance = await connection.getBalance(publicKey)
      const balanceInSol = balance / LAMPORTS_PER_SOL
      
      console.log(`💰 Wallet balance: ${balanceInSol.toFixed(4)} SOL`)
      console.log(`💰 Required for $${amount} game: ${amount} SOL`)
      
      if (balanceInSol < amount) {
        alert(`Insufficient balance! You have ${balanceInSol.toFixed(4)} SOL but need ${amount} SOL for this game.`)
        setCheckingBalance(false)
        return false
      }
      
      return true
    } catch (error) {
      console.error('Balance check error:', error)
      alert('Failed to check balance. Please try again.')
      setCheckingBalance(false)
      return false
    }
  }

  const handleSelect = async (amount: number) => {
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return
    }
    
    // Check balance first
    const hasEnoughBalance = await checkBalance(amount)
    if (!hasEnoughBalance) {
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
    } finally {
      setCheckingBalance(false)
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
            className={`px-8 py-4 bg-accent text-primary rounded-lg text-2xl font-semibold transition ${
              checkingBalance ? 'opacity-50 cursor-not-allowed' : 'hover:bg-yellow-400'
            }`}
            onClick={() => handleSelect(amount)}
            disabled={checkingBalance}
          >
            {checkingBalance ? 'Checking...' : `$${amount}`}
          </button>
        ))}
      </div>
      
      {publicKey && (
        <div className="mt-6 text-center">
          <p className="text-accent text-sm">
            💡 Make sure you have enough SOL in your wallet for the entry fee
          </p>
          <p className="text-accent text-xs mt-1">
            Connected: {publicKey.toString().slice(0, 4)}...{publicKey.toString().slice(-4)}
          </p>
        </div>
      )}
    </div>
  )
} 