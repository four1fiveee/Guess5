import React from 'react';
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

  const handleConnect = async () => {
    console.log('Attempting to connect wallet...');
    
    if (typeof window === 'undefined') {
      console.error('Window is undefined (SSR)');
      alert('Cannot connect in server-side rendering');
      return;
    }

    // First, check if reCAPTCHA is available
    let captchaPassed = false;
    
    if (window.grecaptcha && window.grecaptcha.enterprise) {
      try {
        console.log('Executing reCAPTCHA...');
        const token = await window.grecaptcha.enterprise.execute('6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI', { action: 'connect_wallet' });
        console.log('reCAPTCHA token received:', token ? 'Success' : 'Failed');
        
        if (token) {
          captchaPassed = true;
          console.log('reCAPTCHA passed successfully');
        } else {
          console.warn('No token received from reCAPTCHA');
        }
      } catch (err) {
        console.error('reCAPTCHA failed:', err);
        // For testing: continue without reCAPTCHA
        console.log('Continuing without reCAPTCHA for testing...');
        captchaPassed = true;
      }
    } else {
      console.log('reCAPTCHA not available, continuing without it for testing...');
      captchaPassed = true;
    }

    if (captchaPassed) {
      // Show wallet selection modal
      console.log('Opening wallet selection modal...');
      setVisible(true);
    } else {
      alert('reCAPTCHA verification failed. Please try again.');
    }
  };

  return (
    <div className="flex flex-col items-center mb-4">
      <button
        className={`px-6 py-2 rounded-lg font-bold transition-colors shadow ${
          connected
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-accent text-primary hover:bg-yellow-400'
        }`}
        onClick={connected ? disconnect : handleConnect}
      >
        {connected
          ? `Disconnect (${publicKey?.toString().slice(0, 4)}...${publicKey?.toString().slice(-4)})`
          : 'Connect Wallet'}
      </button>
    </div>
  );
}; 