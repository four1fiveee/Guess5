import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import SmartContractService from '../utils/smartContractService';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'matched' | 'escrow' | 'error'>('waiting');
  const [timeLeft, setTimeLeft] = useState(120);
  const [timeoutMessage, setTimeoutMessage] = useState<string>('');
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchData, setMatchData] = useState<any>(null);
  const [escrowStatus, setEscrowStatus] = useState<'pending' | 'success' | 'failed'>('pending');
  const [entryFee, setEntryFee] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  
  // Add state to track if matchmaking is already in progress
  const [isMatchmakingInProgress, setIsMatchmakingInProgress] = useState(false);
  
  // Add ref to track if useEffect has already been initialized
  const hasInitialized = useRef(false);
  
  // Add ref to track if startMatchmaking is currently running
  const isStartMatchmakingRunning = useRef(false);
  
  // Add state to prevent multiple simultaneous requests
  const [isRequestInProgress, setIsRequestInProgress] = useState<boolean>(false);

  const handleEscrowPayment = async () => {
    if (!publicKey || !matchData) {
      console.error('❌ Missing publicKey or matchData');
      setEscrowStatus('failed');
      return;
    }

    if (!signTransaction) {
      console.error('❌ Missing signTransaction function');
      setEscrowStatus('failed');
      return;
    }

    // Add timeout to prevent hanging
    const timeoutId = setTimeout(() => {
      console.error('❌ handleEscrowPayment timed out after 30 seconds');
      setEscrowStatus('failed');
    }, 30000); // 30 second timeout

    try {
      console.log('💰 Starting smart contract escrow payment...');
      console.log('🔍 Debug info:', {
        publicKey: publicKey.toString(),
        matchId: matchData.matchId,
        entryFee: entryFee,
        hasSignTransaction: !!signTransaction
      });
      console.log('🔍 About to set escrowStatus to pending...');
      setEscrowStatus('pending');
      console.log('🔍 escrowStatus set to pending');

      // Create smart contract service instance
      console.log('🔍 Creating SmartContractService with wallet:', {
        publicKey: publicKey.toString(),
        hasSignTransaction: !!signTransaction,
        hasSignAllTransactions: !!signAllTransactions
      });
      
      console.log('🔍 About to create SmartContractService...');
      const smartContractService = new SmartContractService({
        publicKey: publicKey,
        signTransaction: signTransaction,
        signAllTransactions: signAllTransactions
      });
      console.log('🔍 SmartContractService created successfully');

      // Lock entry fee using smart contract
      console.log('🔍 About to call lockEntryFee with:', {
        matchId: matchData.matchId,
        entryFee: entryFee
      });
      const lockResult = await smartContractService.lockEntryFee(
        matchData.matchId,
        entryFee
      );
      console.log('🔍 lockEntryFee completed with result:', lockResult);

      if (lockResult.success) {
        console.log('✅ Smart contract escrow payment successful:', lockResult.signature);
        setEscrowStatus('success');
        
        // Confirm escrow payment with backend
        try {
          const confirmResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/confirm-escrow`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              matchId: matchData.matchId,
              wallet: publicKey.toString(),
              escrowSignature: lockResult.signature
            }),
          });

          const confirmData = await confirmResponse.json();
          console.log('✅ Escrow confirmed with backend:', confirmData);

          if (confirmData.status === 'active') {
            console.log('🎮 Game activated! Redirecting to game...');
            
            // Store match data and redirect to game
            localStorage.setItem('matchId', matchData.matchId);
            if (matchData.word) {
              localStorage.setItem('word', matchData.word);
            }
            if (matchData.escrowAddress) {
              localStorage.setItem('escrowAddress', matchData.escrowAddress);
            }
            if (matchData.entryFee) {
              localStorage.setItem('entryFee', matchData.entryFee.toString());
            }
            
            // Redirect to game after successful escrow
            setTimeout(() => {
              router.push(`/game?matchId=${matchData.matchId}`);
            }, 2000);
          } else {
            console.log('⏳ Waiting for opponent to confirm escrow...');
            // Stay on matchmaking page until both players confirm
          }
        } catch (confirmError) {
          console.error('❌ Failed to confirm escrow with backend:', confirmError);
          setEscrowStatus('failed');
        }
      } else {
        console.error('❌ Smart contract escrow payment failed:', lockResult.error);
        setEscrowStatus('failed');
      }
          } catch (error: any) {
        console.error('❌ Smart contract escrow payment error:', error);
        console.error('❌ Error details:', {
          message: error?.message,
          stack: error?.stack,
          name: error?.name
        });
        setEscrowStatus('failed');
      } finally {
        // Clear the timeout
        clearTimeout(timeoutId);
      }
  };

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    // Prevent useEffect from running multiple times
    if (hasInitialized.current) {
      console.log('🎮 useEffect already initialized, skipping...');
      return;
    }

    // Mark as initialized
    hasInitialized.current = true;

    // Don't restart if matchmaking is already in progress
    if (isMatchmakingInProgress) {
      console.log('🎮 Matchmaking already in progress, not restarting');
      return;
    }

    // Don't start matchmaking if we already have a valid match
    if (matchData && (matchData.matchId || matchData.status === 'matched')) {
      console.log('🎮 Already have valid match data, not starting matchmaking');
      return;
    }

    // Mark matchmaking as in progress
    setIsMatchmakingInProgress(true);

    // Get entry fee from URL parameters (set by lobby with live SOL prices)
    const urlEntryFee = router.query.entryFee as string;
    if (urlEntryFee) {
      const entryFeeAmount = parseFloat(urlEntryFee);
      setEntryFee(entryFeeAmount);
      // Store in localStorage for consistency
      localStorage.setItem('entryFeeSOL', entryFeeAmount.toString());
      console.log('💰 Entry fee from URL:', entryFeeAmount, 'SOL');
    } else {
      // Fallback to localStorage if URL parameter not available
      const storedEntryFee = localStorage.getItem('entryFeeSOL');
      if (storedEntryFee) {
        setEntryFee(parseFloat(storedEntryFee));
      }
    }

    let pollInterval: NodeJS.Timeout;
    let timeoutId: NodeJS.Timeout;
    let countdownInterval: NodeJS.Timeout;

    const cleanupStuckMatches = async () => {
      if (!publicKey) return;
      
      try {
        console.log('🧹 Cleaning up stuck matches...');
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/cleanup-stuck-matches`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            wallet: publicKey.toString()
          }),
        });

        const data = await response.json();
        console.log('🧹 Cleanup result:', data);
        
        if (data.success) {
          console.log(`✅ Cleaned up ${data.cleanedMatches} stuck matches`);
          // Don't automatically restart matchmaking - let the polling handle it
        }
      } catch (error) {
        console.error('❌ Failed to cleanup stuck matches:', error);
      }
    };

    const startMatchmaking = async () => {
      if (!publicKey) {
        console.error('❌ Missing publicKey');
        return;
      }

      // Prevent multiple simultaneous matchmaking attempts
      if (isMatchmakingInProgress) {
        console.log('🎮 Matchmaking already in progress, skipping...');
        return;
      }

      // Prevent multiple simultaneous startMatchmaking calls
      if (isStartMatchmakingRunning.current) {
        console.log('🎮 startMatchmaking already running, skipping...');
        return;
      }

      // Prevent multiple simultaneous requests
      if (isRequestInProgress) {
        console.log('🎮 Request already in progress, skipping...');
        return;
      }

      // Don't start matchmaking if we already have a match
      if (matchData || status === 'matched') {
        console.log('🎮 Already have match data or matched status, not starting new matchmaking');
        return;
      }

      // Mark as running
      isStartMatchmakingRunning.current = true;
      setIsRequestInProgress(true);

      const wallet = publicKey.toString();
      console.log('🎮 Starting matchmaking with wallet:', wallet);

      try {
        // Clean up any stuck matches first
        await cleanupStuckMatches();

        // Get entry fee from URL parameters or localStorage
        const urlEntryFee = router.query.entryFee as string;
        let entryFee: number;
        
        if (urlEntryFee) {
          entryFee = parseFloat(urlEntryFee);
        } else {
          const storedEntryFee = localStorage.getItem('entryFeeSOL');
          if (!storedEntryFee) {
            console.error('❌ No entry fee found');
            router.push('/lobby');
            return;
          }
          entryFee = parseFloat(storedEntryFee);
        }
        
        console.log('🎮 Starting matchmaking with entry fee:', entryFee, 'SOL');
        console.log('🎮 Request payload:', { wallet, entryFee });

        // Add retry logic for network failures (less aggressive)
        let retryCount = 0;
        const maxRetries = 2; // Reduced from 3 to 2
        let lastError = null;

        while (retryCount < maxRetries) {
          try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/request-match`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                wallet,
                entryFee
              }),
            });

            if (!response.ok) {
              // Handle rate limiting specifically
              if (response.status === 429) {
                console.log('⚠️ Rate limited, waiting before retry...');
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                retryCount++;
                continue;
              }
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('🎮 Matchmaking response:', data);
            console.log('🎮 Response status:', response.status);
            console.log('🎮 Response headers:', Object.fromEntries(response.headers.entries()));

            // Handle deduplication response
            if (data.duplicate === true) {
              console.log('🔄 Duplicate request detected, continuing with polling...');
              console.log('⚠️ This means the backend is blocking the request due to deduplication');
              console.log('⏰ Waiting 2 seconds before next matchmaking attempt...');
              setStatus('waiting');
              // Wait 2 seconds before next attempt to avoid rapid duplicates
              await new Promise(resolve => setTimeout(resolve, 2000));
              break; // Success, exit retry loop - continue with polling
            }

            if (data.status === 'waiting') {
              setWaitingCount(data.waitingCount || 0);
              setStatus('waiting');
              break; // Success, exit retry loop
            } else if (data.status === 'matched') {
              console.log('✅ Match found, proceeding to escrow...');
              console.log('�� Match data:', data);
              setMatchData(data);
              setStatus('matched');
              // Stop polling since we have a match
              clearInterval(pollInterval);
              clearTimeout(timeoutId);
              clearInterval(countdownInterval);
              setIsPolling(false);
              setIsMatchmakingInProgress(false); // Stop matchmaking
              isStartMatchmakingRunning.current = false; // Reset running flag
              
              // Check if this is an active match (not escrow)
              if (data.message && data.message.includes('Already in active match')) {
                console.log('🎮 Match is already active, redirecting to game...');
                // Store match data and redirect to game
                localStorage.setItem('matchId', data.matchId);
                if (data.word) {
                  localStorage.setItem('word', data.word);
                }
                if (data.escrowAddress) {
                  localStorage.setItem('escrowAddress', data.escrowAddress);
                }
                if (data.entryFee) {
                  localStorage.setItem('entryFee', data.entryFee.toString());
                }
                
                setTimeout(() => {
                  router.push(`/game?matchId=${data.matchId}`);
                }, 1000);
              } else {
                // Don't redirect yet - need to handle escrow first
              }
              break; // Success, exit retry loop
            } else if (data.error) {
              console.log('⚠️ Matchmaking error:', data.error);
              if (data.error.includes('self-match') || data.error.includes('already has an active')) {
                // Clean up stuck matches and retry
                console.log('🔄 Detected stuck match, cleaning up and retrying...');
                await cleanupStuckMatches();
                retryCount++;
                            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 3000 * retryCount)); // Longer backoff
              continue;
            }
              } else {
                setStatus('error');
                break; // Don't retry for other errors
              }
            } else {
              console.error('❌ Unexpected response:', data);
              setStatus('error');
              break; // Don't retry for unexpected responses
            }
          } catch (error) {
            lastError = error;
            console.error(`❌ Matchmaking attempt ${retryCount + 1} failed:`, error);
            retryCount++;
            
            if (retryCount < maxRetries) {
              console.log(`🔄 Retrying in ${retryCount * 3000}ms... (${retryCount}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 3000)); // Longer backoff
            } else {
              console.error('❌ All matchmaking attempts failed');
              setStatus('error');
              clearTimeout(timeoutId);
              clearInterval(pollInterval);
            }
          }
        }

        if (retryCount >= maxRetries && lastError) {
          console.error('❌ Matchmaking failed after all retries:', lastError);
          setStatus('error');
          setIsMatchmakingInProgress(false); // Reset on error
          isStartMatchmakingRunning.current = false; // Reset running flag
        }
      } catch (error) {
        console.error('❌ Matchmaking error:', error);
        setStatus('error');
        clearTimeout(timeoutId);
        clearInterval(pollInterval);
        setIsMatchmakingInProgress(false); // Reset on error
        isStartMatchmakingRunning.current = false; // Reset running flag
      } finally {
        // Mark as not running after completion or failure
        isStartMatchmakingRunning.current = false;
        setIsRequestInProgress(false);
      }
    };

    const startPolling = () => {
      // Poll every 5 seconds to check if we've been matched (less aggressive to avoid rate limits)
      pollInterval = setInterval(async () => {
        try {
          // Don't poll if we already have a match
          if (matchData && status === 'matched') {
            console.log('🎮 Already have a match, stopping polling');
            clearInterval(pollInterval);
            setIsPolling(false);
            return;
          }

          // Don't poll if matchmaking is in progress
          if (isMatchmakingInProgress) {
            console.log('🎮 Matchmaking in progress, skipping poll');
            return;
          }

          // Don't start matchmaking if we already have a valid match
          if (matchData && (matchData.matchId || matchData.status === 'matched')) {
            console.log('🎮 Already have valid match data, not starting matchmaking from polling');
            return;
          }

          console.log('🔍 Polling for match status...');
          
          // Use the dedicated endpoint to check if we've been matched
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/check-match/${publicKey.toString()}`);
          
          // Handle rate limiting
          if (response.status === 429) {
            console.log('⚠️ Rate limited during polling, waiting 10 seconds before next attempt...');
            // Wait 10 seconds before next poll to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 10000));
            return; // Skip this poll cycle, try again next time
          }
          
          if (!response.ok) {
            console.error('❌ Polling request failed:', response.status, response.statusText);
            return;
          }
          
          const data = await response.json();
          
          if (data.matched) {
            console.log('✅ We have been matched!', data);
            setMatchData(data);
            setStatus('matched');
            clearInterval(pollInterval);
            clearInterval(countdownInterval);
            clearTimeout(timeoutId); // Also clear timeout
            setIsPolling(false);
            setIsMatchmakingInProgress(false); // Reset matchmaking progress
            isStartMatchmakingRunning.current = false; // Reset running flag
            
            console.log('🎮 Match confirmed, proceeding to escrow...');
            return; // Exit early, don't continue polling
          }
        } catch (error) {
          console.error('❌ Error polling for match:', error);
        }
      }, 5000); // Poll every 5 seconds (increased to avoid rate limits)
    };

    // Only start matchmaking if we don't already have a valid match
    if (!matchData || (!matchData.matchId && matchData.status !== 'matched')) {
      startMatchmaking();
      if (!isPolling) {
        setIsPolling(true);
        startPolling();
      }
    } else {
      console.log('🎮 Already have valid match data, skipping matchmaking start');
    }
    
    // Countdown timer
    countdownInterval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(countdownInterval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    // 2-minute timeout to return to home
    timeoutId = setTimeout(() => {
      setTimeoutMessage('No opponents found after 2 minutes. Returning to lobby...');
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
      setTimeout(() => router.push('/lobby'), 3000);
    }, 120000); // 2 minutes = 120 seconds

    return () => {
      clearTimeout(timeoutId);
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
      setIsMatchmakingInProgress(false);
      isStartMatchmakingRunning.current = false; // Reset running flag
    };
  }, [publicKey, router, signTransaction]); // Removed entryFee to prevent infinite loops

  // Debug effect for matched status
  useEffect(() => {
    if (status === 'matched') {
      console.log('🎮 Rendering matched status UI with:', { status, matchData, escrowStatus });
      
      // Reset escrow status if it's stuck in pending
      if (escrowStatus === 'pending') {
        console.log('🔧 Resetting stuck escrow status from pending to failed');
        setEscrowStatus('failed');
      }
    }
  }, [status, matchData, escrowStatus]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-primary">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-6">
            {status === 'escrow' ? 'Locking Entry Fee...' : 'Finding Opponent...'}
          </h1>
          {timeoutMessage && (
            <div className="text-yellow-400 text-lg mb-4">{timeoutMessage}</div>
          )}
          {status === 'waiting' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <p className="text-white/80 text-center">🔍 Finding Opponent...</p>
              
              <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
                <h3 className="text-blue-400 font-semibold mb-2">⏳ Waiting for Players</h3>
                <p className="text-white/80 mb-3">
                  Looking for other players with the same entry fee ({entryFee} SOL)
                </p>
                
                {waitingCount > 0 && (
                  <div className="text-accent text-sm bg-white/10 rounded p-2">
                    {waitingCount === 1 ? 'You are the only player waiting' : `${waitingCount} players waiting`}
                  </div>
                )}
                
                <div className="space-y-2 text-sm text-white/70 mt-3">
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-2">ℹ️</span>
                    Match will start automatically when opponent joins
                  </div>
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-2">ℹ️</span>
                    Both players will lock entry fees before game starts
                  </div>
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-2">ℹ️</span>
                    Winner gets 90% of total pot automatically
                  </div>
                </div>
              </div>
              
              <div className="text-xs text-white/50 text-center">
                💡 Try different entry fees if no one joins (0.05, 0.1, 0.2 SOL are popular)
              </div>
            </div>
          )}
          {status === 'matched' && (
            <div className="space-y-4">
              <div className="text-green-400 text-xl font-bold">🎉 Match Found!</div>
              
              {(matchData?.status === 'matched' || matchData?.matchStatus === 'escrow' || matchData?.message?.includes('lock your entry fee')) ? (
                <div className="space-y-4">
                  <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
                    <h3 className="text-green-400 font-semibold mb-2">🔒 Lock Your Entry Fee</h3>
                    <p className="text-white/80 mb-3">
                      Your opponent is ready! Lock your entry fee to start the game.
                    </p>
                    
                    <div className="bg-white/10 rounded-lg p-3 mb-4">
                      <div className="flex justify-between items-center">
                        <span className="text-white/80">Entry Fee:</span>
                        <span className="text-accent font-bold">{entryFee} SOL</span>
                      </div>
                      <div className="flex justify-between items-center mt-1">
                        <span className="text-white/80">Potential Win:</span>
                        <span className="text-green-400 font-bold">{(entryFee * 1.8).toFixed(3)} SOL</span>
                      </div>
                    </div>
                    
                    <div className="space-y-2 text-sm text-white/70">
                      <div className="flex items-center">
                        <span className="text-green-400 mr-2">✓</span>
                        Your SOL will be locked in smart contract escrow
                      </div>
                      <div className="flex items-center">
                        <span className="text-green-400 mr-2">✓</span>
                        Winner gets 90% of total pot automatically
                      </div>
                      <div className="flex items-center">
                        <span className="text-green-400 mr-2">✓</span>
                        No one can steal or avoid payment
                      </div>
                    </div>
                    
                    <button
                      onClick={() => {
                        console.log('🔘 Lock Entry Fee button clicked!');
                        console.log('🔍 Button debug info:', {
                          hasPublicKey: !!publicKey,
                          hasMatchData: !!matchData,
                          hasSignTransaction: !!signTransaction,
                          escrowStatus,
                          matchDataStatus: matchData?.status,
                          matchDataMatchStatus: matchData?.matchStatus
                        });
                        handleEscrowPayment();
                      }}
                      disabled={escrowStatus === 'pending'}
                      className={`w-full mt-4 px-6 py-3 rounded-lg transition-colors font-semibold ${
                        escrowStatus === 'pending' 
                          ? 'bg-gray-500 cursor-not-allowed' 
                          : 'bg-accent hover:bg-accent/80 text-white'
                      }`}
                    >
                      {escrowStatus === 'pending' ? 'Processing...' : '🔒 Lock Entry Fee'}
                    </button>
                    
                    {escrowStatus === 'failed' && (
                      <div className="text-red-400 text-sm mt-2 bg-red-500/20 border border-red-500/30 rounded p-2">
                        ❌ Failed to lock entry fee. Please try again.
                      </div>
                    )}
                  </div>
                  
                  <div className="text-xs text-white/50 text-center">
                    💡 Phantom wallet will pop up asking for approval. Review the transaction details carefully.
                  </div>
                </div>
              ) : matchData?.matchStatus === 'active' ? (
                <div>
                  <p className="text-white/80">Match is already active!</p>
                  <p className="text-accent text-sm">Redirecting to game...</p>
                  <button
                    onClick={() => {
                      localStorage.setItem('matchId', matchData.matchId);
                      if (matchData.escrowAddress) {
                        localStorage.setItem('escrowAddress', matchData.escrowAddress);
                      }
                      if (matchData.entryFee) {
                        localStorage.setItem('entryFee', matchData.entryFee.toString());
                      }
                      router.push(`/game?matchId=${matchData.matchId}`);
                    }}
                    className="bg-accent hover:bg-accent/80 text-white px-6 py-2 rounded-lg transition-colors"
                  >
                    Go to Game
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-white/80">Both players confirmed escrow!</p>
                  <p className="text-accent text-sm">Redirecting to game...</p>
                </div>
              )}
            </div>
          )}
          {status === 'escrow' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <p className="text-white/80 text-center">🔒 Locking Entry Fee...</p>
              
              <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-4">
                <h3 className="text-yellow-400 font-semibold mb-2">⏳ Processing Transaction</h3>
                <p className="text-white/80 mb-3">
                  Please approve the transaction in your Phantom wallet
                </p>
                
                <div className="space-y-2 text-sm text-white/70">
                  <div className="flex items-center">
                    <span className="text-yellow-400 mr-2">📱</span>
                    Phantom wallet should have popped up
                  </div>
                  <div className="flex items-center">
                    <span className="text-yellow-400 mr-2">💰</span>
                    Review amount: {entryFee} SOL
                  </div>
                  <div className="flex items-center">
                    <span className="text-yellow-400 mr-2">🔒</span>
                    Recipient: Smart contract escrow
                  </div>
                  <div className="flex items-center">
                    <span className="text-yellow-400 mr-2">✅</span>
                    Click "Approve" in Phantom
                  </div>
                </div>
                
                <div className="mt-3 text-xs text-white/50">
                  ⚠️ Don't close Phantom or refresh the page during this process
                </div>
              </div>
            </div>
          )}
          {status === 'error' && (
            <div className="space-y-4">
              <div className="text-red-400 text-xl">✗ Error</div>
              <p className="text-white/80">Failed to find match. Please try again.</p>
              <button
                onClick={() => window.location.reload()}
                className="bg-accent hover:bg-accent/80 text-white px-6 py-2 rounded-lg transition-colors"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Matchmaking; 