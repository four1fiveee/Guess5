import React, { useState, useEffect } from 'react'
import wordList from './wordList'

// Props: guesses, currentGuess, setCurrentGuess, onGuess, remainingGuesses, targetWord
const GameGrid: React.FC<{
  guesses: string[],
  currentGuess: string,
  setCurrentGuess: (guess: string) => void,
  onGuess: (guess: string) => Promise<void>,
  remainingGuesses: number,
  targetWord?: string
}> = ({ guesses, currentGuess, setCurrentGuess, onGuess, remainingGuesses, targetWord }) => {
  const [hintColors, setHintColors] = useState<string[][]>([])

  // Calculate hint colors for each guess
  const calculateHintColors = (guess: string, targetWord: string) => {
    const colors = new Array(5).fill('bg-white/10 border-white/30 text-white')
    const targetLetters = targetWord.split('')
    const guessLetters = guess.split('')
    
    // First pass: mark correct letters (green)
    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === targetLetters[i]) {
        colors[i] = 'bg-green-500 border-green-500 text-white'
        targetLetters[i] = '*' // Mark as used
      }
    }
    
    // Second pass: mark misplaced letters (yellow)
    for (let i = 0; i < 5; i++) {
      if (colors[i] === 'bg-white/10 border-white/30 text-white') {
        const letterIndex = targetLetters.indexOf(guessLetters[i])
        if (letterIndex !== -1) {
          colors[i] = 'bg-yellow-500 border-yellow-500 text-white'
          targetLetters[letterIndex] = '*' // Mark as used
        }
      }
    }
    
    return colors
  }

  // Update hint colors when guesses change
  useEffect(() => {
    if (targetWord && guesses.length > 0) {
      const newHintColors = guesses.map(guess => calculateHintColors(guess, targetWord))
      setHintColors(newHintColors)
    }
  }, [guesses, targetWord])

  // Handle guess submission
  const handleSubmit = async () => {
    if (currentGuess.length !== 5 || remainingGuesses <= 0) return
    
    // Allow any 5-letter word (server will validate if needed)
    await onGuess(currentGuess.toUpperCase())
    setCurrentGuess('')
  }

  // Allow Enter key to submit guess
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && currentGuess.length === 5 && remainingGuesses > 0) {
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      {/* Render 7 rows for guesses - Compact on mobile */}
      <div className="flex flex-col gap-1.5 sm:gap-3 items-center mb-3 sm:mb-6 flex-1 justify-center overflow-y-auto max-h-full">
        {[...Array(7)].map((_, row) => {
          const guess = guesses[row] || ''
          const isCurrentRow = row === guesses.length
          const rowHintColors = hintColors[row] || []
          
          return (
            <div key={row} className="flex gap-1.5 sm:gap-3 justify-center">
              {[...Array(5)].map((_, col) => {
                let cellClass = 'w-10 h-10 sm:w-14 sm:h-14 flex items-center justify-center border-2 rounded-full text-lg sm:text-2xl font-bold transition-all duration-200'
                let displayLetter = ''
                
                if (guess) {
                  // Completed guess - show with colors
                  cellClass += ` ${rowHintColors[col] || 'bg-white/10 border-white/30 text-white'}`
                  displayLetter = guess[col] || ''
                } else {
                  // Empty row (including current row)
                  cellClass += ' bg-white/5 border-white/20 text-white/50'
                  displayLetter = ''
                }
                
                return (
                  <div
                    key={col}
                    className={cellClass}
                    style={{ aspectRatio: '1 / 1' }}
                  >
                    {displayLetter}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      
      {/* Input for current guess - Compact on mobile */}
      {remainingGuesses > 0 && (
        <div className="flex flex-col items-center gap-2 sm:gap-4 w-full max-w-md">
          <div className="text-accent text-sm sm:text-lg font-semibold">Guess {7 - remainingGuesses + 1} of 7</div>
          <div className="flex gap-2 sm:gap-3 justify-center w-full px-2">
            <input
              type="text"
              maxLength={5}
              value={currentGuess}
              onChange={e => {
                // Only allow A-Z characters, filter out everything else
                const filteredValue = e.target.value.replace(/[^A-Za-z]/g, '').toUpperCase();
                setCurrentGuess(filteredValue);
              }}
              className="flex-1 px-3 sm:px-6 py-2 sm:py-3 rounded-lg border-2 border-white/30 bg-white/10 text-white text-center text-base sm:text-xl font-semibold placeholder-white/50 focus:outline-none focus:border-accent"
              disabled={remainingGuesses <= 0}
              onKeyDown={handleKeyDown}
              placeholder="Enter word"
              autoFocus
              // Mobile optimizations
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="characters"
              spellCheck="false"
              inputMode="text"
              // Prevent zoom on focus (mobile)
              style={{ fontSize: '16px' }}
            />
            <button
              onClick={handleSubmit}
              className="px-4 sm:px-6 py-2 sm:py-3 bg-accent text-primary rounded-lg font-bold text-sm sm:text-lg hover:bg-yellow-400 hover:shadow-lg disabled:bg-gray-600 disabled:text-gray-400 disabled:cursor-not-allowed transition-all duration-200 transform hover:scale-105 active:scale-95 min-h-[44px] sm:min-h-[48px] flex items-center justify-center whitespace-nowrap"
              disabled={currentGuess.length !== 5 || remainingGuesses <= 0}
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