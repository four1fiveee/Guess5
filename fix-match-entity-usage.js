const fs = require('fs');

// Function to fix Match entity usage in matchController.ts
function fixMatchEntityUsage() {
  console.log('🔧 Fixing Match entity usage in matchController.ts...');
  
  let content = fs.readFileSync('backend/src/controllers/matchController.ts', 'utf8');
  let modified = false;

  // Fix direct access to player1Result and player2Result
  const patterns = [
    // Replace direct access with getter methods
    { 
      pattern: /match\.player1Result/g, 
      replacement: 'match.getPlayer1Result()' 
    },
    { 
      pattern: /match\.player2Result/g, 
      replacement: 'match.getPlayer2Result()' 
    },
    { 
      pattern: /match\.payoutResult/g, 
      replacement: 'match.getPayoutResult()' 
    },
    
    // Replace direct assignment with setter methods
    { 
      pattern: /match\.player1Result\s*=\s*([^;]+);/g, 
      replacement: 'match.setPlayer1Result($1);' 
    },
    { 
      pattern: /match\.player2Result\s*=\s*([^;]+);/g, 
      replacement: 'match.setPlayer2Result($1);' 
    },
    { 
      pattern: /match\.payoutResult\s*=\s*([^;]+);/g, 
      replacement: 'match.setPayoutResult($1);' 
    },
    
    // Fix specific patterns where we need to handle the result differently
    { 
      pattern: /updatedMatch\.player1Result/g, 
      replacement: 'updatedMatch.getPlayer1Result()' 
    },
    { 
      pattern: /updatedMatch\.player2Result/g, 
      replacement: 'updatedMatch.getPlayer2Result()' 
    },
    { 
      pattern: /updatedMatch\.payoutResult/g, 
      replacement: 'updatedMatch.getPayoutResult()' 
    },
  ];

  patterns.forEach(fix => {
    const newContent = content.replace(fix.pattern, fix.replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
      console.log(`✅ Applied fix: ${fix.pattern}`);
    }
  });

  // Fix specific problematic patterns that need special handling
  content = content.replace(
    /const payoutResult = await determineWinnerAndPayout\(matchId, updatedMatch\.getPlayer1Result\(\), updatedMatch\.getPlayer2Result\(\)\);/g,
    `const payoutResult = await determineWinnerAndPayout(matchId, updatedMatch.getPlayer1Result(), updatedMatch.getPlayer2Result());`
  );

  // Fix the specific line where we check if results exist
  content = content.replace(
    /if \(isPlayer1 && match\.getPlayer1Result\(\)\)/g,
    'if (isPlayer1 && match.getPlayer1Result())'
  );
  
  content = content.replace(
    /if \(!isPlayer1 && match\.getPlayer2Result\(\)\)/g,
    'if (!isPlayer1 && match.getPlayer2Result())'
  );

  content = content.replace(
    /if \(\(isPlayer1 && match\.getPlayer2Result\(\)\) \|\| \(!isPlayer1 && match\.getPlayer1Result\(\)\)\)/g,
    'if ((isPlayer1 && match.getPlayer2Result()) || (!isPlayer1 && match.getPlayer1Result()))'
  );

  // Fix the specific line where we check both results exist
  content = content.replace(
    /if \(updatedMatch\.getPlayer1Result\(\) && updatedMatch\.getPlayer2Result\(\) &&/g,
    'if (updatedMatch.getPlayer1Result() && updatedMatch.getPlayer2Result() &&'
  );

  if (modified) {
    fs.writeFileSync('backend/src/controllers/matchController.ts', content, 'utf8');
    console.log('✅ Successfully updated matchController.ts to use new helper methods');
  } else {
    console.log('ℹ️ No changes needed for matchController.ts');
  }
}

// Run the fix
fixMatchEntityUsage();
