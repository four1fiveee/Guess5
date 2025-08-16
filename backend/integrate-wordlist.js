const fs = require('fs');

// Read the word list from the Word List folder
const readWordList = () => {
  try {
    const wordListPath = './Word List/WORDS';
    const content = fs.readFileSync(wordListPath, 'utf8');
    
    // Split by lines and filter for 5-letter words
    const words = content
      .split('\n')
      .map(word => word.trim().toUpperCase())
      .filter(word => word.length === 5 && /^[A-Z]+$/.test(word));
    
    // Remove duplicates
    const uniqueWords = [...new Set(words)];
    
    console.log(`📊 Total words read: ${words.length}`);
    console.log(`📊 Unique 5-letter words: ${uniqueWords.length}`);
    
    return uniqueWords;
  } catch (error) {
    console.error('❌ Error reading word list:', error.message);
    return [];
  }
};

// Create the wordList.ts file
const createWordListFile = (words) => {
  if (words.length === 0) {
    console.error('❌ No words to process');
    return;
  }
  
  // Take first 2500 words if we have more
  const finalWords = words.slice(0, 2500);
  
  const newContent = `import crypto from 'crypto';

// Comprehensive list of ${finalWords.length} most common 5-letter English words for production gameplay
// Source: GitHub gist - intersection of Wikipedia, American English, and British English dictionaries
// https://gist.github.com/shmookey/b28e342e1b1756c4700f42f17102c2ff
const wordList = [
  ${finalWords.map(word => `"${word}"`).join(', ')}
];

// Remove duplicates and ensure all words are exactly 5 letters
const uniqueWords = Array.from(new Set(wordList)).filter(word => word.length === 5);

// Cryptographically secure random word selection
export const getRandomWord = (): string => {
  try {
    // Use crypto.randomBytes for cryptographically secure randomness
    const randomBytes = crypto.randomBytes(4);
    const randomIndex = randomBytes.readUInt32BE(0) % uniqueWords.length;
    const selectedWord = uniqueWords[randomIndex];
    
    console.log(\`🎲 Cryptographically secure word selected: \${selectedWord}\`);
    return selectedWord;
  } catch (error) {
    console.error('❌ Error in secure word selection:', error);
    // Fallback to Math.random() if crypto fails (should never happen)
    const randomIndex = Math.floor(Math.random() * uniqueWords.length);
    return uniqueWords[randomIndex];
  }
};

// Validate if a word is in the word list
export const isValidWord = (word: string): boolean => {
  return uniqueWords.includes(word.toUpperCase());
};

export default uniqueWords;
`;

  try {
    fs.writeFileSync('src/wordList.ts', newContent);
    console.log('✅ Generated wordList.ts successfully!');
    console.log(`📊 Final word count: ${finalWords.length}`);
    console.log('🔤 First 10 words:', finalWords.slice(0, 10));
    console.log('🔤 Last 10 words:', finalWords.slice(-10));
  } catch (error) {
    console.error('❌ Error writing wordList.ts:', error.message);
  }
};

// Clean up unnecessary word generation scripts
const cleanupScripts = () => {
  const scriptsToRemove = [
    'use-github-wordlist.js',
    'add-more-words.js',
    'final-wordlist.js',
    'add-words.js',
    'generate-wordlist.js',
    'temp_words.txt'
  ];
  
  console.log('🧹 Cleaning up unnecessary scripts...');
  
  scriptsToRemove.forEach(script => {
    try {
      if (fs.existsSync(script)) {
        fs.unlinkSync(script);
        console.log(`✅ Removed: ${script}`);
      }
    } catch (error) {
      console.log(`⚠️ Could not remove ${script}: ${error.message}`);
    }
  });
};

// Main execution
const main = () => {
  console.log('🔄 Integrating word list from Word List folder...');
  
  const words = readWordList();
  
  if (words.length > 0) {
    createWordListFile(words);
    cleanupScripts();
    console.log('🎉 Word list integration complete!');
  } else {
    console.error('❌ Failed to read word list');
  }
};

main();
