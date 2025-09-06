# Build with Compatible Dependencies Script
# This script tries to resolve dependency compatibility issues

Write-Host "Starting Build with Compatible Dependencies..." -ForegroundColor Green
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
Write-Host "Analyzing toolchain compatibility..." -ForegroundColor Yellow

# Check current Rust toolchains
Write-Host "Current Rust toolchains:" -ForegroundColor Cyan
rustup toolchain list

# Check if we have a newer Rust version that supports solana-program v2.3.0
Write-Host "Checking for compatible Rust versions..." -ForegroundColor Yellow
$stableVersion = rustup run stable rustc --version 2>&1
Write-Host "Stable Rust version: $stableVersion" -ForegroundColor Cyan

$rust179Version = rustup run 1.79.0 rustc --version 2>&1
Write-Host "Rust 1.79.0 version: $rust179Version" -ForegroundColor Cyan

# Check if we can install a newer Solana toolchain
Write-Host "Attempting to install a newer Solana toolchain..." -ForegroundColor Yellow
Write-Host "First, let's remove the old one..." -ForegroundColor Yellow
rustup toolchain uninstall solana

Write-Host "Now trying to install a newer Solana toolchain..." -ForegroundColor Yellow
rustup toolchain install solana

# Check what we got
$newSolanaVersion = rustup run solana rustc --version 2>&1
Write-Host "New Solana toolchain Rust version: $newSolanaVersion" -ForegroundColor Cyan

Write-Host ""
Write-Host "Building smart contract..." -ForegroundColor Yellow

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

# Try multiple approaches
Write-Host "Trying multiple build approaches..." -ForegroundColor Yellow

# Approach 1: Try with Solana toolchain
Write-Host "Approach 1: Building with Solana toolchain..." -ForegroundColor Yellow
$buildOutput1 = rustup run solana anchor build 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Success with Solana toolchain!" -ForegroundColor Green
    $buildOutput = $buildOutput1
    $success = $true
} else {
    Write-Host "❌ Failed with Solana toolchain" -ForegroundColor Red
    Write-Host "Build output:" -ForegroundColor Cyan
    Write-Host $buildOutput1 -ForegroundColor White
    
    # Approach 2: Try with Rust 1.79.0
    Write-Host "Approach 2: Building with Rust 1.79.0..." -ForegroundColor Yellow
    $buildOutput2 = rustup run 1.79.0 anchor build 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✅ Success with Rust 1.79.0!" -ForegroundColor Green
        $buildOutput = $buildOutput2
        $success = $true
    } else {
        Write-Host "❌ Failed with Rust 1.79.0" -ForegroundColor Red
        Write-Host "Build output:" -ForegroundColor Cyan
        Write-Host $buildOutput2 -ForegroundColor White
        
        # Approach 3: Try with stable Rust
        Write-Host "Approach 3: Building with stable Rust..." -ForegroundColor Yellow
        $buildOutput3 = rustup run stable anchor build 2>&1
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Success with stable Rust!" -ForegroundColor Green
            $buildOutput = $buildOutput3
            $success = $true
        } else {
            Write-Host "❌ Failed with stable Rust" -ForegroundColor Red
            Write-Host "Build output:" -ForegroundColor Cyan
            Write-Host $buildOutput3 -ForegroundColor White
            $success = $false
        }
    }
}

if ($success) {
    Write-Host "✅ Smart contract built successfully!" -ForegroundColor Green
    
    # Check if the Solana program binary was created
    if (Test-Path "target\deploy\guess5_escrow.so") {
        Write-Host "✅ Solana program binary found: target\deploy\guess5_escrow.so" -ForegroundColor Green
        
        Write-Host ""
        Write-Host "Deploying smart contract to devnet..." -ForegroundColor Yellow
        
        # Deploy the contract (use the same toolchain that worked for building)
        if ($buildOutput -eq $buildOutput1) {
            $deployOutput = rustup run solana anchor deploy --provider.cluster devnet 2>&1
        } elseif ($buildOutput -eq $buildOutput2) {
            $deployOutput = rustup run 1.79.0 anchor deploy --provider.cluster devnet 2>&1
        } else {
            $deployOutput = rustup run stable anchor deploy --provider.cluster devnet 2>&1
        }
        
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
        Write-Host "Build output:" -ForegroundColor Cyan
        Write-Host $buildOutput -ForegroundColor White
    }
    
} else {
    Write-Host "❌ All build approaches failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "=== TROUBLESHOOTING ===" -ForegroundColor Yellow
    Write-Host "1. The issue is dependency compatibility with Rust versions" -ForegroundColor White
    Write-Host "2. Try updating dependencies to compatible versions" -ForegroundColor White
    Write-Host "3. Check if Anchor supports the Rust versions we have" -ForegroundColor White
    Write-Host "4. Consider downgrading solana-program to a compatible version" -ForegroundColor White
}

Read-Host "Press Enter to continue"


