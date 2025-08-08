import React, { useState } from 'react';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';

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

  const handleConnect = async () => {
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
    </div>
  );
}; 