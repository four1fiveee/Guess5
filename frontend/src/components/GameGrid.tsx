import React, { useState, useEffect } from 'react'
import wordList from './wordList'

// Props: guesses, currentGuess, setCurrentGuess, onGuess, remainingGuesses
const GameGrid: React.FC<{
  guesses: string[],
  currentGuess: string,
  setCurrentGuess: (guess: string) => void,
  onGuess: (guess: string) => Promise<void>,
  remainingGuesses: number
}> = ({ guesses, currentGuess, setCurrentGuess, onGuess, remainingGuesses }) => {
  const [hintColors, setHintColors] = useState<string[][]>([])

  // Handle guess submission
  const handleSubmit = async () => {
    if (currentGuess.length !== 5 || remainingGuesses <= 0) return
    
    // Validate word is in the word list
    if (!wordList.includes(currentGuess.toUpperCase())) {
      alert('Invalid word - not in word list')
      return
    }
    
    // Server will validate the guess and provide feedback
    await onGuess(currentGuess)
    setCurrentGuess('')
  }

  // Allow Enter key to submit guess
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && currentGuess.length === 5 && remainingGuesses > 0) {
      handleSubmit()
    }
  }

  return (
    <div className="flex flex-col items-center justify-center w-full">
      {/* Render 7 rows for guesses */}
      <div className="flex flex-col gap-3 items-center mb-6">
        {[...Array(7)].map((_, row) => (
          <div key={row} className="flex gap-3 justify-center">
            {[...Array(5)].map((_, col) => (
              <div
                key={col}
                className={`w-14 h-14 flex items-center justify-center border-2 rounded-lg text-2xl font-bold
                  ${hintColors[row]?.[col] || 'bg-white/10 border-white/30 text-white'} transition-all duration-200`}
                style={{ aspectRatio: '1 / 1' }}
              >
                {guesses[row]?.[col] || ''}
              </div>
            ))}
          </div>
        ))}
      </div>
      
      {/* Input for current guess */}
      {remainingGuesses > 0 && (
        <div className="flex flex-col items-center gap-4 w-full max-w-md">
          <div className="text-accent text-lg font-semibold">Guesses: {guesses.length}/7 (Max 7 guesses)</div>
          <div className="flex gap-3 justify-center w-full">
            <input
              type="text"
              maxLength={5}
              value={currentGuess}
              onChange={e => setCurrentGuess(e.target.value.toUpperCase())}
              className="px-6 py-3 rounded-lg border-2 border-white/30 bg-white/10 text-white text-center text-xl font-semibold placeholder-white/50 focus:outline-none focus:border-accent"
              disabled={remainingGuesses <= 0}
              onKeyDown={handleKeyDown}
              placeholder="Enter 5-letter word"
            />
            <button
              onClick={handleSubmit}
              className="px-6 py-3 bg-accent text-primary rounded-lg font-bold text-lg hover:bg-yellow-400 disabled:bg-gray-600 disabled:text-gray-400 transition-colors"
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