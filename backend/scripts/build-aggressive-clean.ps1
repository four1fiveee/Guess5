# Build with Aggressive Clean Script
# This script aggressively removes the solana toolchain and forces Anchor to use only system Rust

Write-Host "Starting Build with Aggressive Clean..." -ForegroundColor Green
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
Write-Host "AGGRESSIVELY cleaning toolchain configuration..." -ForegroundColor Yellow

# Check current Rust toolchains
Write-Host "Current Rust toolchains:" -ForegroundColor Cyan
rustup toolchain list

# AGGRESSIVE: Remove ALL problematic toolchains
Write-Host "AGGRESSIVELY removing problematic toolchains..." -ForegroundColor Yellow
rustup toolchain uninstall solana 2>$null
rustup toolchain uninstall 1.75.0-x86_64-pc-windows-msvc 2>$null

# Set Rust 1.79.0 as default
Write-Host "Setting Rust 1.79.0 as default..." -ForegroundColor Yellow
rustup default 1.79.0

# CRITICAL: Clear ALL environment variables that might interfere
Write-Host "Clearing ALL environment variables..." -ForegroundColor Yellow
if ($env:RUSTUP_TOOLCHAIN) {
    Write-Host "Removing RUSTUP_TOOLCHAIN: $env:RUSTUP_TOOLCHAIN" -ForegroundColor Yellow
    Remove-Item Env:RUSTUP_TOOLCHAIN -ErrorAction SilentlyContinue
}
if ($env:CARGO) {
    Write-Host "Removing CARGO: $env:CARGO" -ForegroundColor Yellow
    Remove-Item Env:CARGO -ErrorAction SilentlyContinue
}
if ($env:RUSTC) {
    Write-Host "Removing RUSTC: $env:RUSTC" -ForegroundColor Yellow
    Remove-Item Env:RUSTC -ErrorAction SilentlyContinue
}

# Verify we're using the right Rust
$currentRust = rustc --version 2>&1
Write-Host "Current Rust version: $currentRust" -ForegroundColor Cyan

# Check if we still have the solana toolchain
$remainingSolana = rustup toolchain list | Select-String "solana"
if ($remainingSolana) {
    Write-Host "❌ Solana toolchain still exists! Force removing..." -ForegroundColor Red
    # Force remove the directory
    $solanaPath = "$env:USERPROFILE\.rustup\toolchains\solana"
    if (Test-Path $solanaPath) {
        Write-Host "Force removing directory: $solanaPath" -ForegroundColor Yellow
        Remove-Item $solanaPath -Recurse -Force -ErrorAction SilentlyContinue
    }
}

# Try to install Solana targets for Rust 1.79.0
Write-Host "Installing Solana targets for Rust 1.79.0..." -ForegroundColor Yellow
rustup target add bpfel-unknown-unknown

# Verify targets are available
$targetCheck = rustc --print target-list 2>&1 | Select-String "bpfel-unknown-unknown"
if ($targetCheck) {
    Write-Host "✅ Solana target found: bpfel-unknown-unknown" -ForegroundColor Green
} else {
    Write-Host "❌ Solana target not found!" -ForegroundColor Red
    Write-Host "This suggests we need a different approach..." -ForegroundColor Yellow
}

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

# AGGRESSIVE: Remove any Anchor toolchain configuration files
Write-Host "AGGRESSIVELY removing Anchor toolchain configuration..." -ForegroundColor Yellow
$anchorConfigPaths = @(
    "$env:USERPROFILE\.anchor",
    "$env:USERPROFILE\.cargo\config.toml",
    "$env:USERPROFILE\.cargo\config",
    "$env:USERPROFILE\.rustup\toolchains\solana"
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

# Try to build with explicit toolchain
Write-Host "Attempting to build with explicit Rust 1.79.0..." -ForegroundColor Yellow
$buildOutput = rustup run 1.79.0 anchor build 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Smart contract built successfully!" -ForegroundColor Green
    
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
    Write-Host "❌ Failed to build smart contract" -ForegroundColor Red
    Write-Host ""
    Write-Host "Build output:" -ForegroundColor Cyan
    Write-Host $buildOutput -ForegroundColor White
    Write-Host ""
    Write-Host "=== TROUBLESHOOTING ===" -ForegroundColor Yellow
    Write-Host "1. Anchor configuration has been completely reset" -ForegroundColor White
    Write-Host "2. Rust 1.79.0 is set as default with Solana targets" -ForegroundColor White
    Write-Host "3. Try running manually: rustup run 1.79.0 anchor build" -ForegroundColor White
    Write-Host "4. Check if there are any remaining toolchain references" -ForegroundColor White
}

Read-Host "Press Enter to continue"


