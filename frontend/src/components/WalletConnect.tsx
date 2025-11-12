import React, { useState, useEffect } from 'react';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { LegalDisclaimer } from './LegalDisclaimer';
import { useWalletBalanceSSE } from '../hooks/useWalletBalanceSSE';

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
      <div className="absolute top-3 right-3 sm:top-4 sm:right-4 bg-secondary bg-opacity-20 rounded-lg p-3 backdrop-blur-sm border border-accent/20">
        <div className="flex flex-col items-center">
          <div className="text-sm sm:text-base font-bold text-accent mb-2 text-center">
            {walletBalance !== null ? `${walletBalance.toFixed(4)} SOL` : 'Loading...'}
          </div>
          <button
            className="px-4 py-2 text-xs sm:text-sm font-bold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors min-h-[36px] flex items-center justify-center"
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