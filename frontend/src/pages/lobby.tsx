import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch } from '../utils/api'
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState, useEffect } from 'react'
import Image from 'next/image'
import logo from '../../public/logo.png'

const ENTRY_FEES_USD = [1, 5, 20];

// Fetch live SOL/USD price with fallback
const fetchSolPrice = async () => {
  try {
    // Try CoinGecko first
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    const data = await response.json();
    if (data.solana?.usd) {
      return data.solana.usd;
    }
  } catch (e) {
    console.log('CoinGecko failed, trying fallback...');
  }
  
  try {
    // Fallback to alternative API
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    const data = await response.json();
    if (data.price) {
      return parseFloat(data.price);
    }
  } catch (e) {
    console.log('Binance fallback failed');
  }
  
  // Final fallback to a reasonable estimate
  console.log('Using fallback SOL price: $100');
  return 100;
};

// Lobby: choose entry fee
export default function Lobby() {
  const router = useRouter()
  const { publicKey } = useWallet()
  const [checkingBalance, setCheckingBalance] = useState(false)
  const [solPrice, setSolPrice] = useState<number | null>(null)
  const [solAmounts, setSolAmounts] = useState<number[]>([])

  useEffect(() => {
    const getPrice = async () => {
      const price = await fetchSolPrice();
      setSolPrice(price);
      if (price) {
        setSolAmounts(ENTRY_FEES_USD.map(usd => +(usd / price).toFixed(4)));
      }
    };
    
    // Get initial price
    getPrice();
    
    // Refresh price every 30 seconds
    const interval = setInterval(getPrice, 30000);
    
    return () => clearInterval(interval);
  }, []);

  const checkBalance = async (requiredSol: number) => {
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return false
    }
    setCheckingBalance(true)
    try {
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed')
      const balance = await connection.getBalance(publicKey)
      const balanceInSol = balance / LAMPORTS_PER_SOL
      if (balanceInSol < requiredSol) {
        alert(`Insufficient balance! You have ${balanceInSol.toFixed(4)} SOL but need ${requiredSol.toFixed(4)} SOL for this game.`)
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

  const handleSelect = async (usdAmount: number, solAmount: number) => {
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return
    }
    
    const hasBalance = await checkBalance(solAmount)
    if (!hasBalance) {
      return
    }

    try {
      // Store the SOL amount in localStorage for consistency
      localStorage.setItem('entryFeeSOL', solAmount.toString());
      
      const result = await requestMatch(publicKey.toString(), solAmount) as any
      if (result.status === 'matched') {
        router.push(`/matchmaking?matchId=${result.matchId}&entryFee=${solAmount}`)
      } else if (result.status === 'waiting') {
        router.push(`/matchmaking?entryFee=${solAmount}`)
      } else {
        alert('Failed to start matchmaking. Please try again.')
      }
    } catch (error) {
      console.error('Matchmaking error:', error)
      alert('Failed to start matchmaking. Please try again.')
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary">
      {/* Logo prominently displayed at the top */}
      <div className="flex justify-center mb-6">
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-4" />
      </div>
      
      <WalletConnectButton />
      <h2 className="text-3xl font-bold text-accent mb-6">Choose Entry Fee</h2>
      
      <div className="flex gap-6">
        {ENTRY_FEES_USD.map((usd, idx) => (
          <button
            key={usd}
            className={`px-8 py-4 bg-accent text-primary rounded-lg text-2xl font-semibold transition ${
              checkingBalance ? 'opacity-50 cursor-not-allowed' : 'hover:bg-yellow-400'
            }`}
            onClick={() => handleSelect(usd, solAmounts[idx])}
            disabled={checkingBalance || solPrice === null}
          >
            {checkingBalance ? 'Checking...' : `$${usd}`}
            <div className="text-xs text-gray-700 mt-1">
              {solPrice !== null && solAmounts[idx] !== undefined ? `(${solAmounts[idx]} SOL)` : ''}
            </div>
          </button>
        ))}
      </div>
      
      {/* Odds Information */}
      <div className="mt-6 text-center max-w-2xl">
        <div className="bg-white/10 rounded-lg p-4 border border-white/20">
          <h3 className="text-accent font-semibold mb-2">🎯 Better Odds Than Roulette!</h3>
          <div className="text-sm text-white/80 space-y-2">
            <div className="flex justify-between">
              <span>🎰 Roulette (0 & 00):</span>
              <span className="text-red-400">5.26% house edge</span>
            </div>
            <div className="flex justify-between">
              <span>🎮 Guess5:</span>
              <span className="text-green-400">5.00% house edge</span>
            </div>
            <div className="text-xs text-white/60 mt-2">
              💡 With a 50% win rate, you get better odds than roulette! 
              Winner takes 95% of the pot, we keep only 5%.
              <br />
              <span className="text-green-400 font-semibold">(Better than American roulette's -5.26% return!)</span>
            </div>
          </div>
        </div>
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
      {solPrice === null && (
        <div className="mt-4 text-red-500">Unable to fetch SOL price. Please refresh.</div>
      )}
    </div>
  )
} 