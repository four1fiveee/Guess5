import '../styles/globals.css'
import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'

// Wallet context provider (Phantom, etc.)
const WalletContextProvider = dynamic(
  () => import('../components/WalletConnect').then(mod => mod.WalletContextProvider),
  { ssr: false }
)

export default function App({ Component, pageProps }: AppProps) {
  // Wrap all pages with wallet context
  return (
    <WalletContextProvider>
      <Component {...pageProps} />
    </WalletContextProvider>
  )
} 