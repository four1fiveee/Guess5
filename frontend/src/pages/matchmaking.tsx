import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import Image from 'next/image';
import logo from '../../public/logo.png';


const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction, signAllTransactions } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'matched' | 'payment_required' | 'active' | 'error' | 'cancelled' | 'waiting_for_opponent'>('waiting');
  const [timeLeft, setTimeLeft] = useState(120);
  const [timeoutMessage, setTimeoutMessage] = useState<string>('');
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchData, setMatchData] = useState<any>(null);
  const [paymentTimeout, setPaymentTimeout] = useState<NodeJS.Timeout | null>(null);

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

  const handlePayment = async () => {
    if (!publicKey || !matchData) {
      console.error('❌ Missing publicKey or matchData');
      return;
    }

    if (!signTransaction) {
      console.error('❌ Missing signTransaction function');
      return;
    }

    try {
      console.log('💰 Starting upfront payment...');
      console.log('🔍 Payment info:', {
        publicKey: publicKey.toString(),
        matchId: matchData.matchId,
        entryFee: entryFee
      });

      // Create connection to Solana network
      const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com';
      const connection = new Connection(solanaNetwork, 'confirmed');
      
      // Check if the user has enough balance
      const balance = await connection.getBalance(publicKey);
      const requiredAmount = Math.floor(entryFee * LAMPORTS_PER_SOL);
      
      console.log('🔍 Balance check:', {
        currentBalance: balance / LAMPORTS_PER_SOL,
        requiredAmount: requiredAmount / LAMPORTS_PER_SOL,
        hasEnoughBalance: balance >= requiredAmount
      });
      
      if (balance < requiredAmount) {
        throw new Error(`Insufficient balance. You have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, but need ${entryFee} SOL`);
      }
      
      console.log('🔍 Creating transaction for:', {
        from: publicKey.toString(),
        to: "2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt",
        amount: entryFee,
        lamports: Math.floor(entryFee * LAMPORTS_PER_SOL)
      });
      
      // Create transaction to pay entry fee to fee wallet
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey("2Q9WZbjgssyuNA1t5WLHL4SWdCiNAQCTM5FbWtGQtvjt"), // Fee wallet
          lamports: Math.floor(entryFee * LAMPORTS_PER_SOL),
        })
      );

      // Get recent blockhash
      const { blockhash } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      
      // Log transaction details for debugging
      console.log('🔍 Transaction details:', {
        recentBlockhash: blockhash,
        feePayer: publicKey.toString(),
        instructions: transaction.instructions.length,
        signers: transaction.signatures.length
      });

      console.log('🔍 Transaction created, signing...');
      
      // Send transaction
      const signedTransaction = await signTransaction(transaction);
      console.log('🔍 Transaction signed, sending...');
      
      // Serialize the transaction
      const serializedTransaction = signedTransaction.serialize();
      console.log('🔍 Transaction serialized, length:', serializedTransaction.length);
      
      // Send the transaction
      const signature = await connection.sendRawTransaction(serializedTransaction, {
        skipPreflight: false,
        preflightCommitment: 'confirmed'
      });
      console.log('🔍 Transaction sent with signature:', signature);
      
      // Wait for confirmation with more detailed error handling
      console.log('🔍 Waiting for transaction confirmation...');
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      
      if (confirmation.value.err) {
        console.error('❌ Transaction confirmation failed:', confirmation.value.err);
        throw new Error(`Transaction failed: ${JSON.stringify(confirmation.value.err)}`);
      }
      
      console.log('✅ Transaction confirmed successfully');
      
      // Verify the transaction actually happened by checking the transaction
      const transactionDetails = await connection.getTransaction(signature);
      if (!transactionDetails) {
        throw new Error('Transaction not found on blockchain');
      }
      
      if (transactionDetails.meta?.err) {
        console.error('❌ Transaction failed on blockchain:', transactionDetails.meta.err);
        throw new Error(`Transaction failed on blockchain: ${JSON.stringify(transactionDetails.meta.err)}`);
      }
      
      console.log('🔍 Transaction details:', {
        signature: signature,
        status: transactionDetails.meta?.err ? 'failed' : 'success',
        fee: transactionDetails.meta?.fee,
        lamports: transactionDetails.meta?.postBalances,
        preBalances: transactionDetails.meta?.preBalances
      });
      
      // Check if the transfer actually happened
      const preBalance = transactionDetails.meta?.preBalances?.[0] || 0;
      const postBalance = transactionDetails.meta?.postBalances?.[0] || 0;
      const transferAmount = Math.floor(entryFee * LAMPORTS_PER_SOL);
      
      console.log('🔍 Balance check:', {
        preBalance: preBalance / LAMPORTS_PER_SOL,
        postBalance: postBalance / LAMPORTS_PER_SOL,
        transferAmount: transferAmount / LAMPORTS_PER_SOL,
        difference: (preBalance - postBalance) / LAMPORTS_PER_SOL
      });

      console.log('✅ Payment successful:', signature);
      
      // Confirm payment with backend
      const confirmResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/confirm-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId: matchData.matchId,
          wallet: publicKey.toString(),
          paymentSignature: signature
        }),
      });

      if (!confirmResponse.ok) {
        const errorData = await confirmResponse.json().catch(() => ({}));
        throw new Error(`Backend confirmation failed: ${errorData.error || confirmResponse.statusText}`);
      }

      const confirmData = await confirmResponse.json();
      console.log('✅ Payment confirmed with backend:', confirmData);

      if (confirmData.status === 'active') {
        console.log('🎮 Game started! Redirecting to game...');
        
        // Clear payment timeout since payment was successful
        if (paymentTimeout) {
          clearTimeout(paymentTimeout);
          setPaymentTimeout(null);
        }
        
        // Store match data and redirect to game
        localStorage.setItem('matchId', matchData.matchId);
        if (matchData.entryFee) {
          localStorage.setItem('entryFee', matchData.entryFee.toString());
        }
        
        // Redirect to game immediately
        router.push(`/game?matchId=${matchData.matchId}`);
      } else {
        console.log('⏳ Waiting for other player to pay...');
        setStatus('waiting_for_opponent');
        
        // Continue polling to detect when other player pays
        console.log('🔄 Continuing to poll for game start...');
      }
      
    } catch (error) {
      console.error('❌ Payment error:', error);
      alert(`Payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      // Reset status to allow retry
      setStatus('matched');
      
      // Log additional details for debugging
      if (error instanceof Error) {
        console.error('❌ Error details:', {
          message: error.message,
          stack: error.stack
        });
      }
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
              console.log('✅ Match found, proceeding to payment...');
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
          // Don't poll if we already have an active match
          if (matchData && status === 'active') {
            console.log('🎮 Already have an active match, stopping polling');
            clearInterval(pollInterval);
            setIsPolling(false);
            return;
          }

          // Don't poll if matchmaking is in progress
          if (isMatchmakingInProgress) {
            console.log('🎮 Matchmaking in progress, skipping poll');
            return;
          }

          // Don't start matchmaking if we already have a valid match and it's active
          if (matchData && matchData.status === 'active') {
            console.log('🎮 Already have active match data, not starting matchmaking from polling');
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
          
          console.log('🔍 Polling response:', data);
          
          if (data.matched) {
            console.log('✅ We have been matched!', data);
            setMatchData(data);
            
            // Always set status to 'matched' to show payment button, regardless of backend status
            setStatus('matched');
            
            // Log payment status for debugging
            console.log('💰 Payment status:', {
              player1Paid: data.player1Paid,
              player2Paid: data.player2Paid,
              player1: data.player1,
              player2: data.player2,
              currentPlayer: publicKey.toString()
            });
            
            clearInterval(countdownInterval);
            clearTimeout(timeoutId); // Also clear timeout
            setIsMatchmakingInProgress(false); // Reset matchmaking progress
            isStartMatchmakingRunning.current = false; // Reset running flag
            
            // Check if the match is active (both players paid)
            if (data.status === 'active') {
              console.log('🎮 Match is active! Starting game...');
              clearInterval(pollInterval);
              setIsPolling(false);
              
              // Store match data and redirect to game
              localStorage.setItem('matchId', data.matchId);
              if (data.entryFee) {
                localStorage.setItem('entryFee', data.entryFee.toString());
              }
              
              // Redirect to game immediately
              router.push(`/game?matchId=${data.matchId}`);
              return;
            }
            
            // Set payment timeout (1 minute) if backend status is payment_required
            if (data.status === 'payment_required') {
              const timeout = setTimeout(() => {
                console.log('⏰ Payment timeout - redirecting to lobby');
                setStatus('cancelled');
                setTimeoutMessage('Payment timeout - returning to lobby...');
                setTimeout(() => router.push('/lobby'), 3000);
              }, 60000); // 1 minute
              setPaymentTimeout(timeout);
            }
            
            console.log('🎮 Match confirmed, waiting for payment...');
            return; // Exit early, don't continue polling
          } else if (data.status === 'cancelled') {
            console.log('❌ Match was cancelled:', data);
            setStatus('cancelled');
            clearInterval(pollInterval);
            clearInterval(countdownInterval);
            clearTimeout(timeoutId);
            setIsPolling(false);
            setIsMatchmakingInProgress(false);
            isStartMatchmakingRunning.current = false;
            setTimeoutMessage('Match was cancelled due to payment timeout - returning to lobby...');
            setTimeout(() => router.push('/lobby'), 3000);
            return;
          }
        } catch (error) {
          console.error('❌ Error polling for match:', error);
        }
      }, 10000); // Poll every 10 seconds (increased to avoid rate limits)
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
      if (paymentTimeout) {
        clearTimeout(paymentTimeout);
      }
      setIsMatchmakingInProgress(false);
      isStartMatchmakingRunning.current = false; // Reset running flag
    };
  }, [publicKey, router, signTransaction]); // Removed entryFee to prevent infinite loops

  // Debug effect for matched status
  useEffect(() => {
    if (status === 'matched') {
      console.log('🎮 Rendering matched status UI with:', { status, matchData });
    }
  }, [status, matchData]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-primary">
      <div className="bg-white/10 backdrop-blur-lg rounded-2xl p-8 shadow-2xl border border-white/20 max-w-md w-full mx-4">
        <div className="text-center">
          {/* Logo prominently displayed at the top */}
          <div className="flex justify-center mb-6">
            <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-4" />
          </div>
          
          <h1 className="text-3xl font-bold text-white mb-6">
            {status === 'active' ? 'Game Starting...' : 'Finding Opponent...'}
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
                    Winner gets 95% of total pot after game
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
              
              <div className="space-y-4">
                <div className="bg-orange-500/20 border border-orange-500/30 rounded-lg p-4">
                  <h3 className="text-orange-400 font-semibold mb-2">💰 Pay Entry Fee</h3>
                  <p className="text-white/80 mb-3">
                    Your opponent is ready! Pay the entry fee to start the game.
                  </p>
                  
                  <div className="bg-white/10 rounded-lg p-3 mb-4">
                    <div className="flex justify-between items-center">
                      <span className="text-white/80">Entry Fee:</span>
                      <span className="text-accent font-bold">{entryFee} SOL</span>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-white/80">Potential Win:</span>
                      <span className="text-green-400 font-bold">{(entryFee * 1.9).toFixed(3)} SOL</span>
                    </div>
                  </div>
                  
                  <div className="space-y-2 text-sm text-white/70">
                    <div className="flex items-center">
                      <span className="text-orange-400 mr-2">⚠️</span>
                      Both players must pay before game starts
                    </div>
                    <div className="flex items-center">
                      <span className="text-orange-400 mr-2">💰</span>
                      Payment goes to fee wallet for security
                    </div>
                    <div className="flex items-center">
                      <span className="text-orange-400 mr-2">🎯</span>
                      Winner gets 95% of total pot after game
                    </div>
                  </div>
                  
                  <button
                    onClick={handlePayment}
                    className="w-full mt-4 px-6 py-3 rounded-lg transition-colors font-semibold bg-orange-500 hover:bg-orange-600 text-white"
                  >
                    💰 Pay {entryFee} SOL
                  </button>
                </div>
                
                <div className="text-xs text-white/50 text-center">
                  💡 Phantom wallet will pop up asking for approval
                </div>
              </div>
            </div>
          )}
          {status === 'payment_required' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <p className="text-white/80 text-center">⏳ Processing Payment...</p>
              
              <div className="bg-orange-500/20 border border-orange-500/30 rounded-lg p-4">
                <h3 className="text-orange-400 font-semibold mb-2">⏳ Processing Transaction</h3>
                <p className="text-white/80 mb-3">
                  Please approve the transaction in your Phantom wallet
                </p>
                
                <div className="space-y-2 text-sm text-white/70">
                  <div className="flex items-center">
                    <span className="text-orange-400 mr-2">📱</span>
                    Phantom wallet should have popped up
                  </div>
                  <div className="flex items-center">
                    <span className="text-orange-400 mr-2">💰</span>
                    Review amount: {entryFee} SOL
                  </div>
                  <div className="flex items-center">
                    <span className="text-orange-400 mr-2">🔒</span>
                    Recipient: Fee wallet
                  </div>
                  <div className="flex items-center">
                    <span className="text-orange-400 mr-2">✅</span>
                    Click "Approve" in Phantom
                  </div>
                </div>
                
                <div className="mt-3 text-xs text-white/50">
                  ⚠️ Don't close Phantom or refresh the page during this process
                </div>
              </div>
            </div>
          )}
          {status === 'cancelled' && (
            <div className="space-y-4">
              <div className="text-red-400 text-xl font-bold">⏰ Match Cancelled</div>
              
              <div className="bg-red-500/20 border border-red-500/30 rounded-lg p-4">
                <h3 className="text-red-400 font-semibold mb-2">Payment Timeout</h3>
                <p className="text-white/80 mb-3">
                  The match was cancelled because one or both players didn't complete payment within 1 minute.
                </p>
                
                <button
                  onClick={() => router.push('/lobby')}
                  className="w-full bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-bold py-3 px-6 rounded-lg transition-all duration-200"
                >
                  Return to Lobby
                </button>
              </div>
            </div>
          )}
          {status === 'waiting_for_opponent' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <p className="text-white/80 text-center">⏳ Waiting for Opponent to Pay...</p>
              
              <div className="bg-blue-500/20 border border-blue-500/30 rounded-lg p-4">
                <h3 className="text-blue-400 font-semibold mb-2">✅ Payment Confirmed!</h3>
                <p className="text-white/80 mb-3">
                  Your payment was successful! Waiting for your opponent to complete their payment.
                </p>
                
                <div className="space-y-2 text-sm text-white/70">
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-2">✅</span>
                    Your payment: {entryFee} SOL sent
                  </div>
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-2">⏳</span>
                    Waiting for opponent to pay
                  </div>
                  <div className="flex items-center">
                    <span className="text-blue-400 mr-2">🎮</span>
                    Game will start automatically when both players pay
                  </div>
                </div>
              </div>
            </div>
          )}
          {status === 'active' && (
            <div className="space-y-4">
              <div className="flex justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
              </div>
              <p className="text-white/80 text-center">🎮 Starting Game...</p>
              
              <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4">
                <h3 className="text-green-400 font-semibold mb-2">🎯 Game Ready!</h3>
                <p className="text-white/80 mb-3">
                  Redirecting to the game...
                </p>
                
                <div className="space-y-2 text-sm text-white/70">
                  <div className="flex items-center">
                    <span className="text-green-400 mr-2">🎮</span>
                    Game is starting
                  </div>
                  <div className="flex items-center">
                    <span className="text-green-400 mr-2">💰</span>
                    Entry fee: {entryFee} SOL
                  </div>
                  <div className="flex items-center">
                    <span className="text-green-400 mr-2">🎯</span>
                    Solve the word puzzle to win!
                  </div>
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