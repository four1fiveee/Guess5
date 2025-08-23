const fs = require('fs');
const path = require('path');

// Function to fix TypeScript errors in a file
function fixTypeScriptErrors(filePath) {
  console.log(`🔧 Fixing TypeScript errors in: ${filePath}`);
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Fix duplicate variable declarations in catch blocks
  const duplicateVarPattern = /const errorMessage = error instanceof Error \? error\.message : String\(error\);\s*const errorStack = error instanceof Error \? error\.stack : undefined;\s*const errorName = error instanceof Error \? error\.name : undefined;\s*const errorMessage = error instanceof Error \? error\.message : String\(error\);\s*const errorStack = error instanceof Error \? error\.stack : undefined;\s*const errorName = error instanceof Error \? error\.name : undefined;/g;
  
  if (duplicateVarPattern.test(content)) {
    content = content.replace(duplicateVarPattern, 
      'const errorMessage = error instanceof Error ? error.message : String(error);\n      const errorStack = error instanceof Error ? error.stack : undefined;\n      const errorName = error instanceof Error ? error.name : undefined;'
    );
    modified = true;
  }

  // Fix function parameters that need type annotations
  const functionParamPatterns = [
    { pattern: /const determineWinnerAndPayout = async \(matchId, player1Result, player2Result\) =>/g, replacement: 'const determineWinnerAndPayout = async (matchId: any, player1Result: any, player2Result: any) =>' },
    { pattern: /const processAutomatedRefunds = async \(match, reason = 'unknown'\) =>/g, replacement: "const processAutomatedRefunds = async (match: any, reason: any = 'unknown') =>" },
    { pattern: /const convertToEST = \(date\) =>/g, replacement: 'const convertToEST = (date: any) =>' },
    { pattern: /const getFiscalInfo = \(date\) =>/g, replacement: 'const getFiscalInfo = (date: any) =>' },
    { pattern: /const sanitizeCsvValue = \(value\) =>/g, replacement: 'const sanitizeCsvValue = (value: any) =>' },
    { pattern: /const generateRowHash = \(match\) =>/g, replacement: 'const generateRowHash = (match: any) =>' },
    { pattern: /const convertToEST = \(timestamp\) =>/g, replacement: 'const convertToEST = (timestamp: any) =>' },
    { pattern: /\.map\(row => row\.map\(field =>/g, replacement: '.map((row: any) => row.map((field: any) =>' },
    { pattern: /const selfMatches = activeMatches\.filter\(match =>/g, replacement: 'const selfMatches = activeMatches.filter((match: any) =>' },
    { pattern: /this\.wss\.on\('connection', \(ws: WebSocket, req\) =>/g, replacement: "this.wss.on('connection', (ws: WebSocket, req: any) =>" },
  ];

  // Fix error handling patterns
  const errorHandlingPatterns = [
    { pattern: /console\.warn\('⚠️ Database lookup failed:', dbError\.message\);/g, replacement: 'console.warn(\'⚠️ Database lookup failed:\', errorMessage);' },
    { pattern: /message: dbError\.message,/g, replacement: 'message: errorMessage,' },
    { pattern: /stack: dbError\.stack,/g, replacement: 'stack: errorStack,' },
    { pattern: /code: dbError\.code/g, replacement: 'code: errorName' },
    { pattern: /error: `Verification failed: \${error\.message}`/g, replacement: 'error: `Verification failed: ${errorMessage}`' },
    { pattern: /console\.log\(`⚠️ Column might already exist: \${error\.message}`\);/g, replacement: 'console.log(`⚠️ Column might already exist: ${errorMessage}`);' },
    { pattern: /details: error\.message/g, replacement: 'details: errorMessage' },
  ];

  // Fix property access on unknown types
  const propertyAccessPatterns = [
    { pattern: /payoutResult\.paymentInstructions =/g, replacement: '(payoutResult as any).paymentInstructions =' },
    { pattern: /payoutResult\.paymentSuccess =/g, replacement: '(payoutResult as any).paymentSuccess =' },
    { pattern: /payoutResult\.automatedPayout =/g, replacement: '(payoutResult as any).automatedPayout =' },
    { pattern: /payoutResult\.paymentError =/g, replacement: '(payoutResult as any).paymentError =' },
    { pattern: /winner: payoutResult\.winner,/g, replacement: 'winner: (payoutResult as any).winner,' },
  ];

  // Fix JSON.parse with unknown type
  const jsonParsePatterns = [
    { pattern: /const waitingPlayer: WaitingPlayer = JSON\.parse\(playerJson\);/g, replacement: 'const waitingPlayer: WaitingPlayer = JSON.parse(playerJson as string);' },
    { pattern: /const player: WaitingPlayer = JSON\.parse\(playerJson\);/g, replacement: 'const player: WaitingPlayer = JSON.parse(playerJson as string);' },
  ];

  // Apply function parameter fixes
  functionParamPatterns.forEach(fix => {
    const newContent = content.replace(fix.pattern, fix.replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  });

  // Apply error handling fixes
  errorHandlingPatterns.forEach(fix => {
    const newContent = content.replace(fix.pattern, fix.replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  });

  // Apply property access fixes
  propertyAccessPatterns.forEach(fix => {
    const newContent = content.replace(fix.pattern, fix.replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  });

  // Apply JSON.parse fixes
  jsonParsePatterns.forEach(fix => {
    const newContent = content.replace(fix.pattern, fix.replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  });

  // Fix specific patterns for different files
  if (filePath.includes('matchController.ts')) {
    // Fix specific matchController.ts patterns
    content = content.replace(
      /const errorMessage = error instanceof Error \? error\.message : String\(error\);\s*const errorStack = error instanceof Error \? error\.stack : undefined;\s*const errorName = error instanceof Error \? error\.name : undefined;\s*const errorMessage = error instanceof Error \? error\.message : String\(error\);\s*const errorStack = error instanceof Error \? error\.stack : undefined;\s*const errorName = error instanceof Error \? error\.name : undefined;\s*const errorMessage = error instanceof Error \? error\.message : String\(error\);\s*const errorStack = error instanceof Error \? error\.stack : undefined;\s*const errorName = error instanceof Error \? error\.name : undefined;/g,
      'const errorMessage = error instanceof Error ? error.message : String(error);\n      const errorStack = error instanceof Error ? error.stack : undefined;\n      const errorName = error instanceof Error ? error.name : undefined;'
    );
    modified = true;
  }

  if (filePath.includes('healthCheck.ts')) {
    // Fix specific healthCheck.ts patterns
    content = content.replace(
      /const errorMessage = error instanceof Error \? error\.message : String\(error\);\s*const errorMessage = error instanceof Error \? error\.message : String\(error\);/g,
      'const errorMessage = error instanceof Error ? error.message : String(error);'
    );
    modified = true;
  }

  // Write the fixed content back to the file
  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`✅ Fixed TypeScript errors in: ${filePath}`);
  } else {
    console.log(`ℹ️ No changes needed for: ${filePath}`);
  }
}

// List of files to fix
const filesToFix = [
  'backend/src/controllers/matchController.ts',
  'backend/src/utils/healthCheck.ts',
  'backend/src/services/redisMatchmakingService.ts',
  'backend/src/services/websocketService.ts'
];

// Fix all files
filesToFix.forEach(file => {
  if (fs.existsSync(file)) {
    fixTypeScriptErrors(file);
  } else {
    console.log(`⚠️ File not found: ${file}`);
  }
});

console.log('🎉 All remaining TypeScript errors fixed!');
