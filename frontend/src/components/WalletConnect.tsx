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
      <div className="absolute top-4 right-4 sm:top-5 sm:right-5 z-50">
        <div className="bg-gradient-to-br from-white/[0.12] via-white/[0.08] to-white/[0.12] backdrop-blur-xl rounded-2xl p-4 sm:p-5 border border-white/20 shadow-2xl min-w-[200px] sm:min-w-[240px] transition-all duration-300 hover:shadow-accent/20 hover:border-white/30">
          <div className="flex flex-col gap-4">
            {/* Username Display/Edit */}
            {editingUsername ? (
              <div className="w-full space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={newUsername}
                    onChange={(e) => handleUsernameChange(e.target.value)}
                    placeholder="Enter username"
                    className="w-full px-4 py-3 text-sm rounded-xl bg-white/10 border-2 border-accent/50 text-white placeholder-white/40 focus:outline-none focus:border-accent focus:ring-4 focus:ring-accent/20 transition-all duration-200 font-medium"
                    maxLength={20}
                    disabled={savingUsername}
                  />
                  {checkingAvailability && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="animate-spin rounded-full h-4 w-4 border-2 border-accent/30 border-t-accent"></div>
                    </div>
                  )}
                </div>
                {usernameError && (
                  <div className="px-3 py-2 text-red-400 text-xs font-medium bg-red-500/10 border border-red-500/30 rounded-lg animate-pulse">
                    {usernameError}
                  </div>
                )}
                <div className="flex gap-2.5">
                  <button
                    onClick={handleSaveUsername}
                    disabled={savingUsername || !!usernameError || !newUsername.trim()}
                    className="flex-1 px-4 py-2.5 text-sm font-bold bg-gradient-to-r from-accent via-yellow-400 to-accent text-primary rounded-xl hover:from-yellow-300 hover:via-accent hover:to-yellow-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-accent/30"
                  >
                    {savingUsername ? (
                      <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin rounded-full h-3 w-3 border-2 border-primary/30 border-t-primary"></span>
                        Saving...
                      </span>
                    ) : (
                      'Save'
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setEditingUsername(false);
                      setNewUsername('');
                      setUsernameError(null);
                    }}
                    className="px-4 py-2.5 text-sm font-semibold bg-white/10 text-white rounded-xl hover:bg-white/20 transition-all duration-200 border border-white/20 hover:border-white/30"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full">
                {username ? (
                  <div className="group flex items-center justify-between bg-gradient-to-r from-accent/15 via-accent/10 to-accent/15 rounded-xl px-4 py-3 border border-accent/30 hover:border-accent/50 transition-all duration-200">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent/30 to-yellow-400/30 flex items-center justify-center border border-accent/40">
                        <span className="text-accent text-sm font-bold">@</span>
                      </div>
                      <div className="text-sm font-bold text-accent tracking-wide">{username}</div>
                    </div>
                    <button
                      onClick={() => {
                        setEditingUsername(true);
                        setNewUsername(username);
                        setUsernameError(null);
                      }}
                      className="opacity-60 group-hover:opacity-100 transition-opacity duration-200 p-1.5 hover:bg-white/10 rounded-lg"
                      title="Edit username"
                    >
                      <svg className="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditingUsername(true);
                      setNewUsername('');
                      setUsernameError(null);
                    }}
                    className="w-full px-4 py-3 text-sm font-semibold bg-gradient-to-r from-purple-500/25 via-pink-500/20 to-purple-500/25 border border-purple-400/40 text-purple-200 rounded-xl hover:from-purple-500/35 hover:via-pink-500/30 hover:to-purple-500/35 hover:border-purple-400/60 transition-all duration-200 transform hover:scale-[1.02] active:scale-[0.98] shadow-lg hover:shadow-purple-500/20 flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    Set Username
                  </button>
                )}
              </div>
            )}

            {/* Balance */}
            <div className="relative overflow-hidden bg-gradient-to-br from-accent/25 via-yellow-400/20 to-accent/25 border-2 border-accent/40 rounded-xl px-4 py-4 text-center shadow-lg hover:shadow-accent/30 transition-all duration-200 group">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
              <div className="relative">
                <div className="text-[10px] uppercase tracking-wider text-white/60 font-semibold mb-1.5">Wallet Balance</div>
                <div className="text-xl sm:text-2xl font-black text-accent tracking-tight">
                  {walletBalance !== null ? (
                    <span className="inline-flex items-baseline gap-1">
                      <span>{walletBalance.toFixed(4)}</span>
                      <span className="text-sm font-bold text-accent/80">SOL</span>
                    </span>
                  ) : (
                    <span className="text-white/40">Loading...</span>
                  )}
                </div>
              </div>
            </div>

            {/* Disconnect Button */}
            <button
              className="px-4 py-3 text-sm font-bold bg-gradient-to-r from-red-600/90 via-red-600 to-red-700/90 text-white rounded-xl hover:from-red-500 hover:via-red-600 hover:to-red-500 transition-all duration-200 min-h-[44px] flex items-center justify-center w-full shadow-lg hover:shadow-red-500/40 transform hover:scale-[1.02] active:scale-[0.98] border border-red-500/40 hover:border-red-400/60 group"
              onClick={disconnect}
            >
              <span className="flex items-center gap-2">
                <svg className="w-4 h-4 group-hover:rotate-90 transition-transform duration-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Disconnect
              </span>
            </button>
          </div>
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