import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/router'
import { WalletConnectButton } from '../components/WalletConnect'
import GameGrid from '../components/GameGrid'

export default function Game() {
  const router = useRouter()
  // Use the assigned word and matchId from localStorage
  const [correctWord] = useState(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('word') || '').toUpperCase()
    }
    return ''
  })
  const matchId = typeof window !== 'undefined' ? localStorage.getItem('matchId') : ''
  const [countdown, setCountdown] = useState(15)
  const [gameOver, setGameOver] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  // Get the entry fee from localStorage (default to 1 if not set)
  const entryFee = Number(typeof window !== 'undefined' ? localStorage.getItem('entryFee') : 1) || 1

  // Reset timer for each guess
  const resetTimer = useCallback(() => setCountdown(15), [])

  // Handle timer countdown
  useEffect(() => {
    if (gameOver) return
    if (countdown === 0) return // handled by onTimeout
    const timer = setTimeout(() => setCountdown(c => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, gameOver])

  // Called when a guess times out
  const handleTimeout = () => {
    setGameOver(true)
    setResult('timeout')
    setTimeout(() => router.push(`/result?result=timeout&word=${correctWord}`), 2000)
  }

  // Called when the game ends (win/lose)
  const handleGameEnd = (outcome: string) => {
    setGameOver(true)
    setResult(outcome)
    setTimeout(() => router.push(`/result?result=${outcome}&word=${correctWord}`), 2000)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-primary">
      <WalletConnectButton />
      <h2 className="text-3xl font-bold text-accent mb-2">Guess5 Game</h2>
      <div className="mb-2 text-lg text-secondary font-semibold">Staked Amount: ${entryFee.toFixed(2)} USD</div>
      <GameGrid
        onGameEnd={handleGameEnd}
        disabled={gameOver}
        correctWord={correctWord}
        onTimeout={handleTimeout}
        countdown={countdown}
        resetTimer={resetTimer}
      />
      {gameOver && <div className="mt-6 text-xl text-error">Game Over: {result}</div>}
    </div>
  )
} 