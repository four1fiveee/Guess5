import React, { useState, useEffect } from 'react';
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

  const handleEscrowPayment = async () => {
    if (!publicKey || !matchData) {
      console.error('❌ Missing publicKey or matchData');
      setEscrowStatus('failed');
      return;
    }

    try {
      console.log('💰 Starting smart contract escrow payment...');
      setEscrowStatus('pending');

      // Create smart contract service instance
      const smartContractService = new SmartContractService({
        publicKey: publicKey,
        signTransaction: signTransaction,
        signAllTransactions: signAllTransactions
      });

      // Lock entry fee using smart contract
      const lockResult = await smartContractService.lockEntryFee(
        matchData.matchId,
        entryFee
      );

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
    } catch (error) {
      console.error('❌ Smart contract escrow payment error:', error);
      setEscrowStatus('failed');
    }
  };

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    // Get entry fee from localStorage
    const storedEntryFee = localStorage.getItem('entryFeeSOL');
    if (storedEntryFee) {
      setEntryFee(parseFloat(storedEntryFee));
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
          // Retry matchmaking after cleanup
          setTimeout(() => {
            startMatchmaking();
          }, 1000);
        }
      } catch (error) {
        console.error('❌ Failed to cleanup stuck matches:', error);
      }
    };

    const startMatchmaking = async () => {
      if (!publicKey || !matchData) {
        console.error('❌ Missing publicKey or matchData');
        return;
      }

      const wallet = publicKey.toString();
      console.log('🎮 Starting matchmaking with wallet:', wallet);

      try {
        // Clean up any stuck matches first
        await cleanupStuckMatches();

        // Get entry fee from localStorage
        const storedEntryFee = localStorage.getItem('entryFee');
        
        if (!storedEntryFee) {
          console.error('❌ No entry fee found');
          router.push('/lobby');
          return;
        }

        const entryFee = parseFloat(storedEntryFee);
        console.log('🎮 Starting matchmaking with entry fee:', entryFee);

        // Add retry logic for network failures
        let retryCount = 0;
        const maxRetries = 3;
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
              throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('🎮 Matchmaking response:', data);

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
                  await new Promise(resolve => setTimeout(resolve, 1000 * retryCount)); // Exponential backoff
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
              console.log(`🔄 Retrying in ${retryCount * 1000}ms... (${retryCount}/${maxRetries})`);
              await new Promise(resolve => setTimeout(resolve, retryCount * 1000)); // Exponential backoff
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
        }
      } catch (error) {
        console.error('❌ Matchmaking error:', error);
        setStatus('error');
        clearTimeout(timeoutId);
        clearInterval(pollInterval);
      }
    };

    const startPolling = () => {
      // Poll every 1 second to check if we've been matched (faster response)
      pollInterval = setInterval(async () => {
        try {
          console.log('🔍 Polling for match status...');
          
          // Use the dedicated endpoint to check if we've been matched
          const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/check-match/${publicKey.toString()}`);
          const data = await response.json();
          
          if (data.matched) {
            console.log('✅ We have been matched!', data);
            const ourMatch = data;
            
            // Validate that this is a proper match with both players
            if (ourMatch && (ourMatch.status === 'active' || ourMatch.status === 'escrow') && ourMatch.player1 && ourMatch.player2) {
              // CRITICAL: Check that this is not a self-match
              if (ourMatch.player1 === ourMatch.player2) {
                console.log('❌ Found self-match, ignoring:', ourMatch);
                return;
              }
              
              // IMMEDIATE CLEANUP: Stop polling since we have a confirmed match
              clearInterval(pollInterval);
              clearTimeout(timeoutId);
              clearInterval(countdownInterval);
              setIsPolling(false);
              
              console.log('🎮 Match confirmed, proceeding to escrow...');
              setMatchData(ourMatch);
              setStatus('matched');
              
              // Check if this is an active match (not escrow)
              if (ourMatch.message && ourMatch.message.includes('Already in active match')) {
                console.log('🎮 Match is already active, redirecting to game...');
                // Store match data and redirect to game
                localStorage.setItem('matchId', ourMatch.matchId);
                if (ourMatch.word) {
                  localStorage.setItem('word', ourMatch.word);
                }
                if (ourMatch.escrowAddress) {
                  localStorage.setItem('escrowAddress', ourMatch.escrowAddress);
                }
                if (ourMatch.entryFee) {
                  localStorage.setItem('entryFee', ourMatch.entryFee.toString());
                }
                
                setTimeout(() => {
                  router.push(`/game?matchId=${ourMatch.matchId}`);
                }, 1000);
              } else {
                // Don't redirect yet - need to handle escrow first
              }
            } else {
              console.log('⚠️ Invalid match data received:', ourMatch);
            }
          }
        } catch (error) {
          console.error('❌ Error polling for match:', error);
        }
      }, 1000); // Poll every 1 second
    };

    startMatchmaking();
    if (!isPolling) {
      setIsPolling(true);
      startPolling();
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
    };
  }, [publicKey, router, signTransaction, matchData, entryFee]);

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
              <p className="text-white/80">Waiting for another player to join...</p>
              {waitingCount > 0 && (
                <div className="text-accent text-sm">
                  {waitingCount === 1 ? 'You are the only player waiting' : `${waitingCount} players waiting`}
                </div>
              )}
              <div className="text-accent text-sm">
                Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
              </div>
            </div>
          )}
          {status === 'matched' && (
            <div className="space-y-4">
              <div className="text-green-400 text-xl">✓ Match Found!</div>
              {(matchData?.matchStatus === 'escrow' || matchData?.message?.includes('lock your entry fee')) ? (
                <div>
                  <p className="text-white/80">Please lock your entry fee to start the game</p>
                  <div className="text-accent text-sm">
                    Entry Fee: {entryFee} SOL
                  </div>
                  <button
                    onClick={handleEscrowPayment}
                    disabled={escrowStatus === 'pending'}
                    className={`px-6 py-3 rounded-lg transition-colors ${
                      escrowStatus === 'pending' 
                        ? 'bg-gray-500 cursor-not-allowed' 
                        : 'bg-accent hover:bg-accent/80 text-white'
                    }`}
                  >
                    {escrowStatus === 'pending' ? 'Processing...' : 'Lock Entry Fee'}
                  </button>
                  {escrowStatus === 'failed' && (
                    <div className="text-red-400 text-sm mt-2">
                      Failed to lock entry fee. Please try again.
                    </div>
                  )}
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
              <p className="text-white/80">Locking your entry fee...</p>
              <p className="text-accent text-sm">Please approve the transaction in your wallet</p>
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