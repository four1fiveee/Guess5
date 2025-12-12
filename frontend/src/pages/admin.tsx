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
  weekly: {
    matchesPlayed: number;
    totalEntryFeesUSD: number;
    totalPlatformFeeUSD: number;
    totalBonusUSD: number;
    totalSquadsCostUSD: number;
    totalGasCostUSD: number;
    netProfitUSD: number;
  };
  quarterly: {
    matchesPlayed: number;
    totalEntryFeesUSD: number;
    totalPlatformFeeUSD: number;
    totalBonusUSD: number;
    totalSquadsCostUSD: number;
    totalGasCostUSD: number;
    netProfitUSD: number;
  };
  yearly: {
    matchesPlayed: number;
    totalEntryFeesUSD: number;
    totalPlatformFeeUSD: number;
    totalBonusUSD: number;
    totalSquadsCostUSD: number;
    totalGasCostUSD: number;
    netProfitUSD: number;
  };
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

interface PayoutLockStatus {
  lock: {
    id: string;
    lockDate: string;
    lockedAt: string | null;
    executedAt: string | null;
    totalAmountUSD: number;
    totalAmountSOL: number;
    referrerCount: number;
    autoExecuted: boolean;
    transactionSignature: string | null;
  } | null;
  windows: {
    isLockWindow: boolean;
    isExecuteWindow: boolean;
    currentTimeEST: string;
  };
  countdown: {
    expiresAt: string;
    remainingSeconds: number;
    expired: boolean;
  } | null;
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
  const [payoutLockStatus, setPayoutLockStatus] = useState<PayoutLockStatus | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, token]);

  const loadDashboardData = async () => {
    if (!token) return;
    setLoadingData(true);
    try {
      const headers = { 'Authorization': `Bearer ${token}` };
      
      // Load all data in parallel
      const [healthRes, financialRes, walletRes, referralRes, lockStatusRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/health/status`, { headers }),
        fetch(`${API_URL}/api/admin/financial/metrics`, { headers }),
        fetch(`${API_URL}/api/admin/financial/fee-wallet-balance`, { headers }),
        fetch(`${API_URL}/api/admin/referrals/payout-execution`, { headers }),
        fetch(`${API_URL}/api/admin/referrals/payout-lock-status`, { headers }),
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

      if (lockStatusRes.ok) {
        const lockData = await lockStatusRes.json();
        setPayoutLockStatus(lockData);
        if (lockData.countdown && lockData.countdown.remainingSeconds > 0) {
          setCountdownSeconds(lockData.countdown.remainingSeconds);
        } else if (lockData.countdown && lockData.countdown.expired && lockData.lock && !lockData.lock.executedAt) {
          // Auto-execute if countdown expired - will be handled by useEffect
          setCountdownSeconds(0);
        }
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

  const handleDeleteMatch = async (matchId: string) => {
    if (!token) {
      alert('Not authenticated. Please log in again.');
      return;
    }

    if (!matchId || matchId.trim() === '') {
      alert('Please enter a valid Match ID');
      return;
    }

    if (!confirm(`Are you sure you want to delete match ${matchId}? This action cannot be undone.`)) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/admin/delete-match/${matchId}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || data.message || `Failed to delete match: ${response.status}`);
      }

      alert(`✅ Match deleted successfully!\n\nMatch ID: ${matchId}\n${data.message || ''}`);
      
      // Clear the input field
      const input = document.getElementById('matchIdInput') as HTMLInputElement;
      if (input) {
        input.value = '';
      }
    } catch (err: any) {
      const errorMsg = err.message || 'Failed to delete match';
      setError(errorMsg);
      alert(`❌ Error deleting match:\n\n${errorMsg}`);
    } finally {
      setLoading(false);
    }
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
      if (response.ok) {
        alert(`Success: ${data.message}\n\nYou have 2 hours to review and execute. After 2 hours, payout will auto-execute.`);
        loadDashboardData();
      } else {
        alert(`Error: ${data.error || 'Failed to lock referrals'}\n\n${data.note || ''}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message || 'Failed to lock referrals'}`);
    }
  };

  const handleExecutePayout = async () => {
    if (!token) return;
    if (!confirm('Are you sure you want to execute the payout? This will send funds to all locked referrers.')) {
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/admin/referrals/execute-payout`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      if (response.ok) {
        alert(`Success: ${data.message}\n\nBatch ID: ${data.batch.id}\nAmount: $${data.batch.totalAmountUSD.toFixed(2)} USD (${data.batch.totalAmountSOL.toFixed(6)} SOL)\n\n${data.transaction ? 'Transaction prepared. Please sign and send using the sendPayoutBatch endpoint.' : ''}`);
        loadDashboardData();
        setCountdownSeconds(null);
      } else {
        alert(`Error: ${data.error || 'Failed to execute payout'}\n\n${data.note || ''}`);
      }
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : 'Failed to execute payout'}`);
    }
  };

  // Countdown timer effect
  useEffect(() => {
    if (countdownSeconds !== null && countdownSeconds > 0) {
      const interval = setInterval(() => {
        setCountdownSeconds((prev) => {
          if (prev === null || prev <= 1) {
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [countdownSeconds]);

  // Auto-execute effect when countdown expires
  useEffect(() => {
    if (countdownSeconds === 0 && payoutLockStatus?.lock && !payoutLockStatus.lock.executedAt && payoutLockStatus.windows.isExecuteWindow) {
      handleExecutePayout();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownSeconds, payoutLockStatus]);

  const formatCountdown = (seconds: number | null): string => {
    if (seconds === null || seconds <= 0) return '00:00:00';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
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
                    <p className="text-white font-mono text-xs break-words overflow-wrap-anywhere">{feeWalletBalance.wallet}</p>
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
                    <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                      <span className="text-white/70">Total Entry Fees:</span>
                      <span className="text-white font-bold">${financialMetrics.weekly.totalEntryFeesUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Platform Fee (5%):</span>
                      <span className="text-green-400 font-bold">${financialMetrics.weekly.totalPlatformFeeUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Platform Bonus:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.weekly.totalBonusUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Squads Costs:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.weekly.totalSquadsCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Gas Costs:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.weekly.totalGasCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t-2 border-white/30 pt-2 mt-2">
                      <span className="text-white font-semibold">Net Profit:</span>
                      <span className={`font-bold text-lg ${financialMetrics.weekly.netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
                    <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                      <span className="text-white/70">Total Entry Fees:</span>
                      <span className="text-white font-bold">${financialMetrics.quarterly.totalEntryFeesUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Platform Fee (5%):</span>
                      <span className="text-green-400 font-bold">${financialMetrics.quarterly.totalPlatformFeeUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Platform Bonus:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.quarterly.totalBonusUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Squads Costs:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.quarterly.totalSquadsCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Gas Costs:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.quarterly.totalGasCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t-2 border-white/30 pt-2 mt-2">
                      <span className="text-white font-semibold">Net Profit:</span>
                      <span className={`font-bold text-lg ${financialMetrics.quarterly.netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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
                    <div className="flex justify-between border-t border-white/10 pt-1 mt-1">
                      <span className="text-white/70">Total Entry Fees:</span>
                      <span className="text-white font-bold">${financialMetrics.yearly.totalEntryFeesUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Platform Fee (5%):</span>
                      <span className="text-green-400 font-bold">${financialMetrics.yearly.totalPlatformFeeUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Platform Bonus:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.yearly.totalBonusUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Squads Costs:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.yearly.totalSquadsCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/70">Gas Costs:</span>
                      <span className="text-red-400 font-bold">-${financialMetrics.yearly.totalGasCostUSD.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between border-t-2 border-white/30 pt-2 mt-2">
                      <span className="text-white font-semibold">Net Profit:</span>
                      <span className={`font-bold text-lg ${financialMetrics.yearly.netProfitUSD >= 0 ? 'text-green-400' : 'text-red-400'}`}>
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

              {/* Auto-Lock Status */}
              {payoutLockStatus && (
                <div className="p-4 bg-blue-500/20 rounded-lg border border-blue-500/50">
                  <h3 className="text-lg font-bold text-white mb-2">Auto-Lock Status</h3>
                  {payoutLockStatus.lock ? (
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <span className="text-white/70">Auto-Locked At:</span>
                        <span className="text-white font-semibold">{new Date(payoutLockStatus.lock.lockDate).toLocaleDateString()} 12:00 AM EST</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/70">Amount Locked:</span>
                        <span className="text-white font-bold">${payoutLockStatus.lock.totalAmountUSD.toFixed(2)} USD ({payoutLockStatus.lock.totalAmountSOL.toFixed(6)} SOL)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-white/70">Eligible Referrers (≥$10 USD):</span>
                        <span className="text-white font-semibold">{payoutLockStatus.lock.referrerCount}</span>
                      </div>
                      <div className="mt-2 p-2 bg-white/5 rounded border border-white/10">
                        <p className="text-white/70 text-xs">
                          <strong className="text-white">Note:</strong> Only referrers with ≥$10 USD owed are included. Others carry over to next week.
                        </p>
                      </div>
                      {payoutLockStatus.lock.executedAt ? (
                        <div className="mt-3 p-2 bg-green-500/20 rounded border border-green-500/50">
                          <p className="text-green-300 font-semibold">✅ Payout Executed</p>
                          <p className="text-white/70 text-sm">Executed: {new Date(payoutLockStatus.lock.executedAt).toLocaleString()}</p>
                          {payoutLockStatus.lock.transactionSignature && (
                            <p className="text-white/70 text-xs font-mono break-all mt-1">Tx: {payoutLockStatus.lock.transactionSignature}</p>
                          )}
                        </div>
                      ) : (
                        <div className="mt-3 p-2 bg-yellow-500/20 rounded border border-yellow-500/50">
                          <p className="text-yellow-300 text-sm font-semibold">⏳ Ready to Execute</p>
                          <p className="text-white/70 text-xs mt-1">
                            Execute window: Sunday 9:00 AM - 9:00 PM EST
                          </p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="text-white/70">No auto-lock for this week yet</p>
                      <p className="text-white/50 text-sm mt-1">
                        Auto-lock happens automatically at 12:00 AM EST every Sunday
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Execute Button */}
              <div className="flex justify-end">
                <button
                  onClick={handleExecutePayout}
                  disabled={
                    !payoutLockStatus?.windows.isExecuteWindow || 
                    !payoutLockStatus?.lock || 
                    payoutLockStatus.lock.executedAt !== null
                  }
                  className={`px-6 py-2 rounded-lg transition-colors border ${
                    payoutLockStatus?.windows.isExecuteWindow && 
                    payoutLockStatus?.lock && 
                    !payoutLockStatus.lock.executedAt
                      ? 'bg-green-500/20 hover:bg-green-500/30 text-green-300 border-green-500/30 cursor-pointer'
                      : 'bg-gray-500/20 text-gray-400 border-gray-500/30 cursor-not-allowed'
                  }`}
                  title={
                    !payoutLockStatus?.windows.isExecuteWindow
                      ? 'Execute window is only available on Sunday between 9am-9pm EST'
                      : !payoutLockStatus?.lock
                      ? 'Auto-lock happens at 12:00 AM Sunday EST. Please wait for auto-lock.'
                      : payoutLockStatus.lock.executedAt
                      ? 'Payout already executed'
                      : 'Execute payout transaction'
                  }
                >
                  💰 Execute Payout
                </button>
              </div>
            </div>
          ) : (
            <p className="text-white/50">Loading referral payout data...</p>
          )}
        </div>

        {/* Match Management */}
        <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
          <h2 className="text-xl font-bold text-white mb-4">Match Management</h2>
          <div className="space-y-4">
            <div className="flex gap-3">
              <input
                type="text"
                id="matchIdInput"
                placeholder="Enter Match ID (e.g., 15dcfba1-b4a5-4896-b563-937fa04d45f5)"
                className="flex-1 px-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    const input = e.target as HTMLInputElement;
                    handleDeleteMatch(input.value);
                  }
                }}
              />
              <button
                onClick={() => {
                  const input = document.getElementById('matchIdInput') as HTMLInputElement;
                  if (input?.value) {
                    handleDeleteMatch(input.value);
                  } else {
                    alert('Please enter a Match ID');
                  }
                }}
                className="px-6 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-lg transition-colors border border-red-500/30 font-semibold"
              >
                🗑️ Delete Match
              </button>
            </div>
            <p className="text-white/50 text-sm">
              Enter a Match ID above and click Delete to remove it from the database. This is useful for cleaning up test matches.
            </p>
          </div>
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



