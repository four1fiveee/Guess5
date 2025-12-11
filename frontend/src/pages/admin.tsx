import { useState, useEffect } from 'react';
import Head from 'next/head';
import { useRouter } from 'next/router';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'https://guess5-backend.onrender.com';
// Admin dashboard URL: https://guess5.io/admin (or https://guess5.vercel.app/admin)

export default function AdminPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [authStatus, setAuthStatus] = useState<any>(null);

  // Check if already authenticated on mount
  useEffect(() => {
    const savedToken = localStorage.getItem('admin_token');
    if (savedToken) {
      checkAuthStatus(savedToken);
    }
  }, []);

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
                {authStatus && (
                  <>
                    IP: {authStatus.ip} • 
                    {authStatus.ipWhitelisted === 'all' ? ' All IPs allowed' : ` IP Whitelisted: ${authStatus.ipWhitelisted ? 'Yes' : 'No'}`}
                  </>
                )}
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

        {/* Dashboard Content */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Quick Links */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">Quick Actions</h2>
            <div className="space-y-3">
              <a
                href={`${API_URL}/api/admin/referrals/owed`}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 rounded-lg transition-colors border border-purple-500/30"
              >
                View Owed Referrals
              </a>
              <a
                href={`${API_URL}/api/admin/payouts/batches`}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-2 bg-green-500/20 hover:bg-green-500/30 text-green-300 rounded-lg transition-colors border border-green-500/30"
              >
                View Payout Batches
              </a>
              <a
                href={`${API_URL}/api/admin/locks/stats`}
                target="_blank"
                rel="noopener noreferrer"
                className="block px-4 py-2 bg-blue-500/20 hover:bg-blue-500/30 text-blue-300 rounded-lg transition-colors border border-blue-500/30"
              >
                Lock Statistics
              </a>
            </div>
          </div>

          {/* Info Card */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">System Status</h2>
            <div className="space-y-2 text-white/80">
              <p>✅ Authenticated</p>
              <p>🔒 Admin Access Active</p>
              <p>⏰ Token expires in 24h</p>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
            <h2 className="text-xl font-bold text-white mb-4">Usage</h2>
            <p className="text-white/70 text-sm mb-4">
              Use the API endpoints directly or integrate with your local dashboard.
              All requests require the Authorization header:
            </p>
            <code className="block bg-black/30 p-2 rounded text-xs text-white/80 break-all">
              Authorization: Bearer {token?.substring(0, 20)}...
            </code>
          </div>
        </div>

        {/* API Testing Section */}
        <div className="mt-6 bg-white/10 backdrop-blur-sm rounded-xl p-6 border border-white/20">
          <h2 className="text-xl font-bold text-white mb-4">API Test</h2>
          <p className="text-white/70 text-sm mb-4">
            Test admin endpoints. Token is automatically included in requests.
          </p>
          <div className="space-y-2">
            <button
              onClick={async () => {
                try {
                  const response = await fetch(`${API_URL}/api/admin/referrals/owed`, {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });
                  const data = await response.json();
                  alert(JSON.stringify(data, null, 2));
                } catch (err: any) {
                  alert('Error: ' + err.message);
                }
              }}
              className="px-4 py-2 bg-accent hover:bg-yellow-400 text-primary font-semibold rounded-lg transition-colors"
            >
              Test: Get Owed Referrals
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

