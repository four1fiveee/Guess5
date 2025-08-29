import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import api from '../utils/api';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'payment_required' | 'waiting_for_game' | 'active' | 'error' | 'cancelled'>('waiting');
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchData, setMatchData] = useState<any>(null);
  const [entryFee, setEntryFee] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isMatchmakingInProgress, setIsMatchmakingInProgress] = useState(false);
  const [isRequestInProgress, setIsRequestInProgress] = useState<boolean>(false);
  const [isPaymentInProgress, setIsPaymentInProgress] = useState<boolean>(false);
  const [paymentTimeout, setPaymentTimeout] = useState<NodeJS.Timeout | null>(null);
  
  // Use ref to track current matchData to avoid closure issues
  const matchDataRef = useRef<any>(null);
  const statusRef = useRef<string>('waiting');

  const handlePayment = async () => {
    if (isPaymentInProgress) {
      console.log('⚠️ Payment already in progress');
      return;
    }

    setIsPaymentInProgress(true);
    if (!publicKey || !matchData) {
      console.error('❌ Missing publicKey or matchData');
      return;
    }

    if (!signTransaction) {
      console.error('❌ Missing signTransaction function');
      return;
    }

    // Check if current player already paid
    const isPlayer1 = publicKey.toString() === matchData.player1;
    const currentPlayerPaid = isPlayer1 ? matchData.player1Paid : matchData.player2Paid;
    
    if (currentPlayerPaid) {
      console.log('⚠️ Current player already paid');
      return;
    }

    try {
      console.log('💰 Starting payment...');

      // Create connection to Solana network
      const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com';
      const connection = new Connection(solanaNetwork, 'confirmed');
      
      // Check if the user has enough balance
      const balance = await connection.getBalance(publicKey);
      const requiredAmount = Math.floor(entryFee * LAMPORTS_PER_SOL);
      
      if (balance < requiredAmount) {
        throw new Error(`Insufficient balance. You have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, but need ${entryFee} SOL`);
      }
      
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

      // Sign and send transaction
      const signedTransaction = await signTransaction(transaction);
      const signature = await connection.sendRawTransaction(signedTransaction.serialize());
      
  

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        throw new Error('Transaction failed to confirm');
      }

  

      // Confirm payment with backend with retry mechanism
      let confirmData;
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          confirmData = await api.confirmPayment(matchData.matchId, publicKey.toString(), signature);
      
          break; // Success, exit retry loop
        } catch (error) {
          retryCount++;
          console.warn(`⚠️ Payment confirmation attempt ${retryCount} failed:`, error);
          
          if (retryCount >= maxRetries) {
            throw new Error(`Payment confirmation failed after ${maxRetries} attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
          }
          
          // Wait before retrying
          await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
        }
      }

      // Update match data with payment status
      setMatchData((prev: any) => ({
        ...prev,
        player1Paid: isPlayer1 ? true : prev.player1Paid,
        player2Paid: isPlayer1 ? prev.player2Paid : true
      }));

      // Check if both players have paid based on backend response
      if (confirmData.player1Paid && confirmData.player2Paid) {
    
        setStatus('waiting_for_game');
      } else {
        console.log('⏳ Waiting for other player to pay...');
        setStatus('waiting_for_game');
        
        // Set a timeout to redirect back to lobby if game doesn't start within 2 minutes
        const timeout = setTimeout(() => {
          console.log('⏰ Payment timeout - redirecting to lobby');
          alert('Game failed to start within 2 minutes. Please try again.');
          router.push('/lobby');
        }, 120000); // 2 minutes
        
        setPaymentTimeout(timeout);
      }
      
    } catch (error) {
      console.error('❌ Payment error:', error);
      alert(`Payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsPaymentInProgress(false);
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (paymentTimeout) {
        clearTimeout(paymentTimeout);
      }
    };
  }, [paymentTimeout]);

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    // Prevent multiple initializations
    if (isMatchmakingInProgress) {
      return;
    }

    // If we already have match data, don't start matchmaking again
    if (matchData && matchData.matchId) {
      return;
    }

    setIsMatchmakingInProgress(true);

    let pollInterval: NodeJS.Timeout;

    // Define startPolling function FIRST to avoid declaration order issues
    const startPolling = () => {
      
      
      // Clear any existing interval first
      if (pollInterval) {
        clearInterval(pollInterval);
      }
      
      pollInterval = setInterval(async () => {
        // Get the current matchData from ref to avoid closure issues
        const currentMatchData = matchDataRef.current;
        
        try {
          // Always check for new matches first when in waiting status
          if (statusRef.current === 'waiting' || !currentMatchData || !currentMatchData.matchId) {
            // Check if we've been matched while waiting
            try {
              const data = await api.checkPlayerMatch(publicKey.toString());
              
                              if (data.matched) {
                  // Stop current polling
                  clearInterval(pollInterval);
                  setIsMatchmakingInProgress(false);
                  
                  // Set the match data
                  setMatchData(data);
                  matchDataRef.current = data; // Update ref to avoid closure issues
                  setStatus('payment_required');
                  
                  // Start new polling for status updates
                  setIsPolling(true);
                  startPolling();
                  return; // Exit early to restart polling with new match data
                }
            } catch (error) {
              console.error('❌ Error checking for match:', error);
              console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
            }
          } else if (currentMatchData && currentMatchData.matchId) {
            // Check payment status for existing match
            try {
              const data = await api.getMatchStatus(currentMatchData.matchId);
              
              // Update match data with latest payment status
              setMatchData((prev: any) => {
                const updated = {
                  ...prev,
                  player1Paid: data.player1Paid,
                  player2Paid: data.player2Paid,
                  status: data.status
                };
                matchDataRef.current = updated; // Update ref to avoid closure issues
                return updated;
              });

              // Check if both players have paid and game is active
              if (data.player1Paid && data.player2Paid && data.status === 'active') {
                setStatus('active');
                
                // Store match data and redirect to game
                localStorage.setItem('matchId', currentMatchData.matchId);
                if (data.word) {
                  localStorage.setItem('word', data.word);
                }
                if (data.entryFee) {
                  localStorage.setItem('entryFee', data.entryFee.toString());
                }
                
                // Stop polling and redirect immediately
                clearInterval(pollInterval);
                setIsPolling(false);
                
                setTimeout(() => {
                  router.push(`/game?matchId=${currentMatchData.matchId}`);
                }, 1000);
              } else if (data.player1Paid && data.player2Paid && data.status !== 'active') {
                // Both players paid but game not yet active - show waiting state
                setStatus('waiting_for_game');
              }
            } catch (error) {
              console.error('❌ Error polling for match status:', error);
            }
          }
        } catch (error) {
          console.error('❌ Error polling for match:', error);
          console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
        }
        
      }, 2000);
    };

    // Define startMatchmaking function AFTER startPolling
    const startMatchmaking = async () => {
      if (!publicKey || isRequestInProgress) return;

      // Get entry fee from URL parameters or localStorage
      let currentEntryFee = entryFee;
      const urlEntryFee = router.query.entryFee as string;
      if (urlEntryFee) {
        currentEntryFee = parseFloat(urlEntryFee);
      } else {
        const storedEntryFee = localStorage.getItem('entryFeeSOL');
        if (storedEntryFee) {
          currentEntryFee = parseFloat(storedEntryFee);
        }
      }

      if (!currentEntryFee || currentEntryFee <= 0) {
        console.error('❌ No valid entry fee found');
        setStatus('error');
        return;
      }

      setIsRequestInProgress(true);
      
      try {
        const data = await api.requestMatch(publicKey.toString(), currentEntryFee);

        if (data.status === 'waiting') {
          setWaitingCount(data.waitingCount || 0);
          setStatus('waiting');
          // Ensure polling starts after initial request returns 'waiting'
          if (!isPolling) {
            setIsPolling(true);
            startPolling();
          }
        } else if (data.status === 'matched') {
          setMatchData(data);
          matchDataRef.current = data;
          setStatus('payment_required');
          clearInterval(pollInterval);
          setIsPolling(false);
          setIsMatchmakingInProgress(false);
        } else if (data.error) {
          setStatus('error');
        }
      } catch (error) {
        console.error('❌ Matchmaking error:', error);
        console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
        setStatus('error');
      } finally {
        setIsRequestInProgress(false);
      }
    };

    // Check if we have a matchId in the URL (from lobby redirect)
    const urlMatchId = router.query.matchId as string;
    if (urlMatchId) {
      // Initialize match data from URL
      const urlEntryFee = router.query.entryFee as string;
      const entryFeeAmount = urlEntryFee ? parseFloat(urlEntryFee) : 0;
      
      const initialMatchData = {
        matchId: urlMatchId,
        player1: router.query.player1 as string,
        player2: router.query.player2 as string,
        entryFee: entryFeeAmount,
        status: 'payment_required'
      };
      setMatchData(initialMatchData);
      matchDataRef.current = initialMatchData;
      setStatus('payment_required');
      setEntryFee(entryFeeAmount);
      localStorage.setItem('entryFeeSOL', entryFeeAmount.toString());
      
      // Start polling for status updates
      if (!isPolling) {
        setIsPolling(true);
        startPolling();
      }
      return;
    }

    // Get entry fee from URL parameters
    const urlEntryFee = router.query.entryFee as string;
    if (urlEntryFee) {
      const entryFeeAmount = parseFloat(urlEntryFee);
      setEntryFee(entryFeeAmount);
      localStorage.setItem('entryFeeSOL', entryFeeAmount.toString());
    } else {
      const storedEntryFee = localStorage.getItem('entryFeeSOL');
      if (storedEntryFee) {
        setEntryFee(parseFloat(storedEntryFee));
      }
    }

    if (!matchDataRef.current || !matchDataRef.current.matchId) {
      startMatchmaking();
      if (!isPolling) {
        setIsPolling(true);
        startPolling();
      }
    } else {
      // If we already have matchData, start polling for status updates
      if (!isPolling) {
        setIsPolling(true);
        startPolling();
      }
    }
    


    return () => {
      clearInterval(pollInterval);
      setIsMatchmakingInProgress(false);
    };
  }, [publicKey, router, signTransaction, entryFee]);



  // Update status ref when status changes
  useEffect(() => {
    statusRef.current = status;
  }, [status]);



  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={250} height={250} className="mb-8" />
        
        {/* Status Display */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-md w-full text-center shadow">
          {status === 'waiting' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Finding Opponent...</h2>
              <div className="text-white/80 mb-4">
                Waiting for another player to join
              </div>
              <div className="text-accent text-lg font-semibold mb-4">
                {waitingCount > 0 ? `${waitingCount} players waiting` : 'Searching...'}
              </div>
              <button
                onClick={() => router.push('/lobby')}
                className="bg-accent hover:bg-accent/80 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                Back to Lobby
              </button>
            </div>
          )}

          {status === 'payment_required' && matchData && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Payment Required</h2>
              <div className="text-white/80 mb-4">
                Entry Fee: {entryFee} SOL
              </div>
              <div className="text-white/60 text-sm mb-4">
                Match ID: {matchData.matchId}
              </div>
              <button
                onClick={handlePayment}
                disabled={isPaymentInProgress}
                className={`font-bold py-2 px-4 rounded transition-colors ${
                  isPaymentInProgress 
                    ? 'bg-gray-500 cursor-not-allowed text-gray-300' 
                    : 'bg-accent hover:bg-accent/80 text-white'
                }`}
              >
                {isPaymentInProgress ? 'Processing Payment...' : 'Pay Entry Fee'}
              </button>
            </div>
          )}

          {status === 'waiting_for_game' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Waiting for Game</h2>
              <div className="text-white/80 mb-4">
                {matchData?.player1Paid && matchData?.player2Paid 
                  ? 'Both players have paid! Game starting soon...'
                  : 'Waiting for other player to pay...'
                }
              </div>
            </div>
          )}

          {status === 'active' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Game Starting...</h2>
              <div className="text-white/80 mb-4">
                Redirecting to game...
              </div>
            </div>
          )}

          {status === 'error' && (
            <div>
              <h2 className="text-2xl font-bold text-red-400 mb-4">Error</h2>
              <div className="text-white/80 mb-4">
                Something went wrong. Please try again.
              </div>
              <button
                onClick={() => router.push('/lobby')}
                className="bg-accent hover:bg-accent/80 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                Back to Lobby
              </button>
            </div>
          )}

          {status === 'cancelled' && (
            <div>
              <h2 className="text-2xl font-bold text-yellow-400 mb-4">Match Cancelled</h2>
              <div className="text-white/80 mb-4">
                The match was cancelled.
              </div>
              <button
                onClick={() => router.push('/lobby')}
                className="bg-accent hover:bg-accent/80 text-white font-bold py-2 px-4 rounded transition-colors"
              >
                Back to Lobby
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Matchmaking; 