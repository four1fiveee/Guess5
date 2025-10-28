import React, { useState, useEffect } from 'react';
import { MultisigVaultDeposit } from './MultisigVaultDeposit';
import { SquadsClient } from '../utils/squadsClient';
import { useWallet } from '@solana/wallet-adapter-react';

interface MatchStatusDisplayProps {
  matchId: string;
  playerWallet: string;
}

interface MatchStatus {
  match: {
    id: string;
    player1: string;
    player2: string;
    entryFee: number;
    status: string;
    matchStatus: string;
    vaultAddress: string;
    squadsVaultAddress: string;
    depositATx: string;
    depositBTx: string;
    depositAConfirmations: number;
    depositBConfirmations: number;
    payoutTxHash: string;
    refundTxHash: string;
    payoutProposalId: string;
    proposalCreatedAt: string;
    proposalStatus: string;
    proposalSigners: string[];
    needsSignatures: number;
    proposalExecutedAt: string;
    proposalTransactionId: string;
    createdAt: string;
  };
  vaultStatus: {
    balance: number;
    confirmations: number;
    isReady: boolean;
  } | null;
}

export const MatchStatusDisplay: React.FC<MatchStatusDisplayProps> = ({
  matchId,
  playerWallet,
}) => {
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositComplete, setDepositComplete] = useState(false);
  const [signingProposal, setSigningProposal] = useState(false);
  const [squadsClient] = useState(() => new SquadsClient());
  const { publicKey } = useWallet();

  useEffect(() => {
    fetchMatchStatus();
    const interval = setInterval(fetchMatchStatus, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [matchId]);

  const fetchMatchStatus = async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/multisig/matches/${matchId}/status`);
      if (!response.ok) {
        throw new Error('Failed to fetch match status');
      }
      const data = await response.json();
      setMatchStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const handleDepositComplete = (transactionId: string) => {
    setDepositComplete(true);
    fetchMatchStatus(); // Refresh status
  };

  const handleDepositError = (error: string) => {
    setError(error);
  };

  const handleSignProposal = async () => {
    if (!matchStatus?.match.payoutProposalId || !matchStatus?.match.squadsVaultAddress) {
      setError('No proposal or vault address to sign');
      return;
    }

    if (!publicKey) {
      setError('Wallet not connected');
      return;
    }

    setSigningProposal(true);
    try {
      await squadsClient.signProposal(
        matchStatus.match.squadsVaultAddress,
        matchStatus.match.payoutProposalId,
        publicKey
      );
      setError(null);
      fetchMatchStatus(); // Refresh status
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sign proposal');
    } finally {
      setSigningProposal(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
        <div className="animate-pulse">
          <div className="h-4 bg-gray-300 rounded w-3/4 mb-4"></div>
          <div className="h-4 bg-gray-300 rounded w-1/2"></div>
        </div>
      </div>
    );
  }

  if (error || !matchStatus) {
    return (
      <div className="bg-red-500 bg-opacity-10 rounded-lg p-6 border border-red-500">
        <p className="text-red-400">Error: {error || 'Failed to load match status'}</p>
      </div>
    );
  }

  const { match, vaultStatus } = matchStatus;
  const isPlayer1 = playerWallet === match.player1;
  const isPlayer2 = playerWallet === match.player2;
  const isCurrentPlayer = isPlayer1 || isPlayer2;

  if (!isCurrentPlayer) {
    return (
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
        <p className="text-white">You are not part of this match.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Match Info */}
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
        <h2 className="text-2xl font-bold text-accent mb-4">Match Status</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Match ID:</p>
            <p className="text-xs font-mono text-accent break-all">{match.id}</p>
          </div>

          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Status:</p>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                match.matchStatus === 'READY' ? 'bg-green-500' :
                match.matchStatus === 'ACTIVE' ? 'bg-blue-500' :
                match.matchStatus === 'SETTLED' ? 'bg-purple-500' :
                match.matchStatus === 'REFUNDED' ? 'bg-yellow-500' :
                'bg-gray-500'
              }`} />
              <span className="text-sm text-white">{match.matchStatus}</span>
            </div>
          </div>

          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Entry Fee:</p>
            <p className="text-lg font-bold text-accent">{match.entryFee} SOL</p>
          </div>

          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Squads Vault Address:</p>
            <p className="text-xs font-mono text-accent break-all">{match.squadsVaultAddress || match.vaultAddress}</p>
          </div>
        </div>
      </div>

      {/* Vault Status */}
      {vaultStatus && (
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
          <h3 className="text-xl font-bold text-accent mb-4">Vault Status</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Balance:</p>
              <p className="text-lg font-bold text-accent">
                {(vaultStatus.balance / 1000000000).toFixed(6)} SOL
              </p>
            </div>

            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Confirmations:</p>
              <p className="text-lg font-bold text-accent">{vaultStatus.confirmations}</p>
            </div>

            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Ready:</p>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${vaultStatus.isReady ? 'bg-green-500' : 'bg-red-500'}`} />
                <span className="text-sm text-white">{vaultStatus.isReady ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit Status */}
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
        <h3 className="text-xl font-bold text-accent mb-4">Deposit Status</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Player 1 ({match.player1}):</p>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                match.depositAConfirmations > 0 ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="text-sm text-white">
                {match.depositAConfirmations > 0 ? 'Deposited' : 'Pending'}
              </span>
            </div>
            {match.depositATx && (
              <p className="text-xs font-mono text-accent break-all mt-2">{match.depositATx}</p>
            )}
          </div>

          <div className="bg-white bg-opacity-5 rounded-lg p-4">
            <p className="text-sm text-white/80 mb-2">Player 2 ({match.player2}):</p>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${
                match.depositBConfirmations > 0 ? 'bg-green-500' : 'bg-red-500'
              }`} />
              <span className="text-sm text-white">
                {match.depositBConfirmations > 0 ? 'Deposited' : 'Pending'}
              </span>
            </div>
            {match.depositBTx && (
              <p className="text-xs font-mono text-accent break-all mt-2">{match.depositBTx}</p>
            )}
          </div>
        </div>
      </div>

      {/* Proposal Status */}
      {match.payoutProposalId && (
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
          <h3 className="text-xl font-bold text-accent mb-4">Proposal Status</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Proposal ID:</p>
              <p className="text-xs font-mono text-accent break-all">{match.payoutProposalId}</p>
            </div>

            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Status:</p>
              <div className="flex items-center space-x-2">
                <div className={`w-3 h-3 rounded-full ${
                  match.proposalStatus === 'EXECUTED' ? 'bg-green-500' :
                  match.proposalStatus === 'APPROVED' ? 'bg-blue-500' :
                  match.proposalStatus === 'ACTIVE' ? 'bg-yellow-500' :
                  'bg-gray-500'
                }`} />
                <span className="text-sm text-white">{match.proposalStatus}</span>
              </div>
            </div>

            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Signatures Needed:</p>
              <p className="text-lg font-bold text-accent">{match.needsSignatures}</p>
            </div>

            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Created:</p>
              <p className="text-sm text-white">{new Date(match.proposalCreatedAt).toLocaleString()}</p>
            </div>
          </div>

          {/* Signing Button */}
          {match.proposalStatus === 'ACTIVE' && match.needsSignatures > 0 && (
            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-3">
                {match.proposalSigners.includes(playerWallet) 
                  ? 'You have already signed this proposal' 
                  : 'Sign this proposal to execute the payout'
                }
              </p>
              
              {!match.proposalSigners.includes(playerWallet) && (
                <button
                  onClick={handleSignProposal}
                  disabled={signingProposal}
                  className="bg-accent hover:bg-yellow-600 disabled:bg-gray-600 text-black font-bold py-2 px-4 rounded-lg transition-colors"
                >
                  {signingProposal ? 'Signing...' : 'Sign to Claim Winnings'}
                </button>
              )}
            </div>
          )}

          {/* Executed Transaction */}
          {match.proposalTransactionId && (
            <div className="bg-white bg-opacity-5 rounded-lg p-4 mt-4">
              <p className="text-sm text-white/80 mb-2">Executed Transaction:</p>
              <p className="text-xs font-mono text-accent break-all">{match.proposalTransactionId}</p>
              <a
                href={`https://explorer.solana.com/tx/${match.proposalTransactionId}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-yellow-400 text-sm underline"
              >
                View on Solana Explorer
              </a>
            </div>
          )}
        </div>
      )}

      {/* Deposit Component */}
      {match.matchStatus === 'VAULT_CREATED' && (match.squadsVaultAddress || match.vaultAddress) && (
        <MultisigVaultDeposit
          matchId={match.id}
          vaultAddress={match.squadsVaultAddress || match.vaultAddress}
          entryFee={match.entryFee}
          onDepositComplete={handleDepositComplete}
          onError={handleDepositError}
        />
      )}

      {/* Payout/Refund Status */}
      {(match.payoutTxHash || match.refundTxHash) && (
        <div className="bg-secondary bg-opacity-10 rounded-lg p-6">
          <h3 className="text-xl font-bold text-accent mb-4">Transaction Status</h3>
          
          {match.payoutTxHash && (
            <div className="bg-white bg-opacity-5 rounded-lg p-4 mb-4">
              <p className="text-sm text-white/80 mb-2">Payout Transaction:</p>
              <p className="text-xs font-mono text-accent break-all">{match.payoutTxHash}</p>
              <a
                href={`https://explorer.solana.com/tx/${match.payoutTxHash}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-yellow-400 text-sm underline"
              >
                View on Solana Explorer
              </a>
            </div>
          )}

          {match.refundTxHash && (
            <div className="bg-white bg-opacity-5 rounded-lg p-4">
              <p className="text-sm text-white/80 mb-2">Refund Transaction:</p>
              <p className="text-xs font-mono text-accent break-all">{match.refundTxHash}</p>
              <a
                href={`https://explorer.solana.com/tx/${match.refundTxHash}?cluster=devnet`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:text-yellow-400 text-sm underline"
              >
                View on Solana Explorer
              </a>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-500 bg-opacity-10 rounded-lg p-6 border border-red-500">
          <p className="text-red-400">Error: {error}</p>
        </div>
      )}
    </div>
  );
};
