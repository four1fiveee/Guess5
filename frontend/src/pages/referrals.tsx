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
}

interface EarningsBreakdown {
  byLevel: Array<{ level: number; totalUSD: number; count: number }>;
  byReferredWallet: Array<{ referredWallet: string; totalUSD: number; count: number }>;
}

interface PayoutHistory {
  date: Date;
  amountUSD: number;
  amountSOL?: number;
  level: number;
  transactionSignature?: string;
}

export default function ReferralsPage() {
  const { publicKey } = useWallet();
  const [wallet, setWallet] = useState<string>('');
  const [stats, setStats] = useState<ReferralStats | null>(null);
  const [breakdown, setBreakdown] = useState<EarningsBreakdown | null>(null);
  const [isEligible, setIsEligible] = useState<boolean>(false);
  const [nextPayoutDate, setNextPayoutDate] = useState<Date | null>(null);
  const [payoutHistory, setPayoutHistory] = useState<PayoutHistory[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [referralLink, setReferralLink] = useState<string>('');

  useEffect(() => {
    // Get wallet from connected wallet or query params
    const walletAddress = publicKey?.toString() || '';
    
    if (walletAddress) {
      setWallet(walletAddress);
      setReferralLink(`${window.location.origin}?ref=${walletAddress}`);
      loadDashboardData(walletAddress);
    }
  }, [publicKey]);

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
        setNextPayoutDate(data.nextPayoutDate ? new Date(data.nextPayoutDate) : null);
        setPayoutHistory(data.payoutHistory || []);
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
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
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
          <title>Referrals - Guess5</title>
        </Head>
        <div className="flex flex-col items-center max-w-4xl w-full mt-8">
          <div className="logo-shell mb-4 sm:mb-6">
            <Image src={logo} alt="Guess5 Logo" width={100} height={100} priority />
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-6 text-center">Referrals</h1>
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

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary px-4 sm:px-6 relative">
      <TopRightWallet />
      <Head>
        <title>Referrals - Guess5</title>
      </Head>
      <div className="flex flex-col items-center max-w-4xl w-full mt-8">
        <div className="logo-shell mb-4 sm:mb-6">
          <Image src={logo} alt="Guess5 Logo" width={100} height={100} priority />
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold text-accent mb-6 text-center">Earn when your friends play</h1>
        
        {/* Referral Summary Card */}
        <div className="referral-summary bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Referral Summary</h2>
          {loading ? (
            <p>Loading...</p>
          ) : stats ? (
            <div className="space-y-3 text-white/90">
              <div className="flex justify-between items-center">
                <span className="font-semibold">Total Earned:</span>
                <span className="text-accent font-bold text-lg">{formatUSD(stats.totalEarnedUSD)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold">Available to Payout:</span>
                <span className="text-green-400 font-bold text-lg">{formatUSD(stats.pendingUSD)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="font-semibold">Paid:</span>
                <span className="text-white/70">{formatUSD(stats.paidUSD)}</span>
              </div>
              {nextPayoutDate && (
                <div className="flex justify-between items-center pt-2 border-t border-white/20">
                  <span className="font-semibold">Next Payout:</span>
                  <span className="text-white/80">{formatDate(nextPayoutDate)}</span>
                </div>
              )}
              {!isEligible && (
                <div className="bg-yellow-500/20 border border-yellow-500/30 rounded-lg p-3 mt-4">
                  <p className="text-yellow-400 text-sm">⚠️ Play your first match to start earning referral rewards!</p>
                </div>
              )}
            </div>
          ) : (
            <p>No data available</p>
          )}
        </div>

        {/* Share Link */}
        <div className="share-link bg-gradient-to-br from-purple-500/20 via-pink-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-purple-500/30 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Your Referral Link</h2>
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <input 
              type="text" 
              value={referralLink} 
              readOnly 
              className="flex-1 px-4 py-3 rounded-xl bg-white/10 border border-white/20 text-white/90 focus:outline-none focus:border-accent/50"
            />
            <button 
              onClick={copyReferralLink} 
              className="px-6 py-3 bg-accent hover:bg-yellow-300 text-primary font-bold rounded-xl transition-all duration-300 transform hover:scale-105 active:scale-95"
            >
              Copy Link
            </button>
          </div>
          <div className="flex gap-3 flex-wrap mb-4">
            <a
              href={`https://twitter.com/intent/tweet?text=Check out Guess5.io - a fun word game on Solana!&url=${encodeURIComponent(referralLink)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Share on Twitter
            </a>
            <button
              onClick={() => navigator.share?.({ title: 'Guess5.io', text: 'Check out this fun word game!', url: referralLink })}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg transition-colors text-sm font-medium"
            >
              Share
            </button>
          </div>
          <p className="text-sm text-white/70">
            Share this link — every person who signs up and plays using your link will credit you. 
            You'll earn a share of the net fee. Payouts: weekly Sunday 1pm EST, min $20 USD.
          </p>
        </div>

        {/* Referral Funnel */}
        {stats && (
          <div className="referral-funnel bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
            <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Referral Funnel</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-white/5 rounded-xl p-4 text-center border border-white/10">
                <div className="text-3xl font-bold text-accent mb-2">{stats.referredCount}</div>
                <div className="text-white/80 text-sm">Referred Wallets</div>
              </div>
              <div className="bg-white/5 rounded-xl p-4 text-center border border-white/10">
                <div className="text-3xl font-bold text-green-400 mb-2">{stats.activeReferredCount}</div>
                <div className="text-white/80 text-sm">Active (Played)</div>
              </div>
              <div className="bg-white/5 rounded-xl p-4 text-center border border-white/10">
                <div className="text-3xl font-bold text-purple-400 mb-2">{stats.eligibleReferredCount}</div>
                <div className="text-white/80 text-sm">Eligible</div>
              </div>
            </div>
          </div>
        )}

        {/* Earnings Breakdown */}
        {breakdown && (
          <div className="earnings-breakdown bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
            <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Earnings Breakdown</h2>
            <h3 className="text-lg font-semibold text-white/90 mb-3">By Level</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left py-3 px-4 text-white/90 font-semibold">Level</th>
                    <th className="text-right py-3 px-4 text-white/90 font-semibold">Total USD</th>
                    <th className="text-right py-3 px-4 text-white/90 font-semibold">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.byLevel.map(item => (
                    <tr key={item.level} className="border-b border-white/10 hover:bg-white/5">
                      <td className="py-3 px-4 text-accent font-bold">L{item.level}</td>
                      <td className="py-3 px-4 text-right text-white/90">{formatUSD(item.totalUSD)}</td>
                      <td className="py-3 px-4 text-right text-white/70">{item.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Payout History */}
        {payoutHistory.length > 0 && (
          <div className="payout-history bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mb-6 shadow-xl border border-white/20 w-full">
            <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Payout History</h2>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/20">
                    <th className="text-left py-3 px-4 text-white/90 font-semibold">Date</th>
                    <th className="text-right py-3 px-4 text-white/90 font-semibold">Amount</th>
                    <th className="text-center py-3 px-4 text-white/90 font-semibold">Level</th>
                    <th className="text-center py-3 px-4 text-white/90 font-semibold">Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {payoutHistory.map((payout, idx) => (
                    <tr key={idx} className="border-b border-white/10 hover:bg-white/5">
                      <td className="py-3 px-4 text-white/80 text-sm">{formatDate(payout.date)}</td>
                      <td className="py-3 px-4 text-right text-green-400 font-semibold">{formatUSD(payout.amountUSD)}</td>
                      <td className="py-3 px-4 text-center text-accent font-bold">L{payout.level}</td>
                      <td className="py-3 px-4 text-center">
                        {payout.transactionSignature ? (
                          <a 
                            href={`https://solscan.io/tx/${payout.transactionSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent hover:text-yellow-300 underline"
                          >
                            View
                          </a>
                        ) : (
                          <span className="text-white/50">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* How Referrals Work - Detailed Explanation */}
        <div className="how-it-works bg-gradient-to-br from-purple-500/20 via-pink-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mt-6 shadow-xl border border-purple-500/30 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-6">💰 How the Referral Program Works</h2>
          
          <div className="space-y-6 text-white/90">
            {/* Step 1 */}
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
                <span className="bg-accent text-primary rounded-full w-8 h-8 flex items-center justify-center text-sm font-black">1</span>
                Referral Pool Calculation
              </h3>
              <p className="text-sm leading-relaxed mb-2">
                For every completed match, Guess5 calculates the <strong className="text-white">net profit</strong>:
              </p>
              <div className="bg-black/30 rounded-lg p-4 mb-3 font-mono text-xs">
                <div className="text-white/80 mb-1">Net Profit = Platform Fee - Bonus - Squads Network Costs</div>
                <div className="text-accent mt-2">Referral Pool = 25% of Net Profit</div>
              </div>
              <p className="text-sm text-white/70">
                The referral pool is split equally between the two players in the match. Each player's activity generates a <strong className="text-white">per-player share</strong> that flows up their referral chain.
              </p>
            </div>

            {/* Step 2 */}
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
                <span className="bg-accent text-primary rounded-full w-8 h-8 flex items-center justify-center text-sm font-black">2</span>
                Multi-Level Earnings (Geometric Decay)
              </h3>
              <p className="text-sm leading-relaxed mb-3">
                When someone you referred (or someone in your referral chain) plays a match, earnings flow up to 3 levels:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div className="bg-accent/20 border border-accent/40 rounded-lg p-3 text-center">
                  <div className="text-2xl font-black text-accent mb-1">L1</div>
                  <div className="text-xs text-white/90">100% of per-player share</div>
                  <div className="text-xs text-white/70 mt-1">Direct referral</div>
                </div>
                <div className="bg-purple-500/20 border border-purple-500/40 rounded-lg p-3 text-center">
                  <div className="text-2xl font-black text-purple-400 mb-1">L2</div>
                  <div className="text-xs text-white/90">25% of L1</div>
                  <div className="text-xs text-white/70 mt-1">Your referral's referral</div>
                </div>
                <div className="bg-pink-500/20 border border-pink-500/40 rounded-lg p-3 text-center">
                  <div className="text-2xl font-black text-pink-400 mb-1">L3</div>
                  <div className="text-xs text-white/90">25% of L2</div>
                  <div className="text-xs text-white/70 mt-1">3rd level down</div>
                </div>
              </div>
              <div className="bg-black/30 rounded-lg p-3 font-mono text-xs">
                <div className="text-white/80">Example: If per-player share = $10</div>
                <div className="text-accent mt-1">L1 earns: $10.00</div>
                <div className="text-purple-400 mt-1">L2 earns: $2.50 (25% of $10)</div>
                <div className="text-pink-400 mt-1">L3 earns: $0.63 (25% of $2.50)</div>
              </div>
            </div>

            {/* Step 3 */}
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
                <span className="bg-accent text-primary rounded-full w-8 h-8 flex items-center justify-center text-sm font-black">3</span>
                Eligibility Requirements
              </h3>
              <p className="text-sm leading-relaxed mb-2">
                To receive referral payouts, you must:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-white/80 ml-4">
                <li>Have played at least <strong className="text-white">one match</strong> (any entry fee level)</li>
                <li>Have referred players who have also played matches</li>
                <li>Accumulate at least <strong className="text-accent">$20 USD</strong> in pending earnings</li>
              </ul>
            </div>

            {/* Step 4 */}
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
                <span className="bg-accent text-primary rounded-full w-8 h-8 flex items-center justify-center text-sm font-black">4</span>
                Weekly Payout Schedule
              </h3>
              <p className="text-sm leading-relaxed mb-2">
                Referral earnings are paid out weekly:
              </p>
              <ul className="list-disc list-inside space-y-1 text-sm text-white/80 ml-4">
                <li><strong className="text-white">Schedule:</strong> Every Sunday at 1:00 PM EST</li>
                <li><strong className="text-white">Minimum:</strong> $20 USD equivalent in SOL</li>
                <li><strong className="text-white">Method:</strong> Batched on-chain transactions</li>
                <li><strong className="text-white">Conversion:</strong> USD amounts converted to SOL at payout time using current market rates</li>
              </ul>
              <p className="text-sm text-white/70 mt-3">
                Earnings below $20 accumulate until you reach the minimum threshold. All eligible earnings are automatically included in the next payout batch.
              </p>
            </div>

            {/* Step 5 */}
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3 flex items-center gap-2">
                <span className="bg-accent text-primary rounded-full w-8 h-8 flex items-center justify-center text-sm font-black">5</span>
                How to Start Earning
              </h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-white/80 ml-4">
                <li>Play your first match to become eligible</li>
                <li>Share your referral link (found above) with friends</li>
                <li>When they sign up using your link and play matches, you earn a percentage of the net fees</li>
                <li>Earnings accumulate in your account and are paid out weekly if you meet the $20 minimum</li>
                <li>You can track all your earnings, referrals, and payout history on this dashboard</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Terms & FAQ */}
        <div className="terms bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mt-6 shadow-xl border border-white/20 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Terms & FAQ</h2>
          <div className="space-y-4 text-white/80 text-sm">
            <div>
              <strong className="text-white">Q: How is the referral pool calculated?</strong>
              <p className="mt-1 text-white/70">
                The referral pool is 25% of the match's net profit. Net profit = Platform Fee - Bonus Amount - Squads Network Costs. This pool is split equally between the two players, and each player's share flows up their referral chain.
              </p>
            </div>
            <div>
              <strong className="text-white">Q: What happens if I haven't played a match yet?</strong>
              <p className="mt-1 text-white/70">
                You can still refer players, but you won't receive payouts until you've played at least one match. Once you play, all accumulated earnings become eligible for payout.
              </p>
            </div>
            <div>
              <strong className="text-white">Q: Can I refer myself?</strong>
              <p className="mt-1 text-white/70">
                No, self-referrals are not allowed. The system automatically prevents this.
              </p>
            </div>
            <div>
              <strong className="text-white">Q: What if my earnings are less than $20?</strong>
              <p className="mt-1 text-white/70">
                Earnings below $20 accumulate in your account. Once you reach $20 or more, you'll be included in the next weekly payout batch.
              </p>
            </div>
            <div>
              <strong className="text-white">Q: How are payouts converted from USD to SOL?</strong>
              <p className="mt-1 text-white/70">
                At payout time, your USD earnings are converted to SOL using the current market rate. The exact SOL amount you receive may vary based on SOL price fluctuations between when earnings were calculated and when the payout occurs.
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-4 mt-8 mb-8">
          <Link href="/">
            <button className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white font-semibold rounded-xl transition-all duration-300 border border-white/20">
              ← Back to Home
            </button>
          </Link>
          <Link href="/lobby">
            <button className="px-6 py-3 bg-accent hover:bg-yellow-300 text-primary font-bold rounded-xl transition-all duration-300 transform hover:scale-105">
              Play Now
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}

