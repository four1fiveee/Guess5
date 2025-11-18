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
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 bg-secondary bg-opacity-20 rounded-lg p-3 backdrop-blur-sm border border-accent/20 min-w-[200px]">
        <div className="flex flex-col items-center gap-2">
          {/* Username Display/Edit */}
          {editingUsername ? (
            <div className="w-full">
              <input
                type="text"
                value={newUsername}
                onChange={(e) => handleUsernameChange(e.target.value)}
                placeholder="Enter username"
                className="w-full px-3 py-2 text-sm rounded-lg bg-white/10 border border-accent/30 text-white placeholder-white/50 focus:outline-none focus:border-accent"
                maxLength={20}
                disabled={savingUsername}
              />
              {usernameError && (
                <div className="text-red-400 text-xs mt-1">{usernameError}</div>
              )}
              <div className="flex gap-2 mt-2">
                <button
                  onClick={handleSaveUsername}
                  disabled={savingUsername || !!usernameError || !newUsername.trim()}
                  className="flex-1 px-3 py-1.5 text-xs font-bold bg-accent text-primary rounded hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {savingUsername ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => {
                    setEditingUsername(false);
                    setNewUsername('');
                    setUsernameError(null);
                  }}
                  className="px-3 py-1.5 text-xs font-bold bg-white/10 text-white rounded hover:bg-white/20"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full text-center">
              {username ? (
                <div className="text-sm font-bold text-accent mb-1">@{username}</div>
              ) : (
                <button
                  onClick={() => {
                    setEditingUsername(true);
                    setNewUsername('');
                    setUsernameError(null);
                  }}
                  className="text-xs text-accent hover:text-yellow-400 underline mb-1"
                >
                  Set Username
                </button>
              )}
              {username && (
                <button
                  onClick={() => {
                    setEditingUsername(true);
                    setNewUsername(username);
                    setUsernameError(null);
                  }}
                  className="text-xs text-white/60 hover:text-white/80 underline"
                >
                  Edit
                </button>
              )}
            </div>
          )}

          {/* Balance */}
          <div className="text-sm sm:text-base font-bold text-accent text-center">
            {walletBalance !== null ? `${walletBalance.toFixed(4)} SOL` : 'Loading...'}
          </div>

          {/* Disconnect Button */}
          <button
            className="px-4 py-2 text-xs sm:text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors min-h-[36px] flex items-center justify-center w-full"
            onClick={disconnect}
          >
            Disconnect
          </button>
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