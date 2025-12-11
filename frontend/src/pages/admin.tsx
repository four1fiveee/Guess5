import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5-backend.onrender.com';

interface HealthStatus {
  vercel: { status: 'up' | 'down' | 'unknown'; lastChecked: string; url: string };
  render: { status: 'up' | 'down' | 'unknown'; lastChecked: string; url: string };
  overall: 'up' | 'down';
}

interface FinancialMetrics {
  weekly: any;
  quarterly: any;
  yearly: any;
}

interface FeeWalletBalance {
  wallet: string;
  balanceSOL: number;
  balanceUSD: number;
  solPriceUSD: number;
}

interface ReferralPayoutExecution {
  currentOwed: { totalUSD: number; totalSOL: number; count: number; breakdown: any[] };
  totalPaid: { totalUSD: number; totalSOL: number; count: number };
  historicalPayouts: any[];
}

export default function AdminPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<any>(null);
  
  // Dashboard data
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [financialMetrics, setFinancialMetrics] = useState<FinancialMetrics | null>(null);
  const [feeWalletBalance, setFeeWalletBalance] = useState<FeeWalletBalance | null>(null);
  const [referralPayoutExecution, setReferralPayoutExecution] = useState<ReferralPayoutExecution | null>(null);
  const [loadingData, setLoadingData] = useState(false);

  // Check if already authenticated on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('admin_token');
    if (savedToken) {
      checkAuthStatus(savedToken);
    }
  }, []);

  // Load dashboard data when authenticated
  useEffect(() => {
    if (authenticated && token) {
      loadDashboardData();
      // Refresh data every 30 seconds
      const interval = setInterval(loadDashboardData, 30000);
      return () => clearInterval(interval);
    }
  }, [authenticated, token]);

  const loadDashboardData = async () => {
    if (!token) return;
    setLoadingData(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      
      // Load all data in parallel
      const [healthRes, financialRes, walletRes, referralRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/health/status`, { headers }),
        fetch(`${API_URL}/api/admin/financial/metrics`, { headers }),
        fetch(`${API_URL}/api/admin/financial/fee-wallet-balance`, { headers }),
        fetch(`${API_URL}/api/admin/referrals/payout-execution`, { headers }),
      ]);

      if (healthRes.ok) {
        const healthData = await healthRes.json();
        setHealthStatus(healthData);
      }
      if (financialRes.ok) {
        const financialData = await financialRes.json();
        setFinancialMetrics(financialData);
      }
      if (walletRes.ok) {
        const walletData = await walletRes.json();
        setFeeWalletBalance(walletData);
      }
      if (referralRes.ok) {
        const referralData = await referralRes.json();
        setReferralPayoutExecution(referralData);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoadingData(false);
    }
  };

  const checkAuthStatus = async (tokenToCheck: string) => {
    try {
      const response = await fetch(`${API_URL}/api/admin/auth/status`, {
        headers: {
          'Authorization': `Bearer ${tokenToCheck}`,
        },
      });
      const data = await response.json();
      if (data.authenticated) {
        setToken(tokenToCheck);
        setAuthenticated(true);
        setAuthStatus(data);
      } else {
        localStorage.removeItem('admin_token');
      }
    } catch (err) {
      console.error('Auth check failed:', err);
      localStorage.removeItem('admin_token');
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/admin/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok && data.token) {
        localStorage.setItem('admin_token', data.token);
        setToken(data.token);
        setAuthenticated(true);
        await checkAuthStatus(data.token);
      } else {
        setError(data.error || 'Login failed');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('admin_token');
    setToken(null);
    setAuthenticated(false);
    setAuthStatus(null);
    setPassword('');
    setUsername('');
    setHealthStatus(null);
    setFinancialMetrics(null);
    setFeeWalletBalance(null);
    setReferralPayoutExecution(null);
  };

  const handleQuickAction = async (endpoint: string, actionName: string) => {
    if (!token) return;
    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
      alert(`${actionName}:\n\n${JSON.stringify(data, null, 2)}`);
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  const handleLockReferrals = async () => {
    if (!token) return;
    if (!confirm('Lock referrals for this week? This ensures referrals during payout review are tracked for next week.')) {
      return;
    }
    try {
      const response = await fetch(`${API_URL}/api/admin/referrals/lock-week`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await response.json();
      alert(`Success: ${data.message}`);
      loadDashboardData();
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    }
  };

  if (!authenticated) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
        <Head>
          <title>Admin Login - Guess5.io</title>
        </Head>
        <div className="bg-white/10 backdrop-blur-sm rounded-2xl p-8 w-full max-w-md border border-white/20 shadow-2xl">
          <h1 className="text-3xl font-bold text-white mb-2 text-center">Admin Dashboard</h1>
          <p className="text-white/70 text-sm text-center mb-6">Guess5.io Administration</p>
          
          {error && (
            <div className="bg-red-500/20 border border-red-500/50 rounded-lg p-3 mb-4">
              <p className="text-red-300 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="username" className="block text-white/80 text-sm mb-2">
                Username
              </label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                placeholder="Enter admin username"
                required
                disabled={loading}
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-white/80 text-sm mb-2">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20"
                placeholder="Enter admin password"
                required
                disabled={loading}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-accent hover:bg-yellow-400 text-primary font-bold py-3 px-6 rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-white/10">
            <p className="text-white/50 text-xs text-center">
              ⚠️ Authorized access only. All login attempts are logged.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 p-4">
      <Head>
        <title>Admin Dashboard - Guess5.io</title>
      </Head>
      
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-white mb-2">Admin Dashboard</h1>
              <p className="text-white/70 text-sm">
                {authStatus && <>IP: {authStatus.ip}</>}
                {loadingData && <span className="ml-4">🔄 Refreshing...</span>}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors border border-red-500/30"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Health Monitoring Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20">
          <h2 className="text-2xl font-bold text-white mb-4">System Health</h2>
          {healthStatus ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className={`p-4 rounded-lg border ${healthStatus.vercel.status === 'up' ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/70 text-sm">Vercel (Frontend)</p>
                    <p className="text-white font-bold text-lg">{healthStatus.vercel.status === 'up' ? '✅ Up' : '❌ Down'}</p>
                  </div>
                  <span className="text-white/50 text-xs">{healthStatus.vercel.url}</span>
                </div>
              </div>
              <div className={`p-4 rounded-lg border ${healthStatus.render.status === 'up' ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/70 text-sm">Render (Backend)</p>
                    <p className="text-white font-bold text-lg">{healthStatus.render.status === 'up' ? '✅ Up' : '❌ Down'}</p>
                  </div>
                  <span className="text-white/50 text-xs">{healthStatus.render.url}</span>
                </div>
              </div>
              <div className={`p-4 rounded-lg border ${healthStatus.overall === 'up' ? 'bg-green-500/20 border-green-500/50' : 'bg-red-500/20 border-red-500/50'}`}>
                <div>
                  <p className="text-white/70 text-sm">Overall Status</p>
                  <p className="text-white font-bold text-lg">{healthStatus.overall === 'up' ? '✅ All Systems Operational' : '❌ Issues Detected'}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-white/50">Loading health status...</p>
          )}
        </div>

        {/* Operations Section - Financial Metrics */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20">
          <h2 className="text-2xl font-bold text-white mb-4">Operations - Financial Metrics</h2>
          {financialMetrics && feeWalletBalance ? (
            <div className="space-y-6">
              {/* Fee Wallet Balance */}
              <div className="p-4 bg-purple-500/20 rounded-lg border border-purple-500/50">
                <h3 className="text-lg font-bold text-white mb-2">Fee Wallet Balance</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-white/70 text-sm">SOL Balance</p>
                    <p className="text-white font-bold text-xl">{feeWalletBalance.balanceSOL.toFixed(6)} SOL</p>
                  </div>
                  <div>
                    <p className="text-white/70 text-sm">USD Value</p>
                    <p className="text-white font-bold text-xl">${feeWalletBalance.balanceUSD.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-white/70 text-sm">SOL Price</p>
                    <p className="text-white font-bold text-xl">${feeWalletBalance.solPriceUSD.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-white/70 text-sm">Wallet</p>
                    <p className="text-white font-mono text-xs break-all">{feeWalletBalance.wallet}</p>
                  </div>
                </div>
              </div>

              {/* Financial Breakdown */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Weekly */}
                <div className="p-4 bg-blue-500/20 rounded-lg border border-blue-500/50">
                  <h3 className="text-lg font-bold text-white mb-3">This Week</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/70">Matches Played:</span>
                      <span className="text-white font-bold">{financialMetrics.weekly.matchesPlayed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Entry Fees:</span>
                      <span className="text-white font-bold">${financialMetrics.weekly.totalEntryFeesUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Payouts:</span>
                      <span className="text-white font-bold">${financialMetrics.weekly.totalPayoutsUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Bonus:</span>
                      <span className="text-white font-bold">${financialMetrics.weekly.totalBonusUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/20 pt-2 mt-2">
                      <span className="text-white font-semibold">Net Profit:</span>
                      <span className={`font-bold ${financialMetrics.weekly.netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${financialMetrics.weekly.netProfitUSD.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Quarterly */}
                <div className="p-4 bg-green-500/20 rounded-lg border border-green-500/50">
                  <h3 className="text-lg font-bold text-white mb-3">This Quarter</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/70">Matches Played:</span>
                      <span className="text-white font-bold">{financialMetrics.quarterly.matchesPlayed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Entry Fees:</span>
                      <span className="text-white font-bold">${financialMetrics.quarterly.totalEntryFeesUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Payouts:</span>
                      <span className="text-white font-bold">${financialMetrics.quarterly.totalPayoutsUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Bonus:</span>
                      <span className="text-white font-bold">${financialMetrics.quarterly.totalBonusUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/20 pt-2 mt-2">
                      <span className="text-white font-semibold">Net Profit:</span>
                      <span className={`font-bold ${financialMetrics.quarterly.netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${financialMetrics.quarterly.netProfitUSD.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Yearly */}
                <div className="p-4 bg-yellow-500/20 rounded-lg border border-yellow-500/50">
                  <h3 className="text-lg font-bold text-white mb-3">Year to Date</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/70">Matches Played:</span>
                      <span className="text-white font-bold">{financialMetrics.yearly.matchesPlayed}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Entry Fees:</span>
                      <span className="text-white font-bold">${financialMetrics.yearly.totalEntryFeesUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Payouts:</span>
                      <span className="text-white font-bold">${financialMetrics.yearly.totalPayoutsUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Bonus:</span>
                      <span className="text-white font-bold">${financialMetrics.yearly.totalBonusUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t border-white/20 pt-2 mt-2">
                      <span className="text-white font-semibold">Net Profit:</span>
                      <span className={`font-bold ${financialMetrics.yearly.netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        ${financialMetrics.yearly.netProfitUSD.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-white/50">Loading financial metrics...</p>
          )}
        </div>

        {/* Referral Payout Execution Section */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 mb-6 border border-white/20">
          <h2 className="text-2xl font-bold text-white mb-4">Referral Payout Execution</h2>
          {referralPayoutExecution ? (
            <div className="space-y-6">
              {/* Current Status */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 bg-orange-500/20 rounded-lg border border-orange-500/50">
                  <h3 className="text-lg font-bold text-white mb-2">Current Amount Owed</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-white/70">Total USD:</span>
                      <span className="text-white font-bold text-xl">${referralPayoutExecution.currentOwed.totalUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Total SOL:</span>
                      <span className="text-white font-bold">{referralPayoutExecution.currentOwed.totalSOL.toFixed(6)} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Referrers:</span>
                      <span className="text-white font-bold">{referralPayoutExecution.currentOwed.count}</span>
                    </div>
                  </div>
                </div>
                <div className="p-4 bg-green-500/20 rounded-lg border border-green-500/50">
                  <h3 className="text-lg font-bold text-white mb-2">Total Paid (All Time)</h3>
                  <div className="space-y-1">
                    <div className="flex justify-between">
                      <span className="text-white/70">Total USD:</span>
                      <span className="text-white font-bold text-xl">${referralPayoutExecution.totalPaid.totalUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Total SOL:</span>
                      <span className="text-white font-bold">{referralPayoutExecution.totalPaid.totalSOL.toFixed(6)} SOL</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Referrers:</span>
                      <span className="text-white font-bold">{referralPayoutExecution.totalPaid.count}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Historical Payouts */}
              <div>
                <h3 className="text-lg font-bold text-white mb-3">Historical Payouts</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {referralPayoutExecution.historicalPayouts.length > 0 ? (
                    referralPayoutExecution.historicalPayouts.map((batch: any) => (
                      <div key={batch.id} className="p-3 bg-white/5 rounded-lg border border-white/10">
                        <div className="flex justify-between items-center">
                          <div>
                            <p className="text-white font-semibold">Batch {batch.id}</p>
                            <p className="text-white/70 text-sm">
                              {batch.executedAt ? new Date(batch.executedAt).toLocaleDateString() : 'Pending'}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-white font-bold">${batch.totalAmountUSD.toFixed(2)}</p>
                            <p className="text-white/70 text-sm">{batch.recipientCount} recipients</p>
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-white/50">No historical payouts yet</p>
                  )}
                </div>
              </div>

              {/* Lock Referrals Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleLockReferrals}
                  className="px-6 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors border border-purple-500/30"
                >
                  🔒 Lock Referrals for Week
                </button>
              </div>
            </div>
          ) : (
            <p className="text-white/50">Loading referral payout data...</p>
          )}
        </div>

        {/* Quick Actions */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
          <h2 className="text-xl font-bold text-white mb-4">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <button
              onClick={() => handleQuickAction('/api/admin/referrals/owed', 'Owed Referrals')}
              className="px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors border border-purple-500/30"
            >
              View Owed Referrals
            </button>
            <button
              onClick={() => handleQuickAction('/api/admin/payouts/batches', 'Payout Batches')}
              className="px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded-lg transition-colors border border-green-500/30"
            >
              View Payout Batches
            </button>
            <button
              onClick={() => handleQuickAction('/api/admin/locks/stats', 'Lock Statistics')}
              className="px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors border border-blue-500/30"
            >
              Lock Statistics
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
