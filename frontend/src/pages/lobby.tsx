import { useRouter } from 'next/router'
import { WalletConnectButton, TopRightWallet } from '../components/WalletConnect'
import { useWallet } from '@solana/wallet-adapter-react'
import { requestMatch, getMatchStatus } from '../utils/api'
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { useState, useEffect } from 'react'
import Image from 'next/image'
import logo from '../../public/logo.png'
import { usePendingClaims } from '../hooks/usePendingClaims'

const ENTRY_FEES_USD = [1, 5, 20, 100];

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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-6 sm:mb-8" />
        
                 {/* Back to Home Button */}
         <button
           onClick={() => router.push('/')}
           className="mb-4 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 sm:py-3 rounded-lg transition-all duration-200 text-xs sm:text-sm border border-white/20 hover:border-white/30 min-h-[44px] flex items-center justify-center"
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
            
            {/* Pending Claims Warning */}
            {hasBlockingClaims && (
              <div className="bg-yellow-500 bg-opacity-20 border border-yellow-500 rounded-lg p-4 mb-4">
                <div className="text-yellow-400 font-semibold mb-2">⚠️ You have unclaimed funds!</div>
                <div className="text-white/80 text-sm mb-3">
                  {pendingClaims?.hasPendingWinnings && pendingClaims.pendingWinnings.length > 0 && (
                    <div>You have unclaimed winnings from {pendingClaims.pendingWinnings.length} previous match(es).</div>
                  )}
                  {pendingClaims?.hasPendingRefunds && pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0 && (
                    <div>You have unclaimed refunds from {pendingClaims.pendingRefunds.length} previous match(es).</div>
                  )}
                </div>
                <div className="text-white/60 text-xs">
                  Please claim your funds before starting a new game.
                </div>
              </div>
            )}

            {/* Pending Refunds That Need Signing - Show Only Oldest, Block Matchmaking */}
            {pendingClaims?.hasPendingRefunds && !pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0 && (
              <div className="bg-orange-500 bg-opacity-20 border border-orange-500 rounded-lg p-4 mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-orange-400 font-semibold">
                    📝 Sign Pending Refunds ({pendingClaims.pendingRefunds.length} total)
                  </div>
                </div>
                <div className="text-white/80 text-sm mb-3">
                  You must sign for all pending refunds before starting a new match. 
                  Showing oldest refund first.
                </div>
                {/* Show only the oldest refund (first in array, sorted by proposalCreatedAt) */}
                {(() => {
                  // Sort by proposalCreatedAt (oldest first) - assuming backend returns them sorted
                  const sortedRefunds = [...pendingClaims.pendingRefunds].sort((a, b) => {
                    const aTime = a.proposalCreatedAt ? new Date(a.proposalCreatedAt).getTime() : 0;
                    const bTime = b.proposalCreatedAt ? new Date(b.proposalCreatedAt).getTime() : 0;
                    return aTime - bTime;
                  });
                  const oldestRefund = sortedRefunds[0];
                  
                  return (
                    <div className="bg-black bg-opacity-30 rounded-lg p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-white/90 text-sm font-medium mb-1">
                            Match: {oldestRefund.matchId.substring(0, 8)}...
                          </div>
                          <div className="text-accent text-sm font-semibold">
                            Amount: {oldestRefund.refundAmount?.toFixed(4) || oldestRefund.entryFee.toFixed(4)} SOL
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
                              
                              // Get the approval transaction from backend
                              const getTxResponse = await fetch(`${apiUrl}/api/match/get-proposal-approval-transaction?matchId=${oldestRefund.matchId}&wallet=${publicKey.toString()}`);
                              
                              if (!getTxResponse.ok) {
                                const errorData = await getTxResponse.json().catch(() => ({ error: 'Unknown error' }));
                                throw new Error(errorData.error || errorData.details || 'Failed to get approval transaction');
                              }
                              
                              const txData = await getTxResponse.json();
                              
                              if (!txData.transaction) {
                                throw new Error('No transaction data received from server');
                              }
                              
                              // Deserialize and sign the transaction
                              const { VersionedTransaction } = await import('@solana/web3.js');
                              const txBuffer = Buffer.from(txData.transaction, 'base64');
                              const approveTx = VersionedTransaction.deserialize(txBuffer);
                              
                              // Sign the transaction with the wallet
                              const signedTx = await signTransaction(approveTx);
                              
                              // Serialize the signed transaction
                              const serialized = signedTx.serialize();
                              const base64Tx = Buffer.from(serialized).toString('base64');
                              
                              // Send to backend to submit
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
                              // Refresh pending claims
                              await checkPendingClaims();
                              // Show success message
                              alert(`✅ Refund proposal signed! ${pendingClaims.pendingRefunds.length - 1 > 0 ? `You have ${pendingClaims.pendingRefunds.length - 1} more refund(s) to sign.` : 'All refunds signed!'}`);
                            } catch (err) {
                              console.error('❌ Error signing refund proposal:', err);
                              alert(err instanceof Error ? err.message : 'Failed to sign refund proposal');
                            } finally {
                              setSigningRefund(null);
                            }
                          }}
                          disabled={signingRefund === oldestRefund.matchId || !signTransaction}
                          className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-black font-bold py-2.5 px-6 rounded-lg transition-colors min-w-[140px] flex items-center justify-center"
                        >
                          {signingRefund === oldestRefund.matchId ? (
                            <>
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-black mr-2"></div>
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
            
                         <div className="grid grid-cols-2 gap-3">
              {ENTRY_FEES_USD.map((usdAmount, index) => {
                const solAmount = solAmounts[index];
                const hasEnoughBalance = walletBalance !== null && solAmount && walletBalance >= solAmount;
                // Block if: insufficient balance, already matchmaking, has blocking claims, OR has unsigned refunds
                const hasUnsignedRefunds = pendingClaims?.hasPendingRefunds && !pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0;
                const isDisabled = !hasEnoughBalance || isMatchmaking || hasBlockingClaims || hasUnsignedRefunds;
                
                return (
                  <button
                    key={usdAmount}
                    className={`w-full p-4 sm:p-5 rounded-lg font-bold transition-all duration-200 shadow min-h-[100px] flex flex-col items-center justify-center ${
                      hasEnoughBalance && !hasBlockingClaims && !isMatchmaking && !hasUnsignedRefunds
                        ? 'bg-accent text-primary hover:bg-yellow-400 hover:shadow-lg transform hover:scale-[1.02] active:scale-[0.98] border-2 border-transparent hover:border-yellow-300'
                        : 'bg-gray-700 text-gray-400 cursor-not-allowed border-2 border-gray-600'
                    } ${isMatchmaking ? 'opacity-60' : ''}`}
                    onClick={() => handleSelect(usdAmount, solAmount)}
                    disabled={isDisabled}
                  >
                    <div className="text-xl font-bold mb-1">${usdAmount}</div>
                    <div className="text-xs opacity-90 font-medium">
                      {solAmount ? `${solAmount} SOL` : '...'}
                    </div>
                    {!hasEnoughBalance && walletBalance !== null && (
                      <div className="text-xs text-red-400 mt-2 font-medium">
                        ⚠ Insufficient balance
                      </div>
                    )}
                    {hasBlockingClaims && (
                      <div className="text-xs text-yellow-400 mt-2 font-medium">
                        ⚠ Claim pending funds first
                      </div>
                    )}
                    {hasUnsignedRefunds && (
                      <div className="text-xs text-orange-400 mt-2 font-medium">
                        ⚠ Sign pending refunds first
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            
            {isMatchmaking && (
              <div className="text-center mt-4 animate-fade-in">
                <div className="flex items-center justify-center mb-2">
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-accent mr-2"></div>
                  <div className="text-accent text-lg font-semibold">Finding opponent...</div>
                </div>
                <div className="text-white/60 text-xs">Redirecting to matchmaking...</div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
} 