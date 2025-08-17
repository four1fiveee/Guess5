import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';


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

    // Prevent double payment
    if (status === 'payment_required' && matchData.player1Paid && matchData.player2Paid) {
      console.log('⚠️ Both players already paid, preventing double payment');
      return;
    }

    // Check if current player already paid
    const isPlayer1 = publicKey.toString() === matchData.player1;
    const currentPlayerPaid = isPlayer1 ? matchData.player1Paid : matchData.player2Paid;
    
    if (currentPlayerPaid) {
      console.log('⚠️ Current player already paid, preventing double payment');
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
            
            // Set status based on backend status
            if (data.status === 'payment_required') {
              setStatus('payment_required');
            } else if (data.status === 'active') {
              setStatus('active');
            } else {
              setStatus('matched');
            }
            
            // Log payment status for debugging
            console.log('💰 Payment status:', {
              player1Paid: data.player1Paid,
              player2Paid: data.player2Paid,
              player1: data.player1,
              player2: data.player2,
              currentPlayer: publicKey.toString()
            });
            
            // STOP ALL TIMERS when match is found
            clearInterval(pollInterval);
            clearInterval(countdownInterval);
            clearTimeout(timeoutId);
            if (paymentTimeout) {
              clearTimeout(paymentTimeout);
              setPaymentTimeout(null);
            }
            setIsPolling(false);
            setIsMatchmakingInProgress(false); // Reset matchmaking progress
            isStartMatchmakingRunning.current = false; // Reset running flag
            
            // Check if the match is active (both players paid)
            if (data.status === 'active') {
              console.log('🎮 Match is active! Starting game...');
              console.log('🎮 Game data:', {
                matchId: data.matchId,
                word: data.word,
                player1: data.player1,
                player2: data.player2,
                player1Paid: data.player1Paid,
                player2Paid: data.player2Paid
              });
              
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
            
            // Check if both players have paid but status hasn't updated yet
            if (data.player1Paid && data.player2Paid && data.status === 'payment_required') {
              console.log('💰 Both players have paid, waiting for status to update to active...');
              // Clear payment timeout since both players paid
              if (paymentTimeout) {
                clearTimeout(paymentTimeout);
                setPaymentTimeout(null);
              }
              // Continue polling to wait for status to become 'active'
              setStatus('waiting_for_opponent');
            }
            
            // Wait for backend to update status to 'active' when both players paid
            if (data.player1Paid && data.player2Paid && data.status === 'payment_required') {
              console.log('💰 Both players confirmed paid - waiting for backend to activate game...');
              setStatus('waiting_for_opponent');
              // Continue polling to wait for status to become 'active'
            }
            
            // Redirect when backend confirms game is active
            if (data.status === 'active') {
              console.log('🎮 Backend confirmed game is active - redirecting to game!');
              console.log('🎮 Game data:', {
                matchId: data.matchId,
                player1: data.player1,
                player2: data.player2,
                player1Paid: data.player1Paid,
                player2Paid: data.player2Paid
              });
              
              // STOP ALL TIMERS when game is active
              clearInterval(pollInterval);
              clearInterval(countdownInterval);
              clearTimeout(timeoutId);
              if (paymentTimeout) {
                clearTimeout(paymentTimeout);
                setPaymentTimeout(null);
              }
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
            
            // Set payment timeout (1 minute) if backend status is payment_required AND current player hasn't paid
            const currentPlayerPaid = (data.player1 === publicKey?.toString() && data.player1Paid) || 
                                    (data.player2 === publicKey?.toString() && data.player2Paid);
            
            if (data.status === 'payment_required' && !currentPlayerPaid) {
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
      }, 2000); // Poll every 2 seconds for faster matchmaking
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={200} height={200} className="mb-6" />
        
        {/* Status Display */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-md w-full text-center shadow">
          {status === 'waiting' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Finding Opponent...</h2>
              <div className="text-white/80 mb-4">
                Waiting for another player to join
              </div>
              <div className="text-accent text-lg font-semibold">
                {waitingCount > 0 ? `${waitingCount} players waiting` : 'Searching...'}
              </div>
            </div>
          )}
          
          {status === 'matched' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Match Found!</h2>
              <div className="text-white/80 mb-4">
                Opponent found. Please pay the entry fee to start the game.
              </div>
              <div className="text-white/80 mb-4">
                Entry Fee: {entryFee} SOL
              </div>
              {matchData && (
                <div className="text-sm text-white/60 mb-4">
                  Payment Status: {matchData.player1Paid ? 'Player 1 Paid' : 'Player 1 Pending'} | {matchData.player2Paid ? 'Player 2 Paid' : 'Player 2 Pending'}
                </div>
              )}
              <button
                onClick={handlePayment}
                disabled={matchData && ((publicKey?.toString() === matchData.player1 && matchData.player1Paid) || (publicKey?.toString() === matchData.player2 && matchData.player2Paid))}
                className={`px-6 py-3 rounded-lg font-bold transition-colors ${
                  matchData && ((publicKey?.toString() === matchData.player1 && matchData.player1Paid) || (publicKey?.toString() === matchData.player2 && matchData.player2Paid))
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-accent text-primary hover:bg-yellow-400'
                }`}
              >
                {matchData && ((publicKey?.toString() === matchData.player1 && matchData.player1Paid) || (publicKey?.toString() === matchData.player2 && matchData.player2Paid))
                  ? 'Payment Confirmed'
                  : 'Pay Entry Fee'
                }
              </button>
            </div>
          )}
          
          {status === 'payment_required' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Payment Required</h2>
              <div className="text-white/80 mb-4">
                Entry Fee: {entryFee} SOL
              </div>
              <button
                onClick={handlePayment}
                className="bg-accent text-primary px-6 py-3 rounded-lg font-bold hover:bg-yellow-400 transition-colors"
              >
                Pay Entry Fee
              </button>
            </div>
          )}
          
          {status === 'active' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Game Starting!</h2>
              <div className="text-white/80 mb-4">
                Redirecting to game...
              </div>
            </div>
          )}
          
          {status === 'error' && (
            <div>
              <h2 className="text-2xl font-bold text-red-400 mb-4">Error</h2>
              <div className="text-white/80 mb-4">
                {timeoutMessage || 'An error occurred'}
              </div>
              <button
                onClick={() => router.push('/lobby')}
                className="bg-accent text-primary px-6 py-3 rounded-lg font-bold hover:bg-yellow-400 transition-colors"
              >
                Back to Lobby
              </button>
            </div>
          )}
          
          {status === 'cancelled' && (
            <div>
              <h2 className="text-2xl font-bold text-red-400 mb-4">Match Cancelled</h2>
              <div className="text-white/80 mb-4">
                The match was cancelled
              </div>
              <button
                onClick={() => router.push('/lobby')}
                className="bg-accent text-primary px-6 py-3 rounded-lg font-bold hover:bg-yellow-400 transition-colors"
              >
                Back to Lobby
              </button>
            </div>
          )}
          
          {status === 'waiting_for_opponent' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Waiting for Game to Start</h2>
              <div className="text-white/80 mb-4">
                Both players have paid! The game is being initialized...
              </div>
              <div className="text-accent text-lg font-semibold">
                Redirecting to game...
              </div>
            </div>
          )}
        </div>
        
        {/* Timer */}
        {timeLeft > 0 && (
          <div className="mt-4 text-accent text-lg font-semibold">
            ⏰ Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
          </div>
        )}
      </div>
    </div>
  );
};

export default Matchmaking; 