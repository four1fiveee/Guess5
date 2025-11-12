import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, LAMPORTS_PER_SOL, PublicKey, Transaction, SystemProgram } from '@solana/web3.js';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { requestMatch, checkPlayerMatch, getMatchStatus, cancelMatch } from '../utils/api';
import { usePendingClaims } from '../hooks/usePendingClaims';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey, signTransaction, sendTransaction } = useWallet();
  const { hasBlockingClaims, pendingClaims } = usePendingClaims();
  const queryEntryFee =
    typeof router.query.entryFee === 'string' ? router.query.entryFee : undefined;
  const [status, setStatus] = useState<
    | 'waiting'
    | 'payment_required'
    | 'waiting_for_payment'
    | 'waiting_for_game'
    | 'active'
    | 'error'
    | 'cancelled'
    | 'refund_pending'
    | 'queue_cancelled'
    | 'opponent_left'
    | 'completed'
  >('waiting');
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchData, setMatchData] = useState<any>(null);
  const [entryFee, setEntryFee] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isMatchmakingInProgress, setIsMatchmakingInProgress] = useState(false);
  const [isRequestInProgress, setIsRequestInProgress] = useState<boolean>(false);
  const [isPaymentInProgress, setIsPaymentInProgress] = useState<boolean>(false);
  const [paymentTimeout, setPaymentTimeout] = useState<NodeJS.Timeout | null>(null);
  const [queueStartTime, setQueueStartTime] = useState<number | null>(null);
  const [elapsedTime, setElapsedTime] = useState<string>('0s');
  const [solPrice, setSolPrice] = useState<number | null>(null);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const currentWallet = publicKey?.toString() || null;

  const cancellationContext = useMemo(() => {
    if (!matchData) {
      return null;
    }

    const isPlayer1 =
      !!currentWallet && matchData.player1 && currentWallet === matchData.player1;
    const userPaid = isPlayer1 ? !!matchData.player1Paid : !!matchData.player2Paid;
    const opponentPaid = isPlayer1 ? !!matchData.player2Paid : !!matchData.player1Paid;
    const reason = matchData.refundReason;

    if (status === 'opponent_left') {
      return {
        heading: 'Opponent Left',
        detail: 'Your opponent exited before paying. Re-queueing you for another match.',
        tone: 'info' as const,
        encourageResult: false,
      };
    }

    if (status === 'refund_pending') {
      let detail: string;
      let tone: 'info' | 'warning' | 'success' = 'warning';
      let encourageResult = true;

      switch (reason) {
        case 'payment_timeout':
          detail = userPaid
            ? 'The opponent never finished paying. A refund proposal is being assembled—open the result screen shortly to co-sign your SOL back.'
            : 'The opponent never finished paying. We cancelled the match automatically before SOL moved.';
          if (!userPaid) {
            tone = 'info';
            encourageResult = false;
          }
          break;
        case 'player_cancelled_after_payment':
          detail =
            'The other player backed out after you deposited. The multisig refund will appear in the result view within ~2 minutes.';
          break;
        case 'player_cancelled_before_payment':
          detail =
            'The match ended before any deposits were collected. No funds left your wallet.';
          tone = 'info';
          encourageResult = false;
          break;
        default:
          detail = userPaid
            ? 'We are preparing your refund proposal now. Visit the result screen to co-sign once it appears.'
            : 'Match cancelled before any deposits were at risk.';
          tone = userPaid ? 'warning' : 'info';
          encourageResult = userPaid;
      }

      return {
        heading: 'Refund Pending',
        detail,
        tone,
        encourageResult,
      };
    }

    if (status === 'queue_cancelled') {
      return {
        heading: 'Queue Cancelled',
        detail: 'You left the matchmaking queue. Join again any time.',
        tone: 'info' as const,
        encourageResult: false,
      };
    }

    if (status === 'cancelled') {
      if (reason === 'player_cancelled_before_payment' || (!userPaid && !opponentPaid)) {
        return {
          heading: 'Match Cancelled',
          detail: 'The opponent bailed before anyone deposited. No funds moved.',
          tone: 'info' as const,
          encourageResult: false,
        };
      }

      if (reason === 'payment_timeout' || reason === 'player_cancelled_after_payment') {
        return {
          heading: 'Match Cancelled - Refund Inbound',
          detail: 'Funds from your deposit are safe. The refund proposal will appear soon in your result feed.',
          tone: 'warning' as const,
          encourageResult: true,
        };
      }

      return {
        heading: 'Match Cancelled',
        detail: userPaid
          ? 'Your deposit is being returned. Check the result page shortly to sign the refund proposal.'
          : 'Opponent left the queue. No deposits were taken.',
        tone: userPaid ? 'warning' : 'info',
        encourageResult: userPaid,
      };
    }

    return null;
  }, [status, matchData, currentWallet]);
  
  // Use ref to track current matchData to avoid closure issues
  const matchDataRef = useRef<any>(null);
  const statusRef = useRef<string>('waiting');

  // Redirect players with pending claims
  useEffect(() => {
    if (hasBlockingClaims && publicKey) {
      console.log('🚫 Player has pending claims, redirecting from matchmaking');
      
      if (pendingClaims?.hasPendingWinnings && pendingClaims.pendingWinnings.length > 0) {
        const firstWinning = pendingClaims.pendingWinnings[0];
        router.push(`/result?matchId=${firstWinning.matchId}`);
        return;
      }
      
      if (pendingClaims?.hasPendingRefunds && pendingClaims.refundCanBeExecuted && pendingClaims.pendingRefunds.length > 0) {
        const firstRefund = pendingClaims.pendingRefunds[0];
        router.push(`/result?matchId=${firstRefund.matchId}`);
        return;
      }
    }
  }, [hasBlockingClaims, pendingClaims, publicKey, router]);

  // Fetch SOL price for USD conversion
  useEffect(() => {
    const fetchSolPrice = async () => {
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';
        const response = await fetch(`${API_URL}/api/match/sol-price`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.price && typeof data.price === 'number' && data.price > 0) {
            setSolPrice(data.price);
          } else if (data.fallback) {
            setSolPrice(data.fallback);
          }
        }
      } catch (error) {
        console.error('❌ Error fetching SOL price:', error);
        // Use fallback price
        setSolPrice(180);
      }
    };

    fetchSolPrice();
    // Refresh price every 30 seconds
    const interval = setInterval(fetchSolPrice, 30000);
    return () => clearInterval(interval);
  }, []);

  // Timer to track elapsed time in queue
  useEffect(() => {
    if (status === 'waiting' && queueStartTime) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - queueStartTime) / 1000);
        const minutes = Math.floor(elapsed / 60);
        const seconds = elapsed % 60;
        setElapsedTime(minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`);
      }, 1000);

      return () => clearInterval(interval);
    } else if (status !== 'waiting') {
      // Reset timer when not waiting
      setQueueStartTime(null);
      setElapsedTime('0s');
    }
  }, [status, queueStartTime]);

  const handleCancelAndReturn = async () => {
    if (isCancelling) {
      return;
    }

    if (!publicKey) {
      router.push('/lobby');
      return;
    }

    setIsCancelling(true);
    try {
      const currentMatchId =
        matchDataRef.current?.matchId ||
        matchDataRef.current?.id ||
        matchData?.matchId ||
        undefined;

      const response = await cancelMatch(publicKey.toString(), currentMatchId);

      matchDataRef.current = null;
      setMatchData(null);
      setIsPolling(false);
      setIsMatchmakingInProgress(false);
      setWaitingCount(0);
      setQueueStartTime(null);

      if (response?.status === 'queue_cancelled') {
        setStatus('queue_cancelled');
      } else if (response?.status === 'cancelled') {
        setStatus(response?.refundPending ? 'refund_pending' : 'cancelled');
      }

      if (response?.refundPending && currentMatchId) {
        localStorage.setItem('matchId', currentMatchId);
        if (matchData?.entryFee) {
          localStorage.setItem('entryFee', matchData.entryFee.toString());
        }
        router.push(`/result?matchId=${currentMatchId}`);
        return;
      }

      router.push('/lobby');
    } catch (error) {
      console.error('❌ Error cancelling matchmaking:', error);
      router.push('/lobby');
    } finally {
      setIsCancelling(false);
    }
  };

  const navigateToResult = () => {
    const targetMatchId =
      matchDataRef.current?.matchId || matchData?.matchId || router.query.matchId;
    if (targetMatchId) {
      router.push(`/result?matchId=${targetMatchId}`);
    }
  };

  const handlePayment = async () => {
    if (isPaymentInProgress) {
      console.log('⚠️ Payment already in progress');
      return;
    }

    setIsPaymentInProgress(true);
    if (!publicKey || !matchData) {
      console.error('❌ Missing publicKey or matchData');
      setIsPaymentInProgress(false);
      return;
    }

    const hasSendTransaction = typeof sendTransaction === 'function';
    const hasSignTransaction = typeof signTransaction === 'function';

    if (!hasSendTransaction && !hasSignTransaction) {
      console.error('❌ Wallet adapter missing both sendTransaction and signTransaction capabilities');
      alert(
        'Your connected wallet cannot send transactions in this context. Please reconnect your wallet or try a different one.'
      );
      setIsPaymentInProgress(false);
      return;
    }

    // Check if current player already paid
    const isPlayer1 = publicKey.toString() === matchData.player1;
    const currentPlayerPaid = isPlayer1 ? matchData.player1Paid : matchData.player2Paid;
    
    if (currentPlayerPaid) {
      console.log('⚠️ Current player already paid');
      setIsPaymentInProgress(false);
      return;
    }

    try {
      console.log('💰 Starting payment to multisig vault deposit...');

      if (matchData.status && matchData.status !== 'payment_required') {
        setIsPaymentInProgress(false);
        if (matchData.status === 'cancelled') {
          setStatus('opponent_left');
        } else if (matchData.status === 'refund_pending') {
          setStatus('refund_pending');
        }
        return;
      }

      let latestStatus: any;
      try {
        latestStatus = await getMatchStatus(matchData.matchId);
      } catch (statusCheckError) {
        console.warn('⚠️ Unable to fetch latest match status before payment', statusCheckError);
      }

      const allowedPaymentStatuses = ['payment_required', 'waiting_for_payment'];
      if (
        latestStatus?.status &&
        !allowedPaymentStatuses.includes(latestStatus.status)
      ) {
        if (latestStatus.status === 'cancelled') {
          const depositMade = !!latestStatus.player1Paid || !!latestStatus.player2Paid;
          if (depositMade) {
            setStatus('refund_pending');
            setMatchData((prev: any) =>
              prev
                ? {
                    ...prev,
                    ...latestStatus,
                    status: 'refund_pending',
                  }
                : latestStatus
            );
            matchDataRef.current = {
              ...(matchDataRef.current || {}),
              ...latestStatus,
              status: 'refund_pending',
            };
          } else {
            setStatus('opponent_left');
            setMatchData((prev: any) =>
              prev
                ? {
                    ...prev,
                    ...latestStatus,
                    status: 'opponent_left',
                  }
                : latestStatus
            );
            matchDataRef.current = {
              ...(matchDataRef.current || {}),
              ...latestStatus,
              status: 'opponent_left',
            };
          }
        } else if (latestStatus.status === 'refund_pending' || latestStatus.status === 'refunded') {
          setStatus('refund_pending');
          setMatchData((prev: any) =>
            prev
              ? {
                  ...prev,
                  ...latestStatus,
                  status: 'refund_pending',
                }
              : latestStatus
          );
          matchDataRef.current = {
            ...(matchDataRef.current || {}),
            ...latestStatus,
            status: 'refund_pending',
          };
        } else {
          setStatus(latestStatus.status as any);
        }
        setIsPaymentInProgress(false);
        return;
      }

      if (latestStatus?.status && allowedPaymentStatuses.includes(latestStatus.status)) {
        setMatchData((prev: any) =>
          prev
            ? {
                ...prev,
                ...latestStatus,
              }
            : latestStatus
        );
        matchDataRef.current = {
          ...(matchDataRef.current || {}),
          ...latestStatus,
        };
      }

      // Create connection to Solana network
      const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com';
      const connection = new Connection(solanaNetwork, 'confirmed');
      
      // Check if the user has enough balance
      const balance = await connection.getBalance(publicKey);
      const requiredAmount = Math.floor(entryFee * LAMPORTS_PER_SOL);
      
      if (balance < requiredAmount) {
        throw new Error(`Insufficient balance. You have ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL, but need ${entryFee} SOL`);
      }
      
      const resolveVaultAddresses = async () => {
        let multisigAddress: string | null = matchData.squadsVaultAddress || matchData.vaultAddress || null;
        let depositAddress: string | null = matchData.squadsVaultPda || matchData.vaultPda || null;

        if (!depositAddress || !multisigAddress) {
          try {
            const latest = await getMatchStatus(matchData.matchId) as any;
            multisigAddress = latest?.squadsVaultAddress || latest?.vaultAddress || multisigAddress;
            depositAddress = latest?.squadsVaultPda || latest?.vaultPda || depositAddress;
            if (multisigAddress || depositAddress) {
              setMatchData((prev: any) => ({
                ...prev,
                squadsVaultAddress: multisigAddress ?? prev?.squadsVaultAddress ?? null,
                vaultAddress: multisigAddress ?? prev?.vaultAddress ?? null,
                squadsVaultPda: depositAddress ?? prev?.squadsVaultPda ?? null,
                vaultPda: depositAddress ?? prev?.vaultPda ?? null,
              }));
            }
          } catch (refreshError) {
            console.warn('⚠️ Failed to refresh match status while resolving vault addresses', refreshError);
          }
        }

        return { multisigAddress, depositAddress };
      };

      const { multisigAddress, depositAddress } = await resolveVaultAddresses();

      if (!depositAddress) {
        // Retry resolving vault addresses one more time with a short delay
        console.log('⚠️ Vault deposit address not found, retrying after short delay...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        const retryResult = await resolveVaultAddresses();
        if (!retryResult.depositAddress) {
          throw new Error('Vault deposit address not found. Please wait a moment and try again.');
        }
        // Update matchData with retried addresses
        setMatchData((prev: any) => ({
          ...prev,
          squadsVaultAddress: retryResult.multisigAddress ?? prev?.squadsVaultAddress ?? null,
          vaultAddress: retryResult.multisigAddress ?? prev?.vaultAddress ?? null,
          squadsVaultPda: retryResult.depositAddress ?? prev?.squadsVaultPda ?? null,
          vaultPda: retryResult.depositAddress ?? prev?.vaultPda ?? null,
        }));
        // Use retried addresses
        const finalDepositAddress = retryResult.depositAddress;
        const finalMultisigAddress = retryResult.multisigAddress;
        
        if (!finalDepositAddress) {
          throw new Error('Vault deposit address still not found after retry. Please refresh the page.');
        }
        
        // Continue with final addresses
        const depositAddressToUse = finalDepositAddress;
        const multisigAddressToUse = finalMultisigAddress;
        
        // Create transaction with final addresses
        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: new PublicKey(depositAddressToUse),
            lamports: requiredAmount,
          })
        );
        
        // Get recent blockhash
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        let signature: string;
        
        // Try using sendTransaction if available
        if (hasSendTransaction) {
          console.log('📤 Sending transaction via wallet adapter...');
          signature = await sendTransaction!(transaction, connection, {
            skipPreflight: false,
            maxRetries: 3,
          });
          console.log('✅ Transaction sent with signature:', signature);
          
          await connection.confirmTransaction({
            blockhash,
            lastValidBlockHeight,
            signature,
          }, 'confirmed');
          console.log('✅ Transaction confirmed successfully');
        } else {
          if (!hasSignTransaction) {
            throw new Error('Wallet does not support signing transactions');
          }
          console.log('🔐 Signing transaction...');
          const signedTransaction = await signTransaction!(transaction);
          console.log('📤 Sending transaction to Solana...');
          
          try {
            signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
              skipPreflight: false,
              maxRetries: 3,
            });
            console.log('✅ Transaction sent with signature:', signature);
          } catch (sendErr: any) {
            if (sendErr?.message?.includes('already been processed') || 
                sendErr?.message?.includes('This transaction has already been processed')) {
              console.log('⚠️ Transaction already processed - extracting signature from error');
              throw new Error('Transaction was already submitted. Please check your wallet for the transaction signature.');
            }
            throw sendErr;
          }
          
          console.log('⏳ Waiting for transaction confirmation...');
          await connection.confirmTransaction({
            blockhash,
            lastValidBlockHeight,
            signature,
          }, 'confirmed');
          console.log('✅ Transaction confirmed successfully');
        }

        // Notify backend of deposit
        const depositResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/multisig/deposits`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            matchId: matchData.matchId,
            playerWallet: publicKey.toString(),
            amount: entryFee,
            depositTxSignature: signature,
          }),
        });

        if (!depositResponse.ok) {
          throw new Error('Failed to notify backend of deposit');
        }

        const depositData = await depositResponse.json();
        console.log('✅ Deposit confirmed by backend:', depositData);

        // Fetch updated match status
        const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/status/${matchData.matchId}`);
        const confirmData = await statusResponse.json();

        // Update match data with payment status
        setMatchData((prev: any) => ({
          ...prev,
          ...confirmData,
          player1Paid: isPlayer1 ? true : (confirmData.player1Paid ?? prev.player1Paid),
          player2Paid: isPlayer1 ? (confirmData.player2Paid ?? prev.player2Paid) : true
        }));

        // If match is active, redirect to game immediately
        if (confirmData.status === 'active') {
          console.log('✅ Match is active, redirecting to game...');
          setStatus('active');
          
          localStorage.setItem('matchId', matchData.matchId);
          if (confirmData.word) {
            localStorage.setItem('word', confirmData.word);
          }
          if (confirmData.entryFee) {
            localStorage.setItem('entryFee', confirmData.entryFee.toString());
          }
          
          setTimeout(() => {
            router.push(`/game?matchId=${matchData.matchId}`);
          }, 500);
          return;
        }

        // Check if both players have paid
        const bothPaid = (confirmData.player1Paid && confirmData.player2Paid) || 
                         (confirmData.status === 'payment_required' && 
                          (confirmData.depositAConfirmations >= 1 && confirmData.depositBConfirmations >= 1));
        
        const currentPlayerPaid = isPlayer1 ? confirmData.player1Paid : confirmData.player2Paid;
        
        if (bothPaid) {
          console.log('✅ Both players paid, waiting for game to start...');
          setStatus('waiting_for_game');
        } else if (currentPlayerPaid) {
          console.log('⏳ Current player paid, waiting for opponent to pay...');
          setStatus('waiting_for_payment');
        } else {
          console.log('⏳ Current player has not paid yet...');
          setStatus('payment_required');
          
          const timeout = setTimeout(() => {
            console.log('⏰ Payment timeout - redirecting to lobby');
            alert('Game failed to start within 2 minutes. Please try again.');
            router.push('/lobby');
          }, 120000);
          
          setPaymentTimeout(timeout);
        }
        
        return; // Exit early since we handled the retry case
      }

      if (!multisigAddress) {
        // Try one quick status fetch to populate vault
        console.warn('⚠️ Multisig address missing while deposit address present', { matchId: matchData.matchId });
      }

      console.log('📍 Resolved vault addresses', {
        matchId: matchData.matchId,
        multisigAddress,
        depositAddress,
      });
      
      // Create transaction to send SOL to vault
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: new PublicKey(depositAddress),
          lamports: requiredAmount,
        })
      );

      // Get recent blockhash - use getLatestBlockhash for better reliability
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      let signature: string;
      
      // Try using sendTransaction if available (handles wallet submission properly)
      if (hasSendTransaction) {
        console.log('📤 Sending transaction via wallet adapter...');
        signature = await sendTransaction!(transaction, connection, {
          skipPreflight: false,
          maxRetries: 3,
        });
        console.log('✅ Transaction sent with signature:', signature);
        
        // Wait for confirmation using the lastValidBlockHeight
        console.log('⏳ Waiting for transaction confirmation...');
        await connection.confirmTransaction({
          blockhash,
          lastValidBlockHeight,
          signature,
        }, 'confirmed');
        console.log('✅ Transaction confirmed successfully');
      } else {
        // Fallback to manual signing/sending
        if (!hasSignTransaction) {
          throw new Error('Wallet does not support signing transactions');
        }
        console.log('🔐 Signing transaction...');
        const signedTransaction = await signTransaction!(transaction);
        console.log('📤 Sending transaction to Solana...');
        
        try {
          signature = await connection.sendRawTransaction(signedTransaction.serialize(), {
            skipPreflight: false,
            maxRetries: 3,
          });
          console.log('✅ Transaction sent with signature:', signature);
        } catch (sendErr: any) {
          // Handle duplicate transaction error - if it was already sent, treat as success
          if (sendErr?.message?.includes('already been processed') || 
              sendErr?.message?.includes('This transaction has already been processed')) {
            console.log('⚠️ Transaction already processed - extracting signature from error');
            // Try to extract signature from error or use the serialized transaction signature
            // If we can't extract it, we'll need to query for the transaction
            // For now, rethrow with better message
            throw new Error('Transaction was already submitted. Please check your wallet for the transaction signature.');
          }
          throw sendErr;
        }
        
        // Wait for confirmation
        console.log('⏳ Waiting for transaction confirmation...');
        await connection.confirmTransaction({
          blockhash,
          lastValidBlockHeight,
          signature,
        }, 'confirmed');
        console.log('✅ Transaction confirmed successfully');
      }

      // Notify backend of deposit with transaction signature
      const depositResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/multisig/deposits`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          matchId: matchData.matchId,
          playerWallet: publicKey.toString(),
          amount: entryFee,
          depositTxSignature: signature,
        }),
      });

      if (!depositResponse.ok) {
        throw new Error('Failed to notify backend of deposit');
      }

      const depositData = await depositResponse.json();
      console.log('✅ Deposit confirmed by backend:', depositData);

      // Fetch updated match status using the main match status endpoint
      const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/status/${matchData.matchId}`);
      const confirmData = await statusResponse.json();

      // Update match data with payment status
      setMatchData((prev: any) => ({
        ...prev,
        ...confirmData,
        player1Paid: isPlayer1 ? true : (confirmData.player1Paid ?? prev.player1Paid),
        player2Paid: isPlayer1 ? (confirmData.player2Paid ?? prev.player2Paid) : true
      }));

      // If match is active, redirect to game immediately
      if (confirmData.status === 'active') {
        console.log('✅ Match is active, redirecting to game...');
        setStatus('active');
        
        // Store match data and redirect to game
        localStorage.setItem('matchId', matchData.matchId);
        if (confirmData.word) {
          localStorage.setItem('word', confirmData.word);
        }
        if (confirmData.entryFee) {
          localStorage.setItem('entryFee', confirmData.entryFee.toString());
        }
        
        setTimeout(() => {
          router.push(`/game?matchId=${matchData.matchId}`);
        }, 500);
        return;
      }

      // Check if both players have paid based on backend response
      const bothPaid = (confirmData.player1Paid && confirmData.player2Paid) || 
                       (confirmData.status === 'payment_required' && 
                        (confirmData.depositAConfirmations >= 1 && confirmData.depositBConfirmations >= 1));
      
      // Check if current player has paid
      const isPlayer1 = publicKey?.toString() === matchData.player1;
      const currentPlayerPaid = isPlayer1 ? confirmData.player1Paid : confirmData.player2Paid;
      
      if (bothPaid) {
        console.log('✅ Both players paid, waiting for game to start...');
        setStatus('waiting_for_game');
      } else if (currentPlayerPaid) {
        console.log('⏳ Current player paid, waiting for opponent to pay...');
        setStatus('waiting_for_payment');
      } else {
        console.log('⏳ Current player has not paid yet...');
        setStatus('payment_required');
        
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
              const data = await checkPlayerMatch(publicKey.toString());
              
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
              
              // Enhanced error handling for network issues
              if (error instanceof Error) {
                if (error.name === 'AbortError' || error.message.includes('timeout')) {
                  console.log('⏰ Network timeout - will retry on next poll cycle');
                } else if (error.message.includes('Failed to fetch')) {
                  console.log('🌐 Network error - will retry on next poll cycle');
                }
              }
            }
          } else if (currentMatchData && currentMatchData.matchId) {
            // Check payment status for existing match
            try {
              const data = await getMatchStatus(currentMatchData.matchId);
              
              // Update match data with latest payment status
              setMatchData((prev: any) => {
                const va =
                  (data as any)?.squadsVaultAddress ||
                  (data as any)?.vaultAddress ||
                  prev?.vaultAddress ||
                  null;
                const vp =
                  (data as any)?.squadsVaultPda ||
                  (data as any)?.vaultPda ||
                  prev?.squadsVaultPda ||
                  prev?.vaultPda ||
                  null;
                const updated = {
                  ...prev,
                  player1Paid: data.player1Paid,
                  player2Paid: data.player2Paid,
                  status: data.status,
                  refundReason:
                    (data as any)?.refundReason ?? prev?.refundReason ?? null,
                  matchOutcome:
                    (data as any)?.matchOutcome ?? prev?.matchOutcome ?? null,
                  entryFee: data.entryFee ?? prev?.entryFee ?? null,
                  depositAConfirmations:
                    typeof (data as any)?.depositAConfirmations === 'number'
                      ? (data as any)?.depositAConfirmations
                      : prev?.depositAConfirmations ?? 0,
                  depositBConfirmations:
                    typeof (data as any)?.depositBConfirmations === 'number'
                      ? (data as any)?.depositBConfirmations
                      : prev?.depositBConfirmations ?? 0,
                  squadsVaultAddress:
                    (data as any)?.squadsVaultAddress ??
                    prev?.squadsVaultAddress ??
                    va,
                  vaultAddress: va,
                  squadsVaultPda:
                    (data as any)?.squadsVaultPda ?? prev?.squadsVaultPda ?? vp,
                vaultPda: vp,
                };
                matchDataRef.current = updated; // Update ref to avoid closure issues
                return updated;
              });

              const normalizedStatus = data.status as string;

              if (normalizedStatus === 'active') {
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
                }, 500);
                return;
              }

              if (normalizedStatus === 'cancelled') {
                const depositMade = !!data.player1Paid || !!data.player2Paid;
                matchDataRef.current = {
                  ...(matchDataRef.current || {}),
                  status: depositMade ? 'refund_pending' : 'opponent_left',
                };
                setMatchData((prev: any) =>
                  prev
                    ? {
                        ...prev,
                        status: depositMade ? 'refund_pending' : 'opponent_left',
                      }
                    : prev
                );
                clearInterval(pollInterval);
                setIsPolling(false);
                setIsMatchmakingInProgress(false);
                if (depositMade) {
                  setStatus('refund_pending');
                  if (currentMatchData.matchId) {
                    localStorage.setItem('matchId', currentMatchData.matchId);
                    if (data.entryFee) {
                      localStorage.setItem('entryFee', data.entryFee.toString());
                    }
                  }
                } else {
                  localStorage.removeItem('matchId');
                  localStorage.removeItem('word');
                  localStorage.removeItem('entryFee');
                  setStatus('opponent_left');
                }
                return;
              }

              if (normalizedStatus === 'refund_pending' || normalizedStatus === 'refunded') {
                matchDataRef.current = {
                  ...(matchDataRef.current || {}),
                  status: 'refund_pending',
                };
                setMatchData((prev: any) =>
                  prev
                    ? {
                        ...prev,
                        status: 'refund_pending',
                      }
                    : prev
                );
                setStatus('refund_pending');
                clearInterval(pollInterval);
                setIsPolling(false);
                setIsMatchmakingInProgress(false);
                if (currentMatchData.matchId) {
                  localStorage.setItem('matchId', currentMatchData.matchId);
                  if (data.entryFee) {
                    localStorage.setItem('entryFee', data.entryFee.toString());
                  }
                }
                return;
              }

              // Verify player has actually paid before showing waiting_for_payment
              const currentPlayerPaid = publicKey?.toString() === data.player1 
                ? data.player1Paid 
                : publicKey?.toString() === data.player2 
                ? data.player2Paid 
                : false;
              
              if (normalizedStatus === 'waiting_for_payment' && currentPlayerPaid) {
                setStatus('waiting_for_payment');
              } else if (normalizedStatus === 'payment_required' && !currentPlayerPaid) {
                setStatus('payment_required');
              } else if (normalizedStatus === 'completed') {
                setStatus('completed');
                clearInterval(pollInterval);
                setIsPolling(false);
                setIsMatchmakingInProgress(false);
                return;
              }
              
              // Check if both players have paid (either via paid flags or deposit confirmations)
              const bothPaid = (data.player1Paid && data.player2Paid) || 
                               ((data.depositAConfirmations >= 1 && data.depositBConfirmations >= 1));
              
              if (
                bothPaid &&
                data.status !== 'active' &&
                normalizedStatus !== 'refund_pending' &&
                normalizedStatus !== 'cancelled'
              ) {
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
        const data = await requestMatch(publicKey.toString(), currentEntryFee);

        if (data.status === 'waiting') {
          setWaitingCount(data.waitingCount || 0);
          setStatus('waiting');
          // Start timer when entering waiting state
          if (!queueStartTime) {
            setQueueStartTime(Date.now());
          }
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
        } else if (data.status === 'vault_pending') {
          // Record basic match info and begin polling for vault readiness
          const pending = {
            matchId: data.matchId,
            player1: data.player1,
            player2: data.player2,
            entryFee: currentEntryFee,
            status: 'payment_required', // target state once vault appears
            squadsVaultAddress: null,
            vaultAddress: null,
            player1Paid: false,
            player2Paid: false,
          } as any;
          setMatchData(pending);
          matchDataRef.current = pending;
          // Ensure polling is running to pick up vault + payments
          if (!isPolling) {
            setIsPolling(true);
            startPolling();
          }
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

  useEffect(() => {
    if (!matchData?.matchId) {
      return;
    }

    if (status === 'refund_pending') {
      localStorage.setItem('matchId', matchData.matchId);
      if (matchData.entryFee) {
        localStorage.setItem('entryFee', matchData.entryFee.toString());
      }
    } else if (status === 'cancelled' || status === 'queue_cancelled' || status === 'opponent_left') {
      localStorage.removeItem('matchId');
      localStorage.removeItem('word');
      localStorage.removeItem('entryFee');
    }
  }, [status, matchData?.matchId, matchData?.entryFee]);

  useEffect(() => {
    if (status === 'completed' && matchData?.matchId) {
      router.push(`/result?matchId=${matchData.matchId}`);
    }
  }, [status, matchData?.matchId, router]);

  useEffect(() => {
    if (status !== 'opponent_left') {
      return;
    }

    const parsedQueryFee = queryEntryFee ? parseFloat(queryEntryFee) : NaN;
    const requeueEntryFee =
      matchData?.entryFee || entryFee || (Number.isNaN(parsedQueryFee) ? undefined : parsedQueryFee);
    const baseTarget =
      requeueEntryFee && !Number.isNaN(requeueEntryFee)
        ? `/matchmaking?entryFee=${requeueEntryFee}`
        : '/matchmaking';
    const finalTarget = `${baseTarget}${baseTarget.includes('?') ? '&' : '?'}requeue=${Date.now()}`;

    const timer = setTimeout(() => {
      router.replace(finalTarget);
    }, 2200);

    return () => clearTimeout(timer);
  }, [status, matchData?.entryFee, entryFee, router, queryEntryFee]);



  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        <div className="logo-shell mb-6 sm:mb-8">
          <Image src={logo} alt="Guess5 Logo" width={200} height={200} priority />
        </div>
        
        {/* Status Display */}
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-md w-full text-center shadow">
          {status === 'waiting' && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-center mb-6">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mr-3"></div>
                <h2 className="text-2xl font-bold text-accent">Finding Opponent...</h2>
              </div>
              <div className="text-white/80 mb-6 text-center">
                Waiting for another player to join
              </div>
              <div className="space-y-3 mb-6">
                <div className="bg-secondary bg-opacity-20 rounded-lg p-4 border border-accent/20">
                  <div className="text-white/60 text-xs uppercase tracking-wide mb-1">Entry Fee</div>
                  <div className="text-accent text-lg font-semibold">
                    {solPrice && entryFee ? `$${(entryFee * solPrice).toFixed(2)} USD` : '—'}
                  </div>
                  <div className="text-white/70 text-sm mt-1">
                    {entryFee} SOL
                  </div>
                </div>
                <div className="bg-secondary bg-opacity-20 rounded-lg p-4 border border-accent/20">
                  <div className="text-white/60 text-xs uppercase tracking-wide mb-1">Time in Queue</div>
                  <div className="text-accent text-xl font-bold font-mono">
                    {elapsedTime}
                  </div>
                </div>
              </div>
              <button
                onClick={handleCancelAndReturn}
                disabled={isCancelling}
                className={`w-full py-2.5 px-4 rounded-lg transition-all duration-200 border ${
                  isCancelling
                    ? 'bg-white/5 border-white/10 text-white/40 cursor-not-allowed'
                    : 'bg-white/10 hover:bg-white/20 text-white border-white/20'
                }`}
              >
                {isCancelling ? 'Cancelling...' : '← Cancel & Return to Lobby'}
              </button>
            </div>
          )}

          {status === 'payment_required' && matchData && (
            <div className="animate-fade-in">
              <h2 className="text-2xl font-bold text-accent mb-2">Payment Required</h2>
              <p className="text-white/70 text-sm mb-6">Send your entry fee to the secure multisig vault</p>
              
              <div className="bg-secondary bg-opacity-20 rounded-lg p-4 mb-4 border border-accent/20">
                <div className="text-white/60 text-xs uppercase tracking-wide mb-2">Entry Fee</div>
                <div className="text-accent text-xl font-bold">
                  {solPrice && entryFee ? `$${(entryFee * solPrice).toFixed(2)} USD` : '—'}
                </div>
                <div className="text-white/70 text-sm mt-1">
                  {entryFee} SOL
                </div>
              </div>

              {!(matchData.squadsVaultPda || matchData.vaultPda || matchData.squadsVaultAddress || matchData.vaultAddress) && (
                <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-3 mb-4">
                  <div className="flex items-center justify-center mb-2">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400 mr-2"></div>
                    <div className="text-yellow-400 text-sm font-medium">Preparing secure vault...</div>
                  </div>
                  <p className="text-white/70 text-xs text-center">This usually takes a few seconds</p>
                </div>
              )}

              {(matchData.squadsVaultPda || matchData.vaultPda || matchData.squadsVaultAddress || matchData.vaultAddress) && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4">
                  <div className="text-green-400 text-sm font-medium mb-1">✓ Vault Ready</div>
                  <div className="text-white/60 text-xs break-all font-mono">
                    {(matchData.squadsVaultPda || matchData.vaultPda || matchData.squadsVaultAddress || matchData.vaultAddress)?.slice(0, 8)}...{(matchData.squadsVaultPda || matchData.vaultPda || matchData.squadsVaultAddress || matchData.vaultAddress)?.slice(-8)}
                  </div>
                </div>
              )}

              <button
                onClick={handlePayment}
                disabled={isPaymentInProgress || !matchData || !publicKey}
                className={`w-full font-bold py-3.5 px-6 rounded-lg transition-all duration-200 min-h-[52px] flex items-center justify-center ${
                  isPaymentInProgress || !matchData || !publicKey
                    ? 'bg-gray-600 cursor-not-allowed text-gray-400' 
                    : 'bg-accent hover:bg-yellow-400 hover:shadow-lg text-primary transform hover:scale-[1.02] active:scale-[0.98]'
                }`}
              >
                {isPaymentInProgress ? (
                  <span className="flex items-center justify-center">
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                    Processing Payment...
                  </span>
                ) : matchData && publicKey ? (
                  `Pay ${entryFee} SOL Entry Fee`
                ) : (
                  'Waiting for Vault...'
                )}
              </button>
              
              <div className="mt-4 text-center">
                <button
                  onClick={handleCancelAndReturn}
                  disabled={isCancelling}
                  className="text-white/60 hover:text-white text-sm underline transition-colors disabled:text-white/30 disabled:hover:text-white/30"
                >
                  {isCancelling ? 'Cancelling...' : 'Cancel'}
                </button>
              </div>
            </div>
          )}

          {status === 'waiting_for_payment' && matchData && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-center mb-4">
                <div className="animate-pulse w-3 h-3 bg-accent rounded-full mr-3"></div>
                <h2 className="text-2xl font-bold text-accent">Waiting for Opponent</h2>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
                <div className="text-green-400 text-sm font-medium mb-1">✓ Your payment confirmed</div>
                <p className="text-white/70 text-sm">Waiting for your opponent to pay their entry fee</p>
              </div>
            </div>
          )}

          {status === 'waiting_for_game' && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-center mb-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent mr-3"></div>
                <h2 className="text-2xl font-bold text-accent">Preparing Game</h2>
              </div>
              <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4 mb-4">
                {matchData?.player1Paid && matchData?.player2Paid ? (
                  <>
                    <div className="text-green-400 text-sm font-medium mb-1">✓ Both players paid</div>
                    <p className="text-white/70 text-sm">Game starting soon...</p>
                  </>
                ) : (
                  <p className="text-white/70 text-sm">Waiting for other player to pay...</p>
                )}
              </div>
            </div>
          )}

          {status === 'active' && (
            <div className="animate-fade-in">
              <div className="flex items-center justify-center mb-4">
                <div className="animate-pulse w-3 h-3 bg-green-400 rounded-full mr-3"></div>
                <h2 className="text-2xl font-bold text-green-400">Game Starting</h2>
              </div>
              <p className="text-white/70 text-center">Redirecting to game...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="animate-fade-in">
              <div className="text-red-400 text-4xl mb-4 text-center">⚠️</div>
              <h2 className="text-2xl font-bold text-red-400 mb-2 text-center">Something Went Wrong</h2>
              <p className="text-white/70 text-sm mb-6 text-center">
                An error occurred during matchmaking. Please try again.
              </p>
              <button
                onClick={() => router.push('/lobby')}
                className="w-full bg-accent hover:bg-yellow-400 text-primary font-bold py-3 px-6 rounded-lg transition-all duration-200 hover:shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Return to Lobby
              </button>
            </div>
          )}

          {(status === 'cancelled' ||
            status === 'refund_pending' ||
            status === 'queue_cancelled' ||
            status === 'opponent_left') && (
            <div className="animate-fade-in">
              {(() => {
                const tone = (cancellationContext?.tone ?? 'info') as keyof typeof toneStyles;
                const toneStyles: Record<
                  'info' | 'warning' | 'success',
                  { icon: string; heading: string; border: string; background: string }
                > = {
                  info: {
                    icon: 'ℹ️',
                    heading: 'text-white',
                    border: 'border-white/15',
                    background: 'bg-white/5'
                  },
                  warning: {
                    icon: '⏰',
                    heading: 'text-yellow-400',
                    border: 'border-yellow-500/40',
                    background: 'bg-yellow-500/10'
                  },
                  success: {
                    icon: '✅',
                    heading: 'text-green-400',
                    border: 'border-green-500/30',
                    background: 'bg-green-500/10'
                  }
                };
                const styles = toneStyles[tone];

                return (
                  <>
                    <div className={`${styles.heading} text-4xl mb-4 text-center`}>{styles.icon}</div>
                    <h2 className={`text-2xl font-bold mb-2 text-center ${styles.heading}`}>
                      {cancellationContext?.heading ||
                        (status === 'refund_pending'
                          ? 'Refund Pending'
                          : status === 'queue_cancelled'
                          ? 'Queue Cancelled'
                          : 'Match Cancelled')}
                    </h2>
                    <div className={`${styles.background} border ${styles.border} rounded-lg p-4 mb-6`}>
                      <p className="text-white/80 text-sm text-center">
                        {cancellationContext?.detail ||
                          'Match cancelled. Queue up again whenever you are ready.'}
                </p>
              </div>
                  </>
                );
              })()}
              <div className="flex flex-col gap-3">
                {cancellationContext?.encourageResult && matchData?.matchId && (
              <button
                    onClick={navigateToResult}
                    className="w-full bg-white/10 hover:bg-white/20 text-white font-semibold py-3 px-6 rounded-lg transition-all duration-200 border border-white/20"
                  >
                    View Refund Status
                  </button>
                )}
                <button
                  onClick={() => router.push('/lobby')}
                className="w-full bg-accent hover:bg-yellow-400 text-primary font-bold py-3 px-6 rounded-lg transition-all duration-200 hover:shadow-lg transform hover:scale-[1.02] active:scale-[0.98]"
              >
                Return to Lobby
              </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Matchmaking; 