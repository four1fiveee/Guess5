import { useEffect, useState } from 'react'
import { TopRightWallet } from '../components/WalletConnect'

export default function Status() {
  const [status, setStatus] = useState('Checking...')
  const [apiUrl, setApiUrl] = useState('')

  useEffect(() => {
    const checkStatus = async () => {
      const url = process.env.NEXT_PUBLIC_API_URL || 'https://guess5.onrender.com'
      setApiUrl(url || '')
      
      try {
        const response = await fetch(`${url}/api/match/health`)
        if (response.ok) {
          setStatus('✅ Backend is running')
        } else {
          setStatus('❌ Backend returned error')
        }
      } catch (error) {
        setStatus('❌ Cannot connect to backend')
      }
    }
    
    checkStatus()
  }, [])

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary p-4 relative">
      <TopRightWallet />
      <h1 className="text-3xl font-bold text-accent mb-6">Deployment Status</h1>
      
      <div className="bg-secondary bg-opacity-10 rounded-lg p-6 max-w-md w-full">
        <h2 className="text-xl font-bold text-accent mb-4">Environment Variables</h2>
        <div className="space-y-2 text-sm">
          <div>
            <strong>API URL:</strong> {apiUrl || 'Not set'}
          </div>
          <div>
            <strong>Solana Network:</strong> {process.env.NEXT_PUBLIC_SOLANA_NETWORK || 'Not set'}
          </div>
        </div>
        
        <h2 className="text-xl font-bold text-accent mt-6 mb-4">Backend Status</h2>
        <div className="text-lg">{status}</div>
        
        <h2 className="text-xl font-bold text-accent mt-6 mb-4">Instructions</h2>
        <div className="text-sm space-y-2">
          <p>1. Set NEXT_PUBLIC_API_URL in Vercel environment variables</p>
          <p>2. Deploy backend to Render/Railway</p>
          <p>3. Update API URL to point to your backend</p>
        </div>
      </div>
    </div>
  )
} 