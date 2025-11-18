import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch, getMatchStatus, getUsername, setUsername, checkUsernameAvailability } from '../utils/api'
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState, useEffect, useMemo } from 'react'
import Image from 'next/image'
import logo from '../../public/logo.png'
import { usePendingClaims } from '../hooks/usePendingClaims'
import Link from 'next/link'

// Username Input Component
const UsernameInput: React.FC<{ wallet: string; onUsernameSet: (username: string) => void }> = ({ wallet, onUsernameSet }) => {
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  const handleUsernameChange = async (value: string) => {
    setNewUsername(value);
    setUsernameError(null);

    // Validate format
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (value && !usernameRegex.test(value)) {
      setUsernameError('3-20 chars, letters/numbers/underscores only');
      return;
    }

    // Check availability if username is valid
    if (value && usernameRegex.test(value)) {
      setCheckingAvailability(true);
      try {
        const response = await checkUsernameAvailability(value);
        if (!response.available) {
          setUsernameError('Username taken');
        }
      } catch (error) {
        console.error('Failed to check username:', error);
      } finally {
        setCheckingAvailability(false);
      }
    }
  };

  const handleSaveUsername = async () => {
    if (!newUsername.trim()) return;

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(newUsername)) {
      setUsernameError('Invalid format');
      return;
    }

    setSavingUsername(true);
    setUsernameError(null);

    try {
      await setUsername(wallet, newUsername.trim());
      onUsernameSet(newUsername.trim().toLowerCase());
    } catch (error: any) {
      setUsernameError(error.message || 'Failed to save username');
    } finally {
      setSavingUsername(false);
    }
  };

  return (
    <div className="w-full">
      <div className="mb-3">
        <input
          type="text"
          value={newUsername}
          onChange={(e) => handleUsernameChange(e.target.value)}
          placeholder="Enter username (3-20 characters)"
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-accent/40 text-white placeholder-white/50 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-all text-center text-lg font-semibold"
          maxLength={20}
          disabled={savingUsername}
        />
        {usernameError && (
          <div className="text-red-400 text-xs mt-2 text-center">{usernameError}</div>
        )}
        {checkingAvailability && (
          <div className="text-accent text-xs mt-2 text-center">Checking availability...</div>
        )}
      </div>
      <button
        onClick={handleSaveUsername}
        disabled={savingUsername || !!usernameError || !newUsername.trim()}
        className="w-full px-6 py-3 bg-gradient-to-r from-accent to-yellow-400 text-primary font-bold rounded-xl hover:from-yellow-300 hover:to-accent transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg border-2 border-accent/30 hover:border-accent/60"
      >
        {savingUsername ? 'Saving...' : 'Save Username'}
      </button>
      <p className="text-xs text-white/60 mt-3 text-center">
        Your username will be shown to opponents during matchmaking
      </p>
    </div>
  );
};

const POT_RETURN_PERCENT = 0.95;

type BadgeTheme = 'accent' | 'purple' | 'blue' | 'green';

type StakeTier = {
  id: string;
  usd: number;
  title: string;
  badgeText?: string;
  badgeTheme?: BadgeTheme;
  headline: string;
  incentive: string;
  bonusCopy?: string;
  cta: string;
  isPopular?: boolean;
  isHighValue?: boolean;
  isPremium?: boolean;
  bonusUsd: number;
};

const STAKE_TIERS: StakeTier[] = [
  {
    id: 'starter',
    usd: 5,
    title: 'Starter',
    badgeText: '🎮 Warm-Up',
    badgeTheme: 'green',
    headline: 'Classic head-to-head with standard payouts.',
    incentive: 'Perfect for dialling in strategies at full pot value.',
    cta: 'Enter Starter Duel',
    bonusUsd: 0
  },
  {
    id: 'competitive',
    usd: 20,
    title: 'Competitive',
    badgeText: '⭐ Crowd Favorite',
    badgeTheme: 'accent',
    headline: 'Step up to the first tier with a house boost.',
    incentive: 'We add $0.25 to every victory for more bragging rights.',
    cta: 'Queue Competitive',
    isPopular: true,
    bonusUsd: 0.25
  },
  {
    id: 'highRoller',
    usd: 50,
    title: 'Veteran',
    badgeText: '🎯 Bonus Stacked',
    badgeTheme: 'blue',
    headline: 'Bigger stakes with an even bigger bonus.',
    incentive: 'House boost: +$0.75 on every single win.',
    cta: 'Go Veteran',
    isHighValue: true,
    bonusUsd: 0.75
  },
  {
    id: 'vip',
    usd: 100,
    title: 'VIP Elite',
    badgeText: '💎 VIP Showcase',
    badgeTheme: 'purple',
    headline: 'The most competitive tier with the biggest bonus we offer.',
    incentive: 'Pocket an extra $1.75 every time you seal the match.',
    cta: 'Claim a VIP Seat',
    isPremium: true,
    bonusUsd: 1.75
  }
];

const BADGE_THEME_CLASSES: Record<BadgeTheme, string> = {
  accent:
    'bg-gradient-to-r from-accent to-yellow-400 text-black border-2 border-black/20',
  purple:
    'bg-gradient-to-r from-purple-500 to-pink-500 text-white border-2 border-purple-300/50',
  blue:
    'bg-gradient-to-r from-blue-500 to-cyan-500 text-white border-2 border-blue-300/50',
  green:
    'bg-gradient-to-r from-green-500 to-emerald-500 text-white border-2 border-green-300/50'
};

// Fetch live SOL/USD price from backend (avoids CORS issues)
const fetchSolPrice = async () => {
  console.log('🔍 Fetching live SOL price from backend...');
  
  try {
    const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';
    const response = await fetch(`${API_URL}/api/match/sol-price`);
    
    if (!response.ok) {
      throw new Error(`Backend SOL price API returned ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('📊 Backend SOL price response:', data);
    
    if (data.price && typeof data.price === 'number' && data.price > 0) {
      console.log('✅ SOL price from backend:', data.price);
      return data.price;
    } else if (data.fallback) {
      console.warn('⚠️ Backend returned fallback price:', data.fallback);
      return data.fallback;
    } else {
      throw new Error('Invalid SOL price data from backend');
    }
  } catch (e) {
    console.error('❌ Backend SOL price fetch failed:', e);
    console.warn('⚠️ Using client-side fallback price: $180');
    return 180; // Reasonable fallback
  }
};

// Lobby: choose entry fee
export default function Lobby() {
  const router = useRouter()
  const { publicKey, signTransaction } = useWallet()
  const { pendingClaims, hasBlockingClaims, checkPendingClaims } = usePendingClaims()
  const [checkingBalance, setCheckingBalance] = useState(false)
  const [isMatchmaking, setIsMatchmaking] = useState(false)
  const [solPrice, setSolPrice] = useState<number | null>(null)
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [signingRefund, setSigningRefund] = useState<string | null>(null)
  const [username, setUsername] = useState<string | null>(null)

  const tierData = useMemo(() => {
    return STAKE_TIERS.map((tier) => {
      const solAmount = solPrice ? +(tier.usd / solPrice).toFixed(4) : null
      const baseWinningsUsd = tier.usd * 2 * POT_RETURN_PERCENT
      const bonusUsd = tier.bonusUsd
      const totalWinUsd = baseWinningsUsd + bonusUsd
      const bonusSol =
        solPrice && bonusUsd > 0 ? +(bonusUsd / solPrice).toFixed(4) : null
      const totalWinSol =
        solPrice && totalWinUsd > 0 ? +(totalWinUsd / solPrice).toFixed(4) : null
      const roiValue = ((totalWinUsd - tier.usd) / tier.usd) * 100

      return {
        ...tier,
        solAmount,
        baseWinningsUsd,
        totalWinUsd,
        bonusUsd,
        bonusSol,
        totalWinSol,
        roi: roiValue,
        solPriceUsed: solPrice || null
      }
    })
  }, [solPrice])

  const walletBalanceUSD =
    walletBalance !== null && solPrice ? walletBalance * solPrice : null

  const highestTierData = tierData[tierData.length - 1]
  const canCoverHighestTier =
    !!(
      highestTierData?.solAmount &&
      walletBalance !== null &&
      walletBalance >= highestTierData.solAmount
    )
  const nextTierToUnlock =
    walletBalance !== null
      ? tierData.find(
          (tier) => tier.solAmount && walletBalance < tier.solAmount
        )
      : null
  const amountToUnlock =
    nextTierToUnlock && walletBalanceUSD !== null
      ? Math.max(0, nextTierToUnlock.usd - walletBalanceUSD)
      : null

  const getTierHighlightTextClass = (
    tier?: (typeof tierData)[number] | null
  ) => {
    if (!tier) return 'text-white'
    if (tier.isPremium) return 'text-purple-300'
    if (tier.isHighValue) return 'text-blue-300'
    if (tier.isPopular) return 'text-accent'
    return 'text-white'
  }

  useEffect(() => {
    const getPrice = async () => {
      try {
        const price = await fetchSolPrice();
        console.log('💰 Setting SOL price:', price);
        setSolPrice(price);
        
        if (!(price && price > 0)) {
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
    let isMounted = true;
    let interval: NodeJS.Timeout | null = null;

    const fetchBalance = async () => {
      if (!publicKey) {
        if (isMounted) {
        setWalletBalance(null);
        }
        return;
      }
      
      try {
        const solanaNetwork =
          process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com';
        const connection = new Connection(solanaNetwork, 'confirmed');
        const balance = await connection.getBalance(publicKey);
        if (isMounted) {
          setWalletBalance(balance / LAMPORTS_PER_SOL);
        }
      } catch (error) {
        console.error('Failed to check wallet balance:', error);
        if (isMounted) {
        setWalletBalance(null);
      }
      }
    };
    
    fetchBalance();

    if (publicKey) {
      interval = setInterval(fetchBalance, 15000);
    }

    return () => {
      isMounted = false;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [publicKey]);

  // Clean up stale match data and check for existing matches when lobby loads
  useEffect(() => {
    // Clear any stale match data from previous sessions
    localStorage.removeItem('matchId');
    localStorage.removeItem('word');
    localStorage.removeItem('entryFee');
    
    // Load username when wallet connects
    if (publicKey) {
      getUsername(publicKey.toString())
        .then((response) => setUsername(response.username || null))
        .catch((error) => console.error('Failed to load username:', error));
    } else {
      setUsername(null);
    }
    
    // Check if player has an active match
    const checkForActiveMatch = async () => {
      if (!publicKey) return;
      
      try {
        const { config } = await import('../config/environment');
        const response = await fetch(`${config.API_URL}/api/match/check-player-match/${publicKey.toString()}`);
        
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
    
    // Check for pending claims before allowing new matchmaking
    if (hasBlockingClaims) {
      console.log('🚫 Player has pending claims, preventing new matchmaking');
      
      if (pendingClaims?.hasPendingWinnings && pendingClaims.pendingWinnings.length > 0) {
        const firstWinning = pendingClaims.pendingWinnings[0];
        alert(`You have unclaimed winnings from a previous match! Please claim your ${firstWinning.entryFee.toFixed(4)} SOL winnings before starting a new game.`);
        router.push(`/result?matchId=${firstWinning.matchId}`);
        return;
      }
      
      if (pendingClaims?.hasPendingRefunds && pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0) {
        const firstRefund = pendingClaims.pendingRefunds[0];
        alert(`You have an unclaimed refund from a previous match! Please claim your ${firstRefund.refundAmount?.toFixed(4) || firstRefund.entryFee.toFixed(4)} SOL refund before starting a new game.`);
        router.push(`/result?matchId=${firstRefund.matchId}`);
        return;
      }
    }
    
    // BLOCK matchmaking if there are pending refunds that need signing
    // (even if they can't be executed yet - player must sign first)
    if (pendingClaims?.hasPendingRefunds && !pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0) {
      const totalRefunds = pendingClaims.pendingRefunds.length;
      alert(`You have ${totalRefunds} pending refund(s) that need your signature. Please sign for all refunds before starting a new match.`);
      return;
    }
    
    // Prevent multiple clicks
    if (isMatchmaking) {
      console.log('⏳ Already matchmaking, ignoring click');
      return;
    }

    // Check if username is set
    if (!username) {
      alert('Please set a username before entering the queue. You can set it in the top right corner.');
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
      } else if (result.status === 'vault_pending') {
        console.log('⏳ Vault pending detected; redirecting to matchmaking to continue polling');
        router.push(`/matchmaking?matchId=${result.matchId}&entryFee=${solAmount}`);
      } else {
        console.log('❌ Unknown result status:', result.status);
        alert('Failed to start matchmaking. Please try again.')
        setIsMatchmaking(false);
      }
    } catch (error) {
      console.error('❌ Matchmaking error:', error)
      
      // Provide more specific error messages based on the error type
      let errorMessage = 'Failed to start matchmaking. Please try again.';
      
      if (error instanceof Error) {
        if (error.message.includes('ReCaptcha')) {
          errorMessage = 'ReCaptcha verification failed. Please refresh the page and try again.';
        } else if (error.message.includes('network') || error.message.includes('connection')) {
          errorMessage = 'Network error. Please check your connection and try again.';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Request timed out. Please try again.';
        }
      }
      
      alert(errorMessage);
      setIsMatchmaking(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 py-8 relative">
      <div className="flex flex-col items-center w-full max-w-6xl">
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-6 sm:mb-8">
          <div className="logo-shell mb-4 sm:mb-6">
            <Image 
              src={logo} 
              alt="Guess5 Logo" 
              width={180} 
              height={180} 
              priority
            />
          </div>
          <button
            onClick={() => router.push('/')}
            className="mb-4 bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg transition-all duration-200 text-sm border border-white/20 hover:border-white/30 backdrop-blur-sm"
          >
            ← Back to Home
          </button>
          <Link href="/referrals">
            <button className="mb-4 bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-400 hover:to-pink-400 text-white px-5 py-2.5 rounded-lg transition-all duration-200 text-sm border border-purple-400/40 hover:border-purple-300/60 backdrop-blur-sm">
              💰 Referrals
            </button>
          </Link>
        </div>

        {/* Wallet Connection */}
        <div className="mb-6">
          <WalletConnectButton />
        </div>

        {/* Username Input Section */}
        {publicKey && (
          <div className="mb-6 bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 border border-white/20 shadow-xl max-w-md w-full">
            <h3 className="text-lg font-bold text-accent mb-4 text-center">Set Your Username</h3>
            {!username ? (
              <UsernameInput 
                wallet={publicKey.toString()}
                onUsernameSet={(newUsername) => setUsername(newUsername)}
              />
            ) : (
              <div className="text-center">
                <div className="bg-white/5 rounded-lg px-4 py-3 mb-3 border border-white/10">
                  <div className="text-sm text-white/70 mb-1">Your Username</div>
                  <div className="text-xl font-bold text-accent">@{username}</div>
                </div>
                <button
                  onClick={() => setUsername(null)}
                  className="text-xs text-white/60 hover:text-white/80 underline"
                >
                  Change Username
                </button>
              </div>
            )}
          </div>
        )}

        {!publicKey ? (
          <div className="bg-secondary bg-opacity-10 rounded-2xl p-8 max-w-md w-full text-center border border-white/10 backdrop-blur-sm">
            <div className="text-white text-lg font-medium mb-2">Connect Your Wallet</div>
            <div className="text-white/70 text-sm">Please connect your Phantom wallet to start playing</div>
          </div>
        ) : (
          <div className="w-full">
            {/* Main Content Card */}
            <div className="bg-gradient-to-br from-secondary/20 to-secondary/10 rounded-2xl p-6 sm:p-8 border border-white/10 backdrop-blur-sm shadow-2xl">
              {/* Header Section - Premium Design */}
              <div className="text-center mb-10">
                <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white mb-4 tracking-tight">
                  Choose Your <span className="bg-gradient-to-r from-accent via-yellow-400 to-accent bg-clip-text text-transparent">Level of Competition</span>
                </h1>
                <p className="text-white/70 text-base sm:text-lg mb-8 font-medium">
                  Choose a tier, lock your entry, and we will seat you against a worthy opponent.
                </p>
                
                {/* Price & Balance Info Bar */}
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
                  {/* SOL Price Display */}
                  {solPrice && (
                    <div className="flex items-center gap-2.5 bg-gradient-to-r from-blue-500/10 to-blue-600/10 rounded-xl px-5 py-3 border border-blue-400/20 backdrop-blur-sm">
                      <span className="text-white/80 text-sm font-medium">SOL Price:</span>
                      <span className="text-blue-300 font-bold text-lg">${solPrice.toFixed(2)}</span>
                      <button
                        onClick={async () => {
                          console.log('🔄 Manual SOL price refresh requested');
                          const price = await fetchSolPrice();
                          setSolPrice(price);
                        }}
                        className="text-blue-400 hover:text-blue-300 text-sm transition-colors ml-1"
                        title="Refresh SOL price"
                      >
                        🔄
                      </button>
                    </div>
                  )}
                  
                  {/* Wallet Balance Display */}
                  {walletBalance !== null && (
                    <div className="flex items-center gap-3 bg-gradient-to-r from-green-500/10 to-green-600/10 rounded-xl px-5 py-3 border border-green-400/20 backdrop-blur-sm">
                      <span className="text-white/80 text-sm font-medium">Your Balance:</span>
                      <span className="text-green-300 font-bold text-lg">{walletBalance.toFixed(4)} SOL</span>
                      {walletBalanceUSD !== null && (
                        <span className="text-green-200 text-sm font-semibold">(${walletBalanceUSD.toFixed(2)} USD)</span>
                      )}
                    </div>
                  )}
                  
                  {!solPrice && (
                    <div className="text-yellow-400 text-sm bg-yellow-500/10 rounded-xl px-5 py-3 border border-yellow-400/20">
                      🔄 Loading SOL price...
                    </div>
                  )}
                </div>

                {walletBalanceUSD !== null && (
                  <div className="text-white/70 text-sm text-center max-w-3xl mx-auto mb-6">
                    {canCoverHighestTier && highestTierData ? (
                      <>
                        You already cover{' '}
                        <span
                          className={`${getTierHighlightTextClass(
                            highestTierData
                          )} font-semibold`}
                        >
                          {highestTierData.title}
                        </span>
                        . Jump in now and play for
                        <span className="text-green-300 font-semibold">
                          {' '}
                          ${highestTierData.totalWinUsd.toFixed(2)}
                        </span>
                        {' '}including our house boost.
                      </>
                    ) : nextTierToUnlock && amountToUnlock !== null ? (
                      <>
                        Deposit{' '}
                        <span className="text-accent font-semibold">
                          ${amountToUnlock.toFixed(2)}
                        </span>{' '}
                        more to unlock{' '}
                        <span
                          className={`${getTierHighlightTextClass(
                            nextTierToUnlock
                          )} font-semibold`}
                        >
                          {nextTierToUnlock.title}
                        </span>{' '}
                        and compete for{' '}
                        <span className="text-green-300 font-semibold">
                          ${nextTierToUnlock.totalWinUsd.toFixed(2)}
                        </span>
                        with the built-in house boost.
                      </>
                    ) : (
                      <>Top up your wallet to unlock bigger pots and larger house boosts.</>
                    )}
                  </div>
                )}
              </div>

              {/* Pending Claims Warning */}
              {hasBlockingClaims && (
                <div className="bg-yellow-500/20 border-2 border-yellow-500/50 rounded-xl p-5 mb-6 backdrop-blur-sm">
                  <div className="flex items-start gap-3">
                    <div className="text-yellow-400 text-2xl">⚠️</div>
                    <div className="flex-1">
                      <div className="text-yellow-400 font-bold text-lg mb-2">Unclaimed Funds Detected</div>
                      <div className="text-white/90 text-sm space-y-1 mb-3">
                        {pendingClaims?.hasPendingWinnings && pendingClaims.pendingWinnings.length > 0 && (
                          <div>• {pendingClaims.pendingWinnings.length} unclaimed winning(s)</div>
                        )}
                        {pendingClaims?.hasPendingRefunds && pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0 && (
                          <div>• {pendingClaims.pendingRefunds.length} unclaimed refund(s)</div>
                        )}
                      </div>
                      <div className="text-white/70 text-xs">
                        Please claim your funds before starting a new game.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Pending Refunds That Need Signing */}
              {pendingClaims?.hasPendingRefunds && !pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0 && (
                <div className="bg-orange-500/20 border-2 border-orange-500/50 rounded-xl p-5 mb-6 backdrop-blur-sm">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="text-orange-400 text-2xl">📝</div>
                    <div className="flex-1">
                      <div className="text-orange-400 font-bold text-lg mb-1">
                        Sign Pending Refunds ({pendingClaims.pendingRefunds.length} total)
                      </div>
                      <div className="text-white/80 text-sm">
                        You must sign for all pending refunds before starting a new match.
                      </div>
                    </div>
                  </div>
                  {(() => {
                    const sortedRefunds = [...pendingClaims.pendingRefunds].sort((a, b) => {
                      const aTime = a.proposalCreatedAt ? new Date(a.proposalCreatedAt).getTime() : 0;
                      const bTime = b.proposalCreatedAt ? new Date(b.proposalCreatedAt).getTime() : 0;
                      return aTime - bTime;
                    });
                    const oldestRefund = sortedRefunds[0];
                    
                    return (
                      <div className="bg-black/40 rounded-lg p-4 border border-white/10">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                          <div className="flex-1">
                            <div className="text-white/90 text-sm font-medium mb-1">
                              Match: {oldestRefund.matchId.substring(0, 8)}...
                            </div>
                            <div className="text-accent text-base font-bold">
                              {oldestRefund.refundAmount?.toFixed(4) || oldestRefund.entryFee.toFixed(4)} SOL
                            </div>
                            {pendingClaims.pendingRefunds.length > 1 && (
                              <div className="text-white/60 text-xs mt-2">
                                + {pendingClaims.pendingRefunds.length - 1} more refund(s) to sign
                              </div>
                            )}
                          </div>
                          <button
                            onClick={async () => {
                              if (!publicKey || !signTransaction || signingRefund === oldestRefund.matchId) return;
                              
                              setSigningRefund(oldestRefund.matchId);
                              try {
                                const apiUrl = process.env.NEXT_PUBLIC_API_URL || '';
                                
                                console.log('🧾 Attempting to sign pending refund', {
                                  matchId: oldestRefund.matchId,
                                  wallet: publicKey.toString(),
                                  refundAmount: oldestRefund.refundAmount || oldestRefund.entryFee,
                                  proposalId: oldestRefund.proposalId,
                                });
                                
                                const getTxResponse = await fetch(`${apiUrl}/api/match/get-proposal-approval-transaction?matchId=${oldestRefund.matchId}&wallet=${publicKey.toString()}`);
                                
                                if (!getTxResponse.ok) {
                                  const errorData = await getTxResponse.json().catch(() => ({ error: 'Unknown error' }));
                                  throw new Error(errorData.error || errorData.details || 'Failed to get approval transaction');
                                }
                                
                                const txData = await getTxResponse.json();
                                
                                if (!txData.transaction) {
                                  throw new Error('No transaction data received from server');
                                }
                                
                                const { VersionedTransaction } = await import('@solana/web3.js');
                                const txBuffer = Buffer.from(txData.transaction, 'base64');
                                const approveTx = VersionedTransaction.deserialize(txBuffer);
                                
                                const signedTx = await signTransaction(approveTx);
                                
                                const serialized = signedTx.serialize();
                                const base64Tx = Buffer.from(serialized).toString('base64');
                                
                                console.log('📤 Submitting signed refund proposal to backend', {
                                  matchId: oldestRefund.matchId,
                                  wallet: publicKey.toString(),
                                  serializedLength: serialized.length,
                                });
                                const response = await fetch(`${apiUrl}/api/match/sign-proposal`, {
                                  method: 'POST',
                                  headers: {
                                    'Content-Type': 'application/json',
                                  },
                                  body: JSON.stringify({
                                    matchId: oldestRefund.matchId,
                                    wallet: publicKey.toString(),
                                    signedTransaction: base64Tx,
                                  }),
                                });
                                
                                if (!response.ok) {
                                  const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
                                  throw new Error(errorData.error || errorData.details || 'Failed to sign proposal');
                                }
                                
                                const responseJson = await response.json().catch(() => ({}));
                                console.log('✅ Refund proposal signed successfully', {
                                  matchId: oldestRefund.matchId,
                                  wallet: publicKey.toString(),
                                  response: responseJson,
                                });
                                await checkPendingClaims();
                                alert(`✅ Refund proposal signed! ${pendingClaims.pendingRefunds.length - 1 > 0 ? `You have ${pendingClaims.pendingRefunds.length - 1} more refund(s) to sign.` : 'All refunds signed!'}`);
                              } catch (err) {
                                console.error('❌ Error signing refund proposal:', err);
                                alert(err instanceof Error ? err.message : 'Failed to sign refund proposal');
                              } finally {
                                setSigningRefund(null);
                              }
                            }}
                            disabled={signingRefund === oldestRefund.matchId || !signTransaction}
                            className="bg-accent hover:bg-yellow-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold py-3 px-8 rounded-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95 min-w-[160px] flex items-center justify-center"
                          >
                            {signingRefund === oldestRefund.matchId ? (
                              <>
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-black mr-2"></div>
                                Signing...
                              </>
                            ) : (
                              'Sign Refund'
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Entry Fee Selection Cards - Premium Grid Layout for 4 Tiers */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8 max-w-7xl mx-auto items-stretch">
                {tierData.map((tier) => {
                  const {
                    id,
                    usd: usdAmount,
                    solAmount,
                    baseWinningsUsd,
                    totalWinUsd,
                    totalWinSol,
                    bonusUsd,
                    bonusSol,
                    roi,
                    title,
                    headline,
                    incentive,
                    badgeText,
                    badgeTheme,
                    cta,
                    isPopular = false,
                    isHighValue = false,
                    isPremium = false
                  } = tier

                  const isPriceReady = typeof solAmount === 'number' && solAmount > 0
                  const hasEnoughBalance =
                    walletBalance !== null &&
                    isPriceReady &&
                    solAmount !== null &&
                    walletBalance >= solAmount
                  const hasUnsignedRefunds =
                    pendingClaims?.hasPendingRefunds &&
                    !pendingClaims.refundCanBeExecuted &&
                    pendingClaims.pendingRefunds.length > 0
                  const isDisabled =
                    !isPriceReady ||
                    !hasEnoughBalance ||
                    isMatchmaking ||
                    hasBlockingClaims ||
                    hasUnsignedRefunds

                  const badgeClassName =
                    badgeText && badgeTheme && BADGE_THEME_CLASSES[badgeTheme]
                      ? BADGE_THEME_CLASSES[badgeTheme]
                      : 'bg-white/20 text-white border border-white/20'

                  const handleTierSelect = () => {
                    if (!isPriceReady || solAmount == null) {
                      alert('Fetching live SOL price. Please try again in a moment.');
                      return;
                    }
                    handleSelect(usdAmount, solAmount);
                  };

                  return (
                    <button
                      key={id}
                      onClick={handleTierSelect}
                      disabled={isDisabled}
                      className={`relative group w-full h-full transition-all duration-300 ${
                        isMatchmaking ? 'opacity-60' : ''
                      }`}
                    >
                      <div
                        className={`relative h-full bg-gradient-to-br ${
                          isDisabled
                            ? 'from-gray-800/40 to-gray-900/40 cursor-not-allowed border-gray-700/30'
                            : isPopular
                            ? 'from-accent/25 via-yellow-500/20 to-accent/25 border-2 border-accent/60 shadow-2xl shadow-accent/20'
                            : isPremium
                            ? 'from-purple-600/20 via-purple-500/15 to-purple-600/20 border-2 border-purple-400/40 shadow-xl'
                            : isHighValue
                            ? 'from-blue-600/20 via-blue-500/15 to-blue-600/20 border-2 border-blue-400/40 shadow-xl'
                            : 'from-white/8 via-white/5 to-white/8 border border-white/20 shadow-lg'
                        } rounded-3xl p-6 sm:p-8 backdrop-blur-sm transition-all duration-300 hover:shadow-2xl ${
                          !isDisabled && !isMatchmaking ? 'hover:scale-105 hover:border-accent/80' : ''
                        }`}
                      >
                        {badgeText && !isDisabled && (
                          <div
                            className={`absolute -top-3 left-1/2 transform -translate-x-1/2 ${badgeClassName} text-xs font-extrabold px-4 py-1 rounded-full shadow-xl uppercase tracking-wide z-20`}
                          >
                            {badgeText}
                          </div>
                        )}

                        <div className="flex flex-col items-center text-center h-full pt-2">
                          <div className="flex flex-col items-center w-full flex-1">
                            <div className="uppercase tracking-[0.35em] text-xs text-white/50 mb-3">
                            {title}
                          </div>

                          <div className="mb-3">
                            <div
                              className={`text-4xl sm:text-5xl lg:text-6xl font-black mb-1 ${
                                isDisabled
                                  ? 'text-gray-500'
                                  : isPopular
                                  ? 'text-accent'
                                  : isPremium
                                  ? 'text-purple-300'
                                  : isHighValue
                                  ? 'text-blue-300'
                                  : 'text-white'
                              }`}
                            >
                              ${usdAmount}
                            </div>
                            <div className="text-white/60 text-xs sm:text-sm font-medium">
                              {isPriceReady ? `≈ ${solAmount} SOL` : 'Loading price...'}
                            </div>
                          </div>

                          <div
                            className={`w-12 sm:w-16 h-0.5 mb-4 sm:mb-6 ${
                              isPopular
                                ? 'bg-accent/50'
                                : isPremium
                                ? 'bg-purple-400/50'
                                : isHighValue
                                ? 'bg-blue-400/50'
                                : 'bg-white/20'
                            }`}
                          ></div>

                          <div className="mb-4">
                          <div className="space-y-2 mb-3">
                            <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-center">
                              <div className="text-white/70 text-[11px] uppercase tracking-[0.25em] mb-1 font-semibold">
                                Core Pot
                              </div>
                              <div className="text-2xl sm:text-3xl font-black text-white">
                                ${baseWinningsUsd.toFixed(2)}
                              </div>
                              <div className="text-white/60 text-xs font-medium mt-1">
                                95% of ${(usdAmount * 2).toFixed(2)} prize pool
                              </div>
                            </div>
                            <div className="bg-accent/10 border border-accent/25 rounded-xl px-4 py-2.5 text-center">
                              <div className="text-accent text-[11px] uppercase tracking-[0.25em] mb-1 font-semibold">
                                Platform Bonus
                              </div>
                              <div className="text-accent text-sm font-semibold">
                                +${bonusUsd.toFixed(2)} {bonusSol ? `(≈ ${bonusSol} SOL)` : ''}
                              </div>
                            </div>
                          </div>
                            <div className="text-white/70 text-xs uppercase tracking-wider mb-1.5 font-semibold">
                              Total Payout
                            </div>
                            <div
                              className={`text-2xl sm:text-3xl font-black mb-1 ${
                                isDisabled ? 'text-gray-500' : 'text-green-400'
                              }`}
                            >
                              ${totalWinUsd.toFixed(2)}
                            </div>
                          </div>
                          
                          <div className="text-white font-semibold text-sm mb-3">
                            Effective ROI: +{roi.toFixed(2)}%
                          </div>
                          <div className="text-white/70 text-sm font-medium mb-4">
                            {headline}
                          </div>
                          </div>

                          <div className="w-full mt-auto pt-5 sm:pt-6">
                            {!hasEnoughBalance && walletBalance !== null && (
                              <div className="text-xs text-red-400 font-semibold bg-red-500/10 px-3 py-1.5 rounded-lg border border-red-500/20">
                                ⚠ Insufficient Balance
                              </div>
                            )}
                            {hasBlockingClaims && (
                              <div className="text-xs text-yellow-400 font-semibold bg-yellow-500/10 px-3 py-1.5 rounded-lg border border-yellow-500/20">
                                ⚠ Claim Funds First
                              </div>
                            )}
                            {hasUnsignedRefunds && (
                              <div className="text-xs text-orange-400 font-semibold bg-orange-500/10 px-3 py-1.5 rounded-lg border border-orange-500/20">
                                ⚠ Sign Refunds First
                              </div>
                            )}
                            {!isDisabled &&
                              !hasBlockingClaims &&
                              !hasUnsignedRefunds &&
                              walletBalance !== null &&
                              hasEnoughBalance && (
                                <div
                                  className={`text-xs sm:text-sm font-bold py-2 sm:py-2.5 px-4 sm:px-6 rounded-xl transition-all ${
                                    isPopular
                                      ? 'bg-accent text-black hover:bg-yellow-400'
                                      : isPremium
                                      ? 'bg-purple-500 text-white hover:bg-purple-400'
                                      : isHighValue
                                      ? 'bg-blue-500 text-white hover:bg-blue-400'
                                      : 'bg-white/10 text-white hover:bg-white/20'
                                  }`}
                                >
                                  {cta || 'Select This Tier'}
                                </div>
                              )}
                          </div>
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Matchmaking Status */}
              {isMatchmaking && (
                <div className="text-center mt-6 animate-fade-in">
                  <div className="inline-flex items-center gap-3 bg-accent/20 rounded-full px-6 py-4 border border-accent/30">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent"></div>
                    <div className="text-accent text-lg font-semibold">Finding Opponent...</div>
                  </div>
                  <div className="text-white/60 text-sm mt-3">Redirecting to matchmaking...</div>
                </div>
              )}

              {/* Trust Indicators */}
              <div className="mt-8 pt-6 border-t border-white/10">
                <div className="flex flex-wrap justify-center gap-4 text-xs text-white/60">
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-400">✓</span>
                    <span>Non-Custodial</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-400">✓</span>
                    <span>2-of-3 Multisig</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-400">✓</span>
                    <span>Squads Protocol</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-green-400">✓</span>
                    <span>Winner Gets 95%</span>
                  </div>
                </div>
                <div className="text-center text-white/40 text-[11px] mt-4">
                  * House boosts hit your wallet automatically on eligible wins. Promotional amounts rotate weekly.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 