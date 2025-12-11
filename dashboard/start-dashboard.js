#!/usr/bin/env node

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function maskSecret(value, showChars = 4) {
  if (!value || value.length <= showChars) return '***';
  return value.slice(0, showChars) + '***' + value.slice(-showChars);
}

function checkEnvFile() {
  const envPath = path.join(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) {
    log('❌ .env.local file not found!', 'red');
    log('   Please create .env.local from env.example.txt', 'yellow');
    log('\n   Waiting 5 seconds before exiting...', 'yellow');
    setTimeout(() => {
      process.exit(1);
    }, 5000);
    return null; // Won't reach here, but for type safety
  }
  return envPath;
}

function loadAndDisplayEnv() {
  const envPath = checkEnvFile();
  if (!envPath) {
    // Error already logged, exit will happen after delay
    return {};
  }
  const envContent = fs.readFileSync(envPath, 'utf8');
  const envVars = {};
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        envVars[key.trim()] = valueParts.join('=').trim();
      }
    }
  });

  log('\n📋 Critical Environment Variables:', 'bright');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
  
  const criticalVars = {
    'DATABASE_URL': 'Database Connection',
    'REDIS_MM_HOST': 'Redis MM Host',
    'REDIS_OPS_HOST': 'Redis OPS Host',
    'SOLANA_NETWORK': 'Solana Network',
    'RENDER_SERVICE_URL': 'Render Service',
  };

  for (const [key, label] of Object.entries(criticalVars)) {
    const value = envVars[key];
    if (value) {
      let displayValue = value;
      if (key === 'DATABASE_URL') {
        // Extract just the host from postgres URL
        const match = value.match(/@([^:]+):/);
        displayValue = match ? `postgresql://...@${match[1]}:...` : maskSecret(value);
      } else if (key.includes('PASSWORD')) {
        displayValue = maskSecret(value);
      } else {
        displayValue = value.length > 50 ? value.slice(0, 50) + '...' : value;
      }
      log(`   ${label.padEnd(20)}: ${displayValue}`, 'green');
    } else {
      log(`   ${label.padEnd(20)}: ${colors.red}MISSING${colors.reset}`, 'red');
    }
  }
  
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'cyan');
  
  return envVars;
}

function checkDependencies() {
  log('🔍 Checking dependencies...', 'cyan');
  
  try {
    execSync('pnpm --version', { stdio: 'ignore' });
  } catch (error) {
    log('❌ pnpm not found!', 'red');
    log('   Install pnpm: npm install -g pnpm', 'yellow');
    log('\n   Waiting 5 seconds before exiting...', 'yellow');
    setTimeout(() => {
      process.exit(1);
    }, 5000);
    return;
  }

  const nodeModulesPath = path.join(__dirname, 'node_modules');
  if (!fs.existsSync(nodeModulesPath)) {
    log('📦 Installing dependencies (this may take a minute)...', 'yellow');
    try {
      execSync('pnpm install', { stdio: 'inherit', cwd: __dirname });
      log('✅ Dependencies installed!', 'green');
    } catch (error) {
      log('❌ Failed to install dependencies', 'red');
      log('\n   Waiting 5 seconds before exiting...', 'yellow');
      setTimeout(() => {
        process.exit(1);
      }, 5000);
      return;
    }
  } else {
    log('✅ Dependencies already installed', 'green');
  }
}

function openBrowser(url) {
  const platform = os.platform();
  let command;
  
  switch (platform) {
    case 'darwin':
      command = `open "${url}"`;
      break;
    case 'win32':
      // Try Chrome first, then default browser
      try {
        execSync(`start chrome "${url}"`, { stdio: 'ignore' });
        log(`\n🌐 Opening Chrome at ${url}...`, 'cyan');
        return;
      } catch (e) {
        // Fall back to default browser
        command = `start "" "${url}"`;
      }
      break;
    default:
      command = `xdg-open "${url}"`;
  }
  
  try {
    execSync(command, { stdio: 'ignore' });
    log(`\n🌐 Opening browser at ${url}...`, 'cyan');
  } catch (error) {
    log(`\n⚠️  Could not open browser automatically. Please visit: ${url}`, 'yellow');
  }
}

function startDashboard() {
  try {
    log('\n🚀 Starting Guess5.io Dashboard...\n', 'bright');
    
    // Check and display env
    const envVars = loadAndDisplayEnv();
    
    // Check dependencies
    checkDependencies();
    
    log('🎯 Starting development servers...\n', 'cyan');
    log('   API Server:  http://localhost:4000', 'blue');
    log('   Frontend:    http://localhost:5173', 'blue');
    log('\n   💡 Tip: Bookmark http://localhost:5173 for quick access!', 'yellow');
    log('   Press Ctrl+C to stop\n', 'yellow');
    
    const url = 'http://localhost:5173';
    
    // Start the dev server first
    const devProcess = spawn('pnpm', ['dev'], {
      stdio: 'inherit',
      shell: true,
      cwd: __dirname,
    });
    
    devProcess.on('error', (error) => {
      log(`❌ Failed to start: ${error.message}`, 'red');
      log(`\n⚠️  Make sure pnpm is installed: npm install -g pnpm`, 'yellow');
      setTimeout(() => {
        process.exit(1);
      }, 2000);
    });
    
    // Wait for server to be ready, then open browser
    let browserOpened = false;
    const checkServerAndOpen = setInterval(() => {
      // Try to fetch the page to see if server is ready
      const http = require('http');
      const req = http.get(url, (res) => {
        if (res.statusCode === 200 && !browserOpened) {
          browserOpened = true;
          clearInterval(checkServerAndOpen);
          log(`\n✅ Server ready! Opening browser...`, 'green');
          openBrowser(url);
          log(`\n🌐 Dashboard opened at ${url}`, 'cyan');
          log('   (If browser did not open, manually visit the URL above)\n', 'yellow');
        }
      });
      req.on('error', () => {
        // Server not ready yet, keep waiting
      });
      req.setTimeout(1000);
      req.on('timeout', () => {
        req.destroy();
      });
    }, 2000); // Check every 2 seconds
    
    // Fallback: open browser after 8 seconds even if check didn't work
    setTimeout(() => {
      if (!browserOpened) {
        browserOpened = true;
        clearInterval(checkServerAndOpen);
        log(`\n🌐 Opening browser (fallback)...`, 'cyan');
      openBrowser(url);
        log(`\n   Dashboard should be at ${url}`, 'blue');
        log('   (If browser did not open, manually visit the URL above)\n', 'yellow');
      }
    }, 8000);
    
    devProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        log(`\n⚠️  Process exited with code ${code}`, 'yellow');
      }
      // Exit when the dev process exits
      setTimeout(() => {
        process.exit(code || 0);
      }, 500);
    });
    
    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      log('\n\n🛑 Shutting down dashboard...', 'yellow');
      devProcess.kill('SIGINT');
      // Give it a moment to clean up
      setTimeout(() => {
        process.exit(0);
      }, 1000);
    });
    
    // Keep the Node.js process alive - it will exit when devProcess exits
  } catch (error) {
    log(`❌ Unexpected error: ${error.message}`, 'red');
    console.error(error);
    setTimeout(() => {
      process.exit(1);
    }, 3000);
  }
}

// Run it
startDashboard();


