import { useRouter } from 'next/router'
import { WalletConnectButton, TopRightWallet } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch } from '../utils/api'
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState, useEffect } from 'react'
import Image from 'next/image'
import logo from '../../public/logo.png'

const ENTRY_FEES_USD = [1, 5, 20];

// Fetch live SOL/USD price with fallback
const fetchSolPrice = async () => {
  console.log('🔍 Fetching live SOL price...');
  
  try {
    // Try CoinGecko first
    console.log('📡 Trying CoinGecko API...');
    const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
    
    if (!response.ok) {
      throw new Error(`CoinGecko API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📊 CoinGecko response:', data);
    
    if (data.solana?.usd && typeof data.solana.usd === 'number' && data.solana.usd > 0) {
      console.log('✅ CoinGecko SOL price:', data.solana.usd);
      return data.solana.usd;
    } else {
      throw new Error('Invalid SOL price data from CoinGecko');
    }
  } catch (e) {
    console.error('❌ CoinGecko failed:', e);
    console.log('🔄 Trying Binance fallback...');
  }
  
  try {
    // Fallback to alternative API
    const response = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT');
    
    if (!response.ok) {
      throw new Error(`Binance API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📊 Binance response:', data);
    
    if (data.price && typeof data.price === 'string' && parseFloat(data.price) > 0) {
      const price = parseFloat(data.price);
      console.log('✅ Binance SOL price:', price);
      return price;
    } else {
      throw new Error('Invalid SOL price data from Binance');
    }
  } catch (e) {
    console.error('❌ Binance fallback failed:', e);
  }
  
  // Final fallback to a reasonable estimate
  console.warn('⚠️ All SOL price APIs failed, using fallback price: $100');
  return 100;
};

// Lobby: choose entry fee
export default function Lobby() {
  const router = useRouter()
  const { publicKey } = useWallet()
  const [checkingBalance, setCheckingBalance] = useState(false)
  const [isMatchmaking, setIsMatchmaking] = useState(false)
  const [solPrice, setSolPrice] = useState<number | null>(null)
  const [solAmounts, setSolAmounts] = useState<number[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)

  useEffect(() => {
    const getPrice = async () => {
      try {
        const price = await fetchSolPrice();
        console.log('💰 Setting SOL price:', price);
        setSolPrice(price);
        
        if (price && price > 0) {
          const calculatedAmounts = ENTRY_FEES_USD.map(usd => +(usd / price).toFixed(4));
          console.log('💵 Calculated SOL amounts:', calculatedAmounts, 'for USD amounts:', ENTRY_FEES_USD);
          setSolAmounts(calculatedAmounts);
        } else {
          console.warn('⚠️ Invalid SOL price received:', price);
        }
      } catch (error) {
        console.error('❌ Error in getPrice:', error);
      }
    };
    
    // Get initial price
    console.log('🚀 Initializing SOL price fetching...');
    getPrice();
    
    // Refresh price every 30 seconds
    const interval = setInterval(() => {
      console.log('🔄 Refreshing SOL price...');
      getPrice();
    }, 30000);
    
    return () => {
      console.log('🧹 Cleaning up SOL price interval');
      clearInterval(interval);
    };
  }, []);

  // Check wallet balance when wallet connects
  useEffect(() => {
    const checkWalletBalance = async () => {
      if (!publicKey) {
        setWalletBalance(null);
        return;
      }
      
      try {
        const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com';
        const connection = new Connection(solanaNetwork, 'confirmed');
        const balance = await connection.getBalance(publicKey);
        const balanceInSol = balance / LAMPORTS_PER_SOL;
        setWalletBalance(balanceInSol);
      } catch (error) {
        console.error('Failed to check wallet balance:', error);
        setWalletBalance(null);
      }
    };
    
    checkWalletBalance();
  }, [publicKey]);

  // Clean up stale match data and check for existing matches when lobby loads
  useEffect(() => {
    // Clear any stale match data from previous sessions
    localStorage.removeItem('matchId');
    localStorage.removeItem('word');
    localStorage.removeItem('entryFee');
    
    // Check if player has an active match
    const checkForActiveMatch = async () => {
      if (!publicKey) return;
      
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL;
        const response = await fetch(`${apiUrl}/api/match/check-player-match/${publicKey.toString()}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.matched && data.status === 'active') {
            console.log('🎮 Found active match, redirecting to game:', data.matchId);
            localStorage.setItem('matchId', data.matchId);
            if (data.word) {
              localStorage.setItem('word', data.word);
            }
            if (data.entryFee) {
              localStorage.setItem('entryFee', data.entryFee.toString());
            }
            router.push(`/game?matchId=${data.matchId}`);
            return;
          }
        }
      } catch (error) {
        console.error('❌ Error checking for active match:', error);
      }
    };
    
    checkForActiveMatch();
  }, [publicKey, router]);

  const checkBalance = async (requiredSol: number) => {
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return false
    }
    setCheckingBalance(true)
    try {
      const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com';
      const connection = new Connection(solanaNetwork, 'confirmed')
      const balance = await connection.getBalance(publicKey)
      const balanceInSol = balance / LAMPORTS_PER_SOL
      if (balanceInSol < requiredSol) {
        alert(`Insufficient balance! You have ${balanceInSol.toFixed(4)} SOL but need ${requiredSol.toFixed(4)} SOL for this game.`)
        setCheckingBalance(false)
        return false
      }
      setCheckingBalance(false) // Reset checking state on success
      return true
    } catch (error) {
      console.error('Balance check error:', error)
      alert('Failed to check balance. Please try again.')
      setCheckingBalance(false)
      return false
    }
  }

  const handleSelect = async (usdAmount: number, solAmount: number) => {
    console.log('🎮 handleSelect called with:', { usdAmount, solAmount });
    
    if (!publicKey) {
      alert('Please connect your wallet first!')
      return
    }
    
    // Prevent multiple clicks
    if (isMatchmaking) {
      console.log('⏳ Already matchmaking, ignoring click');
      return;
    }
    
    // Check if balance is sufficient
    if (walletBalance !== null && walletBalance < solAmount) {
      alert(`Insufficient balance! You have ${walletBalance.toFixed(4)} SOL but need ${solAmount.toFixed(4)} SOL for this game.`)
      return;
    }
    
    setIsMatchmaking(true);
    
    try {
      console.log('💾 Storing entry fee in localStorage:', solAmount);
      localStorage.setItem('entryFeeSOL', solAmount.toString());
      
      console.log('📡 Calling requestMatch with:', { wallet: publicKey.toString(), entryFee: solAmount });
      const result = await requestMatch(publicKey.toString(), solAmount) as any
      console.log('📡 requestMatch result:', result);
      
      if (result.status === 'matched') {
        console.log('✅ Match found, redirecting to matchmaking with matchId');
        router.push(`/matchmaking?matchId=${result.matchId}&entryFee=${solAmount}`)
      } else if (result.status === 'waiting') {
        console.log('⏳ Waiting for opponent, redirecting to matchmaking');
        router.push(`/matchmaking?entryFee=${solAmount}`)
      } else {
        console.log('❌ Unknown result status:', result.status);
        alert('Failed to start matchmaking. Please try again.')
        setIsMatchmaking(false);
      }
    } catch (error) {
      console.error('❌ Matchmaking error:', error)
      alert('Failed to start matchmaking. Please try again.')
      setIsMatchmaking(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={300} height={300} className="mb-8" />
        
        {/* Back to Home Button */}
        <button
          onClick={() => router.push('/')}
          className="mb-4 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors text-sm"
        >
          ← Back to Home
        </button>
        
        <WalletConnectButton />
        
        {!publicKey ? (
          <div className="text-white text-xl text-center">
            Please connect your wallet to continue
          </div>
        ) : (
          <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-md w-full text-accent shadow">
            <h2 className="text-2xl font-bold text-accent mb-4 text-center">Choose Entry Fee</h2>
            
            {solPrice && (
              <div className="text-white/80 text-center mb-4">
                Current SOL Price: ${solPrice.toFixed(2)}
                {solPrice === 100 && (
                  <div className="text-yellow-400 text-sm mt-1">
                    ⚠️ Using fallback price - live price fetch may have failed
                  </div>
                )}
                <button
                  onClick={async () => {
                    console.log('🔄 Manual SOL price refresh requested');
                    const price = await fetchSolPrice();
                    setSolPrice(price);
                    if (price && price > 0) {
                      const calculatedAmounts = ENTRY_FEES_USD.map(usd => +(usd / price).toFixed(4));
                      setSolAmounts(calculatedAmounts);
                    }
                  }}
                  className="ml-2 text-blue-400 hover:text-blue-300 text-sm underline"
                >
                  🔄 Refresh
                </button>
              </div>
            )}
            
            {!solPrice && (
              <div className="text-yellow-400 text-center mb-4">
                🔄 Loading SOL price...
              </div>
            )}
            
            <div className="space-y-3">
              {ENTRY_FEES_USD.map((usdAmount, index) => {
                const solAmount = solAmounts[index];
                const hasEnoughBalance = walletBalance !== null && solAmount && walletBalance >= solAmount;
                
                return (
                  <button
                    key={usdAmount}
                    className={`w-full p-4 rounded-lg font-bold transition-colors shadow ${
                      hasEnoughBalance
                        ? 'bg-accent text-primary hover:bg-yellow-400'
                        : 'bg-gray-600 text-gray-300 cursor-not-allowed'
                    } ${isMatchmaking ? 'opacity-50 cursor-not-allowed' : ''}`}
                    onClick={() => handleSelect(usdAmount, solAmount)}
                    disabled={!hasEnoughBalance || isMatchmaking}
                  >
                    <div className="text-lg">${usdAmount}</div>
                    <div className="text-sm opacity-80">
                      {solAmount ? `${solAmount} SOL` : 'Loading...'}
                    </div>
                    {!hasEnoughBalance && walletBalance !== null && (
                      <div className="text-xs text-red-400 mt-1">
                        Insufficient balance
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            
            {isMatchmaking && (
              <div className="text-center mt-4">
                <div className="text-accent text-lg font-semibold">Finding opponent...</div>
                <div className="text-white/80 text-sm">Please wait</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 