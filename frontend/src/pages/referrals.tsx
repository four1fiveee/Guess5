import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import Image from 'next/image';
import logo from '../../public/logo.png';
import { TopRightWallet } from '../components/WalletConnect';
import { useWallet } from '@solana/wallet-adapter-react';

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

interface CanReferInfo {
  canReferOthers: boolean;
  canReferReason?: string;
  matchCount: number;
  exemptFromMinimum: boolean;
}

interface EarningsBreakdown {
  byTier: Array<{ tier: number; tierName: string; percentage: number; totalUSD: number; count: number }>;
  byReferredWallet: Array<{ referredWallet: string; totalUSD: number; count: number }>;
  currentTier: { tier: number; tierName: string; percentage: number; activeReferredCount: number };
}

export default function ReferralsPage() {
  const { publicKey } = useWallet();
  const [wallet, setWallet] = useState<string>('');
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [breakdown, setBreakdown] = useState<EarningsBreakdown | null>(null);
  const [isEligible, setIsEligible] = useState<boolean>(false);
  const [canReferInfo, setCanReferInfo] = useState<CanReferInfo | null>(null);
  const [nextPayoutDate, setNextPayoutDate] = useState<Date | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [referralLink, setReferralLink] = useState<string>('');
  const [solPrice, setSolPrice] = useState<number | null>(null);

  useEffect(() => {
    const walletAddress = publicKey?.toString() || '';
    
    if (walletAddress) {
      setWallet(walletAddress);
      setReferralLink(`${window.location.origin}?ref=${walletAddress}`);
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
      const response = await fetch(`${apiUrl}/api/referral/dashboard?wallet=${walletAddress}`);
      const data = await response.json();

      if (data.success) {
        setStats(data.stats);
        setBreakdown(data.breakdown);
        setIsEligible(data.isEligible);
        setCanReferInfo({
          canReferOthers: data.canReferOthers,
          canReferReason: data.canReferReason,
          matchCount: data.matchCount,
          exemptFromMinimum: data.exemptFromMinimum
        });
        setNextPayoutDate(data.nextPayoutDate ? new Date(data.nextPayoutDate) : null);
      }
    } catch (error) {
      console.error('Error loading referral dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  const copyReferralLink = () => {
    navigator.clipboard.writeText(referralLink);
    alert('Referral link copied to clipboard!');
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
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (!wallet) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative">
        <TopRightWallet />
        <Head>
          <title>Referral Earnings - Guess5</title>
        </Head>
        <div className="flex flex-col items-center max-w-6xl w-full mt-8">
          <div className="logo-shell mb-4 sm:mb-6">
            <Image src={logo} alt="Guess5 Logo" width={100} height={100} priority />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-6 text-center">Referral Earnings</h1>
          <div className="bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
            <p className="text-white/90 text-center mb-4">Please connect your wallet to view your referral dashboard.</p>
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

  // Calculate SOL amounts from USD using current price
  const totalEarnedSOL = solPrice && stats?.totalEarnedUSD ? stats.totalEarnedUSD / solPrice : stats?.totalEarnedSOL || 0;
  const pendingSOL = solPrice && stats?.pendingUSD ? stats.pendingUSD / solPrice : 0;
  const paidSOL = solPrice && stats?.paidUSD ? stats.paidUSD / solPrice : 0;

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative pb-12">
      <TopRightWallet />
      <Head>
        <title>Referral Earnings - Guess5</title>
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
        
        <h1 className="text-2xl sm:text-3xl font-bold text-purple-400 mb-6 text-center">Your Network is Earning You This Much</h1>
        
        {/* Featured Card: All-Time Referral Earnings */}
        <div className="w-full mb-8">
          <div className="bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border-2 border-purple-400/40">
            <div className="text-center">
              <div className="text-white/70 text-sm uppercase tracking-wider mb-2">You've Earned</div>
              <div className="text-5xl sm:text-6xl font-bold mb-2 text-purple-400">
                {formatUSD(stats?.totalEarnedUSD || 0)}
              </div>
              <div className="text-white/60 text-sm font-mono mb-4">
                {formatSOL(totalEarnedSOL)} from referrals
              </div>
              <div className="flex items-center justify-center gap-6 text-sm">
                <div className="text-green-400">
                  💵 Paid: {formatUSD(stats?.paidUSD || 0)}
                </div>
                <div className="text-yellow-400">
                  ⏳ Pending: {formatUSD(stats?.pendingUSD || 0)}
                </div>
              </div>
            </div>
          </div>

          {/* Referral Stats Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {/* Total Referred Players */}
            <div className="bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20 backdrop-blur-sm rounded-xl p-5 border border-purple-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">🧑‍🤝‍🧑</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Total Referred</span>
              </div>
              <div className="text-3xl font-bold text-purple-400">
                {stats?.referredCount || 0}
              </div>
              <div className="text-white/60 text-xs mt-1">
                Players who used your link
              </div>
            </div>

            {/* Active Referred Players */}
            <div className="bg-gradient-to-br from-green-500/20 via-green-500/10 to-green-500/20 backdrop-blur-sm rounded-xl p-5 border border-green-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">✅</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Active Players</span>
              </div>
              <div className="text-3xl font-bold text-green-400">
                {stats?.activeReferredCount || 0}
              </div>
              <div className="text-white/60 text-xs mt-1">
                Played 1+ match
              </div>
            </div>

            {/* Earnings Last 7 Days */}
            <div className="bg-gradient-to-br from-yellow-500/20 via-yellow-500/10 to-yellow-500/20 backdrop-blur-sm rounded-xl p-5 border border-yellow-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">💰</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Last 7 Days</span>
              </div>
              <div className="text-3xl font-bold text-yellow-400">
                {formatUSD(stats?.earningsLast7Days || 0)}
              </div>
              <div className="text-white/60 text-xs mt-1">
                Recent earnings
              </div>
            </div>

            {/* Awaiting Payout */}
            <div className="bg-gradient-to-br from-orange-500/20 via-orange-500/10 to-orange-500/20 backdrop-blur-sm rounded-xl p-5 border border-orange-400/30">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">⏳</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Awaiting Payout</span>
              </div>
              <div className="text-3xl font-bold text-orange-400">
                {formatUSD(stats?.pendingUSD || 0)}
              </div>
              <div className="text-white/60 text-xs mt-1 font-mono">
                {formatSOL(pendingSOL)}
              </div>
              <div className="text-white/50 text-xs mt-1 italic">
                Next payout: Sunday
              </div>
            </div>
          </div>

          {/* Additional Stats Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            {/* Paid Out */}
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-2xl">💵</span>
                <span className="text-white/70 text-xs uppercase tracking-wider">Total Paid Out</span>
              </div>
              <div className="text-2xl font-bold text-green-400">
                {formatUSD(stats?.paidUSD || 0)}
              </div>
              <div className="text-white/60 text-xs mt-1 font-mono">
                {formatSOL(paidSOL)}
              </div>
              <div className="text-white/50 text-xs mt-1 italic">
                Amount received in payouts
              </div>
            </div>

            {/* Current Tier */}
            {breakdown && breakdown.currentTier && (
              <div className="bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20 rounded-xl p-5 border border-purple-400/30">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">⭐</span>
                  <span className="text-white/70 text-xs uppercase tracking-wider">Your Tier</span>
                </div>
                <div className="text-2xl font-bold text-purple-400">
                  {breakdown.currentTier.tierName}
                </div>
                <div className="text-white/60 text-xs mt-1">
                  {(breakdown.currentTier.percentage * 100).toFixed(0)}% per referral
                </div>
                <div className="text-white/50 text-xs mt-1 italic">
                  {breakdown.currentTier.activeReferredCount} active wallets
                </div>
              </div>
            )}

            {/* Next Payout Date */}
            {nextPayoutDate && (
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">📅</span>
                  <span className="text-white/70 text-xs uppercase tracking-wider">Next Payout</span>
                </div>
                <div className="text-lg font-bold text-white">
                  {formatDate(nextPayoutDate)}
                </div>
                <div className="text-white/60 text-xs mt-1">
                  Sunday 1:00 PM EST
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Referral Link Section */}
        <div className={`w-full mb-8 bg-gradient-to-br from-purple-500/20 via-pink-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-xl border border-purple-500/30 ${!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum ? 'opacity-50' : ''}`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl sm:text-2xl font-bold text-accent">Your Referral Link</h2>
            {canReferInfo?.canReferOthers ? (
              <span className="px-3 py-1 bg-green-500/20 border border-green-500/40 rounded-lg text-green-400 text-xs font-semibold">
                ✓ Qualified
              </span>
            ) : canReferInfo?.exemptFromMinimum ? (
              <span className="px-3 py-1 bg-purple-500/20 border border-purple-500/40 rounded-lg text-purple-400 text-xs font-semibold">
                ⭐ Exempt
              </span>
            ) : (
              <span className="px-3 py-1 bg-yellow-500/20 border border-yellow-500/40 rounded-lg text-yellow-400 text-xs font-semibold">
                ⚠️ Not Qualified
              </span>
            )}
          </div>
          
          {!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum && (
            <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3 mb-4">
              <p className="text-yellow-400 text-sm">
                ⚠️ You need to play at least <strong>20 games</strong> before you can refer others. You have played <strong>{canReferInfo?.matchCount || 0} game{canReferInfo?.matchCount !== 1 ? 's' : ''}</strong>.
              </p>
            </div>
          )}
          
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
            <input 
              type="text" 
              value={referralLink} 
              readOnly 
              disabled={!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum}
              className={`flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white/90 focus:outline-none focus:border-accent/50 font-mono text-sm ${!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum ? 'opacity-50 cursor-not-allowed' : ''}`}
            />
            <button 
              onClick={copyReferralLink}
              disabled={!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum}
              className={`px-6 py-3 bg-accent hover:bg-yellow-300 text-primary font-bold rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 ${!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Copy Link
            </button>
          </div>
          <div className="flex gap-3 flex-wrap">
            <a
              href={`https://twitter.com/intent/tweet?text=Check out Guess5.io - a fun word game on Solana!&url=${encodeURIComponent(referralLink)}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium ${!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
            >
              Share on Twitter
            </a>
            <button
              onClick={() => navigator.share?.({ title: 'Guess5.io', text: 'Check out this fun word game!', url: referralLink })}
              disabled={!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum}
              className={`px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors text-sm font-medium ${!canReferInfo?.canReferOthers && !canReferInfo?.exemptFromMinimum ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              Share
            </button>
          </div>
        </div>

        {/* CTA: Start Referring */}
        <div className="text-center mb-8">
          <Link href="/lobby">
            <button className="px-8 py-4 bg-purple-500 hover:bg-purple-600 text-white font-bold text-lg rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg hover:shadow-xl">
              Refer & Earn Instantly ➜
            </button>
          </Link>
        </div>

        {/* Current Tier & Progress */}
        {breakdown && breakdown.currentTier && (
          <div className="w-full mb-8">
            <div className="bg-gradient-to-br from-purple-500/20 via-purple-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-xl border-2 border-purple-400/40 w-full">
              <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Your Referral Tier</h2>
              <div className="text-center mb-6">
                <div className="text-white/70 text-sm uppercase tracking-wider mb-2">Current Tier</div>
                <div className="text-5xl sm:text-6xl font-bold mb-2 text-purple-400">
                  {breakdown.currentTier.tierName}
                </div>
                <div className="text-white/60 text-sm mb-1">
                  {(breakdown.currentTier.percentage * 100).toFixed(0)}% per referral
                </div>
                <div className="text-white/60 text-sm">
                  {breakdown.currentTier.activeReferredCount} active wallets
                </div>
                <div className="text-white/50 text-xs mt-2 italic">
                  {breakdown.currentTier.activeReferredCount >= 1000 
                    ? 'Maximum tier reached!'
                    : breakdown.currentTier.activeReferredCount >= 500
                    ? `${1000 - breakdown.currentTier.activeReferredCount} more active wallets to reach Platinum tier`
                    : breakdown.currentTier.activeReferredCount >= 100
                    ? `${500 - breakdown.currentTier.activeReferredCount} more active wallets to reach Gold tier`
                    : `${100 - breakdown.currentTier.activeReferredCount} more active wallets to reach Silver tier`
                  }
                </div>
              </div>
              
              {/* Tier Progress Bars */}
              <div className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-white/70 mb-1">
                    <span>Base (10%)</span>
                    <span>{breakdown.currentTier.activeReferredCount < 100 ? `${breakdown.currentTier.activeReferredCount}/100` : '✓'}</span>
                  </div>
                  <div className="w-full bg-white/10 rounded-full h-2">
                    <div 
                      className="bg-purple-400 h-2 rounded-full transition-all"
                      style={{ width: `${Math.min((breakdown.currentTier.activeReferredCount / 100) * 100, 100)}%` }}
                    ></div>
                  </div>
                </div>
                {breakdown.currentTier.activeReferredCount >= 100 && (
                  <div>
                    <div className="flex justify-between text-xs text-white/70 mb-1">
                      <span>Silver (15%)</span>
                      <span>{breakdown.currentTier.activeReferredCount < 500 ? `${breakdown.currentTier.activeReferredCount}/500` : '✓'}</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div 
                        className="bg-purple-400 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(((breakdown.currentTier.activeReferredCount - 100) / 400) * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                )}
                {breakdown.currentTier.activeReferredCount >= 500 && (
                  <div>
                    <div className="flex justify-between text-xs text-white/70 mb-1">
                      <span>Gold (20%)</span>
                      <span>{breakdown.currentTier.activeReferredCount < 1000 ? `${breakdown.currentTier.activeReferredCount}/1000` : '✓'}</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div 
                        className="bg-purple-400 h-2 rounded-full transition-all"
                        style={{ width: `${Math.min(((breakdown.currentTier.activeReferredCount - 500) / 500) * 100, 100)}%` }}
                      ></div>
                    </div>
                  </div>
                )}
                {breakdown.currentTier.activeReferredCount >= 1000 && (
                  <div>
                    <div className="flex justify-between text-xs text-white/70 mb-1">
                      <span>Platinum (25%)</span>
                      <span>✓ Maximum</span>
                    </div>
                    <div className="w-full bg-white/10 rounded-full h-2">
                      <div className="bg-purple-400 h-2 rounded-full w-full"></div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* CSV Download */}
        <div className="w-full mb-8">
          <div className="bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-xl border border-white/20 w-full">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-xl sm:text-2xl font-bold text-accent mb-2">Download Payout History</h2>
                <p className="text-white/70 text-sm">
                  Export a complete CSV file with all your referral payout history, including dates, amounts, levels, and transaction signatures.
                </p>
              </div>
              <button
                onClick={async () => {
                  try {
                    const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'https://guess5-backend.onrender.com';
                    const response = await fetch(`${apiUrl}/api/referral/payouts/csv?wallet=${wallet}`);
                    if (!response.ok) {
                      throw new Error('Failed to download CSV');
                    }
                    const blob = await response.blob();
                    const url = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Guess5_Referral_Payouts_${wallet.slice(0, 8)}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    window.URL.revokeObjectURL(url);
                    document.body.removeChild(a);
                  } catch (error) {
                    console.error('Error downloading CSV:', error);
                    alert('Failed to download payout history. Please try again.');
                  }
                }}
                className="px-6 py-3 bg-accent hover:bg-yellow-300 text-primary font-semibold rounded-lg transition-all duration-300 transform hover:scale-105 active:scale-95 whitespace-nowrap"
              >
                📥 Download CSV
              </button>
            </div>
          </div>
        </div>

        {/* How It Works Section - Keep existing content but make it more compact */}
        <div className="w-full">
          <div className="bg-gradient-to-br from-purple-500/20 via-pink-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 shadow-xl border border-purple-500/30 w-full">
            <h2 className="text-xl sm:text-2xl font-bold text-accent mb-6">💰 How Referral Earnings Work</h2>
            
            <div className="space-y-4 text-white/90 text-sm">
              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <h3 className="text-lg font-bold text-accent mb-3">Earning Structure</h3>
                <p className="text-white/80 mb-3 leading-relaxed">
                  When someone uses your referral link and plays a match, you earn <strong className="text-white">a percentage of the match's net profit</strong> (Platform Fee - Bonus - Network Costs). The percentage depends on your referral tier, which is based on how many active wallets you've referred.
                </p>
                <p className="text-white/80 mb-4 leading-relaxed">
                  <strong className="text-white">If you referred both players</strong> in a match, you earn <strong className="text-accent">double the percentage</strong> (one percentage per player). For example, at the base tier (10%), referring both players earns you 20% of net profit.
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
                  <div className="bg-purple-500/20 border border-purple-400/40 rounded-lg p-3 text-center">
                    <div className="text-xl font-black text-purple-400 mb-1">Base</div>
                    <div className="text-xs text-white/90 font-semibold">10%</div>
                    <div className="text-xs text-white/70 mt-1">0-99 active</div>
                    <div className="text-xs text-white/60 mt-1 italic">20% if both</div>
                  </div>
                  <div className="bg-gray-500/20 border border-gray-400/40 rounded-lg p-3 text-center">
                    <div className="text-xl font-black text-gray-300 mb-1">Silver</div>
                    <div className="text-xs text-white/90 font-semibold">15%</div>
                    <div className="text-xs text-white/70 mt-1">100-499 active</div>
                    <div className="text-xs text-white/60 mt-1 italic">30% if both</div>
                  </div>
                  <div className="bg-yellow-500/20 border border-yellow-400/40 rounded-lg p-3 text-center">
                    <div className="text-xl font-black text-yellow-400 mb-1">Gold</div>
                    <div className="text-xs text-white/90 font-semibold">20%</div>
                    <div className="text-xs text-white/70 mt-1">500-999 active</div>
                    <div className="text-xs text-white/60 mt-1 italic">40% if both</div>
                  </div>
                  <div className="bg-blue-500/20 border border-blue-400/40 rounded-lg p-3 text-center">
                    <div className="text-xl font-black text-blue-400 mb-1">Platinum</div>
                    <div className="text-xs text-white/90 font-semibold">25%</div>
                    <div className="text-xs text-white/70 mt-1">1000+ active</div>
                    <div className="text-xs text-white/60 mt-1 italic">50% if both</div>
                  </div>
                </div>
                <p className="text-white/70 text-xs mt-4 italic">
                  An "active wallet" is a wallet that has played at least one completed match.
                </p>
              </div>

              <div className="bg-white/5 rounded-xl p-5 border border-white/10">
                <h3 className="text-lg font-bold text-accent mb-3">Payout Schedule & Rules</h3>
                <ul className="space-y-2 text-white/80 text-sm leading-relaxed">
                  <li>• <strong className="text-accent">Minimum payout: $10 USD</strong> - You must be owed at least $10 USD to qualify for payout</li>
                  <li>• <strong className="text-white">Auto-lock:</strong> Every Sunday at <strong className="text-accent">12:00 AM EST</strong>, all unpaid earnings are automatically locked</li>
                  <li>• <strong className="text-yellow-300">SOL Conversion:</strong> Your USD earnings are converted to SOL at the price at 12:00 AM Sunday EST</li>
                  <li>• <strong className="text-white">Below $10 USD?</strong> Your earnings carry over to the next week until you reach the $10 minimum</li>
                  <li>• <strong className="text-accent">Payout Execution:</strong> Payouts are executed between <strong className="text-white">9:00 AM - 9:00 PM EST</strong> on Sunday</li>
                  <li>• <strong className="text-yellow-300">Matches not completed by 12:00 AM Sunday</strong> are included in the following week's payout</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}