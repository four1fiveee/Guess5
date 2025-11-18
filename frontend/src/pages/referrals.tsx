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
          <div className="flex flex-col sm:flex-row gap-3 mb-3">
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
          <div className="flex gap-3 flex-wrap">
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

        {/* How Referrals Work */}
        <div className="how-it-works bg-gradient-to-br from-purple-500/20 via-pink-500/10 to-purple-500/20 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mt-6 shadow-xl border border-purple-500/30 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-6">💰 How It Works</h2>
          
          <div className="space-y-5 text-white/90 text-sm">
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3">Earning Structure</h3>
              <p className="text-white/80 mb-3 leading-relaxed">
                When someone uses your referral link and plays a match, you earn from fees generated by <strong className="text-white">their wallet's activity</strong>. The referral pool is <strong className="text-white">25% of the match's net profit</strong> (Platform Fee - Bonus - Network Costs).
              </p>
              <p className="text-white/80 mb-4 leading-relaxed">
                This pool is split equally between the two players in the match. Each player's share flows up their referral chain, meaning you earn from <strong className="text-white">half of the match's net profit</strong> (12.5% total) when your referred player is involved, since both players can have referrers.
              </p>
              <p className="text-white/80 mb-4 leading-relaxed">
                Earnings flow up to 3 levels with geometric decay:
              </p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="bg-accent/20 border border-accent/40 rounded-lg p-3 text-center">
                  <div className="text-xl font-black text-accent mb-1">L1</div>
                  <div className="text-xs text-white/90 font-semibold">100%</div>
                  <div className="text-xs text-white/70 mt-1">Direct referral</div>
                </div>
                <div className="bg-purple-500/20 border border-purple-500/40 rounded-lg p-3 text-center">
                  <div className="text-xl font-black text-purple-400 mb-1">L2</div>
                  <div className="text-xs text-white/90 font-semibold">25%</div>
                  <div className="text-xs text-white/70 mt-1">Your referral's referral</div>
                </div>
                <div className="bg-pink-500/20 border border-pink-500/40 rounded-lg p-3 text-center">
                  <div className="text-xl font-black text-pink-400 mb-1">L3</div>
                  <div className="text-xs text-white/90 font-semibold">6.25%</div>
                  <div className="text-xs text-white/70 mt-1">3rd level down</div>
                </div>
              </div>
            </div>

            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-lg font-bold text-accent mb-3">Requirements & Payouts</h3>
              <ul className="space-y-2 text-white/80 text-sm leading-relaxed">
                <li>• Play at least <strong className="text-white">one match</strong> to become eligible for referral payouts</li>
                <li>• Minimum payout: <strong className="text-accent">$20 USD</strong> (earnings accumulate until you reach this threshold)</li>
                <li>• Payouts: <strong className="text-white">Every Sunday at 1:00 PM EST</strong> via batched on-chain transactions</li>
                <li>• USD amounts are converted to SOL at payout time using current market rates</li>
                <li>• All eligible earnings are automatically included in the next payout batch once you meet the minimum</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Examples Section */}
        <div className="examples bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mt-6 shadow-xl border border-white/20 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-6">📊 Examples</h2>
          
          <div className="space-y-5 text-white/90 text-sm">
            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-base font-bold text-accent mb-3">Example 1: $20 Match</h3>
              <p className="text-white/80 mb-3 leading-relaxed">
                A $20 match completes with a net profit of $5 (after bonuses and network costs). The referral pool is 25% of $5 = <strong className="text-white">$1.25</strong>.
              </p>
              <p className="text-white/80 mb-3 leading-relaxed">
                This $1.25 is split equally: <strong className="text-white">$0.625 per player</strong>. If Player A was referred by you (L1), you earn <strong className="text-accent">$0.625</strong>. If Player A's referrer was referred by you (L2), you earn <strong className="text-purple-300">$0.156</strong> (25% of $0.625).
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-base font-bold text-accent mb-3">Example 2: Both Players Have Referrers</h3>
              <p className="text-white/80 mb-3 leading-relaxed">
                In a $50 match with $10 net profit, the referral pool is <strong className="text-white">$2.50</strong> (25% of $10). Each player's share is <strong className="text-white">$1.25</strong>.
              </p>
              <p className="text-white/80 mb-3 leading-relaxed">
                If you referred Player A (L1) and someone else referred Player B (L1), you earn <strong className="text-accent">$1.25</strong> from Player A's activity, while Player B's referrer earns $1.25 from Player B's activity. Both referrers get their share independently.
              </p>
            </div>

            <div className="bg-white/5 rounded-xl p-5 border border-white/10">
              <h3 className="text-base font-bold text-accent mb-3">Example 3: Multi-Level Chain</h3>
              <p className="text-white/80 mb-3 leading-relaxed">
                You refer Alice (L1), Alice refers Bob (L2), and Bob refers Charlie (L3). When Charlie plays a $100 match with $20 net profit:
              </p>
              <ul className="list-disc list-inside space-y-1.5 text-white/80 ml-2 mt-2">
                <li>Referral pool: <strong className="text-white">$5.00</strong> (25% of $20)</li>
                <li>Charlie's share: <strong className="text-white">$2.50</strong> (half of $5)</li>
                <li>You (L3): <strong className="text-pink-300">$0.156</strong> (6.25% of $2.50)</li>
                <li>Alice (L2): <strong className="text-purple-300">$0.625</strong> (25% of $2.50)</li>
                <li>Bob (L1): <strong className="text-accent">$2.50</strong> (100% of $2.50)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="terms bg-gradient-to-br from-white/10 via-white/5 to-white/10 backdrop-blur-sm rounded-2xl p-6 sm:p-8 mt-6 shadow-xl border border-white/20 w-full">
          <h2 className="text-xl sm:text-2xl font-bold text-accent mb-4">Frequently Asked Questions</h2>
          <div className="space-y-4 text-white/80 text-sm">
            <div>
              <strong className="text-white">Can I refer myself?</strong>
              <p className="mt-1.5 text-white/70 leading-relaxed">No, self-referrals are automatically prevented by the system. Each wallet can only be referred once, and you cannot refer your own wallet.</p>
            </div>
            <div>
              <strong className="text-white">What if I haven't played a match yet?</strong>
              <p className="mt-1.5 text-white/70 leading-relaxed">You can still refer players and they can use your link, but you won't receive payouts until you've played at least one match. Once you play, all accumulated earnings become eligible for payout.</p>
            </div>
            <div>
              <strong className="text-white">How are USD amounts converted to SOL?</strong>
              <p className="mt-1.5 text-white/70 leading-relaxed">Conversion happens at payout time using current market rates from a reliable price oracle. The exact SOL amount you receive may vary slightly based on SOL price fluctuations between when earnings were calculated and when the payout occurs.</p>
            </div>
            <div>
              <strong className="text-white">What happens if both players in a match have referrers?</strong>
              <p className="mt-1.5 text-white/70 leading-relaxed">The referral pool is split equally between the two players. Each player's share (50% of the pool) flows up their own referral chain independently. This means both referrers can earn from the same match, each from their own referred player's activity.</p>
            </div>
            <div>
              <strong className="text-white">How do I track my earnings?</strong>
              <p className="mt-1.5 text-white/70 leading-relaxed">All your earnings, referral statistics, and payout history are displayed on this dashboard. You can see earnings broken down by level and by referred wallet, plus view all historical payouts.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

