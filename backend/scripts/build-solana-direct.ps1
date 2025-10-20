# Direct Solana Program Build Script
# This script builds the Solana program directly with the correct target

Write-Host "Starting Direct Solana Program Build..." -ForegroundColor Green
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "..\smart-contract")) {
    Write-Host "Error: smart-contract directory not found" -ForegroundColor Red
    Write-Host "Please run this script from the backend\scripts directory" -ForegroundColor Red
    exit 1
}

Write-Host "Checking prerequisites..." -ForegroundColor Yellow

# Check if Solana is available
try {
    $solanaVersion = solana --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Solana CLI found: $solanaVersion" -ForegroundColor Green
    } else {
        throw "Solana CLI not found"
    }
} catch {
    Write-Host "Error: Solana CLI not found" -ForegroundColor Red
    exit 1
}

# Check if Anchor is available
try {
    $anchorVersion = anchor --version 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Anchor CLI found: $anchorVersion" -ForegroundColor Green
    } else {
        throw "Anchor CLI not found"
    }
} catch {
    Write-Host "Error: Anchor CLI not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Setting up devnet configuration..." -ForegroundColor Yellow

# Set devnet RPC
solana config set --url https://api.devnet.solana.com
Write-Host "✅ Devnet RPC configured" -ForegroundColor Green

# Check wallet configuration
$config = solana config get 2>$null
Write-Host "✅ Wallet configuration found" -ForegroundColor Green

# Check balance
$balance = solana balance 2>$null
Write-Host "Current balance: $balance" -ForegroundColor Cyan

if ([double]($balance -replace ' SOL', '') -lt 1) {
    Write-Host "Requesting devnet SOL..." -ForegroundColor Yellow
    solana airdrop 2
    $finalBalance = solana balance 2>$null
    Write-Host "Final balance: $finalBalance" -ForegroundColor Cyan
}

Write-Host ""
Write-Host "Building Solana program directly..." -ForegroundColor Yellow

# Change to smart contract directory
Set-Location "..\smart-contract"

# Set environment variables
$env:HOME = $env:USERPROFILE
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"

Write-Host "Environment variables set" -ForegroundColor Cyan

# Clean previous build artifacts
Write-Host "Cleaning previous build artifacts..." -ForegroundColor Yellow
anchor clean

# Remove any existing Cargo.lock files
Write-Host "Removing Cargo.lock files..." -ForegroundColor Yellow
$lockFiles = Get-ChildItem -Path "." -Recurse -Name "Cargo.lock"
foreach ($lockFile in $lockFiles) {
    Write-Host "Removing: $lockFile" -ForegroundColor Yellow
    Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

# Check if we have the Solana target
Write-Host "Checking Solana target..." -ForegroundColor Yellow
$targetCheck = rustc --print target-list 2>&1 | Select-String "bpfel-unknown-unknown"

if ($targetCheck) {
    Write-Host "✅ Solana target found: bpfel-unknown-unknown" -ForegroundColor Green
} else {
    Write-Host "❌ Solana target not found. Installing..." -ForegroundColor Yellow
    rustup target add bpfel-unknown-unknown
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Solana target installed successfully" -ForegroundColor Green
    } else {
        Write-Host "❌ Failed to install Solana target" -ForegroundColor Red
        Write-Host "Trying alternative approach..." -ForegroundColor Yellow
    }
}

# Change to the program directory
Set-Location "programs\guess5-escrow"

Write-Host "Building with Solana target..." -ForegroundColor Yellow
Write-Host "Running: cargo build --target bpfel-unknown-unknown --release" -ForegroundColor Cyan

# Build directly with the Solana target
$buildOutput = cargo build --target bpfel-unknown-unknown --release 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Solana program built successfully!" -ForegroundColor Green
    
    # Check if the binary was created
    if (Test-Path "target\bpfel-unknown-unknown\release\guess5_escrow.so") {
        Write-Host "✅ Solana program binary found: target\bpfel-unknown-unknown\release\guess5_escrow.so" -ForegroundColor Green
        
        # Copy to the expected location for deployment
        Write-Host "Copying binary to deployment location..." -ForegroundColor Yellow
        $deployDir = "..\..\target\deploy"
        if (-not (Test-Path $deployDir)) {
            New-Item -ItemType Directory -Path $deployDir -Force | Out-Null
        }
        
        Copy-Item "target\bpfel-unknown-unknown\release\guess5_escrow.so" "$deployDir\guess5_escrow.so" -Force
        Write-Host "✅ Binary copied to: $deployDir\guess5_escrow.so" -ForegroundColor Green
        
        # Go back to smart-contract root for deployment
        Set-Location "..\.."
        
        Write-Host ""
        Write-Host "Deploying smart contract to devnet..." -ForegroundColor Yellow
        
        # Deploy the contract using Anchor
        $deployOutput = anchor deploy --provider.cluster devnet 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Smart contract deployed successfully!" -ForegroundColor Green
            
            # Extract program ID from output
            if ($deployOutput -match "Program Id: (\w+)") {
                $programId = $matches[1]
                Write-Host "Program ID: $programId" -ForegroundColor Green
            } else {
                Write-Host "Warning: Could not extract Program ID from output" -ForegroundColor Yellow
                Write-Host "Deployment output:" -ForegroundColor Cyan
                Write-Host $deployOutput -ForegroundColor White
                $programId = "YOUR_PROGRAM_ID_HERE"
            }
            
            Write-Host ""
            Write-Host "=== DEPLOYMENT SUMMARY ===" -ForegroundColor Green
            Write-Host "Program ID: $programId" -ForegroundColor Cyan
            Write-Host "Network: Devnet" -ForegroundColor Cyan
            Write-Host "RPC Endpoint: https://api.devnet.solana.com" -ForegroundColor Cyan
            Write-Host ""
            
            Write-Host "=== NEXT STEPS ===" -ForegroundColor Green
            Write-Host "1. Add these environment variables to your Render backend:" -ForegroundColor Yellow
            Write-Host "   SMART_CONTRACT_PROGRAM_ID=$programId" -ForegroundColor White
            Write-Host "   RESULTS_ATTESTOR_PUBKEY=YOUR_RESULTS_ATTESTOR_PUBKEY" -ForegroundColor White
            Write-Host "   DEFAULT_FEE_BPS=500" -ForegroundColor White
            Write-Host "   DEFAULT_DEADLINE_BUFFER_SLOTS=1000" -ForegroundColor White
            Write-Host "   MIN_STAKE_LAMPORTS=1000000" -ForegroundColor White
            Write-Host "   MAX_FEE_BPS=1000" -ForegroundColor White
            Write-Host "   SOLANA_NETWORK=https://api.devnet.solana.com" -ForegroundColor White
            Write-Host "   SOLANA_CLUSTER=devnet" -ForegroundColor White
            Write-Host ""
            Write-Host "2. Add these environment variables to your Vercel frontend:" -ForegroundColor Yellow
            Write-Host "   NEXT_PUBLIC_SMART_CONTRACT_PROGRAM_ID=$programId" -ForegroundColor White
            Write-Host "   NEXT_PUBLIC_SOLANA_NETWORK=https://api.devnet.solana.com" -ForegroundColor White
            Write-Host ""
            Write-Host "3. Generate results attestor: solana-keygen new --outfile ~/.config/solana/results-attestor.json" -ForegroundColor Yellow
            Write-Host "4. Run database migration: npm run migration:run" -ForegroundColor Yellow
            Write-Host "5. Test the integration with small amounts (0.001 SOL)" -ForegroundColor Yellow
            
        } else {
            Write-Host "❌ Failed to deploy smart contract" -ForegroundColor Red
            Write-Host ""
            Write-Host "Deployment output:" -ForegroundColor Cyan
            Write-Host $deployOutput -ForegroundColor White
            Write-Host ""
            Write-Host "=== TROUBLESHOOTING ===" -ForegroundColor Yellow
            Write-Host "1. Check your devnet SOL balance: solana balance" -ForegroundColor White
            Write-Host "2. Request airdrop if needed: solana airdrop 2" -ForegroundColor White
            Write-Host "3. Verify devnet connection: solana config get" -ForegroundColor White
            Write-Host "4. Check wallet configuration: solana config get" -ForegroundColor White
        }
        
    } else {
        Write-Host "❌ Solana program binary not found!" -ForegroundColor Red
        Write-Host "Expected location: target\bpfel-unknown-unknown\release\guess5_escrow.so" -ForegroundColor White
        Write-Host "Build output:" -ForegroundColor Cyan
        Write-Host $buildOutput -ForegroundColor White
    }
    
} else {
    Write-Host "❌ Failed to build Solana program" -ForegroundColor Red
    Write-Host ""
    Write-Host "Build output:" -ForegroundColor Cyan
    Write-Host $buildOutput -ForegroundColor White
    Write-Host ""
    Write-Host "=== TROUBLESHOOTING ===" -ForegroundColor Yellow
    Write-Host "1. Check Rust version: rustc --version" -ForegroundColor White
    Write-Host "2. Try updating Rust: rustup update" -ForegroundColor White
    Write-Host "3. Check if Solana target is available: rustup target list | findstr bpfel" -ForegroundColor White
    Write-Host "4. Try installing Solana target: rustup target add bpfel-unknown-unknown" -ForegroundColor White
}

Read-Host "Press Enter to continue"


