import React, { useState, useEffect } from 'react';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { Connection, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { LegalDisclaimer } from './LegalDisclaimer';
import { useWalletBalanceSSE } from '../hooks/useWalletBalanceSSE';

declare global {
  interface Window {
    grecaptcha: {
      enterprise: {
        execute(siteKey: string, options: { action: string }): Promise<string>;
      };
    };
  }
}

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

      // Check if reCAPTCHA is available
      if (!window.grecaptcha || !window.grecaptcha.enterprise) {
        console.error('reCAPTCHA not available');
        alert('reCAPTCHA not loaded. Please refresh the page and try again.');
        return;
      }

      try {
        console.log('Executing reCAPTCHA...');
        const token = await window.grecaptcha.enterprise.execute('6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI', { action: 'connect_wallet' });
        console.log('reCAPTCHA token received:', token ? 'Success' : 'Failed');
        
        if (token) {
          console.log('reCAPTCHA passed successfully');
          // Show wallet selection modal
          console.log('Opening wallet selection modal...');
          setVisible(true);
        } else {
          console.error('No token received from reCAPTCHA');
          alert('reCAPTCHA verification failed. Please try again.');
        }
      } catch (err) {
        console.error('reCAPTCHA failed:', err);
        // More graceful error handling
        if (err instanceof Error && err.message.includes('timeout')) {
          alert('reCAPTCHA timed out. Please try again.');
        } else if (err instanceof Error && err.message.includes('network')) {
          alert('Network error with reCAPTCHA. Please check your connection and try again.');
        } else {
          alert('reCAPTCHA verification failed. Please try again.');
        }
      }
    } finally {
      // Reset the processing flag after a short delay
      setTimeout(() => {
        setIsProcessing(false);
      }, 1000);
    }
  };

  const handleLegalDecline = () => {
    setShowLegalDisclaimer(false);
  };

  return (
    <div className="flex flex-col items-center mb-4">
      <button
        className={`px-6 py-2 rounded-lg font-bold transition-colors shadow ${
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
      
      {/* Wallet Balance Display */}
      {connected && walletBalance !== null && (
        <div className="mt-2 text-center">
          <div className="text-sm text-white/80">Wallet Balance</div>
          <div className="text-lg font-bold text-accent">
            {walletBalance.toFixed(4)} SOL
          </div>
        </div>
      )}

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

      if (!window.grecaptcha || !window.grecaptcha.enterprise) {
        alert('reCAPTCHA not loaded. Please refresh the page and try again.');
        return;
      }

      try {
        const token = await window.grecaptcha.enterprise.execute('6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI', { action: 'connect_wallet' });
        
        if (token) {
          setVisible(true);
        } else {
          alert('reCAPTCHA verification failed. Please try again.');
        }
      } catch (err) {
        console.error('reCAPTCHA failed:', err);
        alert('reCAPTCHA verification failed. Please try again.');
      }
    } finally {
      setTimeout(() => {
        setIsProcessing(false);
      }, 1000);
    }
  };

  const handleLegalDecline = () => {
    setShowLegalDisclaimer(false);
  };

  if (!connected) {
    return (
      <>
        <div className="absolute top-4 right-4">
          <button
            className={`px-4 py-2 rounded-lg font-bold transition-colors shadow bg-accent text-primary hover:bg-yellow-400 ${
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
      <div className="absolute top-4 right-4 bg-secondary bg-opacity-20 rounded-lg p-3 backdrop-blur-sm">
        <div className="flex flex-col items-center">
          <div className="text-lg font-bold text-accent mb-2">
            {walletBalance !== null ? `${walletBalance.toFixed(4)} SOL` : 'Loading...'}
          </div>
          <button
            className="px-4 py-1 text-xs font-bold bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
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