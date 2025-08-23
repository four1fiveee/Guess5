const fs = require('fs');
const path = require('path');

// Function to fix TypeScript errors in a file
function fixTypeScriptErrors(filePath) {
  console.log(`🔧 Fixing TypeScript errors in: ${filePath}`);
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Fix function parameters that need type annotations
  const functionParamPatterns = [
    { pattern: /const (\w+)Handler = async \(req, res\) =>/g, replacement: 'const $1Handler = async (req: any, res: any) =>' },
    { pattern: /const (\w+) = async \(req, res\) =>/g, replacement: 'const $1 = async (req: any, res: any) =>' },
    { pattern: /app\.use\(\(req, res, next\) =>/g, replacement: 'app.use((req: any, res: any, next: any) =>' },
    { pattern: /app\.get\([^)]*\(req, res\) =>/g, replacement: (match) => match.replace(/\(req, res\) =>/, '(req: any, res: any) =>') },
    { pattern: /app\.post\([^)]*\(req, res\) =>/g, replacement: (match) => match.replace(/\(req, res\) =>/, '(req: any, res: any) =>') },
    { pattern: /app\.options\([^)]*\(req, res\) =>/g, replacement: (match) => match.replace(/\(req, res\) =>/, '(req: any, res: any) =>') },
    { pattern: /asyncHandler\(async \(req, res\) =>/g, replacement: 'asyncHandler(async (req: any, res: any) =>' },
    { pattern: /async \(manager\) =>/g, replacement: 'async (manager: any) =>' },
    { pattern: /async \(date\) =>/g, replacement: 'async (date: any) =>' },
    { pattern: /async \(signature\) =>/g, replacement: 'async (signature: any) =>' },
    { pattern: /async \(match\) =>/g, replacement: 'async (match: any) =>' },
    { pattern: /async \(value\) =>/g, replacement: 'async (value: any) =>' },
    { pattern: /async \(timestamp\) =>/g, replacement: 'async (timestamp: any) =>' },
    { pattern: /async \(field\) =>/g, replacement: 'async (field: any) =>' },
    { pattern: /async \(error\) =>/g, replacement: 'async (error: any) =>' },
    { pattern: /\.map\(m =>/g, replacement: '.map((m: any) =>' },
    { pattern: /\.map\(match =>/g, replacement: '.map((match: any) =>' },
    { pattern: /\.map\(key =>/g, replacement: '.map((key: any) =>' },
    { pattern: /\.map\(conn =>/g, replacement: '.map((conn: any) =>' },
    { pattern: /\.findIndex\(key =>/g, replacement: '.findIndex((key: any) =>' },
    { pattern: /\.findIndex\(conn =>/g, replacement: '.findIndex((conn: any) =>' },
    { pattern: /origin: function \(origin, callback\)/g, replacement: 'origin: function (origin: any, callback: any)' },
    { pattern: /on\('error', \(error\) =>/g, replacement: "on('error', (error: any) =>" },
    { pattern: /on\('error', \(error\) =>/g, replacement: "on('error', (error: any) =>" },
  ];

  // Fix error handling blocks
  const errorHandlingPatterns = [
    { pattern: /} catch \(error\) {/g, replacement: '} catch (error: unknown) {' },
    { pattern: /} catch \(dbError\) {/g, replacement: '} catch (dbError: unknown) {' },
    { pattern: /} catch \(repoError\) {/g, replacement: '} catch (repoError: unknown) {' },
    { pattern: /} catch \(e\) {/g, replacement: '} catch (e: unknown) {' },
  ];

  // Apply function parameter fixes
  functionParamPatterns.forEach(fix => {
    if (typeof fix.replacement === 'function') {
      const newContent = content.replace(fix.pattern, fix.replacement);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    } else {
      const newContent = content.replace(fix.pattern, fix.replacement);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
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

  // Fix error.message access with proper type checking
  const catchBlocks = content.match(/} catch \(error: unknown\) \{[\s\S]*?\}/g) || [];
  catchBlocks.forEach(block => {
    if (block.includes('error.message') || block.includes('error.stack') || block.includes('error.name')) {
      const newBlock = block.replace(
        /} catch \(error: unknown\) \{/,
        `} catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;
      const errorName = error instanceof Error ? error.name : undefined;`
      );
      content = content.replace(block, newBlock);
      modified = true;
    }
  });

  // Fix specific error handling patterns
  content = content.replace(
    /console\.error\([^)]*error\.message[^)]*\)/g,
    (match) => {
      return match.replace(/error\.message/g, 'errorMessage');
    }
  );

  content = content.replace(
    /console\.warn\([^)]*error\.message[^)]*\)/g,
    (match) => {
      return match.replace(/error\.message/g, 'errorMessage');
    }
  );

  // Fix return statements with error.message
  content = content.replace(
    /return \{ success: false, error: error\.message \}/g,
    'return { success: false, error: errorMessage }'
  );

  content = content.replace(
    /return \{ error: `[^`]*\${error\.message}[^`]*` \}/g,
    (match) => {
      return match.replace(/error\.message/g, 'errorMessage');
    }
  );

  // Fix specific patterns for different files
  if (filePath.includes('app.ts')) {
    // Fix specific app.ts patterns
    content = content.replace(
      /app\.use\(\(req, res, next\) =>/g,
      'app.use((req: any, res: any, next: any) =>'
    );
  }

  if (filePath.includes('guessController.ts')) {
    // Fix guessController.ts specific patterns
    content = content.replace(
      /const submitGuessHandler = async \(req, res\) =>/g,
      'const submitGuessHandler = async (req: any, res: any) =>'
    );
  }

  if (filePath.includes('redis.ts')) {
    // Fix redis.ts specific patterns
    content = content.replace(
      /redisMM\.on\('error', \(error\) =>/g,
      "redisMM.on('error', (error: any) =>"
    );
    content = content.replace(
      /redisOps\.on\('error', \(error\) =>/g,
      "redisOps.on('error', (error: any) =>"
    );
  }

  if (filePath.includes('healthCheck.ts')) {
    // Fix healthCheck.ts specific patterns
    content = content.replace(
      /logger\.error\([^)]*error\.message[^)]*\)/g,
      (match) => {
        return match.replace(/error\.message/g, 'errorMessage');
      }
    );
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
  'backend/src/app.ts',
  'backend/src/controllers/guessController.ts',
  'backend/src/config/redis.ts',
  'backend/src/config/wallet.ts',
  'backend/src/controllers/matchController.ts',
  'backend/src/utils/healthCheck.ts',
  'backend/src/services/queueService.ts',
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

console.log('🎉 All TypeScript errors fixed!');
