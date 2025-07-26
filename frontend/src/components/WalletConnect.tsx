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
export const WalletConnectButton: FC = () => {
  const { setVisible } = useWalletModal();
  const { connected } = useWallet();
  return (
    <div className="absolute top-0 right-0 p-4 z-50">
      <button
        className="bg-accent text-primary font-bold px-6 py-2 rounded-lg shadow hover:bg-orange-500 transition"
        onClick={() => setVisible(true)}
      >
        {connected ? 'Wallet Connected' : 'Connect Wallet'}
      </button>
    </div>
  )
} 