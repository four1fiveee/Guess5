import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useWallet } from '@solana/wallet-adapter-react';
import { Connection, PublicKey } from '@solana/web3.js';
import axios from 'axios';
import { signSquadsProposal } from '../lib/squads';

interface ProposalData {
  matchId: string;
  vaultAddress: string;
  proposalId: string;
  executed: boolean;
  signers: string[];
  needsSignatures: number;
  winner: string;
  player1: string;
  player2: string;
}

interface PayoutData {
  won: boolean;
  isTie: boolean;
  isWinningTie: boolean;
  refundAmount: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com';

export default function ResultPage() {
  const router = useRouter();
  const { matchId } = router.query;
  const wallet = useWallet();
  const { publicKey } = wallet;
  const [payoutData, setPayoutData] = useState<PayoutData | null>(null);
  const [proposal, setProposal] = useState<ProposalData | null>(null);
  const [isLoadingProposal, setIsLoadingProposal] = useState(false);
  const [isSigning, setIsSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pollInterval, setPollInterval] = useState<NodeJS.Timeout | null>(null);
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // Poll for proposal status
  useEffect(() => {
    if (!matchId || typeof matchId !== 'string') return;

    const pollProposal = async () => {
      try {
        setIsLoadingProposal(true);
        const response = await axios.get(`${API_URL}/api/multisig/proposals/${matchId}`);
        
        if (response.data.success && response.data.proposal) {
          setProposal(response.data.proposal);
          setIsLoadingProposal(false);
          
          // If proposal is executed, stop polling
          if (response.data.proposal.executed) {
            if (pollInterval) {
              clearInterval(pollInterval);
              setPollInterval(null);
            }
          }
        } else {
          // No proposal yet, continue polling
          setIsLoadingProposal(false);
        }
      } catch (err: any) {
        // 404 means no proposal yet, which is fine - continue polling
        if (err.response?.status !== 404) {
          console.error('Error fetching proposal:', err);
          setError(err.response?.data?.error || 'Failed to fetch proposal status');
        }
        setIsLoadingProposal(false);
      }
    };

    // Poll immediately
    pollProposal();

    // Poll every 5 seconds
    const interval = setInterval(pollProposal, 5000);
    setPollInterval(interval);

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [matchId]);

  // Check if current wallet needs to sign
  const needsMySignature = proposal && publicKey && !proposal.executed && 
    (proposal.player1 === publicKey.toString() || proposal.player2 === publicKey.toString()) &&
    !proposal.signers.includes(publicKey.toString());

  // Handle signing the proposal
  const handleSignProposal = async () => {
    if (!proposal || !publicKey || !wallet.signTransaction) {
      setError('Wallet not connected or proposal not available');
      return;
    }

    try {
      setIsSigning(true);
      setError(null);

      const connection = new Connection(
        process.env.NEXT_PUBLIC_SOLANA_RPC || 'https://api.mainnet-beta.solana.com',
        'confirmed'
      );

      // Sign the proposal using the helper function
      const signature = await signSquadsProposal(
        wallet,
        connection,
        matchId as string,
        proposal.vaultAddress,
        proposal.proposalId
      );

      console.log('✅ Proposal signed:', signature);

      // Refresh proposal status
      const response = await axios.get(`${API_URL}/api/multisig/proposals/${matchId}`);
      if (response.data.success) {
        setProposal(response.data.proposal);
      }

      setIsSigning(false);
    } catch (err: any) {
      console.error('Error signing proposal:', err);
      setError(err.message || 'Failed to sign proposal');
      setIsSigning(false);
    }
  };

  // Get payout data (this would come from your existing match status endpoint)
  useEffect(() => {
    if (!matchId || typeof matchId !== 'string') return;

    const fetchPayoutData = async () => {
      try {
        // This should match your existing endpoint
        const response = await axios.get(`${API_URL}/api/match/status/${matchId}`);
        const matchData = response.data;
        
        // Transform to payout data format
        const payout: PayoutData = {
          won: matchData.winner === publicKey?.toString(),
          isTie: matchData.winner === 'tie',
          isWinningTie: false,
          refundAmount: 0,
        };
        
        setPayoutData(payout);
        console.log('🎯 Payout data in render:', payout);
      } catch (err) {
        console.error('Error fetching payout data:', err);
      }
    };

    fetchPayoutData();
  }, [matchId, publicKey]);

  if (!matchId) {
    return <div>Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-900 text-white p-4">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold mb-6">Game Results</h1>

        {/* Game outcome */}
        {payoutData && (
          <div className="mb-6">
            {payoutData.won && !payoutData.isTie && (
              <div className="text-yellow-400 text-xl">🏆 You Won!</div>
            )}
            {!payoutData.won && !payoutData.isTie && (
              <div className="text-red-400 text-xl">😔 You Lost</div>
            )}
            {payoutData.isTie && (
              <div className="text-orange-400 text-xl">🤝 It's a Tie!</div>
            )}
          </div>
        )}

        {/* Payout Details */}
        <div className="mb-6">
          <h2 className="text-orange-400 text-xl font-semibold mb-3">Payout Details</h2>
          
          <div className="bg-gray-800 border border-orange-500 rounded-lg p-4">
            {!proposal && isLoadingProposal && (
              <div className="flex items-center gap-2 text-orange-400">
                <span>⌛</span>
                <span>Processing Payout</span>
              </div>
            )}

            {!proposal && !isLoadingProposal && (
              <div>
                <div className="flex items-center gap-2 text-orange-400 mb-2">
                  <span>⌛</span>
                  <span>Processing Payout</span>
                </div>
                <p className="text-sm text-gray-300">
                  The payout proposal is being created. Please check back in a moment.
                </p>
              </div>
            )}

            {proposal && !proposal.executed && (
              <div>
                <div className="mb-4">
                  <p className="text-orange-400 font-semibold mb-2">
                    Proposal Ready: {proposal.needsSignatures} signature(s) needed
                  </p>
                  <p className="text-sm text-gray-300 mb-2">
                    Current signers: {proposal.signers.length > 0 ? proposal.signers.join(', ') : 'None'}
                  </p>
                </div>

                {needsMySignature && (
                  <button
                    onClick={handleSignProposal}
                    disabled={isSigning}
                    className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
                  >
                    {isSigning ? 'Signing...' : 'Sign Proposed Transaction'}
                  </button>
                )}

                {!needsMySignature && proposal.signers.length > 0 && (
                  <p className="text-sm text-gray-300">
                    Waiting for other signers... ({proposal.signers.length}/{proposal.needsSignatures + proposal.signers.length})
                  </p>
                )}
              </div>
            )}

            {proposal && proposal.executed && (
              <div className="text-green-400">
                <p className="font-semibold">✅ Payout Executed</p>
                <p className="text-sm text-gray-300 mt-2">
                  The payout has been successfully executed and funds have been distributed.
                </p>
              </div>
            )}

            {error && (
              <div className="mt-4 text-red-400 text-sm">
                Error: {error}
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => router.push('/')}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white font-semibold py-3 px-6 rounded-lg transition-colors"
        >
          Play Again
        </button>

        {/* Debug Panel */}
        <div className="mt-6">
          <button
            onClick={() => setShowDebugPanel(!showDebugPanel)}
            className="text-sm text-gray-400 hover:text-gray-300 underline"
          >
            {showDebugPanel ? 'Hide' : 'Show'} Debug Info
          </button>
          
          {showDebugPanel && (
            <div className="mt-4 bg-gray-800 border border-gray-700 rounded-lg p-4 text-sm">
              <h3 className="text-orange-400 font-semibold mb-3">Debug Information</h3>
              
              <div className="space-y-2">
                <div>
                  <span className="text-gray-400">Match ID:</span>
                  <span className="ml-2 text-white font-mono text-xs">{matchId}</span>
                </div>
                
                {proposal && (
                  <>
                    <div>
                      <span className="text-gray-400">Vault Address:</span>
                      <span className="ml-2 text-white font-mono text-xs break-all">{proposal.vaultAddress}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Proposal ID:</span>
                      <span className="ml-2 text-white font-mono text-xs">{proposal.proposalId}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Executed:</span>
                      <span className={`ml-2 ${proposal.executed ? 'text-green-400' : 'text-yellow-400'}`}>
                        {proposal.executed ? 'Yes' : 'No'}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-400">Signatures Needed:</span>
                      <span className="ml-2 text-white">{proposal.needsSignatures}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Current Signers ({proposal.signers.length}):</span>
                      <div className="ml-2 mt-1 space-y-1">
                        {proposal.signers.length > 0 ? (
                          proposal.signers.map((signer, idx) => (
                            <div key={idx} className="text-white font-mono text-xs break-all">
                              {signer}
                            </div>
                          ))
                        ) : (
                          <span className="text-gray-500">None</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400">Player 1:</span>
                      <span className="ml-2 text-white font-mono text-xs break-all">{proposal.player1}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Player 2:</span>
                      <span className="ml-2 text-white font-mono text-xs break-all">{proposal.player2}</span>
                    </div>
                    <div>
                      <span className="text-gray-400">Winner:</span>
                      <span className="ml-2 text-white">{proposal.winner || 'None'}</span>
                    </div>
                  </>
                )}
                
                {publicKey && (
                  <div>
                    <span className="text-gray-400">Your Wallet:</span>
                    <span className="ml-2 text-white font-mono text-xs break-all">{publicKey.toString()}</span>
                  </div>
                )}
                
                <div>
                  <span className="text-gray-400">Needs Your Signature:</span>
                  <span className={`ml-2 ${needsMySignature ? 'text-green-400' : 'text-gray-500'}`}>
                    {needsMySignature ? 'Yes' : 'No'}
                  </span>
                </div>
                
                {!proposal && (
                  <div className="text-yellow-400">
                    No proposal found yet. Polling every 5 seconds...
                  </div>
                )}
                
                {error && (
                  <div className="text-red-400">
                    Error: {error}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

