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
  totalBonusReceived: number;
  totalBonusReceivedUSD: number;
  netProfit: number;
  netProfitUSD: number;
}

interface ReferralStats {
  totalEarnedUSD: number;
  totalEarnedSOL: number;
  pendingUSD: number;
  paidUSD: number;
  referredCount: number;
  activeReferredCount: number;
  eligibleReferredCount: number;
  earningsAllTime: number;
  earningsYTD: number;
  earningsQTD: number;
  earningsLast7Days: number;
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
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
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
      
      // Load stats, referral stats, and proposals in parallel
      const [statsResponse, referralResponse, proposalsResponse] = await Promise.all([
        fetch(`${apiUrl}/api/match/player-stats?wallet=${walletAddress}&_t=${timestamp}`, {
          cache: 'no-store',
          headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          }
        }),
        fetch(`${apiUrl}/api/referral/dashboard?wallet=${walletAddress}&_t=${timestamp}`, {
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

      if (referralResponse.ok) {
        const referralData = await referralResponse.json();
        if (referralData.success && referralData.stats) {
          setReferralStats(referralData.stats);
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
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

  // Calculate USD values using current SOL price
  const netProfitUSD = solPrice && stats?.netProfit !== undefined ? stats.netProfit * solPrice : 0;
  const totalEarnedUSD = solPrice && stats?.totalPayoutsReceived ? stats.totalPayoutsReceived * solPrice : 0;
  const totalLossesUSD = solPrice && stats?.totalEntryFeesSpent ? stats.totalEntryFeesSpent * solPrice : 0;
  const bonusEarnedUSD = solPrice && stats?.totalBonusReceived ? stats.totalBonusReceived * solPrice : 0;

  if (!wallet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative">
        <TopRightWallet />
        <Head>
          <title>Your Dashboard - Guess5</title>
        </Head>
        <div className="flex flex-col items-center max-w-6xl w-full mt-8">
          <div className="logo-shell mb-4 sm:mb-6">
            <Image src={logo} alt="Guess5 Logo" width={100} height={100} priority />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-6 text-center">Your Dashboard</h1>
          <div className="bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
            <p className="text-white/90 text-center mb-4">Please connect your wallet to view your dashboard.</p>
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
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative pb-12">
      <TopRightWallet />
      <Head>
        <title>Your Dashboard - Guess5</title>
      </Head>
      <div className="flex flex-col items-center max-w-6xl w-full">
        <div className="logo-shell mb-4 sm:mb-6">
          <Image src={logo} alt="Guess5 Logo" width={200} height={200} priority />
        </div>
        
        {/* Back to Home Button */}
        <Link href="/" className="mb-6">
          <button className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-300 border border-white/20 backdrop-blur-sm">
            ← Back to Home
          </button>
        </Link>
        
        {/* SECTION 1: Your Earnings & Match Stats */}
        <div className="w-full mb-8">
          <h2 className="text-2xl sm:text-3xl font-bold text-accent mb-6 text-center">Your Earnings & Match Stats</h2>
          
          {/* Net Profit - Prominent Card */}
          <div className="bg-gradient-to-br from-green-500/20 via-green-500/10 to-green-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border-2 border-green-400/40">
            <div className="text-center">
              <div className="text-white/70 text-sm uppercase tracking-wider mb-2">Net Profit</div>
              <div className={`text-5xl sm:text-6xl font-bold mb-2 ${netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {formatUSD(netProfitUSD)}
              </div>
              <div className="text-white/60 text-sm font-mono">
                {formatSOL(stats?.netProfit || 0)}
              </div>
              <div className="text-white/50 text-xs mt-2 italic">
                (Amount Received + Bonus Earned) - Entry Fees Paid
              </div>
            </div>
          </div>

          {/* Stats Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {/* Win Rate */}
            <div className="bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-orange-500/20 backdrop-blur-sm rounded-xl p-5 border border-orange-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🟧</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Win Rate</span>
              </div>
              <div className="text-3xl font-bold text-orange-400">
                {stats?.winPercentage ? stats.winPercentage.toFixed(1) : '0.0'}%
              </div>
              <div className="text-white/60 text-xs mt-1">
                {stats?.wins || 0} wins out of {stats?.gamesPlayed || 0} games
              </div>
            </div>

            {/* Total Earned */}
            <div className="bg-gradient-to-br from-green-500/20 via-green-500/10 to-green-500/20 backdrop-blur-sm rounded-xl p-5 border border-green-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🟩</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Winnings Received</span>
              </div>
              <div className="text-3xl font-bold text-green-400">
                {formatUSD(totalEarnedUSD)}
              </div>
              <div className="text-white/60 text-xs mt-1 font-mono">
                {formatSOL(stats?.totalPayoutsReceived || 0)}
              </div>
              <div className="text-white/50 text-xs mt-1 italic">
                Total payouts from winning matches
              </div>
            </div>

            {/* Entry Fees Paid */}
            <div className="bg-gradient-to-br from-red-500/20 via-red-500/10 to-red-500/20 backdrop-blur-sm rounded-xl p-5 border border-red-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🟥</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Entry Fees Paid</span>
              </div>
              <div className="text-3xl font-bold text-red-400">
                {formatUSD(totalLossesUSD)}
              </div>
              <div className="text-white/60 text-xs mt-1 font-mono">
                {formatSOL(stats?.totalEntryFeesSpent || 0)}
              </div>
              <div className="text-white/50 text-xs mt-1 italic">
                Total amount spent on match entry fees
              </div>
            </div>

            {/* Bonus Earned */}
            <div className="bg-gradient-to-br from-yellow-500/20 via-yellow-500/10 to-yellow-500/20 backdrop-blur-sm rounded-xl p-5 border border-yellow-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🟨</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">House Bonus Earned</span>
              </div>
              <div className="text-3xl font-bold text-yellow-400">
                {formatUSD(bonusEarnedUSD)}
              </div>
              <div className="text-white/60 text-xs mt-1 font-mono">
                {formatSOL(stats?.totalBonusReceived || 0)}
              </div>
              <div className="text-white/50 text-xs mt-1 italic">
                Bonus rewards from higher tier matches
              </div>
            </div>

            {/* Games Played */}
            <div className="bg-gradient-to-br from-blue-500/20 via-blue-500/10 to-blue-500/20 backdrop-blur-sm rounded-xl p-5 border border-blue-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🟦</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Games Played</span>
              </div>
              <div className="text-3xl font-bold text-blue-400">
                {stats?.gamesPlayed || 0}
              </div>
              <div className="text-white/60 text-xs mt-1">
                {stats?.wins || 0}W / {stats?.losses || 0}L / {stats?.ties || 0}T
              </div>
            </div>

            {/* Ties */}
            <div className="bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20 backdrop-blur-sm rounded-xl p-5 border border-purple-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🤝</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Tied Matches</span>
              </div>
              <div className="text-3xl font-bold text-purple-400">
                {stats?.ties || 0}
              </div>
              <div className="text-white/60 text-xs mt-1">
                Matches where both players tied
              </div>
              <div className="text-white/50 text-xs mt-1 italic">
                Entry fees refunded to both players
              </div>
            </div>
          </div>

          {/* CTA: Play Next Match */}
          <div className="text-center mb-6">
            <Link href="/lobby">
              <button className="px-8 py-4 bg-accent hover:bg-yellow-400 text-primary font-bold text-lg rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl">
                Play Your Next Match ➜
              </button>
            </Link>
          </div>
        </div>

        {/* SECTION 2: Your Referral Earnings Engine */}
        {referralStats && (
          <div className="w-full mb-8">
            <h2 className="text-2xl sm:text-3xl font-bold text-purple-400 mb-6 text-center">Your Network is Earning You This Much</h2>
            
            {/* Featured Card: All-Time Referral Earnings */}
            <div className="bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border-2 border-purple-400/40">
              <div className="text-center">
                <div className="text-white/70 text-sm uppercase tracking-wider mb-2">You've Earned</div>
                <div className="text-5xl sm:text-6xl font-bold mb-2 text-purple-400">
                  {formatUSD(referralStats.totalEarnedUSD || 0)}
                </div>
                <div className="text-white/60 text-sm font-mono mb-4">
                  {formatSOL(referralStats.totalEarnedSOL || 0)} from referrals
                </div>
                <div className="flex items-center justify-center gap-4 text-sm">
                  <div className="text-green-400">
                    💵 Paid: {formatUSD(referralStats.paidUSD || 0)}
                  </div>
                  <div className="text-yellow-400">
                    ⏳ Pending: {formatUSD(referralStats.pendingUSD || 0)}
                  </div>
                </div>
              </div>
            </div>

            {/* Referral Stats Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              {/* Referred Players */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">🧑‍🤝‍🧑</span>
                  <span className="text-white/70 text-xs uppercase tracking-wider">Referred Players</span>
                </div>
                <div className="text-3xl font-bold text-white">
                  {referralStats.referredCount || 0}
                </div>
                <div className="text-white/60 text-xs mt-1">
                  {referralStats.activeReferredCount || 0} active
                </div>
              </div>

              {/* Earnings Last 7 Days */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">💰</span>
                  <span className="text-white/70 text-xs uppercase tracking-wider">Last 7 Days</span>
                </div>
                <div className="text-3xl font-bold text-green-400">
                  {formatUSD(referralStats.earningsLast7Days || 0)}
                </div>
                <div className="text-white/60 text-xs mt-1">
                  Recent earnings
                </div>
              </div>

              {/* Awaiting Payout */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">⏳</span>
                  <span className="text-white/70 text-xs uppercase tracking-wider">Awaiting Payout</span>
                </div>
                <div className="text-3xl font-bold text-yellow-400">
                  {formatUSD(referralStats.pendingUSD || 0)}
                </div>
                <div className="text-white/60 text-xs mt-1">
                  Next payout: Sunday
                </div>
              </div>

              {/* Eligible Referrals */}
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">✅</span>
                  <span className="text-white/70 text-xs uppercase tracking-wider">Eligible</span>
                </div>
                <div className="text-3xl font-bold text-green-400">
                  {referralStats.eligibleReferredCount || 0}
                </div>
                <div className="text-white/60 text-xs mt-1">
                  Qualifying players
                </div>
              </div>
            </div>

            {/* CTA: Start Referring */}
            <div className="text-center mb-6">
              <Link href="/referrals">
                <button className="px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white font-bold text-lg rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl">
                  Refer & Earn Instantly ➜
                </button>
              </Link>
            </div>
          </div>
        )}

        {/* Outstanding Proposals */}
        {outstandingProposals.length > 0 && (
          <div className="w-full mb-8">
            <div className="bg-gradient-to-br from-yellow-500/20 via-orange-500/10 to-yellow-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-xl border border-yellow-500/30 w-full">
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
          </div>
        )}

        {/* CSV Download */}
        <div className="w-full">
          <div className="bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-xl border border-white/20 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-accent mb-2">Download Match History</h2>
                <p className="text-white/70 text-sm">
                  Export a complete CSV file with all your match data, including results, entry fees, payouts, and transaction signatures.
                </p>
              </div>
              <button
                onClick={downloadCSV}
                className="px-6 py-3 bg-accent hover:bg-yellow-300 text-primary font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 active:scale-95 whitespace-nowrap"
              >
                📥 Download CSV
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}