import { useRouter } from 'next/router'
import { WalletConnectButton, TopRightWallet } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch, getMatchStatus } from '../utils/api'
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState, useEffect } from 'react'
import Image from 'next/image'
import logo from '../../public/logo.png'
import { usePendingClaims } from '../hooks/usePendingClaims'

const ENTRY_FEES_USD = [5, 20, 100];

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
  const [solAmounts, setSolAmounts] = useState<number[]>([])
  const [walletBalance, setWalletBalance] = useState<number | null>(null)
  const [signingRefund, setSigningRefund] = useState<string | null>(null)

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

  // Calculate potential winnings for each tier
  const calculatePotentialWinnings = (usdAmount: number) => {
    return (usdAmount * 2 * 0.95).toFixed(2); // 95% of total pot
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 py-8 relative">
      <TopRightWallet />
      
      <div className="flex flex-col items-center w-full max-w-6xl">
        {/* Logo and Header */}
        <div className="flex flex-col items-center mb-6 sm:mb-8">
          <Image 
            src={logo} 
            alt="Guess5 Logo" 
            width={180} 
            height={180} 
            className="mb-4 sm:mb-6 drop-shadow-lg" 
          />
          <button
            onClick={() => router.push('/')}
            className="mb-4 bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-lg transition-all duration-200 text-sm border border-white/20 hover:border-white/30 backdrop-blur-sm"
          >
            ← Back to Home
          </button>
        </div>

        {/* Wallet Connection */}
        <div className="mb-6">
          <WalletConnectButton />
        </div>

        {!publicKey ? (
          <div className="bg-secondary bg-opacity-10 rounded-2xl p-8 max-w-md w-full text-center border border-white/10 backdrop-blur-sm">
            <div className="text-white text-lg font-medium mb-2">Connect Your Wallet</div>
            <div className="text-white/70 text-sm">Please connect your Phantom wallet to start playing</div>
          </div>
        ) : (
          <div className="w-full">
            {/* Main Content Card */}
            <div className="bg-gradient-to-br from-secondary/20 to-secondary/10 rounded-2xl p-6 sm:p-8 border border-white/10 backdrop-blur-sm shadow-2xl">
              {/* Header Section */}
              <div className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-3 bg-gradient-to-r from-accent to-yellow-400 bg-clip-text text-transparent">
                  Choose Your Entry Fee
                </h1>
                <p className="text-white/80 text-sm sm:text-base mb-4">
                  Select your stake level and compete for the pot
                </p>
                
                {/* SOL Price Display */}
                {solPrice && (
                  <div className="inline-flex items-center gap-3 bg-black/30 rounded-full px-4 py-2 border border-white/10">
                    <span className="text-white/90 text-sm font-medium">SOL Price:</span>
                    <span className="text-accent font-bold text-base">${solPrice.toFixed(2)}</span>
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
                      className="text-blue-400 hover:text-blue-300 text-sm transition-colors"
                      title="Refresh SOL price"
                    >
                      🔄
                    </button>
                  </div>
                )}
                
                {!solPrice && (
                  <div className="text-yellow-400 text-sm">
                    🔄 Loading SOL price...
                  </div>
                )}
              </div>

              {/* Wallet Balance Display */}
              {walletBalance !== null && (
                <div className="mb-6 text-center">
                  <div className="inline-flex items-center gap-2 bg-black/30 rounded-full px-4 py-2 border border-white/10">
                    <span className="text-white/70 text-xs">Your Balance:</span>
                    <span className="text-white font-semibold text-sm">{walletBalance.toFixed(4)} SOL</span>
                  </div>
                </div>
              )}

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
                                
                                console.log('✅ Refund proposal signed successfully');
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

              {/* Entry Fee Selection Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-6">
                {ENTRY_FEES_USD.map((usdAmount, index) => {
                  const solAmount = solAmounts[index];
                  const hasEnoughBalance = walletBalance !== null && solAmount && walletBalance >= solAmount;
                  const hasUnsignedRefunds = pendingClaims?.hasPendingRefunds && !pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0;
                  const isDisabled = !hasEnoughBalance || isMatchmaking || hasBlockingClaims || hasUnsignedRefunds;
                  const potentialWinnings = calculatePotentialWinnings(usdAmount);
                  const isPopular = usdAmount === 20; // Mark $20 as popular
                  
                  return (
                    <button
                      key={usdAmount}
                      onClick={() => handleSelect(usdAmount, solAmount)}
                      disabled={isDisabled}
                      className={`relative group bg-gradient-to-br ${
                        isDisabled
                          ? 'from-gray-800/50 to-gray-900/50 cursor-not-allowed'
                          : isPopular
                          ? 'from-accent/20 to-yellow-500/20 hover:from-accent/30 hover:to-yellow-500/30 border-2 border-accent/50'
                          : 'from-white/5 to-white/10 hover:from-white/10 hover:to-white/15 border border-white/20'
                      } rounded-2xl p-6 sm:p-8 transition-all duration-300 shadow-lg hover:shadow-2xl transform hover:scale-105 active:scale-95 ${
                        isMatchmaking ? 'opacity-60' : ''
                      }`}
                    >
                      {isPopular && (
                        <div className="absolute -top-3 left-1/2 transform -translate-x-1/2 bg-accent text-black text-xs font-bold px-3 py-1 rounded-full shadow-lg">
                          MOST POPULAR
                        </div>
                      )}
                      
                      <div className="flex flex-col items-center text-center">
                        <div className={`text-4xl sm:text-5xl font-bold mb-2 ${
                          isDisabled ? 'text-gray-500' : 'text-accent'
                        }`}>
                          ${usdAmount}
                        </div>
                        
                        <div className="text-white/70 text-sm mb-4">
                          {solAmount ? `≈ ${solAmount} SOL` : 'Loading...'}
                        </div>
                        
                        <div className="w-full h-px bg-white/10 mb-4"></div>
                        
                        <div className="text-white/60 text-xs mb-2">Potential Winnings</div>
                        <div className={`text-2xl font-bold mb-4 ${
                          isDisabled ? 'text-gray-500' : 'text-green-400'
                        }`}>
                          ${potentialWinnings}
                        </div>
                        
                        <div className="text-white/50 text-xs mb-4">
                          95% of ${(usdAmount * 2).toFixed(2)} pot
                        </div>
                        
                        {!hasEnoughBalance && walletBalance !== null && (
                          <div className="mt-2 text-xs text-red-400 font-medium bg-red-500/10 px-3 py-1 rounded-full">
                            ⚠ Insufficient Balance
                          </div>
                        )}
                        {hasBlockingClaims && (
                          <div className="mt-2 text-xs text-yellow-400 font-medium bg-yellow-500/10 px-3 py-1 rounded-full">
                            ⚠ Claim Funds First
                          </div>
                        )}
                        {hasUnsignedRefunds && (
                          <div className="mt-2 text-xs text-orange-400 font-medium bg-orange-500/10 px-3 py-1 rounded-full">
                            ⚠ Sign Refunds First
                          </div>
                        )}
                      </div>
                    </button>
                  );
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
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 