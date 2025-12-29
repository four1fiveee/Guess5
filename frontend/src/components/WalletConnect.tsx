import React, { useState, useEffect } from 'react';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { LegalDisclaimer } from './LegalDisclaimer';
import { useWalletBalanceSSE } from '../hooks/useWalletBalanceSSE';
import { getUsername, setUsername, checkUsernameAvailability } from '../utils/api';

export const WalletConnectButton: React.FC = () => {
  const { publicKey, connect, disconnect, connected }: WalletContextState = useWallet();
  const { setVisible } = useWalletModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLegalDisclaimer, setShowLegalDisclaimer] = useState(false);

  // Use SSE for real-time wallet balance updates
  const { balance: walletBalance, isConnected: sseConnected, error: sseError, refreshBalance } = useWalletBalanceSSE(
    publicKey?.toString() || null
  );

  const handleConnect = async () => {
    // Show legal disclaimer first
    setShowLegalDisclaimer(true);
  };

  const handleLegalAccept = async () => {
    setShowLegalDisclaimer(false);
    
    // Prevent multiple simultaneous executions
    if (isProcessing) {
      console.log('Already processing wallet connection, ignoring...');
      return;
    }

    console.log('Attempting to connect wallet...');
    setIsProcessing(true);
    
    try {
      if (typeof window === 'undefined') {
        console.error('Window is undefined (SSR)');
        alert('Cannot connect in server-side rendering');
        return;
      }

      // Directly show wallet selection modal (bot protection handled by backend)
      console.log('Opening wallet selection modal...');
      setVisible(true);
    } finally {
      // Reset the processing flag after a short delay
      setTimeout(() => {
        setIsProcessing(false);
      }, 500);
    }
  };

  const handleLegalDecline = () => {
    setShowLegalDisclaimer(false);
  };

  return (
    <div className="flex flex-col items-center mb-4">
      <button
        className={`px-8 py-3 rounded-lg font-bold transition-colors shadow ${
          connected
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-accent text-primary hover:bg-yellow-400'
        } ${isProcessing ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={connected ? disconnect : handleConnect}
        disabled={isProcessing}
      >
        {connected
          ? `Disconnect (${publicKey?.toString().slice(0, 4)}...${publicKey?.toString().slice(-4)})`
          : isProcessing 
            ? 'Processing...' 
            : 'Connect Wallet'}
      </button>

      {/* Legal Disclaimer Modal */}
      <LegalDisclaimer
        isOpen={showLegalDisclaimer}
        onAccept={handleLegalAccept}
        onDecline={handleLegalDecline}
      />
    </div>
  );
};

// New component for top-right wallet display
export const TopRightWallet: React.FC = () => {
  const { publicKey, disconnect, connected }: WalletContextState = useWallet();
  const { setVisible } = useWalletModal();
  const [isProcessing, setIsProcessing] = useState(false);
  const [showLegalDisclaimer, setShowLegalDisclaimer] = useState(false);
  const [username, setUsernameState] = useState<string | null>(null);
  const [editingUsername, setEditingUsername] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [savingUsername, setSavingUsername] = useState(false);

  // Use SSE for real-time wallet balance updates
  const { balance: walletBalance, isConnected: sseConnected, error: sseError, refreshBalance } = useWalletBalanceSSE(
    publicKey?.toString() || null
  );

  // Load username when wallet connects
  useEffect(() => {
    if (connected && publicKey) {
      loadUsername();
    } else {
      setUsernameState(null);
    }
  }, [connected, publicKey]);

  const loadUsername = async () => {
    if (!publicKey) return;
    try {
      const response = await getUsername(publicKey.toString());
      setUsernameState(response.username || null);
    } catch (error) {
      console.error('Failed to load username:', error);
    }
  };

  const handleUsernameChange = async (value: string) => {
    setNewUsername(value);
    setUsernameError(null);

    // Validate format
    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (value && !usernameRegex.test(value)) {
      setUsernameError('3-20 chars, letters/numbers/underscores only');
      return;
    }

    // Check availability if username is valid
    if (value && usernameRegex.test(value) && value.toLowerCase() !== username?.toLowerCase()) {
      setCheckingAvailability(true);
      try {
        const response = await checkUsernameAvailability(value);
        if (!response.available) {
          setUsernameError('Username taken');
        }
      } catch (error) {
        console.error('Failed to check username:', error);
      } finally {
        setCheckingAvailability(false);
      }
    }
  };

  const handleSaveUsername = async () => {
    if (!publicKey || !newUsername.trim()) return;

    const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
    if (!usernameRegex.test(newUsername)) {
      setUsernameError('Invalid format');
      return;
    }

    setSavingUsername(true);
    setUsernameError(null);

    try {
      await setUsername(publicKey.toString(), newUsername.trim());
      setUsernameState(newUsername.trim().toLowerCase());
      setEditingUsername(false);
      setNewUsername('');
    } catch (error: any) {
      setUsernameError(error.message || 'Failed to save username');
    } finally {
      setSavingUsername(false);
    }
  };

  const handleConnect = async () => {
    // Show legal disclaimer first
    setShowLegalDisclaimer(true);
  };

  const handleLegalAccept = async () => {
    setShowLegalDisclaimer(false);
    
    if (isProcessing) return;
    
    setIsProcessing(true);
    
    try {
      if (typeof window === 'undefined') {
        alert('Cannot connect in server-side rendering');
        return;
      }

      // Directly show wallet selection modal (bot protection handled by backend)
      setVisible(true);
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
      }, 500);
    }
  };

  const handleLegalDecline = () => {
    setShowLegalDisclaimer(false);
  };

  if (!connected) {
    return (
      <>
        <div className="absolute top-3 right-3 sm:top-4 sm:right-4">
          <button
            className={`px-4 py-2.5 sm:px-5 sm:py-3 rounded-lg font-bold transition-all duration-200 shadow bg-accent text-primary hover:bg-yellow-400 hover:shadow-lg transform hover:scale-105 active:scale-95 min-h-[44px] flex items-center justify-center text-sm sm:text-base ${
              isProcessing ? 'opacity-50 cursor-not-allowed' : ''
            }`}
            onClick={handleConnect}
            disabled={isProcessing}
          >
            {isProcessing ? 'Processing...' : 'Connect Wallet'}
          </button>
        </div>

        {/* Legal Disclaimer Modal */}
        <LegalDisclaimer
          isOpen={showLegalDisclaimer}
          onAccept={handleLegalAccept}
          onDecline={handleLegalDecline}
        />
      </>
    );
  }

  return (
    <>
      <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-50">
        <div className="bg-white/5 backdrop-blur-md rounded-lg border border-white/10 shadow-lg transition-all duration-200 hover:border-white/20 hover:bg-white/8">
          {editingUsername ? (
            <div className="p-3 space-y-2.5 min-w-[280px]">
              <div className="relative">
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => handleUsernameChange(e.target.value)}
                  placeholder="Enter username"
                  className="w-full px-3 py-2 text-sm rounded-lg bg-white/5 border border-accent/40 text-white placeholder-white/40 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-all duration-200"
                  maxLength={20}
                  disabled={savingUsername}
                />
                {checkingAvailability && (
                  <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                    <div className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-accent/30 border-t-accent"></div>
                  </div>
                )}
              </div>
              {usernameError && (
                <div className="px-2.5 py-1.5 text-red-400 text-xs font-medium bg-red-500/10 border border-red-500/30 rounded-lg">
                  {usernameError}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={handleSaveUsername}
                  disabled={savingUsername || !!usernameError || !newUsername.trim()}
                  className="flex-1 px-3 py-1.5 text-xs font-bold bg-accent text-primary rounded-lg hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {savingUsername ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditingUsername(false);
                    setNewUsername('');
                    setUsernameError(null);
                  }}
                  className="px-3 py-1.5 text-xs font-medium bg-white/5 text-white rounded-lg hover:bg-white/10 transition-all duration-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-1.5 sm:py-2.5">
              {/* Username - Hidden on mobile, shown on larger screens */}
              <div className="hidden sm:flex items-center gap-2">
                {username ? (
                  <>
                    <button
                      onClick={() => {
                        setEditingUsername(true);
                        setNewUsername(username);
                        setUsernameError(null);
                      }}
                      className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all duration-200 group"
                      title="Edit username"
                    >
                      <span className="text-accent text-xs font-bold">@</span>
                      <span className="text-white text-xs font-semibold tracking-wide">{username}</span>
                      <svg className="w-3 h-3 text-white/50 group-hover:text-white/80 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setEditingUsername(true);
                      setNewUsername('');
                      setUsernameError(null);
                    }}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-purple-500/15 hover:bg-purple-500/25 border border-purple-400/30 hover:border-purple-400/50 transition-all duration-200"
                  >
                    <svg className="w-3 h-3 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-purple-200 text-xs font-medium">Set Username</span>
                  </button>
                )}
              </div>

              {/* Divider - Hidden on mobile */}
              <div className="hidden sm:block h-5 w-px bg-white/20"></div>

              {/* Balance - Compact on mobile */}
              <div className="flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md bg-accent/10 border border-accent/20">
                <div className="text-accent text-[10px] sm:text-xs font-black tracking-tight">
                  {walletBalance !== null ? (
                    <span className="flex items-baseline gap-0.5">
                      <span>{walletBalance.toFixed(2)}</span>
                      <span className="text-[8px] sm:text-[10px] font-bold text-accent/70">SOL</span>
                    </span>
                  ) : (
                    <span className="text-white/40 text-[8px] sm:text-[10px]">...</span>
                  )}
                </div>
              </div>

              {/* Divider - Hidden on mobile */}
              <div className="hidden sm:block h-5 w-px bg-white/20"></div>

              {/* Disconnect Button - Smaller on mobile */}
              <button
                className="p-1 sm:p-1.5 rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 hover:border-red-500/40 transition-all duration-200 group"
                onClick={disconnect}
                title="Disconnect wallet"
              >
                <svg className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-red-400 group-hover:text-red-300 group-hover:rotate-90 transition-all duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Legal Disclaimer Modal */}
      <LegalDisclaimer
        isOpen={showLegalDisclaimer}
        onAccept={handleLegalAccept}
        onDecline={handleLegalDecline}
      />
    </>
  );
}; 