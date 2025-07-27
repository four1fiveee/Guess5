import React, { FC, ReactNode } from 'react'
import {
  ConnectionProvider,
  WalletProvider
} from '@solana/wallet-adapter-react'
import {
  WalletModalProvider,
  useWalletModal
} from '@solana/wallet-adapter-react-ui'
import { useWallet } from '@solana/wallet-adapter-react'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import '@solana/wallet-adapter-react-ui/styles.css'
import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useWallet, WalletContextState } from '@solana/wallet-adapter-react';

// Dynamically import reCAPTCHA to avoid SSR issues
const ReCAPTCHA = dynamic(() => import('react-google-recaptcha'), { ssr: false });

// Context provider for Solana wallet connection
export const WalletContextProvider: FC<{ children: ReactNode }> = ({ children }) => {
  // Only Phantom wallet for simplicity
  const wallets = [new PhantomWalletAdapter()]
  
  // Use environment variable or fallback to devnet
  const endpoint = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com'
  
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}

// Custom connect wallet button at top right
export const WalletConnectButton: React.FC = () => {
  const { publicKey, connect, disconnect, connected }: WalletContextState = useWallet();
  const [captchaVerified, setCaptchaVerified] = useState(false);

  // User's production site key
  const RECAPTCHA_SITE_KEY = '6Lcq4JArAAAAAMzZI4o4TVaJANOpDBqqFtzBVqMI';

  const handleCaptcha = (value: string | null) => {
    setCaptchaVerified(!!value);
  };

  return (
    <div className="flex flex-col items-center mb-4">
      {!connected && (
        <div className="mb-2">
          <ReCAPTCHA
            sitekey={RECAPTCHA_SITE_KEY}
            onChange={handleCaptcha}
            theme="dark"
          />
        </div>
      )}
      <button
        className={`px-6 py-2 rounded-lg font-bold transition-colors shadow ${
          connected
            ? 'bg-green-600 text-white hover:bg-green-700'
            : 'bg-accent text-primary hover:bg-yellow-400 disabled:opacity-50 disabled:cursor-not-allowed'
        }`}
        onClick={connected ? disconnect : connect}
        disabled={!connected && !captchaVerified}
      >
        {connected
          ? `Disconnect (${publicKey?.toString().slice(0, 4)}...${publicKey?.toString().slice(-4)})`
          : 'Connect Wallet'}
      </button>
    </div>
  );
}; 