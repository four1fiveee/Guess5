import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/router';

interface MatchStats {
  gamesPlayed: number;
  wins: number;
  losses: number;
  ties: number;
  winPercentage: number;
  totalEntryFeesSpent: number;
  totalEntryFeesSpentUSD: number;
  totalPayoutsReceived: number;
  totalPayoutsReceivedUSD: number;
  netProfit: number;
  netProfitUSD: number;
}

interface OutstandingProposal {
  matchId: string;
  proposalId: string;
  proposalType: 'refund' | 'payout';
  entryFee: number;
  entryFeeUSD: number;
  amount: number;
  amountUSD: number;
  status: string;
  needsSignatures: number;
  createdAt: string;
  vaultAddress: string;
}

export default function MatchHistoryPage() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const [wallet, setWallet] = useState<string>('');
  const [stats, setStats] = useState<MatchStats | null>(null);
  const [outstandingProposals, setOutstandingProposals] = useState<OutstandingProposal[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [solPrice, setSolPrice] = useState<number | null>(null);

  useEffect(() => {
    const walletAddress = publicKey?.toString() || '';
    if (walletAddress) {
      setWallet(walletAddress);
      loadDashboardData(walletAddress);
    }
  }, [publicKey]);

  // Fetch current SOL price
  useEffect(() => {
    const fetchSolPrice = async () => {
      try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
        const data = await response.json();
        if (data.solana?.usd) {
          setSolPrice(data.solana.usd);
        }
      } catch (error) {
        console.error('Error fetching SOL price:', error);
      }
    };
    fetchSolPrice();
  }, []);

  const loadDashboardData = async (walletAddress: string) => {
    setLoading(true);
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://guess5-backend.onrender.com';
      
      // Add cache-busting timestamp to ensure fresh data
      const timestamp = Date.now();
      
      // Load stats and proposals in parallel with cache-busting
      const [statsResponse, proposalsResponse] = await Promise.all([
        fetch(`${apiUrl}/api/match/player-stats?wallet=${walletAddress}&_t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }),
        fetch(`${apiUrl}/api/match/outstanding-proposals?wallet=${walletAddress}&_t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }),
      ]);

      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        if (statsData.success) {
          setStats(statsData.stats);
        }
      }

      if (proposalsResponse.ok) {
        const proposalsData = await proposalsResponse.json();
        if (proposalsData.success) {
          setOutstandingProposals(proposalsData.proposals || []);
        }
      }
    } catch (error) {
      console.error('Error loading match history dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatUSD = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  const formatSOL = (amount: number) => {
    return `${amount.toFixed(4)} SOL`;
  };

  const formatDate = (date: Date | string) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleSignProposal = async (matchId: string, proposalId: string) => {
    // Navigate to result page where they can sign
    router.push(`/result?matchId=${matchId}`);
  };

  const downloadCSV = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://guess5-backend.onrender.com';
      const response = await fetch(`${apiUrl}/api/match/generate-report?wallet=${wallet}`);
      if (!response.ok) {
        throw new Error('Failed to download CSV');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Guess5_Match_History_${wallet.slice(0, 8)}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading CSV:', error);
      alert('Failed to download match history. Please try again.');
    }
  };

  if (!wallet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative">
        <TopRightWallet />
        <Head>
          <title>Match History - Guess5</title>
        </Head>
        <div className="flex flex-col items-center max-w-4xl w-full mt-8">
          <div className="logo-shell mb-4 sm:mb-6">
            <Image src={logo} alt="Guess5 Logo" width={100} height={100} priority />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-6 text-center">Match History</h1>
          <div className="bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
            <p className="text-white/90 text-center mb-4">Please connect your wallet to view your match history.</p>
            <div className="flex justify-center gap-4">
              <Link href="/">
                <button className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-300 border border-white/20">
                  ← Back to Home
                </button>
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative">
      <TopRightWallet />
      <Head>
        <title>Match History - Guess5</title>
      </Head>
      <div className="flex flex-col items-center max-w-4xl w-full">
        <div className="logo-shell mb-4 sm:mb-6">
          <Image src={logo} alt="Guess5 Logo" width={200} height={200} priority />
        </div>
        
        {/* Back to Home Button */}
        <Link href="/" className="mb-6">
          <button className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-300 border border-white/20 backdrop-blur-sm">
            ← Back to Home
          </button>
        </Link>
        
        <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-6 text-center">Your Match History</h1>
        
        {/* Match Statistics Summary */}
        <div className="match-summary bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Match Statistics</h2>
          {loading ? (
            <p className="text-white/70">Loading...</p>
          ) : (
            <div className="space-y-4 text-white/90">
              {/* Games Played & Win Rate */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                <h3 className="text-lg font-bold text-accent mb-3">Performance</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Games Played:</span>
                    <span className="text-accent font-bold">{stats?.gamesPlayed || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Win Rate:</span>
                    <span className="text-accent font-bold">{stats?.winPercentage ? stats.winPercentage.toFixed(1) : '0.0'}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Wins:</span>
                    <span className="text-green-400 font-semibold">{stats?.wins || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Losses:</span>
                    <span className="text-red-400 font-semibold">{stats?.losses || 0}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Ties:</span>
                    <span className="text-blue-400 font-semibold">{stats?.ties || 0}</span>
                  </div>
                </div>
              </div>

              {/* Financial Summary */}
              <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                <h3 className="text-lg font-bold text-accent mb-3">Financial Summary</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Total Entry Fees:</span>
                    <span className="text-white font-semibold">
                      {solPrice && stats?.totalEntryFeesSpent 
                        ? formatUSD(stats.totalEntryFeesSpent * solPrice)
                        : formatUSD(0)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-white/80 text-sm">Amount Received:</span>
                    <span className="text-green-400 font-semibold">
                      {solPrice && stats?.totalPayoutsReceived 
                        ? formatUSD(stats.totalPayoutsReceived * solPrice)
                        : formatUSD(0)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-white/10">
                  <div className="flex justify-between items-center">
                    <span className="text-white/90 font-semibold">Net Profit:</span>
                    <span className={`text-xl font-bold ${(stats?.netProfit || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {solPrice && stats?.netProfit !== undefined
                        ? formatUSD(stats.netProfit * solPrice)
                        : formatUSD(0)}
                    </span>
                  </div>
                  <div className="text-white/60 text-xs mt-1">
                    ({formatSOL(stats?.netProfit || 0)})
                  </div>
                  <div className="text-white/50 text-xs mt-2 italic">
                    Net Profit = Amount Received from Vaults - Entry Fees Paid
                  </div>
                </div>
                {/* USD Conversion Explanation */}
                <div className="mt-4 pt-3 border-t border-white/10 bg-blue-500/10 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <span className="text-blue-400 text-sm mt-0.5">ℹ️</span>
                    <div className="flex-1">
                      <div className="text-blue-300 text-xs font-semibold mb-1">USD Values Explained</div>
                      <div className="text-white/70 text-xs leading-relaxed">
                        USD amounts are calculated using <strong className="text-white/90">current SOL price</strong> ({solPrice ? `$${solPrice.toFixed(2)}` : 'loading...'}) 
                        converted from the actual SOL amounts transacted. 
                        The <strong className="text-white/90">SOL amounts shown are the actual amounts</strong> transferred and are always accurate. 
                        Small rounding differences may occur due to transaction fees and gas costs.
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Outstanding Proposals */}
        {outstandingProposals.length > 0 && (
          <div className="outstanding-proposals bg-gradient-to-br from-yellow-500/20 via-orange-500/10 to-yellow-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-yellow-500/30 w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl sm:text-2xl font-bold text-accent">Outstanding Proposals</h2>
              <span className="px-3 py-1 bg-yellow-500/20 border border-yellow-500/40 rounded-lg text-yellow-400 text-xs font-semibold">
                {outstandingProposals.length} Pending
              </span>
            </div>
            <p className="text-white/70 text-sm mb-4">
              You have proposals that need your signature to release funds. Click "Sign Proposal" to complete the transaction.
            </p>
            <div className="space-y-3">
              {outstandingProposals.map((proposal) => (
                <div key={proposal.matchId} className="bg-white/5 rounded-xl p-4 border border-white/10">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${
                          proposal.proposalType === 'payout' 
                            ? 'bg-green-500/20 text-green-400 border border-green-500/40' 
                            : 'bg-blue-500/20 text-blue-400 border border-blue-500/40'
                        }`}>
                          {proposal.proposalType === 'payout' ? '💰 Payout' : '↩️ Refund'}
                        </span>
                        <span className="text-white/60 text-xs">
                          {formatDate(proposal.createdAt)}
                        </span>
                      </div>
                      <div className="text-white/90 text-sm">
                        <div>Amount: <span className="font-semibold">{formatUSD(proposal.amountUSD)}</span> ({formatSOL(proposal.amount)})</div>
                        <div className="text-white/60 text-xs mt-1 font-mono">
                          Match: {proposal.matchId.slice(0, 8)}...
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSignProposal(proposal.matchId, proposal.proposalId)}
                      className="px-4 py-2 bg-accent hover:bg-yellow-300 text-primary font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 active:scale-95 whitespace-nowrap"
                    >
                      Sign Proposal
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Match History CSV Download */}
        <div className="match-history-download bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-accent">Match History</h2>
            <button
              onClick={downloadCSV}
              className="px-4 py-2 bg-accent hover:bg-yellow-300 text-primary font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 active:scale-95"
            >
              📥 Download CSV
            </button>
          </div>
          <p className="text-white/70 text-sm">
            Download a complete CSV file containing all your match history, including game results, entry fees, payouts, and transaction signatures.
          </p>
        </div>
      </div>
    </div>
  );
}

