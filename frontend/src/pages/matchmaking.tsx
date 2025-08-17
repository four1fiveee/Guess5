import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'payment_required' | 'waiting_for_game' | 'active' | 'error' | 'cancelled'>('waiting');
  const [timeLeft, setTimeLeft] = useState(120);
  const [timeoutMessage, setTimeoutMessage] = useState<string>('');
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchData, setMatchData] = useState<any>(null);
  const [entryFee, setEntryFee] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isMatchmakingInProgress, setIsMatchmakingInProgress] = useState(false);
  const [isRequestInProgress, setIsRequestInProgress] = useState<boolean>(false);
  
  const hasInitialized = useRef(false);
  const isStartMatchmakingRunning = useRef(false);

  const handlePayment = async () => {
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
      
      console.log('✅ Transaction sent with signature:', signature);

      // Wait for confirmation
      const confirmation = await connection.confirmTransaction(signature, 'confirmed');
      if (confirmation.value.err) {
        throw new Error('Transaction failed to confirm');
      }

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
        const errorData = await confirmResponse.json();
        throw new Error(`Backend confirmation failed: ${errorData.error || 'Unknown error'}`);
      }

      const confirmData = await confirmResponse.json();
      console.log('✅ Payment confirmed by backend:', confirmData);

      // Update match data with payment status
      setMatchData((prev: any) => ({
        ...prev,
        player1Paid: isPlayer1 ? true : prev.player1Paid,
        player2Paid: isPlayer1 ? prev.player2Paid : true
      }));

      // Check if both players have paid
      const updatedPlayer1Paid = isPlayer1 ? true : matchData.player1Paid;
      const updatedPlayer2Paid = isPlayer1 ? matchData.player2Paid : true;

      if (updatedPlayer1Paid && updatedPlayer2Paid) {
        console.log('🎮 Both players have paid! Waiting for game to start...');
        setStatus('waiting_for_game');
      } else {
        console.log('⏳ Waiting for other player to pay...');
        setStatus('waiting_for_game');
      }
      
    } catch (error) {
      console.error('❌ Payment error:', error);
      alert(`Payment failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  useEffect(() => {
    if (!publicKey) {
      router.push('/');
      return;
    }

    if (hasInitialized.current) {
      return;
    }

    hasInitialized.current = true;

    if (isMatchmakingInProgress) {
      return;
    }

    if (matchData && matchData.matchId) {
      return;
    }

    setIsMatchmakingInProgress(true);

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

    let pollInterval: NodeJS.Timeout;
    let timeoutId: NodeJS.Timeout;
    let countdownInterval: NodeJS.Timeout;

    const startMatchmaking = async () => {
      if (!publicKey || isRequestInProgress) return;

      setIsRequestInProgress(true);
      
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/request-match`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            wallet: publicKey.toString(),
            entryFee: entryFee
          }),
        });

        const data = await response.json();
        console.log('🎮 Matchmaking response:', data);

        if (data.status === 'waiting') {
          setWaitingCount(data.waitingCount || 0);
          setStatus('waiting');
        } else if (data.status === 'matched') {
          console.log('✅ Match found!');
          setMatchData(data);
          setStatus('payment_required');
          clearInterval(pollInterval);
          clearTimeout(timeoutId);
          clearInterval(countdownInterval);
          setIsPolling(false);
          setIsMatchmakingInProgress(false);
        } else if (data.error) {
          console.log('⚠️ Matchmaking error:', data.error);
          setStatus('error');
        }
      } catch (error) {
        console.error('❌ Matchmaking error:', error);
        setStatus('error');
      } finally {
        setIsRequestInProgress(false);
      }
    };

    const startPolling = () => {
      pollInterval = setInterval(async () => {
        try {
          if (matchData && matchData.matchId) {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/check-match/${matchData.matchId}?wallet=${publicKey.toString()}`);
            
            if (response.ok) {
              const data = await response.json();
              
                             // Update match data with latest payment status
               setMatchData((prev: any) => ({
                 ...prev,
                 player1Paid: data.player1Paid,
                 player2Paid: data.player2Paid
               }));

              // Check if both players have paid and game is active
              if (data.player1Paid && data.player2Paid && data.status === 'active') {
                console.log('🎮 Game is active! Redirecting to game...');
                setStatus('active');
                
                // Store match data and redirect to game
                localStorage.setItem('matchId', matchData.matchId);
                if (data.word) {
                  localStorage.setItem('word', data.word);
                }
                if (data.entryFee) {
                  localStorage.setItem('entryFee', data.entryFee.toString());
                }
                
                setTimeout(() => {
                  router.push(`/game?matchId=${matchData.matchId}`);
                }, 1000);
              }
            }
          }
        } catch (error) {
          console.error('❌ Error polling for match:', error);
        }
      }, 2000);
    };

    if (!matchData || !matchData.matchId) {
      startMatchmaking();
      if (!isPolling) {
        setIsPolling(true);
        startPolling();
      }
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
    
    // 2-minute timeout
    timeoutId = setTimeout(() => {
      setTimeoutMessage('No opponents found after 2 minutes. Returning to lobby...');
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
      setTimeout(() => router.push('/lobby'), 3000);
    }, 120000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(pollInterval);
      clearInterval(countdownInterval);
      setIsMatchmakingInProgress(false);
    };
  }, [publicKey, router, signTransaction]);

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
              <div className="text-accent text-lg font-semibold">
                {waitingCount > 0 ? `${waitingCount} players waiting` : 'Searching...'}
              </div>
            </div>
          )}
          
          {status === 'payment_required' && (
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
          
          {status === 'waiting_for_game' && (
            <div>
              <h2 className="text-2xl font-bold text-accent mb-4">Waiting for Game to Start</h2>
              <div className="text-white/80 mb-4">
                {matchData && matchData.player1Paid && matchData.player2Paid 
                  ? 'Both players have paid! The game is being initialized...'
                  : 'Waiting for both players to complete payment...'
                }
              </div>
              {matchData && (
                <div className="text-sm text-white/60 mb-4">
                  Payment Status: {matchData.player1Paid ? '✅ Player 1 Paid' : '⏳ Player 1 Pending'} | {matchData.player2Paid ? '✅ Player 2 Paid' : '⏳ Player 2 Pending'}
                </div>
              )}
              <div className="text-accent text-lg font-semibold">
                {matchData && matchData.player1Paid && matchData.player2Paid 
                  ? 'Redirecting to game...'
                  : 'Please wait...'
                }
              </div>
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
        </div>
        
        {/* Timer */}
        {timeLeft > 0 && status === 'waiting' && (
          <div className="mt-4 text-accent text-lg font-semibold">
            ⏰ Time remaining: {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
          </div>
        )}
      </div>
    </div>
  );
};

export default Matchmaking; 