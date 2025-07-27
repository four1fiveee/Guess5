import React from 'react';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';

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

  const handleConnect = async () => {
    if (typeof window === 'undefined' || !window.grecaptcha || !window.grecaptcha.enterprise) {
      alert('reCAPTCHA not loaded');
      return;
    }
    try {
      const token = await window.grecaptcha.enterprise.execute('6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI', { action: 'connect_wallet' });
      // Optionally: send token to backend for verification here
      await connect();
    } catch (err) {
      alert('reCAPTCHA failed. Please try again.');
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