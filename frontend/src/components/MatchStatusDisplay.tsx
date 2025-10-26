import React, { useState, useEffect } from 'react';
import { MultisigVaultDeposit } from './MultisigVaultDeposit';

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
    depositATx: string;
    depositBTx: string;
    depositAConfirmations: number;
    depositBConfirmations: number;
    payoutTxHash: string;
    refundTxHash: string;
    createdAt: string;
  };
  vaultStatus: {
    balance: number;
    confirmations: number;
    isReady: boolean;
  } | null;
}

// Helper function to truncate addresses
const truncateAddress = (address: string, startLength: number = 6, endLength: number = 4): string => {
  if (address.length <= startLength + endLength) return address;
  return `${address.slice(0, startLength)}...${address.slice(-endLength)}`;
};

export const MatchStatusDisplay: React.FC<MatchStatusDisplayProps> = ({
  matchId,
  playerWallet,
}) => {
  const [matchStatus, setMatchStatus] = useState<MatchStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [depositComplete, setDepositComplete] = useState(false);

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

  // Calculate total pot
  const totalPot = match.entryFee * 2;

  // Check if current player has deposited
  const currentPlayerHasDeposited = isPlayer1 ? match.depositAConfirmations > 0 : match.depositBConfirmations > 0;
  const opponentHasDeposited = isPlayer1 ? match.depositBConfirmations > 0 : match.depositAConfirmations > 0;

  return (
    <div className="space-y-6 max-w-4xl w-full">
      {/* Main Status Card */}
      <div className="bg-secondary bg-opacity-20 rounded-lg p-6 border border-accent/30">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-3xl font-bold text-accent">Match Ready</h2>
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${match.matchStatus === 'READY' ? 'bg-green-500' : 'bg-yellow-500'}`} />
            <span className="text-sm text-white">{match.matchStatus === 'READY' ? 'Ready to Play' : 'Waiting for Deposits'}</span>
          </div>
        </div>

        {/* Total Pot */}
        <div className="bg-accent/20 rounded-lg p-4 mb-6">
          <p className="text-sm text-white/80 mb-1">Total Pot</p>
          <p className="text-4xl font-bold text-accent">{totalPot.toFixed(4)} SOL</p>
          <p className="text-sm text-white/60 mt-1">{match.entryFee} SOL per player</p>
        </div>

        {/* Player Deposits */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Current Player */}
          <div className={`rounded-lg p-4 border-2 ${currentPlayerHasDeposited ? 'bg-green-500/20 border-green-500' : 'bg-white/5 border-white/20'}`}>
            <p className="text-sm text-white/80 mb-2">You {isPlayer1 ? '(Player 1)' : '(Player 2)'}</p>
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-white/60">{truncateAddress(playerWallet)}</p>
              {currentPlayerHasDeposited ? (
                <span className="text-green-400 text-sm font-semibold">✓ Deposited</span>
              ) : (
                <span className="text-yellow-400 text-sm font-semibold">Pending</span>
              )}
            </div>
          </div>

          {/* Opponent */}
          <div className={`rounded-lg p-4 border-2 ${opponentHasDeposited ? 'bg-green-500/20 border-green-500' : 'bg-white/5 border-white/20'}`}>
            <p className="text-sm text-white/80 mb-2">Opponent {isPlayer1 ? '(Player 2)' : '(Player 1)'}</p>
            <div className="flex items-center justify-between">
              <p className="font-mono text-xs text-white/60">{truncateAddress(isPlayer1 ? match.player2 : match.player1)}</p>
              {opponentHasDeposited ? (
                <span className="text-green-400 text-sm font-semibold">✓ Deposited</span>
              ) : (
                <span className="text-yellow-400 text-sm font-semibold">Waiting</span>
              )}
            </div>
          </div>
        </div>

        {/* Deposit Component - Only show if current player hasn't deposited */}
        {match.matchStatus === 'VAULT_CREATED' && match.vaultAddress && !currentPlayerHasDeposited && (
          <div className="mt-6">
            <MultisigVaultDeposit
              matchId={match.id}
              vaultAddress={match.vaultAddress}
              entryFee={match.entryFee}
              onDepositComplete={handleDepositComplete}
              onError={handleDepositError}
            />
          </div>
        )}

        {/* Waiting message if both players have deposited */}
        {currentPlayerHasDeposited && opponentHasDeposited && match.matchStatus !== 'READY' && (
          <div className="mt-6 bg-blue-500/20 border border-blue-500/50 rounded-lg p-4">
            <p className="text-blue-300 text-center">Both players have deposited! Waiting for game to start...</p>
          </div>
        )}
      </div>

      {/* Vault Info - Compact */}
      {match.vaultAddress && (
        <div className="bg-white/5 rounded-lg p-4 border border-white/10">
          <p className="text-xs text-white/60 mb-2">Vault Address</p>
          <div className="flex items-center space-x-2">
            <p className="text-xs font-mono text-accent">{truncateAddress(match.vaultAddress, 8, 8)}</p>
            <button
              onClick={() => navigator.clipboard.writeText(match.vaultAddress)}
              className="text-xs text-accent hover:text-yellow-400"
            >
              📋 Copy
            </button>
          </div>
          {vaultStatus && (
            <div className="mt-2 text-xs text-white/60">
              Balance: <span className="text-accent">{(vaultStatus.balance / 1000000000).toFixed(6)} SOL</span>
            </div>
          )}
        </div>
      )}

      {/* Error Display */}
      {error && (
        <div className="bg-red-500 bg-opacity-10 rounded-lg p-4 border border-red-500">
          <p className="text-red-400 text-sm">Error: {error}</p>
        </div>
      )}
    </div>
  );
};
