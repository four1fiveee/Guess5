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
    | 'abandoned'
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
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownStarted, setCountdownStarted] = useState<boolean>(false);
  const [paymentTimeRemaining, setPaymentTimeRemaining] = useState<number>(120); // 2 minutes in seconds
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

    if (status === 'abandoned') {
      return {
        heading: 'Opponent Disconnected',
        detail: 'The other player\'s browser crashed or they disconnected after you paid. Your funds are safe in escrow and a refund is being processed. You\'ll receive your full refund automatically (usually within 2-3 minutes).',
        tone: 'warning' as const,
        encourageResult: true,
      };
    }

    if (status === 'refund_pending') {
      let detail: string;
      let tone: 'info' | 'warning' | 'success' = 'warning';
      let encourageResult = true;

      switch (reason) {
        case 'payment_timeout':
          detail = userPaid
            ? 'The opponent never finished paying. Your escrow deposit is being refunded automatically—check the result screen shortly. Your refund will be processed within 2-3 minutes.'
            : 'The opponent never finished paying. We cancelled the match automatically before SOL moved.';
          if (!userPaid) {
            tone = 'info';
            encourageResult = false;
          }
          break;
        case 'player_cancelled_after_payment':
          detail =
            'The other player backed out after you deposited. Your escrow deposit will be automatically refunded and appear in the result view within ~2 minutes.';
          break;
        case 'player_cancelled_before_payment':
          detail =
            'The match ended before any deposits were collected. No funds left your wallet.';
          tone = 'info';
          encourageResult = false;
          break;
        default:
          detail = userPaid
            ? 'Your escrow deposit is being refunded automatically. Visit the result screen to see the status.'
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
          detail: 'Funds from your deposit are safe in escrow. Your refund will be processed automatically and appear soon in your result feed.',
          tone: 'warning' as const,
          encourageResult: true,
        };
      }

      return {
        heading: 'Match Cancelled',
        detail: userPaid
          ? 'Your escrow deposit is being returned automatically. Check the result page shortly to see the refund status.'
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

  // Countdown effect for match start - prevent restarting
  useEffect(() => {
    if (countdown !== null && countdown > 0 && !countdownStarted) {
      setCountdownStarted(true);
    }
    if (countdown !== null && countdown > 0) {
      const timer = setTimeout(() => {
        setCountdown(countdown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (countdown === 0 && status === 'active') {
      // Countdown finished - redirect to game
      const matchId = matchData?.matchId || matchDataRef.current?.matchId || router.query.matchId;
      if (matchId) {
        setTimeout(() => {
          router.push(`/game?matchId=${matchId}`);
        }, 500);
      }
    }
  }, [countdown, status, router, matchData, countdownStarted]);
  
  // Payment timeout effect - 2 minutes to pay or return to lobby
  useEffect(() => {
    if ((status === 'payment_required' || status === 'waiting_for_payment') && paymentTimeRemaining > 0) {
      const timer = setTimeout(() => {
        setPaymentTimeRemaining(prev => {
          if (prev <= 1) {
            // Timeout reached - redirect both players to lobby
            router.push('/lobby');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearTimeout(timer);
    } else if (status !== 'payment_required' && status !== 'waiting_for_payment') {
      // Reset timeout when payment is no longer required
      setPaymentTimeRemaining(120);
    }
  }, [status, paymentTimeRemaining, router]);

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
    // Use matchDataRef as fallback to avoid stale closure issues
    const currentMatchData = matchData || matchDataRef.current;
    
    console.log('🖱️ Deposit button clicked', {
      isPaymentInProgress,
      hasMatchData: !!matchData,
      hasMatchDataRef: !!matchDataRef.current,
      hasPublicKey: !!publicKey,
      matchId: currentMatchData?.matchId,
      status,
    });
    
    // Safety check: reset if isPaymentInProgress is stuck (shouldn't happen, but just in case)
    // This handles edge cases where the state might be stuck
    if (isPaymentInProgress) {
      console.log('⚠️ Payment already in progress - ignoring click');
      // Check if it's been stuck for more than 2 minutes (shouldn't happen)
      const lastPaymentAttempt = (window as any).__lastPaymentAttempt || 0;
      const now = Date.now();
      if (now - lastPaymentAttempt > 120000) {
        console.warn('⚠️ isPaymentInProgress has been stuck for >2 minutes - resetting');
        setIsPaymentInProgress(false);
        // Wait a moment before allowing retry
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        return;
      }
    }
    
    // Track payment attempt time
    (window as any).__lastPaymentAttempt = Date.now();

    if (!publicKey) {
      console.error('❌ No publicKey available');
      alert('Wallet not connected. Please connect your wallet and try again.');
      return;
    }

    if (!currentMatchData || !currentMatchData.matchId) {
      console.error('❌ No match data available', {
        hasMatchData: !!matchData,
        hasMatchDataRef: !!matchDataRef.current,
        matchId: currentMatchData?.matchId,
      });
      alert('Match data not available. Please refresh the page and try again.');
      return;
    }

    console.log('✅ Starting payment process...');
    setIsPaymentInProgress(true);
    
    // Safety timeout: reset payment state after 2 minutes if something goes wrong
    const safetyTimeout = setTimeout(() => {
      console.warn('⚠️ Payment safety timeout - resetting payment state');
      setIsPaymentInProgress(false);
    }, 120000); // 2 minutes
    
    try {
      // Use currentMatchData from closure-safe source
      const matchDataToUse = matchData || matchDataRef.current;
      
      if (!matchDataToUse || !matchDataToUse.matchId) {
        console.error('❌ Match data lost during payment', {
          hadMatchData: !!matchData,
          hadMatchDataRef: !!matchDataRef.current,
        });
        clearTimeout(safetyTimeout);
        setIsPaymentInProgress(false);
        alert('Match data lost. Please refresh the page and try again.');
        return;
      }
      
      // Update matchData state if it was null but matchDataRef has data
      if (!matchData && matchDataRef.current) {
        setMatchData(matchDataRef.current);
      }
      
      console.log('✅ Validation passed, proceeding with payment...', {
        matchId: matchDataToUse.matchId,
        playerWallet: publicKey.toString(),
        entryFee,
        hasVaultAddress: !!(matchDataToUse.squadsVaultAddress || matchDataToUse.vaultAddress),
        hasDepositAddress: !!(matchDataToUse.squadsVaultPda || matchDataToUse.vaultPda),
      });

      const hasSendTransaction = typeof sendTransaction === 'function';
      const hasSignTransaction = typeof signTransaction === 'function';

      if (!hasSendTransaction && !hasSignTransaction) {
        console.error('❌ Wallet adapter missing both sendTransaction and signTransaction capabilities');
        alert(
          'Your connected wallet cannot send transactions in this context. Please reconnect your wallet or try a different one.'
        );
        clearTimeout(safetyTimeout);
        setIsPaymentInProgress(false);
        return;
      }

      // Check if current player already paid
      const isPlayer1 = publicKey.toString() === matchDataToUse.player1;
      const currentPlayerPaid = isPlayer1 ? matchDataToUse.player1Paid : matchDataToUse.player2Paid;
      
      if (currentPlayerPaid) {
        console.log('⚠️ Current player already paid');
        clearTimeout(safetyTimeout);
        setIsPaymentInProgress(false);
        return;
      }

      console.log('💰 Starting payment to escrow deposit...');

      if (matchDataToUse.status && matchDataToUse.status !== 'payment_required' && matchDataToUse.status !== 'vault_pending') {
        clearTimeout(safetyTimeout);
        setIsPaymentInProgress(false);
        if (matchDataToUse.status === 'cancelled') {
          setStatus('opponent_left');
        } else if (matchDataToUse.status === 'refund_pending') {
          setStatus('refund_pending');
        }
        return;
      }

      // Always fetch latest status to ensure we have vault addresses
      let latestStatus: any;
      try {
        latestStatus = await getMatchStatus(matchDataToUse.matchId);
        console.log('✅ Fetched latest match status', {
          hasVaultAddress: !!(latestStatus?.squadsVaultAddress || latestStatus?.vaultAddress),
          hasDepositAddress: !!(latestStatus?.squadsVaultPda || latestStatus?.vaultPda),
          status: latestStatus?.status,
        });
        
        // Update matchData with latest status (especially vault addresses)
        if (latestStatus) {
          const updatedMatchData = {
            ...matchDataToUse,
            ...latestStatus,
            squadsVaultAddress: latestStatus.squadsVaultAddress || matchDataToUse.squadsVaultAddress || matchDataToUse.vaultAddress,
            vaultAddress: latestStatus.vaultAddress || latestStatus.squadsVaultAddress || matchDataToUse.vaultAddress || matchDataToUse.squadsVaultAddress,
            squadsVaultPda: latestStatus.squadsVaultPda || matchDataToUse.squadsVaultPda || matchDataToUse.vaultPda,
            vaultPda: latestStatus.vaultPda || latestStatus.squadsVaultPda || matchDataToUse.vaultPda || matchDataToUse.squadsVaultPda,
          };
          setMatchData(updatedMatchData);
          matchDataRef.current = updatedMatchData;
        }
      } catch (statusCheckError) {
        console.warn('⚠️ Unable to fetch latest match status before payment', statusCheckError);
        // Continue anyway - we'll try to fetch escrow addresses in resolveEscrowAddresses
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
        clearTimeout(safetyTimeout);
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
      
      const resolveEscrowAddresses = async (maxRetries = 3): Promise<{ escrowAddress: string | null; depositAddress: string | null }> => {
        // Use latest status if available, otherwise use matchDataToUse
        const sourceData = latestStatus || matchDataToUse || matchDataRef.current;
        let multisigAddress: string | null = sourceData?.squadsVaultAddress || sourceData?.vaultAddress || null;
        let depositAddress: string | null = sourceData?.squadsVaultPda || sourceData?.vaultPda || null;

        console.log('🔍 Resolving vault addresses', {
          matchId: matchDataToUse.matchId,
          hasMultisigAddress: !!multisigAddress,
          hasDepositAddress: !!depositAddress,
          attempt: 1,
        });

        // If we have both addresses, return immediately
        if (depositAddress && escrowAddress) {
          console.log('✅ Escrow addresses found in match data');
          return { escrowAddress, depositAddress };
        }

        // Try to fetch from backend (with retries)
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            console.log(`🔄 Fetching escrow addresses from backend (attempt ${attempt}/${maxRetries})...`);
            const latest = await getMatchStatus(matchDataToUse.matchId) as any;
            
            // Support both old and new field names
            escrowAddress = latest?.escrowAddress || latest?.squadsVaultAddress || latest?.vaultAddress || escrowAddress;
            depositAddress = latest?.escrowPda || latest?.squadsVaultPda || latest?.vaultPda || depositAddress;
            
            console.log('✅ Fetched vault addresses from backend', {
              hasEscrowAddress: !!escrowAddress,
              hasDepositAddress: !!depositAddress,
              attempt,
            });
            
            // Update matchData with fetched addresses
            if (escrowAddress || depositAddress) {
              const updatedMatchData = {
                ...(matchDataToUse || matchDataRef.current || {}),
                ...latest,
                // Support both old (squads) and new (escrow) field names for backward compatibility
                escrowAddress: escrowAddress ?? matchDataToUse?.escrowAddress ?? matchDataToUse?.squadsVaultAddress ?? matchDataToUse?.vaultAddress,
                squadsVaultAddress: escrowAddress ?? matchDataToUse?.squadsVaultAddress ?? matchDataToUse?.vaultAddress,
                vaultAddress: escrowAddress ?? matchDataToUse?.vaultAddress ?? matchDataToUse?.squadsVaultAddress,
                escrowPda: depositAddress ?? matchDataToUse?.escrowPda ?? matchDataToUse?.squadsVaultPda ?? matchDataToUse?.vaultPda,
                squadsVaultPda: depositAddress ?? matchDataToUse?.squadsVaultPda ?? matchDataToUse?.vaultPda,
                vaultPda: depositAddress ?? matchDataToUse?.vaultPda ?? matchDataToUse?.squadsVaultPda,
              };
              setMatchData(updatedMatchData);
              matchDataRef.current = updatedMatchData;
              
              // If we have both addresses now, return
              if (depositAddress && escrowAddress) {
                return { escrowAddress, depositAddress };
              }
            }
            
            // If we still don't have addresses, wait before retrying
            if (!depositAddress && attempt < maxRetries) {
              console.log(`⏳ Waiting before retry (attempt ${attempt}/${maxRetries})...`);
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            }
          } catch (refreshError: any) {
            console.warn(`⚠️ Failed to fetch vault addresses (attempt ${attempt}/${maxRetries}):`, refreshError);
            
            // If it's a 503 error (service unavailable), throw immediately with the detailed message
            if (refreshError?.status === 503 || refreshError?.message?.includes('insufficient balance')) {
              throw new Error(refreshError.message || 'Vault creation is temporarily unavailable. Please try again later or contact support.');
            }
            
            if (attempt < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempt)); // Exponential backoff
            }
          }
        }

        return { escrowAddress, depositAddress };
      };

      const { multisigAddress, depositAddress } = await resolveVaultAddresses();

      // Validate we have deposit address (required for payment)
      if (!depositAddress) {
        throw new Error('Vault deposit address not found. The vault may still be creating, or there may be a temporary issue. Please wait a moment and try again, or refresh the page.');
      }
      
      // Use the addresses we found
      const depositAddressToUse = depositAddress;
      const multisigAddressToUse = multisigAddress;
      
      console.log('✅ Using vault addresses for payment', {
        depositAddress: depositAddressToUse.slice(0, 8) + '...' + depositAddressToUse.slice(-8),
        hasEscrowAddress: !!escrowAddressToUse,
      });
      
      // Create transaction with addresses (works for both initial and retry cases)
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
          matchId: matchDataToUse.matchId,
          playerWallet: publicKey.toString(),
          amount: entryFee,
          depositTxSignature: signature,
        }),
      });

      if (!depositResponse.ok) {
        const errorText = await depositResponse.text();
        console.error('❌ Failed to notify backend of deposit', {
          status: depositResponse.status,
          statusText: depositResponse.statusText,
          error: errorText,
        });
        throw new Error(`Failed to notify backend of deposit: ${depositResponse.status} ${depositResponse.statusText}`);
      }

      const depositData = await depositResponse.json();
      console.log('✅ Deposit confirmed by backend:', depositData);

      // Fetch updated match status using the main match status endpoint
      const statusResponse = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/match/status/${matchDataToUse.matchId}`);
      if (!statusResponse.ok) {
        throw new Error(`Failed to fetch match status: ${statusResponse.status} ${statusResponse.statusText}`);
      }
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
        console.log('✅ Match is active, starting countdown...');
        setStatus('active');
        
        // Store match data
        localStorage.setItem('matchId', matchDataToUse.matchId);
        if (confirmData.word) {
          localStorage.setItem('word', confirmData.word);
        }
        if (confirmData.entryFee) {
          localStorage.setItem('entryFee', confirmData.entryFee.toString());
        }
        
        clearTimeout(safetyTimeout);
        setIsPaymentInProgress(false);
        
        // Start countdown (3, 2, 1) before redirecting - only if not already started
        if (!countdownStarted) {
          setCountdown(3);
        }
        return;
      }

      // Check if both players have paid based on backend response
      const bothPaid = (confirmData.player1Paid && confirmData.player2Paid) || 
                       (confirmData.status === 'payment_required' && 
                        (confirmData.depositAConfirmations >= 1 && confirmData.depositBConfirmations >= 1));
      
      // Check if current player has paid (reuse isPlayer1 from earlier in function)
      const currentPlayerPaidAfterPayment = isPlayer1 ? confirmData.player1Paid : confirmData.player2Paid;
      
      if (bothPaid) {
        console.log('✅ Both players paid, waiting for game to start...');
        setStatus('waiting_for_game');
      } else if (currentPlayerPaidAfterPayment) {
        console.log('⏳ Current player paid, waiting for opponent to pay...');
        // CRITICAL FIX: Keep player on payment screen instead of switching to waiting_for_payment
        // This provides better UX - they can see the payment status table
        setStatus('payment_required');
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
      
    } catch (error: any) {
      console.error('❌ Payment error:', error);
      
      // Show more detailed error message if available
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isServiceUnavailable = error?.status === 503 || errorMessage?.includes('insufficient balance') || errorMessage?.includes('temporarily unavailable');
      
      if (isServiceUnavailable) {
        alert(`⚠️ Service Temporarily Unavailable\n\n${errorMessage}\n\nPlease try again in a few moments or contact support if the issue persists.`);
      } else {
        alert(`Payment failed: ${errorMessage}`);
      }
    } finally {
      clearTimeout(safetyTimeout);
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
                
                // Ensure matchData is fully populated before setting status
                // This prevents the button from being disabled due to missing matchData
                const fullMatchData = {
                  ...data,
                  matchId: data.matchId,
                  player1: data.player1,
                  player2: data.player2,
                  player1Username: data.player1Username || null,
                  player2Username: data.player2Username || null,
                  entryFee: data.entryFee || entryFee,
                  status: 'payment_required',
                  player1Paid: data.player1Paid || false,
                  player2Paid: data.player2Paid || false,
                  squadsVaultAddress: data.squadsVaultAddress || data.vaultAddress || null,
                  vaultAddress: data.vaultAddress || data.squadsVaultAddress || null,
                  squadsVaultPda: data.squadsVaultPda || data.vaultPda || null,
                  vaultPda: data.vaultPda || data.squadsVaultPda || null,
                };
                
                // Set matchData FIRST
                setMatchData(fullMatchData);
                matchDataRef.current = fullMatchData; // Update ref to avoid closure issues
                
                // Reset payment state in case it was stuck
                setIsPaymentInProgress(false);
                
                // Then set status (React batches updates, but this ensures order)
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
                
                // Store match data
                localStorage.setItem('matchId', currentMatchData.matchId);
                if (data.word) {
                  localStorage.setItem('word', data.word);
                }
                if (data.entryFee) {
                  localStorage.setItem('entryFee', data.entryFee.toString());
                }
                
                // Stop polling
                clearInterval(pollInterval);
                setIsPolling(false);
                
                // Start countdown (3, 2, 1) before redirecting
                setCountdown(3);
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

              // ✅ NEW: Handle abandoned matches (opponent crashed/disconnected after payment)
              if (normalizedStatus === 'abandoned') {
                matchDataRef.current = {
                  ...(matchDataRef.current || {}),
                  status: 'abandoned',
                };
                setMatchData((prev: any) =>
                  prev
                    ? {
                        ...prev,
                        status: 'abandoned',
                      }
                    : prev
                );
                setStatus('abandoned');
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
              
              // Check if both players have paid (either via paid flags or deposit confirmations)
              const bothPaid = (data.player1Paid && data.player2Paid) || 
                               ((data.depositAConfirmations >= 1 && data.depositBConfirmations >= 1));
              
              // CRITICAL FIX: If both players have paid, redirect to game immediately
              // This prevents getting stuck in "waiting_for_payment" state
              if (bothPaid && normalizedStatus === 'active') {
                setStatus('active');
                localStorage.setItem('matchId', currentMatchData.matchId);
                if (data.word) {
                  localStorage.setItem('word', data.word);
                }
                if (data.entryFee) {
                  localStorage.setItem('entryFee', data.entryFee.toString());
                }
                clearInterval(pollInterval);
                setIsPolling(false);
                // Start countdown instead of immediate redirect
                setCountdown(3);
                return;
              }
              
              if (normalizedStatus === 'waiting_for_payment' && currentPlayerPaid) {
                // CRITICAL FIX: Keep player on payment screen instead of switching to waiting_for_payment
                // This provides better UX - they can see the payment status table
                if (bothPaid) {
                  // Both paid but status hasn't updated yet - wait a moment then redirect
                  console.log('✅ Both players paid, waiting for status to update...');
                  setStatus('waiting_for_game');
                  // Give backend 2 seconds to update status, then redirect
                  setTimeout(() => {
                    if (statusRef.current === 'waiting_for_game' || statusRef.current === 'payment_required') {
                      console.log('⏰ Status not updated, redirecting to game anyway...');
                      localStorage.setItem('matchId', currentMatchData.matchId);
                      if (data.word) {
                        localStorage.setItem('word', data.word);
                      }
                      if (data.entryFee) {
                        localStorage.setItem('entryFee', data.entryFee.toString());
                      }
                      // Start countdown instead of immediate redirect
                      setCountdown(3);
                    }
                  }, 2000);
                } else {
                  // Keep on payment screen to show status
                  setStatus('payment_required');
                }
              } else if (normalizedStatus === 'payment_required' && !currentPlayerPaid) {
                setStatus('payment_required');
              } else if (normalizedStatus === 'completed') {
                setStatus('completed');
                clearInterval(pollInterval);
                setIsPolling(false);
                setIsMatchmakingInProgress(false);
                return;
              }
              
              if (
                bothPaid &&
                data.status !== 'active' &&
                normalizedStatus !== 'refund_pending' &&
                normalizedStatus !== 'cancelled' &&
                normalizedStatus !== 'waiting_for_payment'
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
        // Check for referral code and send it with match request
        const referralCode = localStorage.getItem('referralCode');
        const data = await requestMatch(publicKey.toString(), currentEntryFee, referralCode || undefined);
        
        // Process referral if this is first match
        if (referralCode && data.matchId) {
          try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://guess5-backend.onrender.com';
            await fetch(`${apiUrl}/api/referral/link`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                referredWallet: publicKey.toString(),
                referrerWallet: referralCode
              })
            });
            // Clear referral code after processing
            localStorage.removeItem('referralCode');
          } catch (error) {
            console.warn('Failed to process referral:', error);
          }
        }

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
          // Ensure matchData is fully populated before setting status
          const fullMatchData = {
            ...data,
            matchId: data.matchId,
            player1: data.player1,
            player2: data.player2,
            player1Username: data.player1Username || null,
            player2Username: data.player2Username || null,
            entryFee: data.entryFee || currentEntryFee,
            status: 'payment_required',
            player1Paid: data.player1Paid || false,
            player2Paid: data.player2Paid || false,
            squadsVaultAddress: data.squadsVaultAddress || data.vaultAddress || null,
            vaultAddress: data.vaultAddress || data.squadsVaultAddress || null,
            squadsVaultPda: data.squadsVaultPda || data.vaultPda || null,
            vaultPda: data.vaultPda || data.squadsVaultPda || null,
          };
          
          // Set matchData FIRST
          setMatchData(fullMatchData);
          matchDataRef.current = fullMatchData;
          
          // Reset payment state in case it was stuck
          setIsPaymentInProgress(false);
          
          // Then set status
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
            player1Paid: false,
            player2Paid: false,
            squadsVaultAddress: null,
            vaultAddress: null,
            squadsVaultPda: null,
            vaultPda: null,
          } as any;
          
          // Set matchData FIRST
          setMatchData(pending);
          matchDataRef.current = pending;
          
          // Reset payment state in case it was stuck
          setIsPaymentInProgress(false);
          
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
        player1Username: null, // Will be fetched immediately
        player2Username: null, // Will be fetched immediately
        entryFee: entryFeeAmount,
        status: 'payment_required',
        player1Paid: false,
        player2Paid: false,
        squadsVaultAddress: null,
        vaultAddress: null,
        squadsVaultPda: null,
        vaultPda: null,
      };
      
      // Set matchData FIRST
      setMatchData(initialMatchData);
      matchDataRef.current = initialMatchData;
      
      // Reset payment state in case it was stuck
      setIsPaymentInProgress(false);
      
      // Then set status and entry fee
      setStatus('payment_required');
      setEntryFee(entryFeeAmount);
      localStorage.setItem('entryFeeSOL', entryFeeAmount.toString());
      
      // CRITICAL FIX: Immediately fetch full match data to get usernames and payment status
      // This prevents blank payment screen for 10-15 seconds
      (async () => {
        try {
          const fullMatchData = await getMatchStatus(urlMatchId);
          if (fullMatchData) {
            const updatedMatchData = {
              ...initialMatchData,
              ...fullMatchData,
              player1Username: fullMatchData.player1Username || null,
              player2Username: fullMatchData.player2Username || null,
              player1Paid: fullMatchData.player1Paid || false,
              player2Paid: fullMatchData.player2Paid || false,
              squadsVaultAddress: fullMatchData.squadsVaultAddress || fullMatchData.vaultAddress || null,
              vaultAddress: fullMatchData.vaultAddress || fullMatchData.squadsVaultAddress || null,
              squadsVaultPda: fullMatchData.squadsVaultPda || fullMatchData.vaultPda || null,
              vaultPda: fullMatchData.vaultPda || fullMatchData.squadsVaultPda || null,
              status: fullMatchData.status || 'payment_required',
            };
            setMatchData(updatedMatchData);
            matchDataRef.current = updatedMatchData;
            
            // Update status if it changed
            if (fullMatchData.status && fullMatchData.status !== 'payment_required') {
              setStatus(fullMatchData.status as any);
            }
          }
        } catch (error) {
          console.error('❌ Error fetching initial match data:', error);
          // Continue with initial data - polling will update it
        }
      })();
      
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
              {matchData?.player2Username && (
                <div className="bg-accent/20 border border-accent/30 rounded-lg p-4 mb-6 text-center">
                  <div className="text-accent text-lg font-bold">Match found against @{matchData.player2Username}!</div>
                </div>
              )}
              <div className="space-y-3 mb-6">
                <div className="bg-secondary bg-opacity-20 rounded-lg p-4 border border-accent/20">
                  <div className="text-white/60 text-xs uppercase tracking-wide mb-1">Entry Fee</div>
                  <div className="text-accent text-lg font-semibold">
                    {(() => {
                      if (!solPrice || !entryFee) return '—';
                      const calculateRoundedUSD = (solAmount: number, solPrice: number): number => {
                        const usdAmount = solAmount * solPrice;
                        const categories = [5, 20, 50, 100];
                        return categories.reduce((prev, curr) => 
                          Math.abs(curr - usdAmount) < Math.abs(prev - usdAmount) ? curr : prev
                        );
                      };
                      const roundedUSD = calculateRoundedUSD(entryFee, solPrice);
                      return `$${roundedUSD} USD`;
                    })()}
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

          {status === 'payment_required' && (matchData?.matchId || matchDataRef.current?.matchId) && (() => {
            const isPlayer1 = currentWallet === matchData?.player1;
            const userPaid = isPlayer1 ? !!matchData?.player1Paid : !!matchData?.player2Paid;
            const opponentPaid = isPlayer1 ? !!matchData?.player2Paid : !!matchData?.player1Paid;
            
            // Calculate rounded USD amount to match fee categories ($5, $20, $50, $100)
            const calculateRoundedUSD = (solAmount: number, solPrice: number | null): number | null => {
              if (!solPrice) return null;
              const usdAmount = solAmount * solPrice;
              // Round to nearest fee category
              const categories = [5, 20, 50, 100];
              const rounded = categories.reduce((prev, curr) => 
                Math.abs(curr - usdAmount) < Math.abs(prev - usdAmount) ? curr : prev
              );
              return rounded;
            };
            
            const roundedUSD = calculateRoundedUSD(entryFee, solPrice);
            const vaultAddress = matchData?.squadsVaultPda || matchData?.vaultPda || matchData?.squadsVaultAddress || matchData?.vaultAddress;
            
            // Helper to abbreviate wallet address
            const abbreviateAddress = (addr: string | null | undefined): string => {
              if (!addr) return '—';
              return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
            };
            
            return (
              <div className="animate-fade-in">
                <h2 className="text-2xl font-bold text-accent mb-2">Payment Required</h2>
                
                {/* Player status message */}
                {userPaid ? (
                  <p className="text-white/70 text-sm mb-6 text-center">Please wait while the other player pays</p>
                ) : (
                  <p className="text-white/70 text-sm mb-6 text-center">Please pay now to get into a game and compete</p>
                )}
                
                {/* Players table */}
                <div className="bg-secondary bg-opacity-20 rounded-lg p-4 mb-4 border border-accent/20">
                  <div className="space-y-3">
                    {/* Player 1 Row */}
                    <div className="flex items-center justify-between py-2 border-b border-white/10 last:border-b-0">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="text-white/60 text-sm font-medium min-w-[80px]">Player 1</div>
                        <div className="flex-1">
                          {matchData?.player1 ? (
                            <>
                              <div className="text-white font-medium text-sm">
                                {matchData?.player1Username ? `@${matchData.player1Username}` : abbreviateAddress(matchData?.player1)}
                              </div>
                              <div className="text-white/50 text-xs font-mono">
                                {abbreviateAddress(matchData?.player1)}
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-400"></div>
                              <div className="text-white/50 text-xs">Loading...</div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {matchData?.player1Paid ? (
                          <span className="text-green-400 text-sm font-medium flex items-center gap-1">
                            <span>✓</span> Paid
                          </span>
                        ) : (
                          <span className="text-yellow-400 text-sm font-medium">Pending</span>
                        )}
                      </div>
                    </div>
                    
                    {/* Player 2 Row */}
                    <div className="flex items-center justify-between py-2">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="text-white/60 text-sm font-medium min-w-[80px]">Player 2</div>
                        <div className="flex-1">
                          {matchData?.player2 ? (
                            <>
                              <div className="text-white font-medium text-sm">
                                {matchData?.player2Username ? `@${matchData.player2Username}` : abbreviateAddress(matchData?.player2)}
                              </div>
                              <div className="text-white/50 text-xs font-mono">
                                {abbreviateAddress(matchData?.player2)}
                              </div>
                            </>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-yellow-400"></div>
                              <div className="text-white/50 text-xs">Loading...</div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {matchData?.player2Paid ? (
                          <span className="text-green-400 text-sm font-medium flex items-center gap-1">
                            <span>✓</span> Paid
                          </span>
                        ) : (
                          <span className="text-yellow-400 text-sm font-medium">Pending</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Entry Fee Display - Centered and improved formatting */}
                <div className="bg-secondary bg-opacity-20 rounded-lg p-5 mb-4 border border-accent/20">
                  <div className="text-white/60 text-xs uppercase tracking-wide mb-3 text-center">Entry Fee</div>
                  <div className="flex flex-col items-center justify-center gap-1">
                    <div className="text-accent text-2xl font-bold text-center">
                      {roundedUSD ? `$${roundedUSD} USD` : (solPrice && entryFee ? `$${(entryFee * solPrice).toFixed(2)} USD` : '—')}
                    </div>
                    <div className="text-white/70 text-sm text-center">
                      ({entryFee} SOL)
                    </div>
                  </div>
                </div>
                
                {/* Vault Address */}
                {vaultAddress && (
                  <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-3 mb-4">
                    <div className="text-green-400 text-sm font-medium mb-1">✓ Vault Ready</div>
                    <div className="text-white/60 text-xs break-all font-mono">
                      {vaultAddress.slice(0, 8)}...{vaultAddress.slice(-8)}
                    </div>
                  </div>
                )}
                
                {!vaultAddress && (
                  <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-center mb-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-400 mr-2"></div>
                      <div className="text-yellow-400 text-sm font-medium">Preparing secure vault...</div>
                    </div>
                    <p className="text-white/70 text-xs text-center">This usually takes a few seconds</p>
                  </div>
                )}

                {/* Payment Timeout Warning */}
                {(status === 'payment_required' || status === 'waiting_for_payment') && paymentTimeRemaining > 0 && (
                  <div className="bg-yellow-500/10 border border-yellow-400/30 rounded-lg p-3 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="text-yellow-400 text-sm font-medium">
                        ⏰ Payment Required
                      </div>
                      <div className="text-yellow-300 text-sm font-bold">
                        {Math.floor(paymentTimeRemaining / 60)}:{(paymentTimeRemaining % 60).toString().padStart(2, '0')}
                      </div>
                    </div>
                    <p className="text-white/70 text-xs mt-1">
                      Complete payment within {Math.floor(paymentTimeRemaining / 60)}:{(paymentTimeRemaining % 60).toString().padStart(2, '0')} or you'll be returned to the lobby
                    </p>
                  </div>
                )}
                
                {/* Payment Button */}
                {!userPaid && (
                  <button
                    onClick={handlePayment}
                    disabled={isPaymentInProgress || !(matchData?.matchId || matchDataRef.current?.matchId) || !publicKey || !vaultAddress}
                    className={`w-full font-bold py-3.5 px-6 rounded-lg transition-all duration-200 min-h-[52px] flex items-center justify-center ${
                      isPaymentInProgress || !(matchData?.matchId || matchDataRef.current?.matchId) || !publicKey || !vaultAddress
                        ? 'bg-gray-600 cursor-not-allowed text-gray-400' 
                        : 'bg-accent hover:bg-yellow-400 hover:shadow-lg text-primary transform hover:scale-[1.02] active:scale-[0.98]'
                    }`}
                  >
                    {isPaymentInProgress ? (
                      <span className="flex items-center justify-center">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                        Processing Payment...
                      </span>
                    ) : (matchData?.matchId || matchDataRef.current?.matchId) && publicKey ? (
                      `Pay ${entryFee} SOL Entry Fee`
                    ) : (
                      'Waiting for Match...'
                    )}
                  </button>
                )}
                
                {/* Cancel Button */}
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
            );
          })()}


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

          {status === 'active' && countdown !== null && countdown > 0 && (
            <div className="animate-fade-in flex flex-col items-center justify-center min-h-screen w-full bg-primary border-none outline-none">
              {/* Clean countdown display - absolutely no containers, borders, or boxes */}
              {/* Subtle glow effect - positioned absolutely, no container */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-96 h-96 rounded-full bg-accent/5 animate-pulse"></div>
              </div>
              
              {/* Main countdown number - directly displayed, no wrapper divs, no border/outline */}
              <span className="relative z-10 text-[12rem] font-black text-accent drop-shadow-[0_0_30px_rgba(255,215,0,0.6)] leading-none mb-8 border-none outline-none">
                {countdown}
              </span>
              
              {/* Clean text matching gameplay page */}
              <div className="text-center space-y-3 relative z-10">
                <h2 className="text-3xl font-bold text-accent drop-shadow-lg">Match Starting</h2>
                <p className="text-white/70 text-lg">Get ready to play!</p>
              </div>
            </div>
          )}
          
          {status === 'active' && countdown === 0 && (
            <div className="animate-fade-in flex flex-col items-center justify-center min-h-screen w-full bg-primary">
              <div className="text-center space-y-6">
                <div className="relative">
                  <h2 className="text-[10rem] font-black text-accent drop-shadow-[0_0_50px_rgba(255,215,0,0.9)] animate-pulse leading-none">
                    GO!
                  </h2>
                  <div className="absolute inset-0 text-[10rem] font-black text-accent/15 blur-3xl animate-pulse leading-none">
                    GO!
                  </div>
                </div>
                <p className="text-white/80 text-2xl font-semibold">Starting game...</p>
              </div>
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
            status === 'opponent_left' ||
            status === 'abandoned') && (
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
                        (status === 'abandoned'
                          ? 'Opponent Disconnected'
                          : status === 'refund_pending'
                          ? 'Refund Pending'
                          : status === 'queue_cancelled'
                          ? 'Queue Cancelled'
                          : 'Match Cancelled')}
                    </h2>
                    <div className={`${styles.background} border ${styles.border} rounded-lg p-4 mb-6`}>
                      <p className="text-white/80 text-sm text-center">
                        {cancellationContext?.detail ||
                          (status === 'abandoned'
                            ? 'The other player\'s browser crashed or they disconnected after you paid. Your funds are safe and a refund proposal is being prepared. You\'ll receive your full refund once the proposal is created (usually within 2-3 minutes).'
                            : 'Match cancelled. Queue up again whenever you are ready.')}
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