import '../styles/globals.css';
import '@solana/wallet-adapter-react-ui/styles.css';
import type { AppProps } from 'next/app';
import { WalletAdapterNetwork } from '@solana/wallet-adapter-base';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { useMemo, useEffect } from 'react';
import { Analytics } from '@vercel/analytics/react';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  LedgerWalletAdapter,
  CoinbaseWalletAdapter,
  TrustWalletAdapter,
} from '@solana/wallet-adapter-wallets';

function MyApp({ Component, pageProps }: AppProps) {
  const network = WalletAdapterNetwork.Devnet;
  const endpoint = useMemo(() => process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com', []);
  
  // Configure multiple wallet adapters for broader wallet support
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new CoinbaseWalletAdapter(),
      new LedgerWalletAdapter(),
      new TrustWalletAdapter(),
    ],
    []
  );

  // Global error handler to catch CSP violations and other network errors
  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      console.error('🌐 Global error caught:', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: event.error
      });
      
      // Check for CSP violations
      if (event.message.includes('CSP') || event.message.includes('Content Security Policy') || event.message.includes('blocked')) {
        console.error('🚫 CSP Violation detected in global error handler');
      }
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('🌐 Unhandled promise rejection:', {
        reason: event.reason,
        promise: event.promise
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <Component {...pageProps} />
          <Analytics />
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export default MyApp; 