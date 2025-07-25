import '../styles/globals.css'
import type { AppProps } from 'next/app'
import dynamic from 'next/dynamic'

// Wallet context provider (Phantom, etc.)
const WalletContextProvider = dynamic(
  () => import('../components/WalletConnect').then(mod => mod.WalletContextProvider),
  { ssr: false }
)

console.log("API URL:", process.env.NEXT_PUBLIC_API_URL);

export default function App({ Component, pageProps }: AppProps) {
  // Wrap all pages with wallet context
  return (
    <WalletContextProvider>
      <Component {...pageProps} />
    </WalletContextProvider>
  )
} 