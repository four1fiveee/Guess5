import React, { useState, useEffect } from 'react'

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
      <div className="flex flex-col gap-2 items-center">
        {[...Array(7)].map((_, row) => (
          <div key={row} className="flex gap-2 justify-center">
            {[...Array(5)].map((_, col) => (
              <div
                key={col}
                className={`w-12 h-12 flex items-center justify-center border-2 rounded-full text-2xl font-bold
                  ${hintColors[row]?.[col] || 'bg-white border-gray-300'} text-gray-800 transition-all duration-200`}
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
        <div className="mt-4 flex flex-col items-center gap-2 w-full">
          <div className="text-gray-600 text-lg text-center">Guesses: {guesses.length}/7</div>
          <div className="flex gap-2 justify-center w-full">
            <input
              type="text"
              maxLength={5}
              value={currentGuess}
              onChange={e => setCurrentGuess(e.target.value.toUpperCase())}
              className="px-4 py-2 rounded border text-gray-800 text-center"
              disabled={remainingGuesses <= 0}
              onKeyDown={handleKeyDown}
              placeholder="Enter 5-letter word"
            />
            <button
              onClick={handleSubmit}
              className="px-4 py-2 bg-accent text-white rounded font-semibold hover:bg-accent/80 disabled:bg-gray-400"
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