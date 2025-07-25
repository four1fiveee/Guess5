import React, { useState, useEffect } from 'react'

// Props: onGameEnd callback, disabled state, correctWord, onTimeout, countdown, resetTimer
const GameGrid: React.FC<{
  onGameEnd: (result: string) => void,
  disabled: boolean,
  correctWord: string,
  onTimeout: () => void,
  countdown: number,
  resetTimer: () => void
}> = ({ onGameEnd, disabled, correctWord, onTimeout, countdown, resetTimer }) => {
  // 5-letter word, 7 tries
  const [guesses, setGuesses] = useState<string[]>([])
  const [current, setCurrent] = useState('')
  const [hintColors, setHintColors] = useState<string[][]>([])

  // Handle guess submission
  const handleSubmit = (guessOverride?: string) => {
    const guess = guessOverride || current
    if (guess.length !== 5) return
    // New hint system: green = correct, orange = misplaced, darkgray = incorrect
    const colors = Array(5).fill('bg-darkgray')
    for (let i = 0; i < 5; i++) {
      if (guess[i] === correctWord[i]) colors[i] = 'bg-success' // green
      else if (correctWord.includes(guess[i])) colors[i] = 'bg-accent' // orange
      // else remains darkgray
    }
    setGuesses(prev => [...prev, guess])
    setHintColors(prev => [...prev, colors])
    setCurrent('')
    resetTimer()
    if (guess === correctWord) onGameEnd('win')
    else if (guesses.length + 1 === 7) onGameEnd('lose')
  }

  // If time runs out for a guess, auto-submit all-darkgray guess
  useEffect(() => {
    if (!disabled && countdown === 0) {
      // Submit an all-darkgray guess (e.g., '.....')
      handleSubmit('.....')
    }
    // eslint-disable-next-line
  }, [countdown, disabled])

  // Allow Enter key to submit guess
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && current.length === 5 && !disabled) {
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col items-center justify-center w-full">
      {/* Render 7 rows for guesses */}
      <div className="flex flex-col gap-2 items-center">
        {[...Array(7)].map((_, row) => (
          <div key={row} className="flex gap-2 justify-center">
            {[...Array(5)].map((_, col) => (
              <div
                key={col}
                className={`w-12 h-12 flex items-center justify-center border-2 rounded-full text-2xl font-bold
                  ${hintColors[row]?.[col] || 'bg-primary'} text-secondary transition-all duration-200`}
                style={{ aspectRatio: '1 / 1' }}
              >
                {guesses[row]?.[col] || ''}
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Input for current guess */}
      {!disabled && guesses.length < 7 && (
        <div className="mt-4 flex flex-col items-center gap-2 w-full">
          <div className="text-secondary text-lg text-center">Time left: {countdown}s</div>
          <div className="flex gap-2 justify-center w-full">
            <input
              type="text"
              maxLength={5}
              value={current}
              onChange={e => setCurrent(e.target.value.toUpperCase())}
              className="px-4 py-2 rounded border text-primary text-center"
              disabled={disabled}
              onKeyDown={handleKeyDown}
            />
            <button
              onClick={() => handleSubmit()}
              className="px-4 py-2 bg-accent text-primary rounded font-semibold"
              disabled={current.length !== 5}
            >
              Guess
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GameGrid 