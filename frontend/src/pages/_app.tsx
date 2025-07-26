import '../styles/globals.css'
import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'

// Wallet context provider (Phantom, etc.)
const WalletContextProvider = dynamic(
  () => import('../components/WalletConnect').then(mod => mod.WalletContextProvider),
  { ssr: false }
)

// Check for required environment variables
const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
const solanaNetwork = process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'https://api.devnet.solana.com'

console.log("API URL:", apiUrl)
console.log("Solana Network:", solanaNetwork)

export default function App({ Component, pageProps }: AppProps) {
  // Wrap all pages with wallet context
  return (
    <WalletContextProvider>
      <Component {...pageProps} />
    </WalletContextProvider>
  )
} 