const fs = require('fs');

// Function to fix incorrect assignments in matchController.ts
function fixMatchAssignments() {
  console.log('🔧 Fixing incorrect assignments in matchController.ts...');
  
  let content = fs.readFileSync('backend/src/controllers/matchController.ts', 'utf8');
  let modified = false;

  // Fix the incorrect assignments that were made
  const fixes = [
    // Fix assignment to getPayoutResult() - should be setPayoutResult()
    { 
      pattern: /match\.getPayoutResult\(\)\s*=\s*payoutResult;/g, 
      replacement: 'match.setPayoutResult(payoutResult);' 
    },
    { 
      pattern: /updatedMatch\.getPayoutResult\(\)\s*=\s*payoutResult;/g, 
      replacement: 'updatedMatch.setPayoutResult(payoutResult);' 
    },
    
    // Fix assignment to getPlayer1Result() - should be setPlayer1Result()
    { 
      pattern: /match\.getPlayer1Result\(\)\s*=\s*serverValidatedResult;/g, 
      replacement: 'match.setPlayer1Result(serverValidatedResult);' 
    },
    
    // Fix assignment to getPlayer2Result() - should be setPlayer2Result()
    { 
      pattern: /match\.getPlayer2Result\(\)\s*=\s*serverValidatedResult;/g, 
      replacement: 'match.setPlayer2Result(serverValidatedResult);' 
    },
  ];

  fixes.forEach(fix => {
    const newContent = content.replace(fix.pattern, fix.replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
      console.log(`✅ Applied fix: ${fix.pattern}`);
    }
  });

  if (modified) {
    fs.writeFileSync('backend/src/controllers/matchController.ts', content, 'utf8');
    console.log('✅ Successfully fixed incorrect assignments in matchController.ts');
  } else {
    console.log('ℹ️ No assignment fixes needed');
  }
}

// Run the fix
fixMatchAssignments();
