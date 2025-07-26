import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'
import { requestMatch } from '../utils/api'

export default function Matchmaking() {
  const router = useRouter()
  const [status, setStatus] = useState('Waiting for opponent...')

  useEffect(() => {
    let interval: NodeJS.Timeout | null = null
    const checkMatch = async () => {
      try {
        const entryFee = localStorage.getItem('entryFee')
        const wallet = localStorage.getItem('wallet')
        
        if (!entryFee || !wallet) {
          setStatus('Error: Missing match data. Please try again.')
          return
        }
        
        const data = await requestMatch(Number(entryFee), wallet)
        
        if (data.status === 'matched') {
          localStorage.setItem('matchId', data.matchId)
          localStorage.setItem('word', data.word)
          setStatus('Opponent found! Starting game...')
          setTimeout(() => router.push('/game'), 1500)
        }
      } catch (err) {
        console.error('Matchmaking error:', err)
        setStatus('Error connecting to server. Retrying...')
      }
    }
    
    interval = setInterval(checkMatch, 2000)
    return () => { if (interval) clearInterval(interval) }
  }, [router])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary">
      <WalletConnectButton />
      <h2 className="text-3xl font-bold text-accent mb-6">Matchmaking</h2>
      <p className="text-xl text-secondary">{status}</p>
    </div>
  )
} 