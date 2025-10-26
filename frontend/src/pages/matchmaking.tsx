import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { MatchStatusDisplay } from '../components/MatchStatusDisplay';
import api from '../utils/api';

const Matchmaking: React.FC = () => {
  const router = useRouter();
  const { publicKey } = useWallet();
  const [status, setStatus] = useState<'waiting' | 'payment_required' | 'waiting_for_payment' | 'waiting_for_game' | 'active' | 'error' | 'cancelled'>('waiting');
  const [waitingCount, setWaitingCount] = useState(0);
  const [matchData, setMatchData] = useState<any>(null);
  const [entryFee, setEntryFee] = useState<number>(0);
  const [isPolling, setIsPolling] = useState<boolean>(false);
  const [isMatchmakingInProgress, setIsMatchmakingInProgress] = useState(false);
  const [isRequestInProgress, setIsRequestInProgress] = useState<boolean>(false);
  
  // Use ref to track current matchData to avoid closure issues
  const matchDataRef = useRef<any>(null);
  const statusRef = useRef<string>('waiting');

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

    // Define startPolling function
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
            }
          } else if (currentMatchData && currentMatchData.matchId) {
            // Check match status for existing match
            try {
              const data = await api.getMatchStatus(currentMatchData.matchId, publicKey?.toString());
              
              // Update match data with latest status
              setMatchData((prev: any) => {
                const updated = {
                  ...prev,
                  ...data, // Merge all new data
                  player1Paid: data.player1Paid || prev.player1Paid,
                  player2Paid: data.player2Paid || prev.player2Paid,
                  status: data.status,
                  matchStatus: data.matchStatus || prev.matchStatus
                };
                matchDataRef.current = updated; // Update ref to avoid closure issues
                return updated;
              });

              // Check if match was cancelled
              if (data.status === 'cancelled') {
                setStatus('cancelled');
                clearInterval(pollInterval);
                setIsPolling(false);
                setIsMatchmakingInProgress(false);
                
                // Clear all stale match data
                setMatchData(null);
                matchDataRef.current = null;
                localStorage.removeItem('matchId');
                localStorage.removeItem('word');
                localStorage.removeItem('entryFee');
                
                // Clear URL parameters
                router.replace('/matchmaking', undefined, { shallow: true });
                
                return;
              }
              
              // Check if both deposits confirmed and match is ready
              if (data.matchStatus === 'READY' || (data.depositAConfirmations > 0 && data.depositBConfirmations > 0)) {
                setStatus('waiting_for_game');
                
                // Transition to active when backend confirms
                if (data.status === 'active') {
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
                }
              }
            } catch (error) {
              console.error('❌ Error polling for match status:', error);
            }
          }
        } catch (error) {
          console.error('❌ Error polling for match:', error);
        }
        
      }, 3000); // Poll every 3 seconds
    };

    // Define startMatchmaking function
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
        status: 'payment_required',
        matchStatus: 'VAULT_CREATED' // Assume vault created
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
  }, [publicKey, router, entryFee]);

  // Update status ref when status changes
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-2 relative">
      <TopRightWallet />
      <div className="flex flex-col items-center">
        <Image src={logo} alt="Guess5 Logo" width={250} height={250} className="mb-8" />
        
        {/* Show MatchStatusDisplay when we have a vault address */}
        {matchData && matchData.vaultAddress && (
          <div className="max-w-2xl w-full">
            <MatchStatusDisplay matchId={matchData.matchId} playerWallet={publicKey?.toString() || ''} />
          </div>
        )}

        {/* Status Display for other states */}
        {(!matchData || !matchData.vaultAddress) && (
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

            {status === 'waiting_for_game' && (
              <div>
                <h2 className="text-2xl font-bold text-accent mb-4">Waiting for Game</h2>
                <div className="text-white/80 mb-4">
                  {matchData?.depositAConfirmations > 0 && matchData?.depositBConfirmations > 0 
                    ? 'Both players have deposited! Game starting soon...'
                    : 'Waiting for deposits...'
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
                  The match was cancelled. If you deposited, you will receive a refund.
                </div>
                <button
                  onClick={() => {
                    // Clear all stale match data before going to lobby
                    setMatchData(null);
                    matchDataRef.current = null;
                    localStorage.removeItem('matchId');
                    localStorage.removeItem('word');
                    localStorage.removeItem('entryFee');
                    router.push('/lobby');
                  }}
                  className="bg-accent hover:bg-accent/80 text-white font-bold py-2 px-4 rounded transition-colors"
                >
                  Back to Lobby
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default Matchmaking; 