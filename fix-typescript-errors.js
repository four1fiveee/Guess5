const fs = require('fs');
const path = require('path');

// Read the matchController.ts file
const filePath = path.join(__dirname, 'backend', 'src', 'controllers', 'matchController.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Fix all function parameter type annotations
const functionParamFixes = [
  // Fix function parameters that need type annotations
  { pattern: /const (\w+)Handler = async \(req, res\) =>/g, replacement: 'const $1Handler = async (req: any, res: any) =>' },
  { pattern: /const (\w+) = async \(req, res\) =>/g, replacement: 'const $1 = async (req: any, res: any) =>' },
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
];

// Fix error handling blocks
const errorHandlingFixes = [
  // Fix catch blocks that need type annotations
  { pattern: /} catch \(error\) {/g, replacement: '} catch (error: unknown) {' },
  { pattern: /} catch \(dbError\) {/g, replacement: '} catch (dbError: unknown) {' },
  { pattern: /} catch \(repoError\) {/g, replacement: '} catch (repoError: unknown) {' },
  { pattern: /} catch \(e\) {/g, replacement: '} catch (e: unknown) {' },
];

// Fix error.message access
const errorMessageFixes = [
  // Replace error.message with proper type checking
  { 
    pattern: /console\.error\([^)]*error\.message[^)]*\)/g, 
    replacement: (match) => {
      return match.replace(/error\.message/g, 'errorMessage');
    }
  },
  { 
    pattern: /error\.message/g, 
    replacement: 'errorMessage' 
  },
  { 
    pattern: /error\.stack/g, 
    replacement: 'errorStack' 
  },
  { 
    pattern: /error\.name/g, 
    replacement: 'errorName' 
  },
];

// Apply function parameter fixes
functionParamFixes.forEach(fix => {
  content = content.replace(fix.pattern, fix.replacement);
});

// Apply error handling fixes
errorHandlingFixes.forEach(fix => {
  content = content.replace(fix.pattern, fix.replacement);
});

// Add error type checking before error.message access
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

// Write the fixed content back to the file
fs.writeFileSync(filePath, content, 'utf8');

console.log('✅ Fixed TypeScript errors in matchController.ts');
