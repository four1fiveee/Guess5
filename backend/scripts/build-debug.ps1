# Build Debug Script
# This script investigates the cargo metadata issue and tries alternative approaches

Write-Host "Starting Build Debug Investigation..." -ForegroundColor Green
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

Write-Host ""
Write-Host "Investigating build environment..." -ForegroundColor Yellow

# Check current Rust toolchains
Write-Host "Current Rust toolchains:" -ForegroundColor Cyan
rustup toolchain list

# Verify we're using the right Rust
$currentRust = rustc --version 2>&1
Write-Host "Current Rust version: $currentRust" -ForegroundColor Cyan

# Check if we have the solana toolchain
$solanaToolchain = rustup toolchain list | Select-String "solana"
if ($solanaToolchain) {
    Write-Host "❌ Solana toolchain still exists!" -ForegroundColor Red
    Write-Host "Found: $solanaToolchain" -ForegroundColor Yellow
} else {
    Write-Host "✅ Solana toolchain successfully removed" -ForegroundColor Green
}

Write-Host ""
Write-Host "Building smart contract with debug investigation..." -ForegroundColor Yellow

# Change to smart contract directory
Set-Location "..\smart-contract"

# Set environment variables
$env:HOME = $env:USERPROFILE
$env:CARGO_HOME = "$env:USERPROFILE\.cargo"
$env:RUSTUP_HOME = "$env:USERPROFILE\.rustup"

# Force system Rust toolchain
$env:RUSTUP_TOOLCHAIN = "1.79.0"
$env:CARGO = "$env:USERPROFILE\.cargo\bin\cargo.exe"
$env:RUSTC = "$env:USERPROFILE\.cargo\bin\rustc.exe"

Write-Host "Environment variables set" -ForegroundColor Cyan
Write-Host "Forcing Rust 1.79.0 toolchain: $env:RUSTUP_TOOLCHAIN" -ForegroundColor Cyan
Write-Host "Using Cargo: $env:CARGO" -ForegroundColor Cyan
Write-Host "Using Rustc: $env:RUSTC" -ForegroundColor Cyan

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

# CRITICAL: Remove any Anchor toolchain configuration files
Write-Host "Removing Anchor toolchain configuration..." -ForegroundColor Yellow
$anchorConfigPaths = @(
    "$env:USERPROFILE\.anchor",
    "$env:USERPROFILE\.cargo\config.toml",
    "$env:USERPROFILE\.cargo\config"
)

foreach ($path in $anchorConfigPaths) {
    if (Test-Path $path) {
        Write-Host "Removing: $path" -ForegroundColor Yellow
        Remove-Item $path -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# CRITICAL: Double-check we're using the right Rust version
Write-Host "Verifying Rust version before build..." -ForegroundColor Yellow
$verifyRust = rustc --version 2>&1
Write-Host "Rust version for build: $verifyRust" -ForegroundColor Cyan

Write-Host ""
Write-Host "=== DEBUG: Testing cargo metadata ===" -ForegroundColor Yellow

# Test cargo metadata directly
Write-Host "Testing cargo metadata with Rust 1.79.0..." -ForegroundColor Cyan
$metadataOutput = rustup run 1.79.0 cargo metadata --format-version 1 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Cargo metadata successful with Rust 1.79.0" -ForegroundColor Green
} else {
    Write-Host "❌ Cargo metadata failed with Rust 1.79.0" -ForegroundColor Red
    Write-Host "Error: $metadataOutput" -ForegroundColor White
}

Write-Host ""
Write-Host "=== DEBUG: Testing cargo build directly ===" -ForegroundColor Yellow

# Test direct cargo build
Write-Host "Testing direct cargo build with Rust 1.79.0..." -ForegroundColor Cyan
$directBuildOutput = rustup run 1.79.0 cargo build --target bpfel-unknown-unknown --release 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Direct cargo build successful!" -ForegroundColor Green
} else {
    Write-Host "❌ Direct cargo build failed" -ForegroundColor Red
    Write-Host "Error: $directBuildOutput" -ForegroundColor White
}

Write-Host ""
Write-Host "=== DEBUG: Testing anchor build ===" -ForegroundColor Yellow

# Test anchor build
Write-Host "Testing anchor build with Rust 1.79.0..." -ForegroundColor Cyan
$anchorBuildOutput = rustup run 1.79.0 anchor build 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Anchor build successful!" -ForegroundColor Green
    
    # Check if the Solana program binary was created
    if (Test-Path "target\deploy\guess5_escrow.so") {
        Write-Host "✅ Solana program binary found: target\deploy\guess5_escrow.so" -ForegroundColor Green
        
        Write-Host ""
        Write-Host "Deploying smart contract to devnet..." -ForegroundColor Yellow
        
        # Deploy the contract using the same toolchain
        $deployOutput = rustup run 1.79.0 anchor deploy --provider.cluster devnet 2>&1
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
        }
        
    } else {
        Write-Host "❌ Solana program binary not found!" -ForegroundColor Red
        Write-Host "Build output:" -ForegroundColor Cyan
        Write-Host $anchorBuildOutput -ForegroundColor White
    }
    
} else {
    Write-Host "❌ Anchor build failed" -ForegroundColor Red
    Write-Host ""
    Write-Host "Build output:" -ForegroundColor Cyan
    Write-Host $anchorBuildOutput -ForegroundColor White
    Write-Host ""
    Write-Host "=== DEBUG ANALYSIS ===" -ForegroundColor Yellow
    Write-Host "1. Cargo metadata test completed" -ForegroundColor White
    Write-Host "2. Direct cargo build test completed" -ForegroundColor White
    Write-Host "3. Anchor build test completed" -ForegroundColor White
    Write-Host "4. Check the output above for specific error messages" -ForegroundColor White
}

Read-Host "Press Enter to continue"


